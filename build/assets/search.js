// Client-side search over titles and tags only (search.json is built in advance).
(() => {
  const base = document.body.dataset.base || '';
  const q = document.getElementById('q');
  const out = document.getElementById('results');
  let index = null;

  const load = () =>
    (index ??= fetch(`${base}/search.json`).then((r) => r.json()).catch(() => []));

  const el = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });

  q.addEventListener('input', async () => {
    const term = q.value.trim().toLowerCase();
    out.replaceChildren();
    if (!term) { out.hidden = true; return; }
    const hits = (await load()).filter(
      (p) => p.title.toLowerCase().includes(term) || p.tags.some((t) => t.toLowerCase().includes(term)),
    );
    for (const p of hits.slice(0, 20)) {
      const li = document.createElement('li');
      const a = el('a', p.title);
      a.href = p.url;
      li.append(a);
      if (p.stub) li.append(' ', Object.assign(el('span', 'stub'), { className: 'badge' }));
      if (p.summary) li.append(document.createElement('br'), el('small', p.summary));
      out.append(li);
    }
    if (!hits.length) out.append(el('li', 'No matches'));
    out.hidden = false;
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) out.hidden = true; });
})();
