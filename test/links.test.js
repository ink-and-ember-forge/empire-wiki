import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { wikilinkPlugin, makeResolver } from '../editor/lib/wikilinks.js';
import { newId, ID_PATTERN, linkTargets, parseLinkMap, serializeLinkMap, canonicalize, sameMap } from '../editor/lib/links.js';

const md = new MarkdownIt().use(wikilinkPlugin);

test('ids look right, never read as numbers in YAML, and avoid taken ones', () => {
  const taken = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = newId(taken);
    assert.match(id, ID_PATTERN);
    assert.equal(id.length, 8);
    assert.ok(!taken.has(id));
    taken.add(id);
  }
  const map = new Map([['x', 'a2345678']]);
  assert.equal(parseLinkMap(serializeLinkMap(map)).get('x'), 'a2345678');
});

test('numeric-looking ids still survive a YAML round trip as strings', () => {
  const m = new Map([['a', '12345678'], ['b', '1e5']]);
  const back = parseLinkMap(serializeLinkMap(m));
  assert.equal(back.get('a'), '12345678');
  assert.equal(back.get('b'), '1e5');
});

test('link targets are found outside code only, normalised, and deduplicated', () => {
  const body = 'See [[Navarr  Vate]] and [[navarr vate|him]].\n\n`[[Not A Link]]`\n\n```\n[[Nor This]]\n```\n\n- [[Old Kael]]\n';
  const t = linkTargets(md, body);
  assert.deepEqual([...t.keys()], ['navarr vate', 'old kael']);
});

test('link maps serialise sorted and round-trip', () => {
  const m = new Map([['zed', 'b1'], ['alpha: beta', 'a1']]);
  const text = serializeLinkMap(m);
  assert.ok(text.indexOf('alpha') < text.indexOf('zed'));
  assert.deepEqual([...parseLinkMap(text)], [['alpha: beta', 'a1'], ['zed', 'b1']]);
  assert.equal(parseLinkMap('').size, 0);
  assert.ok(sameMap(m, new Map([...m].reverse())));
});

test('canonicalize: picked beats recorded beats name; stale ids and removed links are dropped', () => {
  const targets = new Map([['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D'], ['e', 'E']]);
  const existing = new Map([['b', 'idB-old'], ['c', 'idC'], ['gone', 'idGone'], ['d', 'idDeleted']]);
  const picked = new Map([['b', 'idB-picked']]);
  const knownIds = new Set(['idB-old', 'idC', 'idB-picked', 'idD-byname', 'idA']);
  const byName = (raw) => ({ A: 'idA', D: 'idD-byname' })[raw];
  const out = canonicalize({ targets, existing, picked, knownIds, byName });
  assert.deepEqual(Object.fromEntries(out), { a: 'idA', b: 'idB-picked', c: 'idC', d: 'idD-byname' }); // e unresolved, gone removed
});

test('a recorded id keeps a link working after the target is moved and retitled', () => {
  const links = new Map([['navarr vate', 'n4v7k2']]);
  const before = [{ slug: 'characters/navarr-vate', title: 'Navarr Vate', status: 'published', id: 'n4v7k2' }];
  const after = [{ slug: 'figures/navarr-the-wise', title: 'Navarr the Wise', status: 'published', id: 'n4v7k2' }];
  const plain = makeResolver(after, { basePath: '/w' });
  assert.equal(plain('Navarr Vate').exists, false); // by name alone: broken
  const r = makeResolver(after, { basePath: '/w' })('Navarr Vate', 'characters', links);
  assert.equal(r.exists, true);
  assert.equal(r.url, '/w/figures/navarr-the-wise/');
  assert.equal(makeResolver(before, { basePath: '/w' })('Navarr Vate', '', links).url, '/w/characters/navarr-vate/');
});

test('a recorded id wins over a different page that now has the same title', () => {
  const entries = [
    { slug: 'a/ash', title: 'Ash', status: 'published', id: 'idA' },
    { slug: 'b/ash', title: 'Ash', status: 'published', id: 'idB' },
  ];
  const r = makeResolver(entries)('Ash', 'a', new Map([['ash', 'idB']]));
  assert.equal(r.slug, 'b/ash');
  assert.equal(r.ambiguous, null);
});

test('a recorded id that points at a draft is a missing link to that draft', () => {
  const entries = [{ slug: 'x/secret', title: 'Secret', status: 'draft', id: 'idS' }];
  const r = makeResolver(entries)('whatever it was called', '', new Map([['whatever it was called', 'idS']]));
  assert.equal(r.exists, false);
  assert.equal(r.draft, true);
  assert.match(r.editUrl, /page=x\/secret/);
});

test('a recorded id for a page that no longer exists falls back to the name', () => {
  const entries = [{ slug: 'x/ash', title: 'Ash', status: 'published', id: 'idA' }];
  const r = makeResolver(entries)('Ash', '', new Map([['ash', 'idGone']]));
  assert.equal(r.slug, 'x/ash');
});

import { loadIndex, matchPages, linkText } from '../editor/lib/pageindex.js';

test('the page index reads titles, statuses and ids, reuses its cache, and survives bad files', async () => {
  const files = new Map([['a/one', 's1'], ['a/two', 's2'], ['b/bad', 's3'], ['c/untitled', 's4']]);
  const texts = {
    s1: '---\ntitle: One\nstatus: published\nid: aaaaaaaa\n---\nx',
    s2: '---\ntitle: Two\n---\ny',
    s4: '---\nstatus: published\n---\nno title',
  };
  let fetched = [];
  const fetchText = async (sha) => {
    fetched.push(sha);
    if (!texts[sha]) throw new Error('boom');
    return texts[sha];
  };
  const cache = new Map();
  const progress = [];
  const idx = await loadIndex(files, fetchText, cache, { onProgress: (d, n) => progress.push([d, n]) });
  assert.deepEqual(idx.map((e) => [e.slug, e.title, e.status, e.id]), [
    ['a/one', 'One', 'published', 'aaaaaaaa'],
    ['a/two', 'Two', 'draft', ''],
    ['b/bad', 'b/bad', 'draft', ''],
    ['c/untitled', 'c/untitled', 'published', ''],
  ]);
  assert.deepEqual(progress.at(-1), [4, 4]);
  fetched = [];
  await loadIndex(files, fetchText, cache);
  assert.deepEqual(fetched, ['s3']); // only the file that failed is retried
});

test('picker matching ranks title prefix, then title contains, then file name', () => {
  const entries = [
    { slug: 'characters/navarr-vate', title: 'Navarr Vate' },
    { slug: 'locations/navarr', title: 'Navarr' },
    { slug: 'characters/nisien', title: 'Nisien Duskbound' },
    { slug: 'factions/the-vate', title: 'The Vate Order' },
    { slug: 'x/old-kael', title: 'Kael the Elder' },
  ];
  assert.deepEqual(matchPages(entries, 'nav').map((e) => e.title), ['Navarr', 'Navarr Vate']);
  assert.deepEqual(matchPages(entries, 'vate').map((e) => e.title), ['Navarr Vate', 'The Vate Order']);
  assert.deepEqual(matchPages(entries, 'old kael').map((e) => e.title), ['Kael the Elder']); // by file name
  assert.equal(matchPages(entries, 'zzz').length, 0);
  assert.equal(matchPages(entries, '', 3).length, 3);
});

test('link text falls back to the path when a title would break the syntax', () => {
  assert.equal(linkText({ title: 'Navarr', slug: 'a/navarr' }), 'Navarr');
  assert.equal(linkText({ title: 'A | B', slug: 'a/a-b' }), 'a/a-b');
  assert.equal(linkText({ title: 'Is [this] ok', slug: 'a/ok' }), 'a/ok');
});
