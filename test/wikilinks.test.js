import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { wikilinkPlugin, makeResolver, slugify } from '../editor/lib/wikilinks.js';

const entries = [
  { slug: 'characters/navarr-vate', title: 'Navarr Vate', status: 'published' },
  { slug: 'factions/secret', title: 'The Secret Order', status: 'hidden' },
  { slug: 'locations/ashfall', title: 'Ashfall', status: 'draft' },
  { slug: 'characters/ash', title: 'Ash', status: 'published' },
  { slug: 'locations/ash', title: 'Ash', status: 'published' },
];
const BASE = '/empire-wiki';
const md = new MarkdownIt({ html: false, linkify: true }).use(wikilinkPlugin);
const resolve = makeResolver(entries, { basePath: BASE });
const render = (src, fromDir = '', warns = []) =>
  md.renderInline(src, { wikiResolve: (t) => resolve(t, fromDir), wikiWarn: (m) => warns.push(m) });

test('existing page by title, case-insensitively', () => {
  assert.equal(render('[[navarr vate]]'), '<a class="wikilink" href="/empire-wiki/characters/navarr-vate/">navarr vate</a>');
});

test('existing page by file name and by path', () => {
  assert.match(render('[[navarr-vate]]'), /href="\/empire-wiki\/characters\/navarr-vate\/"/);
  assert.match(render('[[characters/navarr-vate]]'), /href="\/empire-wiki\/characters\/navarr-vate\/"/);
});

test('custom label after a bar', () => {
  assert.match(render('[[Navarr Vate|the envoy]]'), />the envoy<\/a>/);
});

test('hidden pages exist (reachable by link)', () => {
  assert.match(render('[[The Secret Order]]'), /class="wikilink" href="\/empire-wiki\/factions\/secret\/"/);
});

test('missing page renders differently and opens the editor next to the linking page', () => {
  const out = render('[[Old Kael]]', 'characters');
  assert.match(out, /class="wikilink missing"/);
  assert.match(out, /href="\/empire-wiki\/editor\/\?page=characters\/old-kael&amp;title=Old%20Kael"/);
  assert.match(out, /title="No such page yet"/);
});

test('a path target creates the page at that path, from any folder', () => {
  assert.match(render('[[factions/The Guild]]', 'characters'), /page=factions\/the-guild&amp;title=The%20Guild/);
});

test('a draft is not on the site: shown as missing, editor opens the existing draft', () => {
  const out = render('[[Ashfall]]', 'characters');
  assert.match(out, /class="wikilink missing"/);
  assert.match(out, /page=locations\/ashfall/);
  assert.match(out, /Draft: not published yet/);
});

test('ambiguous names warn and prefer the page in the same folder', () => {
  const warns = [];
  assert.match(render('[[ash]]', 'locations', warns), /href="\/empire-wiki\/locations\/ash\/"/);
  assert.match(render('[[ash]]', 'characters', warns), /href="\/empire-wiki\/characters\/ash\/"/);
  assert.equal(warns.length, 2);
  assert.match(warns[0], /matches 2 pages/);
});

test('code, plain brackets and normal links are untouched', () => {
  assert.equal(render('`[[Navarr Vate]]`'), '<code>[[Navarr Vate]]</code>');
  assert.equal(render('[[]] and [[ ]]'), '[[]] and [[ ]]');
  assert.equal(render('[[a\nb]]'), '[[a\nb]]');
  assert.equal(render('[x](https://example.com)'), '<a href="https://example.com">x</a>');
});

test('labels are escaped; unresolvable targets fall back to text', () => {
  assert.equal(render('[[<b>x</b>]]').includes('<b>'), false);
  assert.equal(render('[[???]]'), '???');
});

test('without a resolver the label is plain text', () => {
  assert.equal(md.renderInline('[[Navarr Vate]]'), 'Navarr Vate');
});

test('slugify handles case, accents, apostrophes and spacing', () => {
  assert.equal(slugify("  Kael's Rest — Ünder  "), 'kaels-rest-under');
});
