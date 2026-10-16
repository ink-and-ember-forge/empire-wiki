# Empire Notes Wiki: Specification

## 1. Purpose

A personal wiki for organising worldbuilding notes (the "Empire" notes), hosted for free on GitHub Pages. A small group of trusted people can read it and a few can edit it, using a browser-based editor built into the site. The wiki is non-sensitive. Privacy is about keeping content out of casual view, not about security. Anything in the repository should be treated as public.

## 2. Guiding principles

- **Repository is the source of truth.** Every page is a Markdown file with front matter, committed to Git.
- **Build produces the site; the editor produces the source.** The editor never writes HTML.
- **One button to publish.** Publishing commits to the main branch, and a GitHub Actions workflow builds and deploys. Publishing goes straight to live; there is no review step.
- **Keep it small.** Prefer simple custom code over heavy frameworks, and add features only when needed.

## 3. Decisions made

| Area | Decision |
|---|---|
| Hosting | GitHub Pages from a **public** repository (free tier) |
| Build | Custom build script on top of a Markdown library, run by GitHub Actions |
| Editing | Browser editor integrated into the public site |
| Publishing | Straight to live; no review step |
| Credentials | Each editor's GitHub token, encrypted in the repo, unlocked with a personal passphrase |
| Token type | **Fine-grained personal access token**, scoped to this repository only, Contents: read/write. Set an expiry and renew it |
| Passphrase | Minimum **16 characters** (four random words usually satisfies this). Enforced by the editor when a token is encrypted |
| Key derivation | **PBKDF2-HMAC-SHA256, 600,000 iterations** (WebCrypto), AES-GCM, random salt and IV per token |
| Licence | **CC BY-SA 4.0** (content and code) |
| Access control | None beyond the above. Hidden means "not listed", not "access-controlled" |
| Change log | Per-page history generated from Git, shown on every built page |
| Edit summary | Optional. A default is generated from what changed when left blank |
| Navigation | Folder listings generated from the content folder structure |
| Search | Client-side search over page titles and tags only |
| Schema version | One version number for the whole repo, in `wiki.yml` |

## 4. Repository layout

```
/                       repository root
  wiki.yml              site-wide settings and schema version
  tags.yml              controlled tag list offered by the editor
  content/              all wiki pages, organised into folders
    characters/
    factions/
    locations/
  editor/               editor source (browser page and script)
  build/                build script
  .github/workflows/    Actions workflow
  README.md
```

Folder structure under `content/` becomes the navigation. A page's folder and URL slug are derived from its file path, not stored in its front matter.

## 5. Page format

Each page is a Markdown file under `content/`, beginning with YAML front matter:

```yaml
---
title: Navarr Vate          # required
status: published           # draft | published | hidden (default: draft)
stub: true                  # default: false; shows a badge on every status
tags: [characters, nisien]  # from tags.yml; new tags allowed
summary: One line for listings and search
updated: 2026-10-16         # set by the editor on publish
order: 10                   # position within its folder
---
```

### Field behaviour

- **`title`** is required. The build fails if it's missing.
- **`status`** controls visibility:
  - `draft`: not built into the site. Visible to editors in the editor's page list and in the repository.
  - `published`: built, listed in folder menus, and included in search.
  - `hidden`: built and reachable by direct link, but not listed in menus or folder listings. Carries a `noindex` tag. Title is still searchable.
- **`stub`** is a visual marker only. It shows a badge on the page and in listings, regardless of status. It does not change building, listing, or search.
- **`tags`** should come from `tags.yml`. The editor allows new tags. The build warns about tags used on only one page, since these are often typos, but never fails on them.
- **`summary`** is shown in folder listings and search results.
- **`updated`** is set by the editor on each publish.
- **`order`** sorts pages within a folder. Pages without it sort alphabetically after those with it.
- Unknown keys are **ignored** by the build, not treated as errors, so future fields don't break older builds.

### Defaults

- New pages default to `status: draft`, so nothing goes live by accident.
- Missing optional fields take their defaults. Adding a new optional field requires no changes to existing pages.

## 6. Configuration files

### `wiki.yml`

```yaml
schema: 1
title: Empire Notes
base_url: https://OWNER.github.io/REPO   # placeholder until repo exists
default_status: draft
editor:
  unlock_label: Edit
  show_history: true
```

- `schema` is the repository-wide schema version. Migrations convert all pages together, on a branch, before merging.
- `show_history` is the global switch for the change log.

### `tags.yml`

```yaml
tags:
  - name: characters
    description: People and beings in the setting
  - name: factions
    description: Groups, houses, and organisations
  - name: locations
    description: Places, regions, and cities
```

## 7. Build

The build is a custom script (Node.js) that:

1. Reads `wiki.yml` and `tags.yml`.
2. Reads every page under `content/`, parses its front matter, and validates required fields.
3. **Skips `draft` pages entirely.** They are never written to the output.
4. Renders `published` and `hidden` pages from Markdown to HTML using an off-the-shelf Markdown library, wrapped in a simple template.
5. Adds `<meta name="robots" content="noindex">` to `hidden` pages.
6. Adds the stub badge where `stub: true`.
7. Generates a folder listing page for each folder, excluding `hidden` pages.
8. Generates a search index (JSON) of titles, tags, summaries, and URLs for `published` pages. **Hidden page titles are included**, as agreed.
9. Generates a change log for each built page from Git history (see section 10).
10. Writes everything to `_site/`.
11. Warns about single-use tags. Fails on invalid front matter or missing required fields.

The build does not need to be fast. The site is small.

## 8. Publishing workflow

GitHub Actions workflow, triggered on push to `main`:

- Checks out the repository **with full history** (`fetch-depth: 0`), required for change logs.
- Installs dependencies, runs the build, and uploads `_site/` as the Pages artifact.
- Deploys using the official Pages actions.
- Uses a concurrency group so two deployments don't run at once.

**Important:** publishes must authenticate with the editor's **own token**, not the default `GITHUB_TOKEN`. Commits made with the default token don't trigger workflows, so publishing would silently do nothing.

If the build fails, the previous deployment stays live.

## 9. Editor

The editor is a browser page built into the site (under `/editor/`). It talks to GitHub's API directly.

### Access

- Reading the repository needs no credentials, since the repository is public.
- **Unlock:** the user enters their passphrase, which decrypts their GitHub token into memory for the session only. The token is never written to browser storage.
- Only unlocked sessions can publish.

### Screens

1. **Unlock.** A passphrase prompt. Quick and minimal.
2. **Page list.** Folder structure, with status, title, and summary shown for each page. Filterable by status, so drafts are easy to find.
3. **Page editor.**
   - Front-matter form: title, status, stub, tags, summary, order. `updated` is set automatically and isn't an input.
   - Markdown body, as plain text.
   - A **preview toggle**, off by default, which renders the page.
4. **Publish confirmation.**
   - Lists every page changed since the last publish, with its title and status.
   - Edit summary field, **optional**. If blank, a default is generated from the changes (for example, "Edited body" or "Updated summary and tags").
   - Confirm button, which commits and pushes.
   - A note that the site takes a short time to rebuild.

### In-page editing

- Every built page shows an **Edit** control. It does nothing until the editor is unlocked, at which point it opens that page in the editor.
- Editing a published or hidden page starts from the page itself.
- **Drafts are edited from the page list**, since they aren't built and can't be reached from the public site.

### Conflicts

- The GitHub API requires the file's current version when writing.
- If a page changed since the editor loaded it, publishing is refused for that page. The editor shows the newer version and asks the user to re-apply their change.
- No automatic merging.

## 10. Change log

- Every publish is a Git commit. The commit message is the edit summary (or the default).
- Each built page shows its history, drawn from Git at build time: date, author, and summary, newest first.
- Authorship comes from each editor's GitHub account, since each person publishes with their own token.
- History is shown on **all built pages, including hidden pages**. This matches the rest of the repository, which is already public.
- Drafts have history in Git, but it's not built into the site.
- Diff views between revisions are **not** in scope for the first version.

## 11. Search

- Client-side only. A small script filters the search index as the user types.
- Matches page **titles and tags**, not page content.
- Includes `published` and `hidden` pages. Excludes `draft`.
- Results show title, summary, and the stub badge where relevant.

## 12. Schema versioning and migrations

- `wiki.yml` holds `schema: 1`.
- The build reads the schema version and refuses to run if it doesn't recognise it.
- Adding optional fields is non-breaking.
- Changing the meaning of a field is breaking. It requires a migration, which is performed by Claude Code:
  1. Create a branch.
  2. Convert every page in `content/`.
  3. Run the build locally and check the output.
  4. Bump `schema` in `wiki.yml`.
  5. Merge to `main`.

## 13. Setup status

### Settled

- **Repository and URLs.** Repo: https://github.com/ink-and-ember-forge/empire-wiki. Live site: https://ink-and-ember-forge.github.io/empire-wiki/ (this is also `base_url` in `wiki.yml`).
- **Trusted editors.** The owner only, for now. Adding an editor later means: add them as a collaborator with write access, they create a fine-grained token, and encrypt it with their own passphrase. No design change.
- **Action versions** (checked against the actions' published tags, not yet exercised by a real run): `actions/checkout@v7`, `actions/setup-node@v7`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`.
- **Passphrase and KDF.** See section 3. The encrypted token file is stored in a public repository, so it can be downloaded and attacked offline. The passphrase length is the main defence; the iteration count only slows each guess.
- **Token type.** Fine-grained PAT limited to this repository. If an encrypted token were ever cracked, the damage is limited to this wiki.
- **Licence.** CC BY-SA 4.0. `LICENSE` holds the full legal code.
- **Starting content.** Empty `content/characters`, `content/factions` and `content/locations`; tags as in `tags.yml`. No notes migrated.
- **Rate limits (design rule).** The public site makes no live API calls; history, listings and search data are built in advance. The editor uses the unlocked token for every API call, including reads, so it never depends on the low anonymous limit. The current numeric limits have not been verified against GitHub's documentation (anonymous access is far lower than authenticated). Publishing is a handful of writes per publish, well inside any limit.

### Still to do

- **Pages source setting.** In the repository: Settings, then Pages, then Build and deployment, then Source: **GitHub Actions**. Confirm the menu wording when doing it.
- **Token expiry.** Choose an expiry for the owner's fine-grained token and set a reminder to renew it.

## 14. Out of scope for version 1

- Access control beyond "hidden means not listed".
- Diff views between revisions.
- Full-text content search.
- Review or approval before publishing.
- Comments, notifications, or any server-side component.
- Automated migrations beyond the manual process in section 12.
