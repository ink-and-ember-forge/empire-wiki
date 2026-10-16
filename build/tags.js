// Tag pages: which tags exist, which pages carry them, and the A-Z grouping used on each tag page.
import { slugify } from '../editor/lib/wikilinks.js';

/** Pages that sit directly in content/tags/ are tag descriptions, not ordinary pages. */
export const TAGS_DIR = 'tags';
export const isTagDescription = (p) => p.dir === TAGS_DIR;

const fold = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();

/** Case-insensitive, digit-aware ("Room 2" before "Room 10"), accents ignored. */
export const compareTitles = (a, b) => fold(a).localeCompare(fold(b), 'en', { numeric: true, sensitivity: 'base' });

/** The heading a title is filed under: its first letter, "0-9" for digits, "#" for anything else. */
export function letterOf(title) {
  const c = fold(title).charAt(0).toUpperCase();
  if (/[0-9]/.test(c)) return '0–9';
  if (/\p{L}/u.test(c)) return c;
  return '#';
}

/** [{ letter, items }] with items sorted by title; digits first, then letters, then "#". */
export function groupAlphabetically(items, titleOf = (x) => x.title) {
  const groups = new Map();
  for (const item of [...items].sort((a, b) => compareTitles(titleOf(a), titleOf(b)))) {
    const letter = letterOf(titleOf(item));
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(item);
  }
  const rank = (l) => (l === '0–9' ? 0 : l === '#' ? 2 : 1);
  return [...groups]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([letter, list]) => ({ letter, items: list }));
}

/**
 * Every tag that gets a page.
 *  pages: parsed pages ({ slug, dir, title, status, tags })
 *  defs:  tags.yml entries ({ name, description })
 * A tag exists if it is listed in tags.yml, used by a published page, or has a description page.
 * Tags that differ only by case, spacing or punctuation are one tag. Only published pages are members:
 * drafts aren't on the site and hidden pages are deliberately unlisted.
 * Returns [{ slug, name, description, members, descPage }] sorted by name.
 */
export function buildTags(pages, defs, warn = () => {}) {
  const tags = new Map();
  const names = new Map(); // slug -> Map(spelling -> uses)
  const ensure = (slug) => {
    if (!tags.has(slug)) tags.set(slug, { slug, name: '', defined: false, description: '', members: [], descPage: null });
    return tags.get(slug);
  };

  for (const d of defs) {
    const slug = slugify(d.name);
    if (!slug) continue;
    Object.assign(ensure(slug), { name: d.name, defined: true, description: d.description ?? '' });
  }
  for (const p of pages) {
    if (p.status === 'draft') continue;
    if (isTagDescription(p)) {
      const t = ensure(p.slug.slice(TAGS_DIR.length + 1));
      t.descPage = p;
      if (!t.name) t.name = p.title; // last resort; any tag text or tags.yml entry wins below
      continue;
    }
    if (p.status !== 'published') continue;
    for (const raw of new Set(p.tags)) {
      const slug = slugify(raw);
      if (!slug) {
        warn(`${p.slug}: tag "${raw}" has no letters or digits, so it gets no tag page`);
        continue;
      }
      const t = ensure(slug);
      if (!t.members.includes(p)) t.members.push(p);
      if (!names.has(slug)) names.set(slug, new Map());
      names.get(slug).set(raw, (names.get(slug).get(raw) ?? 0) + 1);
    }
  }
  for (const t of tags.values()) {
    const spellings = names.get(t.slug);
    // Name: tags.yml wins; otherwise the most-used spelling (ties alphabetical); a page title is the last resort.
    if (!t.defined && spellings) t.name = [...spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    if (!t.name) t.name = t.slug;
  }
  return [...tags.values()].sort((a, b) => compareTitles(a.name, b.name));
}
