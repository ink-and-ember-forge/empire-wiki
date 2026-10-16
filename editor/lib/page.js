// Page parsing, serialising and edit summaries. Mirrors the format in spec.md section 5.
import yaml from '../vendor/js-yaml.mjs';

const KNOWN = ['title', 'status', 'stub', 'tags', 'summary', 'updated', 'order', 'id'];
const LABELS = { title: 'title', status: 'status', stub: 'stub flag', summary: 'summary', tags: 'tags', order: 'order' };
const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export const emptyPage = () => ({ fm: { title: '', status: 'draft' }, body: '' });

export function parsePage(text) {
  const m = text.replace(/^﻿/, '').match(FM);
  if (!m) return { fm: {}, body: text };
  const fm = yaml.load(m[1], { schema: yaml.CORE_SCHEMA }) ?? {};
  if (typeof fm !== 'object' || Array.isArray(fm)) throw new Error('Front matter must be a mapping.');
  return { fm, body: m[2] };
}

/** Known keys first in a fixed order; unknown keys are kept so nothing is lost. */
export function serializePage({ fm, body }) {
  const ordered = {};
  for (const k of KNOWN) if (fm[k] !== undefined && fm[k] !== '' && !(Array.isArray(fm[k]) && !fm[k].length)) ordered[k] = fm[k];
  for (const k of Object.keys(fm)) if (!(k in ordered) && !KNOWN.includes(k)) ordered[k] = fm[k];
  const head = yaml.dump(ordered, { schema: yaml.CORE_SCHEMA, flowLevel: 1, lineWidth: -1 });
  return `---\n${head}---\n${body.replace(/^\n+/, '')}`;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Which user-editable parts differ between two versions of a page. */
export function changes(before, after) {
  if (!before) return null;
  const fields = Object.keys(LABELS).filter((k) => !same(before.fm[k], after.fm[k]));
  return { fields, body: before.body.trim() !== after.body.trim() };
}

/** Used when the editor leaves the edit summary blank. */
export function defaultSummary(before, after) {
  if (!before) return `Created ${after.fm.title || 'page'}`;
  const c = changes(before, after);
  const parts = [];
  if (c.body) parts.push('Edited body');
  if (c.fields.length) parts.push(`${parts.length ? 'updated' : 'Updated'} ${list(c.fields.map((f) => LABELS[f]))}`);
  return parts.length ? parts.join('; ') : 'No content changes';
}

export function validate(fm) {
  const problems = [];
  if (!fm.title || !String(fm.title).trim()) problems.push('Title is required.');
  if (!['draft', 'published', 'hidden'].includes(fm.status)) problems.push('Status must be draft, published or hidden.');
  if (fm.order !== undefined && fm.order !== '' && !Number.isFinite(fm.order)) problems.push('Order must be a number.');
  return problems;
}

export const isValidPath = (p) => /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/.test(p);
