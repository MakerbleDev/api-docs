# Makerble API docs

The site at api-docs.makerble.com. It is an Express app (`server.js`) deployed on Vercel.

- `openapi.yaml` (repo root): the OpenAPI spec, served at `/openapi.yaml` and used by the Prism mock server at `/mock`.
- `server.js`: the routes, plus the whole docs page (HTML, CSS and endpoint cards) in `buildDocsPage()`.
- `assets/`: the Makerble logo and favicon, served from `/assets/makerble-logo.png` and `/favicon.png`.
- `vercel.json`: must keep `includeFiles: ["assets/**", "openapi.yaml"]`. Without it, Vercel leaves those files out and the logo, favicon and spec return errors.

## Don't undo other people's changes

The Makerble branding (PR #52) was wiped out by a later docs commit. That commit was built from an out-of-date copy of `server.js`, so it rewrote the page styles and deleted `assets/` without anyone noticing. To stop that happening again:

- **Start from the latest `main`.** Fetch and merge `origin/main` before you edit, and again before you open a PR. Never paste or rewrite `server.js` wholesale from an older copy. Make targeted edits.
- **Check your diff before you commit.** A docs PR should only touch `openapi.yaml` and the endpoint cards or nav links in `server.js`. If `git diff --stat` shows changes to the `<style>` block, the `<head>`, `vercel.json`, `SPEC_PATH`, or deleted files under `assets/`, you are reverting someone's work. Stop and fix it.
- **Keep design changes in their own PR.** Branding, layout and server changes go in PRs of their own, separate from endpoint docs.
- **Run `npm run check` before pushing.** It boots the server and fails if the logo, favicon, Quicksand font, brand colours, or the `/openapi.yaml` route are missing. CI runs the same check on every PR.

## Branding

Match the Makerble app:

- Fonts: Quicksand for UI text, JetBrains Mono for code, paths and params.
- Colours: navy `#2d3e58` text, purple `#ac3898` primary accent (active nav, eyebrows, CTAs), blue `#2f6fb0` links.
- Layout: white header with the logo lockup, light sidebar, dark code panel on the right.
- Logo and favicon live only in `assets/`.

Use the CSS variables in `:root` rather than hard-coded colours. In nav links, use the `method-GET` / `method-POST` classes with no inline `style=`.

## Running locally

```
npm install
npm run dev      # http://localhost:3000
npm run check    # regression check
```
