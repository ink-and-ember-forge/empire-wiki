import { decryptToken } from './lib/crypto.js';
import { GitHub, ConflictError } from './lib/github.js';
import { parsePage, serializePage, emptyPage, defaultSummary, changes, validate, isValidPath } from './lib/page.js';
import { wikilinkPlugin, makeResolver } from './lib/wikilinks.js';
import yaml from './vendor/js-yaml.mjs';

const $ = (id) => document.getElementById(id);
const md = window.markdownit({ html: false, linkify: true }).use(wikilinkPlugin);

let cfg;
let gh = null; // holds the decrypted token, in memory only
let loaded = null; // { path, sha, page, isNew }

function say(text, isError = false) {
  const s = $('status');
  s.textContent = text;
  s.className = isError ? 'error' : '';
}

const show = (id, on) => ($(id).hidden = !on);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---- unlock ----
$('unlock').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = $('user').value.trim();
  if (!/^[A-Za-z0-9-]+$/.test(user)) return say('That does not look like a GitHub username.', true);
  say('Unlocking…');
  try {
    const res = await fetch(`tokens/${encodeURIComponent(user.toLowerCase())}.json`);
    if (res.status === 404) throw new Error('No token has been set up for that username yet.');
    if (!res.ok) throw new Error(`Could not load the token file (${res.status}).`);
    const token = await decryptToken(await res.json(), $('pass').value);
    const client = new GitHub(cfg, token);
    const login = await client.whoami();
    gh = client;
    $('pass').value = '';
    show('unlock', false);
    show('work', true);
    say(`Unlocked as ${login}. The token stays in this tab's memory and is gone on reload.`);
    loadKnownTags();
    const params = new URLSearchParams(location.search);
    const wanted = params.get('page');
    if (wanted) {
      $('path').value = wanted;
      openPage(wanted, params.get('title'));
    }
  } catch (err) {
    say(err.message, true);
  }
});

async function loadKnownTags() {
  try {
    const f = await gh.getFile('tags.yml');
    const names = (yaml.load(f.text, { schema: yaml.CORE_SCHEMA })?.tags ?? []).map((t) => t.name);
    $('knownTags').textContent = names.length ? `Known tags: ${names.join(', ')}` : '';
  } catch {
    /* hint only */
  }
}

// ---- open ----
$('open').addEventListener('submit', (e) => {
  e.preventDefault();
  openPage($('path').value.trim().replace(/\.md$/, ''));
});

async function openPage(path, titleHint) {
  if (!isValidPath(path)) return say('Use lowercase letters, numbers, - and _ in folder/name form, e.g. characters/navarr-vate.', true);
  say('Loading…');
  hidePanels();
  try {
    const file = await gh.getFile(`content/${path}.md`);
    loaded = file
      ? { path, sha: file.sha, page: parsePage(file.text), isNew: false }
      : { path, sha: undefined, page: emptyPage(), isNew: true };
    if (loaded.isNew && titleHint) loaded.page.fm.title = titleHint;
    fillForm(loaded.page);
    show('edit', true);
    say(loaded.isNew ? `New page: content/${path}.md (draft until you change the status).` : `Editing content/${path}.md`);
  } catch (err) {
    say(err.message, true);
  }
}

function hidePanels() {
  show('confirm', false);
  show('conflict', false);
}

function fillForm({ fm, body }) {
  $('title').value = fm.title ?? '';
  $('statusSel').value = fm.status ?? 'draft';
  $('stub').checked = fm.stub === true;
  $('order').value = fm.order ?? '';
  $('tags').value = (fm.tags ?? []).join(', ');
  $('summary').value = fm.summary ?? '';
  $('body').value = body;
  $('previewToggle').checked = false;
  renderPreviewState();
}

function readForm() {
  const fm = { ...loaded.page.fm }; // keeps keys this form doesn't know about
  const set = (k, v, empty) => (empty ? delete fm[k] : (fm[k] = v));
  fm.title = $('title').value.trim();
  fm.status = $('statusSel').value;
  set('stub', true, !$('stub').checked);
  set('order', Number($('order').value), $('order').value === '');
  const tags = $('tags').value.split(',').map((t) => t.trim()).filter(Boolean);
  set('tags', tags, !tags.length);
  set('summary', $('summary').value.trim(), !$('summary').value.trim());
  return { fm, body: $('body').value };
}

// ---- preview ----
let siteIndex = null; // built pages, from search.json; drafts are unknown here, so they preview as missing
async function wikiResolver() {
  if (!siteIndex) {
    try {
      const entries = await (await fetch(`${cfg.basePath}/search.json`)).json();
      siteIndex = entries.map((e) => ({ slug: e.url.slice(cfg.basePath.length).replace(/^\/|\/$/g, ''), title: e.title, status: 'published' }));
    } catch {
      siteIndex = [];
    }
  }
  return makeResolver(siteIndex, { basePath: cfg.basePath });
}

async function renderPreviewState() {
  const on = $('previewToggle').checked;
  show('preview', on);
  show('bodyLabel', !on);
  if (!on) return;
  const resolve = await wikiResolver();
  const dir = loaded ? loaded.path.split('/').slice(0, -1).join('/') : '';
  $('preview').innerHTML = md.render($('body').value, { wikiResolve: (t) => resolve(t, dir) });
}
// Links in the preview open in a new tab so an unpublished edit is never lost.
$('preview').addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  window.open(a.href, '_blank', 'noopener');
});
$('previewToggle').addEventListener('change', renderPreviewState);

// ---- publish ----
let pending = null; // { page, message }

$('edit').addEventListener('submit', (e) => {
  e.preventDefault();
  const page = readForm();
  const problems = validate(page.fm);
  if (problems.length) return say(problems.join(' '), true);
  const before = loaded.isNew ? null : loaded.page;
  const c = changes(before, page);
  if (c && !c.fields.length && !c.body) return say('Nothing has changed.');
  pending = { page, fallback: defaultSummary(before, page) };
  $('confirmList').textContent = `${page.fm.title} (${page.fm.status}) — content/${loaded.path}.md`;
  $('message').value = '';
  $('message').placeholder = pending.fallback;
  show('confirm', true);
  say('');
});

$('cancelBtn').addEventListener('click', () => show('confirm', false));

$('confirmBtn').addEventListener('click', async () => {
  const { page, fallback } = pending;
  const stamped = { fm: { ...page.fm, updated: today() }, body: page.body };
  const message = $('message').value.trim() || fallback;
  say('Publishing…');
  try {
    const sha = await gh.putFile(`content/${loaded.path}.md`, serializePage(stamped), message, loaded.sha);
    loaded = { path: loaded.path, sha, page: stamped, isNew: false };
    show('confirm', false);
    const live = page.fm.status === 'draft' ? '' : ` Live at ${cfg.basePath}/${loaded.path}/ once the rebuild finishes.`;
    say(`Published: "${message}".${live}`);
  } catch (err) {
    if (err instanceof ConflictError) return showConflict();
    say(err.message, true);
  }
});

async function showConflict() {
  show('confirm', false);
  try {
    const remote = await gh.getFile(`content/${loaded.path}.md`);
    $('remoteText').value = remote?.text ?? '(the page was deleted)';
    $('takeRemote').onclick = () => {
      if (!remote) return openPage(loaded.path);
      loaded = { path: loaded.path, sha: remote.sha, page: parsePage(remote.text), isNew: false };
      fillForm(loaded.page);
      show('conflict', false);
      say('Loaded the newer version. Re-apply your change.');
    };
    $('keepMine').onclick = () => show('conflict', false);
    show('conflict', true);
    say('Publish refused: the page changed since you opened it.', true);
  } catch (err) {
    say(err.message, true);
  }
}

// ---- start ----
fetch('config.json')
  .then((r) => r.json())
  .then((c) => {
    cfg = c;
    const page = new URLSearchParams(location.search).get('page');
    if (page) say(`Unlock to edit ${page}.`);
  })
  .catch(() => say('Could not load editor config.', true));
