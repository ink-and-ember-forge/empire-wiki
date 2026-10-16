import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptToken, decryptToken, checkPassphrase, KDF_ITERATIONS } from '../editor/lib/crypto.js';
import { parsePage, serializePage, defaultSummary, validate, isValidPath } from '../editor/lib/page.js';

const PASS = 'correct horse battery staple';

test('token round-trips through encrypt/decrypt', async () => {
  const file = await encryptToken('github_pat_ABC123', PASS);
  assert.equal(file.iterations, KDF_ITERATIONS);
  assert.equal(await decryptToken(file, PASS), 'github_pat_ABC123');
});

test('the encrypted file does not contain the token', async () => {
  const file = await encryptToken('github_pat_ABC123', PASS);
  assert.ok(!JSON.stringify(file).includes('ABC123'));
});

test('each encryption uses a fresh salt and iv', async () => {
  const a = await encryptToken('t', PASS);
  const b = await encryptToken('t', PASS);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
});

test('wrong passphrase is rejected', async () => {
  const file = await encryptToken('github_pat_ABC123', PASS);
  await assert.rejects(decryptToken(file, PASS + 'x'), /Wrong passphrase/);
});

test('tampered ciphertext is rejected', async () => {
  const file = await encryptToken('github_pat_ABC123', PASS);
  const bad = { ...file, data: file.data.slice(0, -4) + 'AAAA' };
  await assert.rejects(decryptToken(bad, PASS), /Wrong passphrase/);
});

test('short passphrases cannot encrypt', async () => {
  assert.ok(checkPassphrase('too short'));
  assert.equal(checkPassphrase('x'.repeat(16)), null);
  await assert.rejects(encryptToken('t', 'short'), /at least 16/);
});

test('a file asking for fewer iterations is refused', async () => {
  const file = await encryptToken('t', PASS);
  await assert.rejects(decryptToken({ ...file, iterations: 1000 }, PASS), /fewer KDF iterations/);
});

test('parse then serialise keeps content and unknown keys', () => {
  const src = '---\ntitle: Navarr Vate\nstatus: published\nstub: true\ntags: [characters, nisien]\nsummary: A wandering envoy\nupdated: 2026-10-16\norder: 10\nfuture_field: keep me\n---\n# Hi\n\nBody.\n';
  const page = parsePage(src);
  assert.equal(page.fm.updated, '2026-10-16'); // stays a string, not a Date
  assert.deepEqual(page.fm.tags, ['characters', 'nisien']);
  const out = serializePage(page);
  assert.deepEqual(parsePage(out), page);
  assert.match(out, /tags: \[characters, nisien\]/);
  assert.match(out, /future_field: keep me/);
});

test('serialise drops empty optional fields and orders known keys', () => {
  const out = serializePage({ fm: { summary: '', tags: [], status: 'draft', title: 'T' }, body: 'x' });
  assert.equal(out, '---\ntitle: T\nstatus: draft\n---\nx');
});

test('titles with YAML-special characters survive', () => {
  const fm = { title: 'Ash: the "Last" City #1', status: 'draft' };
  assert.equal(parsePage(serializePage({ fm, body: '' })).fm.title, fm.title);
});

test('default summaries describe what changed', () => {
  const before = { fm: { title: 'A', status: 'draft', summary: 'x', tags: ['a'] }, body: 'one' };
  assert.equal(defaultSummary(null, { fm: { title: 'A' }, body: '' }), 'Created A');
  assert.equal(defaultSummary(before, { ...before, body: 'two' }), 'Edited body');
  assert.equal(
    defaultSummary(before, { fm: { ...before.fm, summary: 'y', tags: ['b'] }, body: 'one' }),
    'Updated summary and tags',
  );
  assert.equal(
    defaultSummary(before, { fm: { ...before.fm, status: 'published' }, body: 'two' }),
    'Edited body; updated status',
  );
  assert.equal(defaultSummary(before, before), 'No content changes');
});

test('validation and path rules', () => {
  assert.deepEqual(validate({ title: 'T', status: 'draft' }), []);
  assert.equal(validate({ title: ' ', status: 'draft' }).length, 1);
  assert.equal(validate({ title: 'T', status: 'live' }).length, 1);
  assert.ok(isValidPath('characters/navarr-vate'));
  for (const bad of ['', '../x', '/x', 'a//b', 'A/b', 'a/b.md', 'a/']) assert.ok(!isValidPath(bad), bad);
});
