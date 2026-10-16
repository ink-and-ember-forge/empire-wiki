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
}
