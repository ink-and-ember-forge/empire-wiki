# Empire Notes Wiki

A personal worldbuilding wiki hosted on GitHub Pages. Pages are Markdown files in `content/`; a small Node build turns them into a static site. See [`spec.md`](spec.md) for the full design.

Live site: https://ink-and-ember-forge.github.io/empire-wiki/

## Layout

| Path | Purpose |
|---|---|
| `wiki.yml` | Site settings and schema version |
| `tags.yml` | Controlled tag list |
| `content/` | Wiki pages; folders become navigation |
| `build/` | Build script, template and site assets |
| `editor/` | Browser editor (not built yet) |
| `.github/workflows/deploy.yml` | Build and deploy to Pages on push to `main` |

## Writing a page

Create `content/<folder>/<name>.md`:

```yaml
---
title: Navarr Vate        # required
status: published         # draft | published | hidden (default: draft)
stub: true                # optional badge
tags: [characters]
summary: One line for listings and search
order: 10
---
Markdown body here.
```

Drafts are never built. Hidden pages are built but unlisted and `noindex`.

## Local build

```sh
npm install
npm run build   # writes _site/
npm run serve   # builds with a local base URL and serves http://localhost:8080
```

## One-time GitHub setup

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Merge to `main`; the workflow builds and deploys.

## Licence

[CC BY-SA 4.0](LICENSE).
