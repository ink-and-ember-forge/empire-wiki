export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const stubBadge = (p) => (p.stub ? ' <span class="badge">stub</span>' : '');

function layout({ wiki, basePath }, { title, head = '', body, crumbs = '', wide = false }) {
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
  <a class="navlink" href="${basePath}/tags/">Tags</a>
  <div class="search"><input id="q" type="search" placeholder="Search titles and tags" autocomplete="off"><ul id="results" hidden></ul></div>
</header>
<main${wide ? ' class="wide"' : ''}>
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
    ? `<p class="tags">${p.tags
        .map((t) => {
          const url = ctx.tagUrl?.(t);
          return url ? `<a class="tag" href="${esc(url)}">${esc(t)}</a>` : `<span class="tag">${esc(t)}</span>`;
        })
        .join(' ')}</p>`
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

const plural = (n, one, many) => (n === 1 ? one : many);

function groupedList(groups, render) {
  return `<div class="taglist">${groups
    .map((g) => `<h3>${esc(g.letter)}</h3>\n<ul>${g.items.map((i) => `<li>${render(i)}</li>`).join('')}</ul>`)
    .join('\n')}</div>`;
}

/** A tag's page: its description, then every published page with the tag, grouped A-Z. */
export function tagHtml(ctx, tag, descHtml, groups, history) {
  const { basePath } = ctx;
  const n = tag.members.length;
  const edit = `${basePath}/editor/?page=${encodeURI(`tags/${tag.slug}`)}&title=${encodeURIComponent(tag.name)}&status=published`;
  const log = history.length
    ? `<section class="history"><h2>Change log</h2><ul>${history
        .map((h) => `<li><time>${esc(h.date)}</time> \u00b7 ${esc(h.author)} \u00b7 ${esc(h.summary)}</li>`)
        .join('')}</ul></section>`
    : '';
  return layout(ctx, {
    title: `Tag: ${tag.name}`,
    wide: true,
    crumbs: `<nav class="crumbs"><a href="${basePath}/">Home</a> / <a href="${basePath}/tags/">Tags</a></nav>\n`,
    body: `<h1>Tag: ${esc(tag.name)}</h1>
<p class="edit"><a href="${esc(edit)}" rel="nofollow">Edit description</a></p>
<div class="tag-desc">${descHtml || '<p class="hint">This tag has no description yet.</p>'}</div>
<h2>Pages tagged &ldquo;${esc(tag.name)}&rdquo;</h2>
${n ? `<p class="count">${n} ${plural(n, 'page is', 'pages are')} tagged &ldquo;${esc(tag.name)}&rdquo;.</p>\n${groupedList(groups, (p) => `<a href="${esc(p.url)}">${esc(p.title)}</a>${stubBadge(p)}`)}` : '<p>No pages have this tag yet.</p>'}
${log}`,
  });
}

/** /tags/: every tag, with how many pages carry it. */
export function tagsIndexHtml(ctx, tags, groups) {
  return layout(ctx, {
    title: 'Tags',
    wide: true,
    crumbs: `<nav class="crumbs"><a href="${ctx.basePath}/">Home</a></nav>\n`,
    body: `<h1>Tags</h1>
${tags.length ? `<p class="count">${tags.length} ${plural(tags.length, 'tag', 'tags')}.</p>\n${groupedList(groups, (t) => `<a href="${esc(t.url)}">${esc(t.name)}</a> <small>(${t.members.length})</small>`)}` : '<p>No tags yet.</p>'}`,
  });
}
