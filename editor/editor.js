import { decryptToken } from './lib/crypto.js';
import { GitHub, ConflictError } from './lib/github.js';
import { parsePage, serializePage, emptyPage, defaultSummary, changes, validate, isValidPath } from './lib/page.js';
import { wikilinkPlugin, makeResolver } from './lib/wikilinks.js';
import { foldersFrom, folderNote } from './lib/folders.js';
import { loadIndex, matchPages, linkText } from './lib/pageindex.js';
import { newId, linkTargets, linkKey, linkMapPath, parseLinkMap, serializeLinkMap, canonicalize, sameMap } from './lib/links.js';
import yaml from './vendor/js-yaml.mjs';

const $ = (id) => document.getElementById(id);
const md = window.markdownit({ html: false, linkify: true }).use(wikilinkPlugin);

let cfg;
let gh = null; // holds the decrypted token, in memory only
let loaded = null; // { path, sha, page, isNew }
let tree = null; // { folders, files } from the repository, or null when unknown
let index = []; // every page's { slug, title, status, id }, drafts included
const blobCache = new Map(); // blob sha -> parsed front matter, so only changed pages are re-read
let picked = new Map(); // linkKey -> page id, chosen in the [[ picker since this page was opened
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
    await attachLinks();
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
  refreshIndex();
}

async function refreshIndex() {
  if (!tree) return;
  try {
    index = await loadIndex(tree.files, (sha) => gh.getBlobText(sha), blobCache, {
      onProgress: (done, total) => ($('indexHint').textContent = done < total ? `Reading pages for the link picker… ${done}/${total}` : ''),
    });
  } catch {
    /* the picker and link recording are conveniences; editing never depends on them */
  }
  $('indexHint').textContent = '';
}

/** Loads the link map recorded for the open page (links/<page id>.yml), if it has an id. */
async function attachLinks() {
  loaded.links = new Map();
  loaded.linksSha = undefined;
  picked = new Map();
  const id = loaded.page.fm.id;
  if (!id) return;
  try {
    const f = await gh.getFile(linkMapPath(id));
    if (f) {
      loaded.links = parseLinkMap(f.text);
      loaded.linksSha = f.sha;
    }
  } catch {
    /* links fall back to matching by name */
  }
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
  $('pageId').textContent = loaded.page.fm.id || (loaded.isNew ? 'assigned when first published' : 'none yet; assigned on the next publish');
  $('moveHint').textContent = loaded.isNew
    ? 'Only changes where the new page will be created; nothing is saved until you publish.'
    : loaded.page.fm.id
      ? 'Moves the saved page in one commit. Links that point to it by ID keep working, and the old address redirects once the site rebuilds. Links that only match it by name may break.'
      : 'This page has no ID yet, so links to it match by name only and will break if it moves. Publish it once first (that gives it an ID), then move it.';
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
let siteIndex = null; // fallback when the repository index isn't available: built pages, from search.json
const effectiveLinks = () => new Map([...(loaded?.links ?? []), ...picked]);
async function wikiResolver() {
  if (index.length) return makeResolver(index, { basePath: cfg.basePath });
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
  $('preview').innerHTML = md.render($('body').value, { wikiResolve: (t) => resolve(t, dir, effectiveLinks()) });
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
  const unchanged = c && !c.fields.length && !c.body;
  const needsId = before && !before.fm.id;
  if (unchanged && !needsId) return say('Nothing has changed.');
  pending = { page, fallback: unchanged ? 'Added page ID' : defaultSummary(before, page) };
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
  const taken = new Set(index.map((e) => e.id).filter(Boolean));
  const id = page.fm.id || newId(taken);
  const stamped = { fm: { ...page.fm, id, updated: today() }, body: page.body };
  const message = $('message').value.trim() || fallback;
  say('Publishing…');
  try {
    const sha = await gh.putFile(`content/${loaded.path}.md`, serializePage(stamped), message, loaded.sha);
    loaded = { path: loaded.path, sha, page: stamped, isNew: false, links: loaded.links, linksSha: loaded.linksSha };
    show('confirm', false);
    let note = '';
    try {
      await saveLinkMap(new Set([...taken, id]));
    } catch (err) {
      note = ` The page is published, but its link map could not be saved (${err.message}), so its links match by name until the next publish.`;
    }
    afterLoad();
    refreshTree();
    const live = page.fm.status === 'draft' ? '' : ` Live at ${cfg.basePath}/${loaded.path}/ once the rebuild finishes.`;
    say(`Published: "${message}".${live}${note}`, Boolean(note));
  } catch (err) {
    if (err instanceof ConflictError) return showConflict();
    say(err.message, true);
  }
});

/** Records which page each [[link]] points at in links/<page id>.yml (a separate commit; page text is untouched). */
async function saveLinkMap(knownIds) {
  const { page, path } = loaded;
  const resolve = makeResolver(index, { basePath: '' });
  const bySlug = new Map(index.map((e) => [e.slug, e]));
  const dir = path.split('/').slice(0, -1).join('/');
  const byName = (raw) => {
    const r = resolve(raw, dir);
    return r && (r.exists || r.draft) ? bySlug.get(r.slug)?.id : undefined;
  };
  const next = canonicalize({ targets: linkTargets(md, page.body), existing: loaded.links, picked, knownIds, byName });
  const exists = loaded.linksSha !== undefined;
  if ((!exists && next.size === 0) || (exists && sameMap(next, loaded.links))) return;
  const sha = await gh.putFile(linkMapPath(page.fm.id), serializeLinkMap(next), `Update links for ${page.fm.title}`, loaded.linksSha);
  loaded.links = next;
  loaded.linksSha = sha;
  picked = new Map();
}

async function showConflict() {
  show('confirm', false);
  try {
    const remote = await gh.getFile(`content/${loaded.path}.md`);
    $('remoteText').value = remote?.text ?? '(the page was deleted)';
    $('takeRemote').onclick = async () => {
      if (!remote) return openPage(loaded.path);
      loaded = { path: loaded.path, sha: remote.sha, page: parsePage(remote.text), isNew: false };
      await attachLinks();
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

// ---- [[ link picker ----
const pickerEl = $('picker');
const bodyEl = $('body');
let pick = { items: [], active: 0 };

/** The text typed after an unclosed [[ just before the caret, or null. */
function pickerContext() {
  const before = bodyEl.value.slice(0, bodyEl.selectionStart);
  const open = before.lastIndexOf('[[');
  if (open < 0) return null;
  const typed = before.slice(open + 2);
  return /[\]\n|]/.test(typed) ? null : { open, typed };
}

function closePicker() {
  pickerEl.hidden = true;
  bodyEl.setAttribute('aria-expanded', 'false');
  bodyEl.removeAttribute('aria-activedescendant');
  pick = { items: [], active: 0 };
}

function updatePicker() {
  const ctx = pickerContext();
  const items = ctx ? matchPages(index, ctx.typed) : [];
  if (!items.length) return closePicker();
  pick = { items, active: Math.min(pick.active, items.length - 1) };
  pickerEl.replaceChildren(
    ...items.map((e, i) => {
      const li = document.createElement('li');
      li.id = `pick-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === pick.active));
      li.append(e.title);
      const small = document.createElement('small');
      small.textContent = ` ${e.slug}${e.status === 'draft' ? ' · draft' : ''}${e.id ? '' : ' · no ID yet'}`;
      li.append(small);
      li.addEventListener('pointerdown', (ev) => {
        ev.preventDefault(); // keep focus in the textarea
        acceptPick(i);
      });
      return li;
    }),
  );
  pickerEl.hidden = false;
  bodyEl.setAttribute('aria-expanded', 'true');
  bodyEl.setAttribute('aria-activedescendant', `pick-${pick.active}`);
}

function acceptPick(i) {
  const ctx = pickerContext();
  const entry = pick.items[i];
  if (!ctx || !entry) return;
  const text = linkText(entry);
  const caret = bodyEl.selectionStart;
  const rest = bodyEl.value.slice(caret);
  const after = rest.startsWith(']]') ? rest.slice(2) : rest;
  bodyEl.value = `${bodyEl.value.slice(0, ctx.open + 2)}${text}]]${after}`;
  bodyEl.selectionStart = bodyEl.selectionEnd = ctx.open + 2 + text.length + 2;
  if (entry.id) picked.set(linkKey(text), entry.id); // remembered; saved to the link map when you publish
  closePicker();
  bodyEl.focus();
}

bodyEl.addEventListener('input', updatePicker);
bodyEl.addEventListener('click', updatePicker);
bodyEl.addEventListener('blur', () => setTimeout(closePicker, 100));
bodyEl.addEventListener('keydown', (e) => {
  if (pickerEl.hidden) return;
  const move = (d) => {
    e.preventDefault();
    pick.active = (pick.active + d + pick.items.length) % pick.items.length;
    [...pickerEl.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === pick.active)));
    bodyEl.setAttribute('aria-activedescendant', `pick-${pick.active}`);
    pickerEl.children[pick.active].scrollIntoView({ block: 'nearest' });
  };
  if (e.key === 'ArrowDown') move(1);
  else if (e.key === 'ArrowUp') move(-1);
  else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    acceptPick(pick.active);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePicker();
  }
});

// ---- start ----
fetch('config.json')
  .then((r) => r.json())
  .then((c) => {
    cfg = c;
    const page = new URLSearchParams(location.search).get('page');
    if (page) say(`Unlock to edit ${page}.`);
  })
  .catch(() => say('Could not load editor config.', true));
