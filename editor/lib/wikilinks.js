// [[Wiki links]] for markdown-it. Shared by the build and the editor preview.
//
//   [[Navarr Vate]]            link by title, file name or path (case-insensitive)
//   [[characters/navarr-vate]] link by path under content/
//   [[Navarr Vate|the envoy]]  custom label
//
// A link to a page that is built renders as a normal link. Anything else (no such
// page, or a draft that isn't on the site) renders as a "missing" link that opens
// the editor, so the page can be created or finished.

export const slugify = (s) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Normalised form of a link's target text; the key used in a page's link map. */
export const linkKey = (t) => t.trim().toLowerCase().replace(/\s+/g, ' ');

const slugPath = (t) => t.split('/').map(slugify).filter(Boolean).join('/');

/**
 * entries: [{ slug, title, status, id? }] for every page (drafts included).
 * Returns resolve(target, fromDir, links?) -> { exists, url | editUrl, slug, draft, ambiguous } or null.
 * `links` is the source page's link map (Map of linkKey -> page id). A recorded id wins over any
 * name match, so a link keeps working after its target is moved or retitled.
 */
export function makeResolver(entries, { basePath = '' } = {}) {
  const byPath = new Map();
  const byTitle = new Map();
  const byName = new Map();
  const byId = new Map(entries.filter((e) => e.id).map((e) => [e.id, e]));
  const add = (m, k, e) => m.set(k, [...(m.get(k) ?? []), e]);
  for (const e of entries) {
    add(byPath, e.slug.toLowerCase(), e);
    add(byTitle, e.title.trim().toLowerCase(), e);
    add(byName, e.slug.split('/').pop().toLowerCase(), e);
  }

  return (target, fromDir = '', links = null) => {
    const raw = target.trim();
    const isPath = raw.includes('/');
    const name = isPath ? slugPath(raw) : slugify(raw);
    const pinned = byId.get(links?.get(linkKey(raw)));
    if (!name && !pinned) return null;

    const hits = pinned
      ? [pinned]
      : [...((isPath && byPath.get(name)) || byTitle.get(raw.toLowerCase()) || byName.get(name) || [])];
    // Prefer a page in the same folder as the link, then the shortest path.
    hits.sort((a, b) => Number(b.slug.startsWith(`${fromDir}/`)) - Number(a.slug.startsWith(`${fromDir}/`)) || a.slug.localeCompare(b.slug));
    const hit = hits[0];
    const ambiguous = hits.length > 1 ? hits.map((h) => h.slug) : null;

    if (hit && hit.status !== 'draft') return { exists: true, url: `${basePath}/${hit.slug}/`, slug: hit.slug, ambiguous };

    // Not on the site: send the editor to the draft if there is one, else a new page next to the link.
    const slug = hit ? hit.slug : isPath ? name : [fromDir, name].filter(Boolean).join('/');
    const title = hit ? hit.title : raw.split('/').pop();
    return {
      exists: false,
      draft: Boolean(hit),
      slug,
      ambiguous,
      editUrl: `${basePath}/editor/?page=${encodeURI(slug)}&title=${encodeURIComponent(title)}`,
    };
  };
}

/**
 * markdown-it plugin. Render with env = { wikiResolve(target) -> result, wikiWarn?(message) }.
 * Without wikiResolve the label is rendered as plain text.
 */
export function wikilinkPlugin(md) {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const { src, pos } = state;
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const end = src.indexOf(']]', pos + 2);
    if (end < 0) return false;
    const inner = src.slice(pos + 2, end);
    if (!inner.trim() || /[[\]\n]/.test(inner)) return false;
    if (!silent) {
      const bar = inner.indexOf('|');
      const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
      const label = (bar < 0 ? target : inner.slice(bar + 1).trim() || target).trim();
      state.push('wikilink', '', 0).meta = { target, label };
    }
    state.pos = end + 2;
    return true;
  });

  md.renderer.rules.wikilink = (tokens, i, _opts, env) => {
    const { target, label } = tokens[i].meta;
    const text = md.utils.escapeHtml(label);
    const r = env?.wikiResolve?.(target);
    if (!r) return text;
    if (r.ambiguous) env.wikiWarn?.(`[[${target}]] matches ${r.ambiguous.length} pages (${r.ambiguous.join(', ')}); using ${r.slug}`);
    if (r.exists) return `<a class="wikilink" href="${md.utils.escapeHtml(r.url)}">${text}</a>`;
    const why = r.draft ? 'Draft: not published yet' : 'No such page yet';
    return `<a class="wikilink missing" href="${md.utils.escapeHtml(r.editUrl)}" title="${why}" rel="nofollow">${text}</a>`;
  };
}
