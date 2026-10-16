// Empire Notes Wiki build: content/*.md -> _site/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import MarkdownIt from 'markdown-it';
import { pageHtml, listingHtml } from './template.js';
import { wikilinkPlugin, makeResolver } from '../editor/lib/wikilinks.js';

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
const tagDefs = (readYaml('tags.yml').tags ?? []).map((t) => t.name);
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
  const slug = rel.replace(/\.md$/, '');
  return {
    rel,
    slug,
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

function history(rel) {
  try {
    const out = execFileSync(
      'git',
      ['log', '--follow', '--format=%an%x1f%aI%x1f%s', '--', path.join('content', rel)],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [author, date, summary] = l.split('\x1f');
        return { author, date: date.slice(0, 10), summary };
      });
  } catch {
    return [];
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

if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`Build failed with ${errors.length} error(s).`);
  process.exit(1);
}

// --- build ---
fs.rmSync(OUT, { recursive: true, force: true });
const ctx = { wiki, basePath };
const built = pages.filter((p) => p.status !== 'draft');

// [[wiki links]] resolve against every page; drafts count as "not on the site yet".
const resolve = makeResolver(pages.map(({ slug, title, status }) => ({ slug, title, status })), { basePath });
for (const p of built) {
  const env = {
    wikiResolve: (target) => resolve(target, p.dir),
    wikiWarn: (m) => !warnings.includes(`${p.rel}: ${m}`) && warnings.push(`${p.rel}: ${m}`),
  };
  write(`${p.slug}/index.html`, pageHtml(ctx, p, md.render(p.body, env), showHistory ? history(p.rel) : []));
}

for (const d of dirs) {
  const listed = built.filter((p) => p.dir === d && p.status === 'published').sort(byOrder);
  const subdirs = dirs
    .filter((x) => x !== d && path.posix.dirname(x) === (d || '.'))
    .sort()
    .map((x) => ({ name: path.posix.basename(x), url: `${basePath}/${x}/` }));
  write(d ? `${d}/index.html` : 'index.html', listingHtml(ctx, d, listed, subdirs));
}

const searchIndex = built.sort(byOrder).map((p) => ({
  title: p.title,
  url: p.url,
  tags: p.tags,
  summary: p.summary,
  stub: p.stub,
}));
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
