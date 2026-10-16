import { decryptToken } from './lib/crypto.js';
import { GitHub, ConflictError } from './lib/github.js';
import { parsePage, serializePage, emptyPage, defaultSummary, changes, validate, isValidPath } from './lib/page.js';
import { wikilinkPlugin, makeResolver } from './lib/wikilinks.js';
import { foldersFrom, folderNote } from './lib/folders.js';
import yaml from './vendor/js-yaml.mjs';

const $ = (id) => document.getElementById(id);
const md = window.markdownit({ html: false, linkify: true }).use(wikilinkPlugin);

let cfg;
let gh = null; // holds the decrypted token, in memory only
let loaded = null; // { path, sha, page, isNew }
let tree = null; // { folders, files } from the repository, or null when unknown
const PATH_HELP = 'Use lowercase letters, numbers, - and _ in folder/name form, e.g. characters/navarr-vate.';

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
    refreshTree();
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
  if (!isValidPath(path)) return say(PATH_HELP, true);
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
    afterLoad();
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

// ---- location, move/rename, live link ----
async function refreshTree() {
  try {
    const entries = await gh.listTree();
    tree = entries ? foldersFrom(entries) : null;
  } catch {
    tree = null; // warnings are a convenience; never block editing
  }
  if (loaded) showFolderNote();
}

function afterLoad() {
  updateLiveLink();
  updateLocation();
  history.replaceState(null, '', `?page=${encodeURI(loaded.path)}`);
}

function updateLiveLink() {
  const live = !loaded.isNew && loaded.page.fm.status !== 'draft';
  show('liveWrap', true);
  show('liveLink', live);
  show('liveNote', !live);
  if (live) $('liveLink').href = `../${loaded.path}/`;
}

function updateLocation() {
  show('location', true);
  $('locPath').textContent = `content/${loaded.path}.md`;
  $('newPath').value = loaded.path;
  $('moveBtn').textContent = loaded.isNew ? 'Set location' : 'Move page';
  show('moveMsgLabel', !loaded.isNew);
  $('moveMsg').value = '';
  $('moveHint').textContent = loaded.isNew
    ? 'Only changes where the new page will be created; nothing is saved until you publish.'
    : 'Moves the saved page in one commit. Links written by title keep working; links written as [[old-name]] or [[folder/old-name]] will need updating, and the old web address stops working once the site rebuilds.';
  showFolderNote();
}

function showFolderNote() {
  const p = $('newPath').value.trim().replace(/\.md$/, '');
  const note = isValidPath(p) ? folderNote(p, tree?.folders) : '';
  $('folderWarn').textContent = note;
  if (note) $('location').open = true; // don't let the warning hide in a closed panel
}
$('newPath').addEventListener('input', showFolderNote);

function isDirty() {
  const c = changes(loaded.isNew ? null : loaded.page, readForm());
  return Boolean(c && (c.fields.length || c.body));
}

function setUrl() {
  $('path').value = loaded.path;
  history.replaceState(null, '', `?page=${encodeURI(loaded.path)}`);
}

$('moveBtn').addEventListener('click', async () => {
  const dest = $('newPath').value.trim().replace(/\.md$/, '');
  if (!isValidPath(dest)) return say(PATH_HELP, true);
  if (dest === loaded.path) return say('That is already the page location.');
  hidePanels();

  if (loaded.isNew) {
    loaded.path = dest;
    setUrl();
    updateLocation();
    return say(`The new page will be created at content/${dest}.md.`);
  }
  if (isDirty()) return say('You have unpublished edits. Publish or discard them first, then move the page.', true);

  say('Moving…');
  try {
    if (tree?.files.has(dest) || (await gh.getFile(`content/${dest}.md`))) return say('A page already exists at that path.', true);
    const message = $('moveMsg').value.trim() || `Moved ${loaded.path} to ${dest}`;
    const sha = await gh.movePath(`content/${loaded.path}.md`, `content/${dest}.md`, message);
    const from = loaded.path;
    loaded = { ...loaded, path: dest, sha };
    setUrl();
    updateLocation();
    updateLiveLink();
    refreshTree();
    say(`Moved content/${from}.md to content/${dest}.md. The old address stops working once the site rebuilds.`);
  } catch (err) {
    if (err instanceof ConflictError) await refreshTree();
    say(err.message, true);
  }
});

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
  $('confirmFolderWarn').textContent = loaded.isNew ? folderNote(loaded.path, tree?.folders) : '';
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
    afterLoad();
    refreshTree();
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
      afterLoad();
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
