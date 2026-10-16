import test from 'node:test';
import assert from 'node:assert/strict';
import { letterOf, groupAlphabetically, compareTitles, buildTags } from '../build/tags.js';

const pg = (slug, title, tags = [], status = 'published') => ({ slug, dir: slug.includes('/') ? slug.split('/').slice(0, -1).join('/') : '', title, status, tags });

test('titles are filed under their first letter; digits together; other characters under #', () => {
  assert.equal(letterOf('Arrows and clay'), 'A');
  assert.equal(letterOf('a fork in the path'), 'A');
  assert.equal(letterOf('388YE Autumn Equinox'), '0–9');
  assert.equal(letterOf('Élan'), 'E');
  assert.equal(letterOf('"Quoted"'), '#');
  assert.equal(letterOf('Ωmega'), 'Ω');
});

test('grouping follows the reference layout: digits first, then A-Z, each group sorted', () => {
  const items = ['The bargain store', 'A fork in the path', '388YE Autumn Equinox winds of war', 'Accomplices', '388YE Autumn Equinox Conclave sessions', 'Dream on', 'Domain expansion', '?odd'].map((title) => ({ title }));
  const groups = groupAlphabetically(items);
  assert.deepEqual(groups.map((g) => g.letter), ['0–9', 'A', 'D', 'T', '#']);
  assert.deepEqual(groups[0].items.map((i) => i.title), ['388YE Autumn Equinox Conclave sessions', '388YE Autumn Equinox winds of war']);
  assert.deepEqual(groups[1].items.map((i) => i.title), ['A fork in the path', 'Accomplices']);
  assert.deepEqual(groups[2].items.map((i) => i.title), ['Domain expansion', 'Dream on']);
});

test('sorting ignores case and accents and treats numbers as numbers', () => {
  assert.ok(compareTitles('room 2', 'Room 10') < 0);
  assert.ok(compareTitles('apple', 'Banana') < 0);
  assert.ok(compareTitles('Élan', 'Eagle') > 0); // accents don't push it to the end
  assert.equal(compareTitles('Élan', 'elan'), 0);
});

test('tags merge by case and spelling; most-used spelling names the tag; only published pages are members', () => {
  const pages = [
    pg('a', 'A', ['Characters', 'solo']),
    pg('b', 'B', ['characters']),
    pg('c', 'C', ['CHARACTERS', 'characters']),
    pg('d', 'D', ['characters', 'secret-tag'], 'draft'),
    pg('e', 'E', ['characters', 'hidden-only'], 'hidden'),
  ];
  const tags = buildTags(pages, []);
  const chars = tags.find((t) => t.slug === 'characters');
  assert.equal(chars.name, 'characters'); // 2 uses vs 1 vs 1
  assert.deepEqual(chars.members.map((p) => p.slug), ['a', 'b', 'c']); // not the draft or hidden page, no duplicates
  assert.ok(!tags.some((t) => ['secret-tag', 'hidden-only'].includes(t.slug)));
  assert.ok(tags.some((t) => t.slug === 'solo'));
});

test('tags.yml names win, define tags with no pages, and supply the short description', () => {
  const tags = buildTags([pg('a', 'A', ['characters'])], [{ name: 'Characters', description: 'People' }, { name: 'Factions', description: 'Groups' }]);
  const c = tags.find((t) => t.slug === 'characters');
  assert.equal(c.name, 'Characters');
  assert.equal(c.description, 'People');
  assert.equal(c.members.length, 1);
  const f = tags.find((t) => t.slug === 'factions');
  assert.equal(f.members.length, 0);
});

test('a page in content/tags/ describes the tag with its file name; drafts are ignored; it is never a member', () => {
  const desc = pg('tags/characters', 'About characters', ['characters']);
  const tags = buildTags([desc, pg('x', 'X', ['characters'])], []);
  const c = tags.find((t) => t.slug === 'characters');
  assert.equal(c.descPage, desc);
  assert.deepEqual(c.members.map((p) => p.slug), ['x']);
  const drafted = buildTags([pg('tags/orphan', 'Orphan', [], 'draft')], []);
  assert.equal(drafted.length, 0);
  const orphan = buildTags([pg('tags/lonely', 'Lonely things', [])], []);
  assert.equal(orphan[0].name, 'Lonely things'); // a description page alone still makes a tag
});

test('tags with no letters or digits warn and get no page', () => {
  const warned = [];
  const tags = buildTags([pg('a', 'A', ['???'])], [], (m) => warned.push(m));
  assert.equal(tags.length, 0);
  assert.match(warned[0], /no letters or digits/);
});

test('tags are sorted by name', () => {
  const tags = buildTags([pg('a', 'A', ['zebra', 'Apple', 'mango'])], []);
  assert.deepEqual(tags.map((t) => t.name), ['Apple', 'mango', 'zebra']);
});
