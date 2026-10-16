// An index of every page (title, status, id), read from the repository so drafts are included.
// Used for the [[ picker, the preview, and recording which page each link points at.
import { parsePage } from './page.js';

/**
 * files: Map(slug -> blob sha). fetchText(sha) -> file text. cache: Map(sha -> meta), reused between
 * calls so only changed files are fetched again. Never throws for a single bad file.
 */
export async function loadIndex(files, fetchText, cache = new Map(), { concurrency = 6, onProgress } = {}) {
  const queue = [...files];
  const entries = [];
  let done = 0;
  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [slug, sha] = next;
      let meta = cache.get(sha);
      if (!meta) {
        try {
          const { fm } = parsePage(await fetchText(sha));
          meta = { title: typeof fm.title === 'string' && fm.title ? fm.title : slug, status: fm.status ?? 'draft', id: fm.id == null ? '' : String(fm.id) };
          cache.set(sha, meta);
        } catch {
          meta = { title: slug, status: 'draft', id: '' }; // unreadable now; not cached, retried next time
        }
      }
      entries.push({ slug, sha, ...meta });
      onProgress?.(++done, files.size);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return entries.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** What to type inside [[ ]] for this page: its title, unless the title would break the link syntax. */
export const linkText = (e) => (/[[\]|\n]/.test(e.title) ? e.slug : e.title);

/** Pages matching what's been typed after [[ : title prefix, then title contains, then file name contains. */
export function matchPages(entries, query, limit = 8) {
  const q = query.trim().toLowerCase();
  const rank = (e) => {
    const t = e.title.toLowerCase();
    const name = e.slug.toLowerCase();
    if (!q) return 3;
    if (t.startsWith(q)) return 0;
    if (t.includes(q)) return 1;
    if (name.includes(q.replace(/\s+/g, '-')) || name.includes(q)) return 2;
    return -1;
  };
  return entries
    .map((e) => [rank(e), e])
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0] || a[1].title.localeCompare(b[1].title))
    .slice(0, limit)
    .map(([, e]) => e);
}
