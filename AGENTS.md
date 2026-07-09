# MERGE ARENA

A dependency-free static Telegram Mini App game (vanilla HTML/CSS/JS). All state is persisted client-side in `localStorage`; there is no backend, database, or build step. Files: `index.html`, `arena.js`, `arena.css`. Deployed to GitHub Pages via `.github/workflows/pages.yml`.

## Cursor Cloud specific instructions

- There is **no build, install, lint, or test tooling** — no `package.json`, lockfiles, or dependencies. The update script is effectively a no-op.
- **Run it** by serving the repo root over HTTP (needed so `localStorage` and the Telegram SDK behave correctly): `python3 -m http.server 8000` from `/workspace`, then open `http://localhost:8000/index.html`. Any static server works.
- The game is **fully playable in a plain browser**. The Telegram WebApp SDK and Google Fonts load from CDNs and degrade gracefully; Telegram-only features (haptics, header color, real Stars checkout) are optional and only testable inside a Telegram client. The Shop checkout is a demo `window.confirm` dialog, not a real payment.
- Core loop to smoke-test: tap **Get Hero** (costs 1 ⚡), drag two identical heroes together to merge/upgrade them, then tap **Fight!**. Progress persists across reloads via the `merge_arena_v2` localStorage key; clear that key to reset game state.
