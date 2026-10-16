import { encryptToken, decryptToken } from './lib/crypto.js';
import { GitHub } from './lib/github.js';

const $ = (id) => document.getElementById(id);
const say = (t, err = false) => {
  $('status').textContent = t;
  $('status').className = err ? 'error' : '';
};

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('pass').value !== $('pass2').value) return say('Passphrases do not match.', true);
  say('Encrypting…');
  try {
    const cfg = await (await fetch('config.json')).json();
    const token = $('token').value.trim();
    // Ask GitHub who owns the token: confirms it works and gives the file name.
    const login = await new GitHub(cfg, token).whoami();
    const file = await encryptToken(token, $('pass').value);
    if ((await decryptToken(file, $('pass').value)) !== token) throw new Error('Self-check failed.');
    $('filename').textContent = `editor/tokens/${login.toLowerCase()}.json`;
    $('out').value = JSON.stringify(file, null, 2) + '\n';
    $('result').hidden = false;
    $('token').value = $('pass').value = $('pass2').value = '';
    say(`Encrypted for ${login}.`);
  } catch (err) {
    say(err.message, true);
  }
});
