// Folder awareness for the editor: which folders exist under content/, and a warning for new ones.

/** entries: the `tree` array from GitHub's git/trees API. Returns { folders: Set, files: Map(slug -> blob sha) }. */
export function foldersFrom(entries, root = 'content') {
  const folders = new Set();
  const files = new Map();
  const addAncestors = (rel) => {
    const parts = rel.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  };
  for (const e of entries) {
    if (!e.path.startsWith(`${root}/`)) continue;
    const rel = e.path.slice(root.length + 1);
    if (e.type === 'tree') folders.add(rel);
    else if (e.type === 'blob') {
      addAncestors(rel); // a file implies its folders, in case the tree entries are missing
      if (rel.endsWith('.md')) files.set(rel.slice(0, -3), e.sha);
    }
  }
  return { folders, files };
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** The existing folder a typo most likely meant, or null. */
export function closestFolder(name, folders) {
  let best = null;
  let bestD = Infinity;
  for (const f of folders) {
    const d = distance(name, f);
    if (d < bestD) [best, bestD] = [f, d];
  }
  return best !== null && bestD > 0 && bestD <= 2 && bestD < name.length / 2 ? best : null;
}

/** A warning when `path` would create a folder that doesn't exist yet, else ''. Unknown folders (no data) give ''. */
export function folderNote(path, folders) {
  const dir = path.split('/').slice(0, -1).join('/');
  if (!dir || !folders || folders.size === 0 || folders.has(dir)) return '';
  const near = closestFolder(dir, folders);
  const list = [...folders].sort().join(', ');
  return `The folder "${dir}" doesn't exist yet, so this would create it.${near ? ` Did you mean "${near}"?` : ''} Existing folders: ${list}.`;
}
