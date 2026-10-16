// Empire Notes Wiki build: content/*.md -> _site/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import MarkdownIt from 'markdown-it';
import { pageHtml, listingHtml, redirectHtml, tagHtml, tagsIndexHtml, esc } from './template.js';
import { buildTags, groupAlphabetically, isTagDescription, TAGS_DIR } from './tags.js';
import { wikilinkPlugin, makeResolver, slugify } from '../editor/lib/wikilinks.js';
import { ID_PATTERN, linkTargets, linkKey, parseLinkMap } from '../editor/lib/links.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const OUT = path.join(ROOT, '_site');
const SUPPORTED_SCHEMA = 1;
const STATUSES = ['draft', 'published', 'hidden'];

const errors = [];
const warnings = [];

// CORE_SCHEMA keeps dates as plain strings instead of Date objects.
const loadYaml = (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA });
const readYaml = (file) => loadYaml(fs.readFileSync(path.join(ROOT, file), 'utf8')) ?? {};

const wiki = readYaml('wiki.yml');
if (wiki.schema !== SUPPORTED_SCHEMA) {
  console.error(`Unsupported schema ${wiki.schema}; this build supports ${SUPPORTED_SCHEMA}.`);
  process.exit(1);
}
const tagYml = (readYaml('tags.yml').tags ?? []).map((t) => ({ name: String(t.name), description: t.description ? String(t.description) : '' }));
const tagDefs = tagYml.map((t) => t.name);
const defaultStatus = STATUSES.includes(wiki.default_status) ? wiki.default_status : 'draft';
const basePath = new URL(process.env.BASE_URL ?? wiki.base_url ?? 'http://localhost/').pathname.replace(/\/$/, '');
const showHistory = wiki.editor?.show_history !== false;

const md = new MarkdownIt({ html: false, linkify: true }).use(wikilinkPlugin);

function parsePage(file) {
  const rel = path.relative(CONTENT, file).split(path.sep).join('/');
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    errors.push(`${rel}: missing front matter`);
    return null;
  }
  let fm;
  try {
    fm = loadYaml(m[1]) ?? {};
  } catch (e) {
    errors.push(`${rel}: invalid front matter (${e.message.split('\n')[0]})`);
    return null;
  }
  if (typeof fm !== 'object' || Array.isArray(fm)) {
    errors.push(`${rel}: front matter must be a mapping`);
    return null;
  }
  if (!fm.title || typeof fm.title !== 'string') {
    errors.push(`${rel}: missing required field "title"`);
    return null;
  }
  const status = fm.status ?? defaultStatus;
  if (!STATUSES.includes(status)) {
    errors.push(`${rel}: invalid status "${status}" (expected ${STATUSES.join(' | ')})`);
    return null;
  }
  const id = fm.id === undefined || fm.id === null ? '' : String(fm.id);
  if (id && !ID_PATTERN.test(id)) {
    errors.push(`${rel}: invalid id "${id}" (expected a letter followed by 5-15 lowercase letters or digits)`);
    return null;
  }
  const slug = rel.replace(/\.md$/, '');
  return {
    rel,
    slug,
    id,
    dir: path.posix.dirname(slug) === '.' ? '' : path.posix.dirname(slug),
    title: fm.title,
    status,
    stub: fm.stub === true,
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    summary: fm.summary ? String(fm.summary) : '',
    updated: fm.updated ? String(fm.updated) : '',
    order: typeof fm.order === 'number' ? fm.order : null,
    body: m[2],
    url: `${basePath}/${slug}/`,
  };
}

function walk(dir) {
  const files = [];
  const dirs = [''];
  const rec = (d) => {
    for (const e of fs.readdirSync(path.join(CONTENT, d), { withFileTypes: true })) {
      const rel = path.posix.join(d, e.name);
      if (e.isDirectory()) {
        dirs.push(rel);
        rec(rel);
      } else if (e.name.endsWith('.md')) {
        files.push(path.join(CONTENT, rel));
      }
    }
  };
  rec(dir);
  return { files, dirs };
}

const byOrder = (a, b) => {
  if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
  if (a.order !== null && b.order === null) return -1;
  if (a.order === null && b.order !== null) return 1;
  return a.title.localeCompare(b.title);
};

// Per-page change log plus every path the page has had (for redirects), from `git log --follow`.
function history(rel) {
  try {
    const out = execFileSync(
      'git',
      ['log', '--follow', '--name-only', '--format=%x00%an%x1f%aI%x1f%s', '--', path.join('content', rel)],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const log = [];
    const paths = new Set();
    for (const chunk of out.split('\0').filter(Boolean)) {
      const [head, ...names] = chunk.split('\n');
      const [author, date, summary] = head.split('\x1f');
      log.push({ author, date: date.slice(0, 10), summary });
      for (const n of names.filter(Boolean)) if (n.startsWith('content/') && n.endsWith('.md')) paths.add(n.slice('content/'.length, -'.md'.length));
    }
    return { log, paths: [...paths] };
  } catch {
    return { log: [], paths: [] };
  }
}

function write(relPath, content) {
  const file = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// --- read ---
const { files, dirs } = walk('');
const pages = files.map(parsePage).filter(Boolean);

// Tag warnings count every page, drafts included.
const tagCounts = new Map();
for (const p of pages) for (const t of new Set(p.tags)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
for (const [tag, n] of tagCounts) {
  if (n === 1 && !tagDefs.includes(tag)) warnings.push(`tag "${tag}" is used on only one page (typo?)`);
}

// Page ids must be unique (a copied page would carry its id along).
const idOwner = new Map();
for (const p of pages) {
  if (!p.id) continue;
  if (idOwner.has(p.id)) errors.push(`${p.rel}: id "${p.id}" is also used by ${idOwner.get(p.id)}`);
  else idOwner.set(p.id, p.rel);
}

// links/<page id>.yml: each page's recorded link targets, by page id.
const linkMaps = new Map();
const linksDir = path.join(ROOT, 'links');
if (fs.existsSync(linksDir)) {
  for (const f of fs.readdirSync(linksDir).filter((n) => n.endsWith('.yml'))) {
    const sourceId = f.slice(0, -'.yml'.length);
    try {
      const map = parseLinkMap(fs.readFileSync(path.join(linksDir, f), 'utf8'));
      linkMaps.set(sourceId, map);
      if (!idOwner.has(sourceId)) warnings.push(`links/${f}: no page has id "${sourceId}" (orphaned link map)`);
      for (const [text, target] of map) if (!idOwner.has(target)) warnings.push(`links/${f}: "${text}" points at id "${target}", which no page has; falling back to the name`);
    } catch (e) {
      errors.push(`links/${f}: invalid link map (${e.message.split('\n')[0]})`);
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`Build failed with ${errors.length} error(s).`);
  process.exit(1);
}

// --- build ---
fs.rmSync(OUT, { recursive: true, force: true });
const ctx = { wiki, basePath };
const built = pages.filter((p) => p.status !== 'draft');

// Every tag gets a page at /tags/<tag>/; each page's tags link to them.
const tags = buildTags(pages, tagYml, (m) => warnings.push(m));
for (const t of tags) t.url = `${basePath}/${TAGS_DIR}/${t.slug}/`;
const tagBySlug = new Map(tags.map((t) => [t.slug, t]));
ctx.tagUrl = (raw) => tagBySlug.get(slugify(raw))?.url ?? null;

// [[wiki links]] resolve against every page; drafts count as "not on the site yet".
// A page's recorded link ids (links/<id>.yml) win over name matching.
const resolve = makeResolver(pages.map(({ slug, title, status, id }) => ({ slug, title, status, id })), { basePath });
const bySlug = new Map(pages.map((p) => [p.slug, p]));
const moved = []; // { from, to, title }
const tagDesc = new Map(); // tag slug -> { html, log }: the description page's rendered body and history
let nameOnlyLinks = 0;
const namesOnlyPages = new Set();
for (const p of built) {
  const links = linkMaps.get(p.id);
  const env = {
    wikiResolve: (target) => resolve(target, p.dir, links),
    wikiWarn: (m) => !warnings.includes(`${p.rel}: ${m}`) && warnings.push(`${p.rel}: ${m}`),
  };
  // Links that resolve to a page with an id, but aren't recorded, would break if that page moved.
  for (const [key, raw] of linkTargets(md, p.body)) {
    if (links?.has(key)) continue;
    const r = resolve(raw, p.dir);
    if (r && bySlug.get(r.slug)?.id) {
      nameOnlyLinks++;
      namesOnlyPages.add(p.rel);
    }
  }
  const h = history(p.rel);
  const html = md.render(p.body, env);
  // A page in content/tags/ describes a tag: it becomes the top of that tag's page rather than a page of its own.
  const tagSlug = isTagDescription(p) ? p.slug.slice(TAGS_DIR.length + 1) : null;
  const url = tagSlug ? `${basePath}/${TAGS_DIR}/${tagSlug}/` : p.url;
  if (tagSlug) tagDesc.set(tagSlug, { html, log: h.log });
  else write(`${p.slug}/index.html`, pageHtml(ctx, p, html, showHistory ? h.log : []));
  for (const old of h.paths) if (old !== p.slug) moved.push({ from: old, to: url, title: p.title });
}

for (const t of tags) {
  const d = tagDesc.get(t.slug);
  const descHtml = d?.html.trim() ? d.html : t.description ? `<p>${esc(t.description)}</p>` : '';
  write(`${TAGS_DIR}/${t.slug}/index.html`, tagHtml(ctx, t, descHtml, groupAlphabetically(t.members), showHistory && d ? d.log : []));
}
write(`${TAGS_DIR}/index.html`, tagsIndexHtml(ctx, tags, groupAlphabetically(tags, (t) => t.name)));

for (const d of dirs) {
  if (d === TAGS_DIR) continue; // /tags/ is the tag index, written above
  const listed = built.filter((p) => p.dir === d && p.status === 'published').sort(byOrder);
  const subdirs = dirs
    .filter((x) => x !== d && path.posix.dirname(x) === (d || '.'))
    .sort()
    .map((x) => ({ name: path.posix.basename(x), url: `${basePath}/${x}/` }));
  write(d ? `${d}/index.html` : 'index.html', listingHtml(ctx, d, listed, subdirs));
}

// Old addresses (from Git rename history) redirect to where the page lives now.
for (const m of moved) {
  const target = path.join(OUT, m.from, 'index.html');
  if (fs.existsSync(target)) {
    warnings.push(`old address /${m.from}/ is now a different page or folder; no redirect written`);
    continue;
  }
  write(`${m.from}/index.html`, redirectHtml(ctx, m.to, m.title));
}

if (pages.some((p) => !p.id)) {
  const n = pages.filter((p) => !p.id).length;
  warnings.push(`${n} page(s) have no id, so links to them match by name only. Run "npm run ids", or publish them in the editor.`);
}
if (nameOnlyLinks) warnings.push(`${nameOnlyLinks} link(s) on ${namesOnlyPages.size} page(s) match by name only. Run "npm run ids", or publish those pages in the editor.`);

const searchIndex = [
  ...built
    .filter((p) => !isTagDescription(p))
    .sort(byOrder)
    .map((p) => ({ title: p.title, url: p.url, tags: p.tags, summary: p.summary, stub: p.stub })),
  ...tags.map((t) => ({ title: `Tag: ${t.name}`, url: t.url, tags: [], summary: t.description, stub: false })),
];
write('search.json', JSON.stringify(searchIndex));

for (const f of fs.readdirSync(path.join(ROOT, 'build/assets'))) {
  fs.copyFileSync(path.join(ROOT, 'build/assets', f), path.join(OUT, f));
}
// The editor source is published under /editor/ (once it exists).
const editorDir = path.join(ROOT, 'editor');
if (fs.existsSync(editorDir)) fs.cpSync(editorDir, path.join(OUT, 'editor'), { recursive: true });
write('editor/config.json', JSON.stringify({ repo: wiki.repo, branch: wiki.branch ?? 'main', basePath }));
write('.nojekyll', '');

for (const w of warnings) console.warn(`warning: ${w}`);
const skipped = pages.length - built.length;
console.log(`Built ${built.length} page(s), skipped ${skipped} draft(s), ${dirs.length} listing(s) -> _site/`);
