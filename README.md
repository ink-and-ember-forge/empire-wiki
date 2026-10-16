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

Link to other pages with `[[Page title]]` (or `[[folder/file-name]]`, or `[[Page title|label]]`). Links to pages that don't exist yet, or are still drafts, show in red with a dashed underline and open the editor so you can create them.

## Local build

```sh
npm install
npm run build   # writes _site/
npm run serve   # builds with a local base URL and serves http://localhost:8080
```

## Editor

Live at `/editor/` on the site; every page has an **Edit** link that opens it there.

**One-time setup per editor** (the owner has no token file yet):

1. Create a fine-grained GitHub token: resource owner `ink-and-ember-forge`, only `empire-wiki`, permission **Contents: Read and write**, with an expiry.
2. Open `/editor/setup.html`, paste the token, choose a passphrase (16+ characters). Everything happens in your browser.
3. Commit the JSON it shows to `editor/tokens/<your-github-username>.json` (GitHub web UI is fine). After the next deploy you can unlock.

The token is decrypted into memory only and is gone when the tab reloads. Publishing commits straight to `main` as you.

Every tag has a page at `/tags/<tag>/`: a description, then an A-Z list of the published pages with that tag. To write the description, click **Edit description** on the tag page (it's an ordinary page at `content/tags/<tag>.md`).

Each page gets a stable `id` when first published in the editor, and its `[[links]]` are recorded by id in `links/<page id>.yml`, so links keep working when a page is moved or retitled (the page text is never rewritten). Typing `[[` in the editor opens a picker. For pages created or edited outside the editor, run `npm run ids` (add `-- --check` to just report) to backfill ids and link maps. Old addresses of moved pages redirect automatically.

The **Location** panel moves or renames a page (one commit, history preserved) and warns when a path would create a new folder. 

Run the tests with `npm test`.

## One-time GitHub setup

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Merge to `main`; the workflow builds and deploys.

## Licence

[CC BY-SA 4.0](LICENSE).
