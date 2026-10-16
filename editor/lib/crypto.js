// Token encryption for the editor: PBKDF2-HMAC-SHA256 -> AES-GCM (WebCrypto).
// Runs unchanged in browsers and Node 20+. See spec.md sections 3 and 9.
export const KDF_ITERATIONS = 600000;
export const MIN_PASSPHRASE_LENGTH = 16;
const FORMAT = 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Returns an error message, or null if the passphrase is acceptable. */
export function checkPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters (four random words usually does it).`;
  }
  return null;
}

async function deriveKey(passphrase, salt, iterations, usage) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

/** Encrypts a GitHub token. The result is safe to commit to a public repository. */
export async function encryptToken(token, passphrase) {
  const problem = checkPassphrase(passphrase);
  if (problem) throw new Error(problem);
  if (typeof token !== 'string' || !token.trim()) throw new Error('Token is empty.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS, 'encrypt');
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token.trim()));
  return {
    v: FORMAT,
    kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(data),
  };
}

/** Decrypts a token file produced by encryptToken. Throws on a wrong passphrase. */
export async function decryptToken(file, passphrase) {
  if (!file || file.v !== FORMAT || file.kdf !== 'PBKDF2-SHA256') throw new Error('Unrecognised token file.');
  // Refuse a file that asks for a weaker KDF than we would ever have written.
  if (!Number.isInteger(file.iterations) || file.iterations < KDF_ITERATIONS) {
    throw new Error('Token file uses fewer KDF iterations than allowed.');
  }
  try {
    const key = await deriveKey(passphrase, fromB64(file.salt), file.iterations, 'decrypt');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.data));
    return dec.decode(plain);
  } catch {
    throw new Error('Wrong passphrase, or the token file is damaged.');
  }
}
