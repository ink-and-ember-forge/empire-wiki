export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const stubBadge = (p) => (p.stub ? ' <span class="badge">stub</span>' : '');

function layout({ wiki, basePath }, { title, head = '', body, crumbs = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(wiki.title)}</title>
<link rel="stylesheet" href="${basePath}/style.css">
${head}</head>
<body data-base="${basePath}">
<header class="site">
  <a class="brand" href="${basePath}/">${esc(wiki.title)}</a>
  <div class="search"><input id="q" type="search" placeholder="Search titles and tags" autocomplete="off"><ul id="results" hidden></ul></div>
</header>
<main>
${crumbs}${body}
</main>
<script src="${basePath}/search.js"></script>
</body>
</html>
`;
}

function breadcrumbs({ basePath }, dir) {
  const parts = dir ? dir.split('/') : [];
  const links = ['<a href="' + basePath + '/">Home</a>'];
  parts.forEach((part, i) => {
    const url = `${basePath}/${parts.slice(0, i + 1).join('/')}/`;
    links.push(`<a href="${url}">${esc(part)}</a>`);
  });
  return `<nav class="crumbs">${links.join(' / ')}</nav>\n`;
}

export function pageHtml(ctx, p, html, history) {
  const tags = p.tags.length
    ? `<p class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</p>`
    : '';
  const log = history.length
    ? `<section class="history"><h2>Change log</h2><ul>${history
        .map((h) => `<li><time>${esc(h.date)}</time> · ${esc(h.author)} · ${esc(h.summary)}</li>`)
        .join('')}</ul></section>`
    : '';
  return layout(ctx, {
    title: p.title,
    head: p.status === 'hidden' ? '<meta name="robots" content="noindex">\n' : '',
    crumbs: breadcrumbs(ctx, p.dir),
    body: `<article>
<h1>${esc(p.title)}${stubBadge(p)}</h1>
<p class="edit"><a href="${ctx.basePath}/editor/?page=${esc(p.slug)}" rel="nofollow">${esc(ctx.wiki.editor?.unlock_label ?? 'Edit')}</a></p>
${tags}
${html}
</article>
${log}`,
  });
}

export function listingHtml(ctx, dir, pages, subdirs) {
  const name = dir ? dir.split('/').pop() : ctx.wiki.title;
  const folders = subdirs.length
    ? `<ul class="folders">${subdirs.map((d) => `<li><a href="${d.url}">${esc(d.name)}/</a></li>`).join('')}</ul>`
    : '';
  const items = pages.length
    ? `<ul class="pages">${pages
        .map(
          (p) =>
            `<li><a href="${p.url}">${esc(p.title)}</a>${stubBadge(p)}${p.summary ? `<br><small>${esc(p.summary)}</small>` : ''}</li>`,
        )
        .join('')}</ul>`
    : '';
  const empty = !folders && !items ? '<p>No pages yet.</p>' : '';
  return layout(ctx, {
    title: name,
    crumbs: dir ? breadcrumbs(ctx, dir) : '',
    body: `<h1>${esc(name)}</h1>\n${folders}\n${items}\n${empty}`,
  });
}

export function redirectHtml({ wiki }, url, title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Moved: ${esc(title)} · ${esc(wiki.title)}</title>
<link rel="canonical" href="${esc(url)}">
<meta http-equiv="refresh" content="0; url=${esc(url)}">
</head>
<body>
<p>This page has moved to <a href="${esc(url)}">${esc(title)}</a>.</p>
</body>
</html>
`;
}
