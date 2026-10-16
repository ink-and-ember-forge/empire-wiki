import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A throwaway wiki repo with the real build scripts, so Git history and moves behave for real. */
function wiki(pages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-test-'));
  for (const d of ['build', 'editor']) fs.cpSync(path.join(REPO, d), path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'wiki.yml'), 'schema: 1\ntitle: T\nbase_url: https://example.com/w\ndefault_status: draft\nrepo: o/r\n');
  fs.writeFileSync(path.join(dir, 'tags.yml'), 'tags: []\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  const api = {
    dir,
    write(rel, text) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    },
    read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(dir, rel)),
    git(...args) {
      const r = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    },
    commit(msg) {
      api.git('add', '-A');
      api.git('commit', '-qm', msg);
    },
    node: (script, ...args) => spawnSync('node', [`build/${script}.js`, ...args], { cwd: dir, encoding: 'utf8' }),
    site: (rel) => fs.readFileSync(path.join(dir, '_site', rel), 'utf8'),
  };
  api.git('init', '-q');
  for (const [rel, text] of Object.entries(pages)) api.write(`content/${rel}`, text);
  api.commit('seed');
  return api;
}

const page = (title, body, extra = '') => `---\ntitle: ${title}\nstatus: published\n${extra}---\n${body}\n`;
const LONG = 'Enough body text that Git recognises the file as the same one after it is renamed and edited, repeated. '.repeat(3);

test('ids + link maps keep a link working after the target is moved AND retitled; old address redirects', () => {
  const w = wiki({
    'characters/navarr.md': page('Navarr Vate', LONG),
    'characters/nisien.md': page('Nisien', 'A vate in [[Navarr Vate]].'),
  });
  const ids = w.node('ids');
  assert.equal(ids.status, 0, ids.stderr);
  assert.match(w.read('content/characters/navarr.md'), /\nid: [a-z][a-z0-9]{7}\n---/);
  const nisienId = w.read('content/characters/nisien.md').match(/\nid: (\w+)/)[1];
  assert.match(w.read(`links/${nisienId}.yml`), /navarr vate: \w{8}/);
  assert.match(w.read('content/characters/nisien.md'), /A vate in \[\[Navarr Vate\]\]\./); // text untouched
  w.commit('ids');

  // move and retitle in one commit
  fs.mkdirSync(path.join(w.dir, 'content/figures'));
  w.git('mv', 'content/characters/navarr.md', 'content/figures/navarr-the-wise.md');
  w.write('content/figures/navarr-the-wise.md', w.read('content/figures/navarr-the-wise.md').replace('title: Navarr Vate', 'title: Navarr the Wise'));
  w.commit('rename');

  const b = w.node('build');
  assert.equal(b.status, 0, b.stderr);
  const html = w.site('characters/nisien/index.html');
  assert.match(html, /<a class="wikilink" href="\/w\/figures\/navarr-the-wise\/">Navarr Vate<\/a>/);
  const redirect = w.site('characters/navarr/index.html');
  assert.match(redirect, /http-equiv="refresh" content="0; url=\/w\/figures\/navarr-the-wise\/"/);
  assert.match(redirect, /noindex/);
});

test('control: without ids the same move breaks the link', () => {
  const w = wiki({
    'characters/navarr.md': page('Navarr Vate', LONG),
    'characters/nisien.md': page('Nisien', 'A vate in [[Navarr Vate]].'),
  });
  w.git('mv', 'content/characters/navarr.md', 'content/navarr-the-wise.md');
  w.write('content/navarr-the-wise.md', w.read('content/navarr-the-wise.md').replace('title: Navarr Vate', 'title: Navarr the Wise'));
  w.commit('rename');
  assert.equal(w.node('build').status, 0);
  assert.match(w.site('characters/nisien/index.html'), /class="wikilink missing"/);
  assert.match(w.site('characters/navarr/index.html'), /refresh/); // the address still redirects
});

test('the build says how many links and pages still match by name only', () => {
  const w = wiki({
    'a.md': page('A', 'x', 'id: aaaaaaaa\n'),
    'b.md': page('B', 'see [[A]]', 'id: bbbbbbbb\n'),
    'c.md': page('C', 'no id'),
  });
  const b = w.node('build');
  assert.match(b.stderr, /1 page\(s\) have no id/);
  assert.match(b.stderr, /1 link\(s\) on 1 page\(s\) match by name only/);
  w.node('ids');
  const again = w.node('build');
  assert.doesNotMatch(again.stderr, /match by name only|have no id/);
});

test('duplicate ids fail the build', () => {
  const w = wiki({ 'a.md': page('A', 'x', 'id: samesame\n'), 'b.md': page('B', 'y', 'id: samesame\n') });
  const b = w.node('build');
  assert.equal(b.status, 1);
  assert.match(b.stderr, /id "samesame" is also used by/);
});

test('invalid ids fail the build', () => {
  const w = wiki({ 'a.md': page('A', 'x', 'id: 12345\n') });
  const b = w.node('build');
  assert.equal(b.status, 1);
  assert.match(b.stderr, /invalid id/);
});

test('orphaned link maps and dangling targets are warnings, and name matching still works', () => {
  const w = wiki({ 'a.md': page('A', 'x', 'id: aaaaaaaa\n'), 'b.md': page('B', 'see [[A]]', 'id: bbbbbbbb\n') });
  w.write('links/zzzzzzzz.yml', 'links: {}\n');
  w.write('links/bbbbbbbb.yml', 'links:\n  a: gonegone\n');
  const b = w.node('build');
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stderr, /no page has id "zzzzzzzz"/);
  assert.match(b.stderr, /"a" points at id "gonegone"/);
  assert.match(w.site('b/index.html'), /class="wikilink" href="\/w\/a\/"/);
});

test('a redirect never overwrites a page that now lives at the old address', () => {
  const w = wiki({ 'old.md': page('Old', LONG) });
  w.git('mv', 'content/old.md', 'content/new.md');
  w.commit('move');
  w.write('content/old.md', page('Something else', 'a different page now'));
  w.commit('reuse old name');
  const b = w.node('build');
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stderr, /old address \/old\/ is now a different page/);
  assert.match(w.site('old/index.html'), /Something else/);
});

test('ids --check changes nothing and reports', () => {
  const w = wiki({ 'a.md': page('A', 'x') });
  const before = w.read('content/a.md');
  const c = w.node('ids', '--check');
  assert.equal(c.status, 1);
  assert.equal(w.read('content/a.md'), before);
  assert.ok(!w.exists('links'));
  w.node('ids');
  assert.equal(w.node('ids', '--check').status, 0);
});
