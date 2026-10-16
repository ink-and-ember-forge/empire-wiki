// Page IDs and per-page link maps. See spec.md, "Link IDs".
//
// A page may have an `id` in its front matter. Its [[wiki links]] are recorded in
// links/<page id>.yml as { "link text": "target page id" }, so a link keeps pointing
// at the same page after that page is moved or retitled. The page text itself is
// never rewritten: the link text stays exactly as written.
import yaml from '../vendor/js-yaml.mjs';
import { linkKey } from './wikilinks.js';

export { linkKey };

// Starts with a letter so YAML never reads an id as a number (e.g. 1e5).
const FIRST = 'abcdefghjkmnpqrstvwxyz';
const REST = `${FIRST}23456789`;
export const ID_PATTERN = /^[a-z][a-z0-9]{5,15}$/;
export const linkMapPath = (id) => `links/${id}.yml`;

function pick(alphabet) {
  const limit = 256 - (256 % alphabet.length); // reject biased bytes
  for (;;) {
    const [b] = crypto.getRandomValues(new Uint8Array(1));
    if (b < limit) return alphabet[b % alphabet.length];
  }
}

/** A fresh 8-character id that isn't in `taken` (a Set). */
export function newId(taken = new Set()) {
  for (;;) {
    const id = pick(FIRST) + Array.from({ length: 7 }, () => pick(REST)).join('');
    if (!taken.has(id)) return id;
  }
}

/** Map of linkKey -> raw target text, for every [[link]] outside code in `body`. */
export function linkTargets(md, body) {
  const found = new Map();
  const walk = (tokens) => {
    for (const t of tokens) {
      if (t.type === 'wikilink') found.set(linkKey(t.meta.target), t.meta.target);
      if (t.children) walk(t.children);
    }
  };
  walk(md.parse(body, {}));
  return found;
}

export function parseLinkMap(text) {
  const doc = yaml.load(text, { schema: yaml.CORE_SCHEMA });
  const out = new Map();
  for (const [k, v] of Object.entries(doc?.links ?? {})) if (typeof v === 'string' || typeof v === 'number') out.set(String(k), String(v));
  return out;
}

export function serializeLinkMap(map) {
  const links = {};
  for (const k of [...map.keys()].sort()) links[k] = map.get(k);
  return `# Maintained by the editor. Maps the text of each [[wiki link]] on one page to the ID of the page it points at.\n${yaml.dump({ links }, { schema: yaml.CORE_SCHEMA, lineWidth: -1 })}`;
}

/**
 * The link map a page should have after this edit.
 *  - targets:   Map(linkKey -> raw text) of links currently in the body
 *  - existing:  the page's current link map
 *  - picked:    Map(linkKey -> id) chosen explicitly in the picker this session
 *  - knownIds:  Set of ids that exist; a recorded id for a deleted page is dropped
 *  - byName:    (raw text) -> id | undefined, how an unrecorded link resolves by name today
 * Precedence: picked, then already recorded, then resolved by name. Links no longer in the body are dropped.
 */
export function canonicalize({ targets, existing, picked = new Map(), knownIds, byName }) {
  const out = new Map();
  for (const [key, raw] of targets) {
    const rec = existing.get(key);
    const id = picked.get(key) ?? (rec && knownIds.has(rec) ? rec : undefined) ?? byName(raw);
    if (id) out.set(key, id);
  }
  return out;
}

export const sameMap = (a, b) => serializeLinkMap(a) === serializeLinkMap(b);
