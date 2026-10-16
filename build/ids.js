// Backfills page ids and link maps so [[wiki links]] survive moves and retitles.
//   npm run ids              write missing ids and links/<id>.yml files
//   npm run ids -- --check   change nothing; exit 1 if anything would change
// Safe to re-run. Only adds an `id:` line to front matter; page text is never touched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import MarkdownIt from 'markdown-it';
import { wikilinkPlugin, makeResolver } from '../editor/lib/wikilinks.js';
import { newId, linkTargets, parseLinkMap, serializeLinkMap, canonicalize, linkMapPath, ID_PATTERN } from '../editor/lib/links.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const check = process.argv.includes('--check');
const md = new MarkdownIt({ html: false, linkify: true }).use(wikilinkPlugin);
const FM = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/;

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.md')) files.push(f);
  }
})(CONTENT);

const pages = [];
let problems = 0;
for (const file of files) {
  const rel = path.relative(CONTENT, file).split(path.sep).join('/');
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.replace(/^﻿/, '').match(FM);
  let fm;
  try {
    fm = m && yaml.load(m[2], { schema: yaml.CORE_SCHEMA });
  } catch {
    fm = null;
  }
  if (!fm || typeof fm !== 'object' || typeof fm.title !== 'string') {
    console.error(`skipping ${rel}: needs valid front matter with a title`);
    problems++;
    continue;
  }
  const id = fm.id == null ? '' : String(fm.id);
  if (id && !ID_PATTERN.test(id)) {
    console.error(`skipping ${rel}: invalid id "${id}"`);
    problems++;
    continue;
  }
  const slug = rel.slice(0, -3);
  pages.push({ file, rel, slug, dir: path.posix.dirname(slug) === '.' ? '' : path.posix.dirname(slug), title: fm.title, status: fm.status ?? 'draft', id, body: m[4], raw });
}

const taken = new Set(pages.map((p) => p.id).filter(Boolean));
let changes = 0;

// 1. ids
for (const p of pages.filter((x) => !x.id)) {
  p.id = newId(taken);
  taken.add(p.id);
  const m = p.raw.match(FM);
  const text = `${m[1]}${m[2]}\nid: ${p.id}${m[3]}${m[4]}`;
  console.log(`${check ? 'would give' : 'id'} ${p.id} -> ${p.rel}`);
  changes++;
  if (!check) fs.writeFileSync(p.file, text);
}

// 2. link maps, from how each link resolves by name today
const resolve = makeResolver(pages, { basePath: '' });
const bySlug = new Map(pages.map((p) => [p.slug, p]));
const known = new Set(pages.map((p) => p.id));
for (const p of pages) {
  const file = path.join(ROOT, linkMapPath(p.id));
  const existingText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const existing = existingText ? parseLinkMap(existingText) : new Map();
  const byName = (raw) => {
    const r = resolve(raw, p.dir);
    return r && (r.exists || r.draft) ? bySlug.get(r.slug)?.id : undefined;
  };
  const next = canonicalize({ targets: linkTargets(md, p.body), existing, knownIds: known, byName });
  if (!next.size && existingText === null) continue; // nothing to record
  const text = serializeLinkMap(next);
  if (text === existingText) continue;
  console.log(`${check ? 'would write' : 'wrote'} ${linkMapPath(p.id)} (${next.size} link${next.size === 1 ? '' : 's'}) for ${p.rel}`);
  changes++;
  if (!check) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

console.log(changes ? `${check ? 'Would change' : 'Changed'} ${changes} file(s).` : 'Everything already has ids and link maps.');
process.exit(check && (changes || problems) ? 1 : 0);
