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

// ---- tag pages ----
const tagged = (title, tags, extra = '') => page(title, 'x', `tags: [${tags.join(', ')}]\n${extra}`);
const headings = (html) => [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
const listed = (html) => [...html.matchAll(/<li><a href="[^"]*">([^<]+)<\/a>/g)].map((m) => m[1]);

test('a tag page lists its pages A-Z in groups, with a count, like a wiki category', () => {
  const w = wiki({
    'a.md': tagged('The bargain store', ['market']),
    'b.md': tagged('A fork in the path', ['market']),
    'c.md': tagged('388YE Autumn Equinox winds of war', ['market']),
    'd.md': tagged('Accomplices', ['market']),
    'e.md': tagged('388YE Autumn Equinox Conclave sessions', ['market']),
    'f.md': tagged('Dream on', ['market']),
    'g.md': tagged('Unrelated', ['other']),
  });
  assert.equal(w.node('build').status, 0);
  const html = w.site('tags/market/index.html');
  assert.match(html, /<h1>Tag: market<\/h1>/);
  assert.match(html, /6 pages are tagged &ldquo;market&rdquo;\./);
  assert.deepEqual(headings(html), ['0–9', 'A', 'D', 'T']);
  assert.deepEqual(listed(html), ['388YE Autumn Equinox Conclave sessions', '388YE Autumn Equinox winds of war', 'A fork in the path', 'Accomplices', 'Dream on', 'The bargain store']);
  assert.doesNotMatch(html, /Unrelated/);
  assert.match(html, /<main class="wide">/);
});

test('a single page uses the singular', () => {
  const w = wiki({ 'a.md': tagged('Only', ['solo']) });
  w.node('build');
  assert.match(w.site('tags/solo/index.html'), /1 page is tagged &ldquo;solo&rdquo;\./);
});

test('the description is a page in content/tags/, rendered with Markdown and wiki links; it is not a page of its own', () => {
  const w = wiki({
    'a.md': tagged('Alpha', ['lore']),
    'b.md': page('Beta', 'x'),
    'tags/lore.md': page('Lore', 'Old stories, **mostly** true. See [[Beta]].'),
  });
  const b = w.node('build');
  assert.equal(b.status, 0, b.stderr);
  const html = w.site('tags/lore/index.html');
  assert.match(html, /<strong>mostly<\/strong>/);
  assert.match(html, /<a class="wikilink" href="\/w\/b\/">Beta<\/a>/);
  assert.doesNotMatch(html, /no description yet/);
  assert.match(html, /<h1>Tag: lore<\/h1>/); // the heading is the tag, not the description page's title
  assert.match(html, /Change log/);
  const search = JSON.parse(w.site('search.json'));
  assert.ok(search.some((e) => e.title === 'Tag: lore' && e.url === '/w/tags/lore/'));
  assert.ok(!search.some((e) => e.title === 'Lore'), 'the description page is not a separate search result');
});

test('without a description page, the short description from tags.yml is used, else a prompt', () => {
  const w = wiki({ 'a.md': tagged('Alpha', ['characters', 'plain']) });
  w.write('tags.yml', 'tags:\n  - name: characters\n    description: People and beings in the setting\n');
  w.node('build');
  assert.match(w.site('tags/characters/index.html'), /<p>People and beings in the setting<\/p>/);
  assert.match(w.site('tags/plain/index.html'), /This tag has no description yet\./);
});

test('"Edit description" opens the editor on content/tags/<tag>, published, titled with the tag', () => {
  const w = wiki({ 'a.md': tagged('Alpha', ['Old Kael']) });
  w.node('build');
  assert.match(w.site('tags/old-kael/index.html'), /href="\/w\/editor\/\?page=tags\/old-kael&amp;title=Old%20Kael&amp;status=published"/);
});

test('tags that differ only by case or spacing are one tag; each page links its tags', () => {
  const w = wiki({ 'a.md': tagged('Alpha', ['Characters']), 'b.md': tagged('Beta', ['characters']), 'c.md': tagged('Gamma', ['Old Kael']) });
  w.node('build');
  assert.deepEqual(listed(w.site('tags/characters/index.html')), ['Alpha', 'Beta']);
  assert.ok(!w.exists('_site/tags/Characters'));
  assert.match(w.site('a/index.html'), /<a class="tag" href="\/w\/tags\/characters\/">Characters<\/a>/);
  assert.match(w.site('c/index.html'), /<a class="tag" href="\/w\/tags\/old-kael\/">Old Kael<\/a>/);
});

test('drafts and hidden pages are never listed, and a tag only they use gets no page', () => {
  const w = wiki({
    'a.md': tagged('Public', ['shared']),
    'b.md': page('Draft one', 'x', 'tags: [shared, secret]\n').replace('status: published', 'status: draft'),
    'c.md': page('Hidden one', 'x', 'tags: [shared, quiet]\n').replace('status: published', 'status: hidden'),
  });
  w.node('build');
  assert.deepEqual(listed(w.site('tags/shared/index.html')), ['Public']);
  assert.ok(!w.exists('_site/tags/secret'));
  assert.ok(!w.exists('_site/tags/quiet'));
  assert.ok(!JSON.stringify(JSON.parse(w.site('search.json'))).includes('secret'));
});

test('a tag in tags.yml with no pages still gets a page', () => {
  const w = wiki({ 'a.md': page('Alpha', 'x') });
  w.write('tags.yml', 'tags:\n  - name: factions\n    description: Groups\n');
  w.node('build');
  assert.match(w.site('tags/factions/index.html'), /No pages have this tag yet\./);
});

test('the tag index lists every tag with its count; /tags/ is not a folder listing', () => {
  const w = wiki({ 'a.md': tagged('Alpha', ['zeta', 'apple']), 'b.md': tagged('Beta', ['apple']), 'tags/apple.md': page('Apple', 'About apples') });
  w.node('build');
  const html = w.site('tags/index.html');
  assert.match(html, /2 tags\./);
  assert.deepEqual([...html.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a> <small>\((\d+)\)/g)].map((m) => [m[2], m[3]]), [['apple', '2'], ['zeta', '1']]);
  assert.doesNotMatch(html, /About apples/);
  assert.match(w.site('index.html'), /href="\/w\/tags\/"/); // the header links to Tags
});

test('moving a description page out of place leaves redirects, and a tag page is never overwritten by one', () => {
  const w = wiki({ 'a.md': tagged('Alpha', ['lore']), 'tags/lore.md': page('Lore', LONG) });
  w.git('mv', 'content/tags/lore.md', 'content/lore-notes.md');
  w.commit('move out');
  const b = w.node('build');
  assert.equal(b.status, 0, b.stderr);
  assert.match(w.site('tags/lore/index.html'), /Tag: lore/); // the tag page survives, no description now
  assert.match(b.stderr, /old address \/tags\/lore\/ is now a different page/);
});
