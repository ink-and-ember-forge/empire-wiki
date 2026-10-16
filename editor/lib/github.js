// Minimal GitHub contents-API client. The token lives only in this object, in memory.
export class ConflictError extends Error {}

const bytesToB64 = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const b64ToText = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

export class GitHub {
  constructor({ repo, branch }, token) {
    this.repo = repo;
    this.branch = branch;
    this.token = token;
  }

  async #call(path, init = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${this.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    return res;
  }

  async #json(path) {
    const res = await this.#call(path);
    if (!res.ok) throw new Error(`GitHub request failed (${res.status}).`);
    return res.json();
  }

  async #post(path, body) {
    const res = await this.#call(path, { method: 'POST', body: JSON.stringify(body) });
    if (res.status === 403 || res.status === 401) throw new Error(`GitHub refused the write (${res.status}). Check the token has Contents: read and write and has not expired.`);
    if (!res.ok) throw new Error(`GitHub request failed (${res.status}).`);
    return res.json();
  }

  async whoami() {
    const res = await this.#call('/user');
    if (!res.ok) throw new Error(`GitHub rejected the token (${res.status}).`);
    return (await res.json()).login;
  }

  /** Returns { text, sha } or null when the file does not exist. */
  async getFile(path) {
    const res = await this.#call(`/repos/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not read ${path} (${res.status}).`);
    const j = await res.json();
    return { text: b64ToText(j.content), sha: j.sha };
  }

  /** Commits a file. Pass the sha you loaded (omit for a new file); a stale sha raises ConflictError. */
  async putFile(path, text, message, sha) {
    const body = { message, content: bytesToB64(new TextEncoder().encode(text)), branch: this.branch };
    if (sha) body.sha = sha;
    const res = await this.#call(`/repos/${this.repo}/contents/${encodePath(path)}`, { method: 'PUT', body: JSON.stringify(body) });
    if (res.status === 409 || res.status === 422) throw new ConflictError('The page changed on GitHub since you loaded it.');
    if (res.status === 403 || res.status === 401) throw new Error(`GitHub refused the write (${res.status}). Check the token has Contents: read and write on this repository, and has not expired.`);
    if (!res.ok) throw new Error(`Publish failed (${res.status}).`);
    return (await res.json()).content.sha;
  }

  /** The text of a file, by blob sha (used to index every page's title and id). */
  async getBlobText(sha) {
    return b64ToText((await this.#json(`/repos/${this.repo}/git/blobs/${sha}`)).content);
  }

  /** Every file and folder on the branch (used to know which folders exist). Null when GitHub truncates the listing. */
  async listTree() {
    const t = await this.#json(`/repos/${this.repo}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
    return t.truncated ? null : t.tree;
  }

  /**
   * Moves a file in one commit, keeping its content byte-for-byte so Git sees a rename.
   * Returns the file's blob sha (the same as its contents-API sha).
   * Raises ConflictError if the branch moved while we were working.
   */
  async movePath(oldPath, newPath, message) {
    const ref = encodePath(`heads/${this.branch}`);
    const head = (await this.#json(`/repos/${this.repo}/git/ref/${ref}`)).object.sha;
    const baseTree = (await this.#json(`/repos/${this.repo}/git/commits/${head}`)).tree.sha;
    const { tree } = await this.#json(`/repos/${this.repo}/git/trees/${baseTree}?recursive=1`);
    const from = tree.find((e) => e.path === oldPath && e.type === 'blob');
    if (!from) throw new ConflictError('The page no longer exists at its old path.');
    if (tree.some((e) => e.path === newPath)) throw new Error('A page already exists at that path.');
    const next = await this.#post(`/repos/${this.repo}/git/trees`, {
      base_tree: baseTree,
      tree: [
        { path: newPath, mode: from.mode, type: 'blob', sha: from.sha },
        { path: oldPath, mode: from.mode, type: 'blob', sha: null },
      ],
    });
    const commit = await this.#post(`/repos/${this.repo}/git/commits`, { message, tree: next.sha, parents: [head] });
    const res = await this.#call(`/repos/${this.repo}/git/refs/${ref}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
    if (res.status === 409 || res.status === 422) throw new ConflictError('The wiki changed while moving the page. Nothing was moved; try again.');
    if (!res.ok) throw new Error(`Move failed (${res.status}).`);
    return from.sha;
  }
}
