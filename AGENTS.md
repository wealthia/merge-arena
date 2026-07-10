# MERGE ARENA

A static Telegram Mini App game (vanilla HTML/CSS/JS) at the repo root, plus an optional backend in
`server/` (Node/Express/SQLite) for real Telegram Stars payments, analytics, and an admin dashboard.
Game files: `index.html`, `arena.js`, `arena.css`, `manifest.json`, `service-worker.js`, `icons/`.
Deployed to GitHub Pages via `.github/workflows/pages.yml`. The backend is a separate deployable
under `server/` — see `server/README.md` for full deployment instructions.

## Cursor Cloud specific instructions

- **Two independent test suites, run both before pushing:**
  - Frontend: `npm install && npm test` (or `node tests/arena.test.js`) at the repo root.
  - Backend: `cd server && npm install && npm test`.
  - CI runs both on every push/PR (`.github/workflows/test.yml`, two jobs) and the frontend suite
    again before every Pages deploy (`.github/workflows/pages.yml`); a failing suite blocks that
    stage.
- **The game itself still has no build step and works with zero backend.** `BACKEND_URL` at the top
  of `arena.js` is `""` by default — when empty (or when not running inside Telegram), the game
  behaves exactly as the original client-only version: free demo Shop purchases, no analytics. Real
  payments/analytics only activate once `BACKEND_URL` is set to a deployed `server/` instance.
- **Run the frontend in a browser** by serving the repo root over HTTP (needed so `localStorage`,
  the service worker, and the Telegram SDK behave correctly): `python3 -m http.server 8000` from
  `/workspace`, then open `http://localhost:8000/index.html`.
- **`server/` must never be published to GitHub Pages.** The deploy workflow copies only
  `index.html arena.js arena.css manifest.json service-worker.js icons/ .nojekyll` into a `dist/`
  folder before uploading — `server/`, `tests/`, `package.json`, docs, etc. are intentionally left
  out. If you add a new file the game needs at runtime, add it to that copy step too.
- **Real Telegram Stars payments now have a real implementation in `server/`** (`createInvoiceLink`,
  `pre_checkout_query`/`successful_payment` webhook handling, server-authoritative pricing via
  `server/src/products.js`, idempotent purchase recording keyed on Telegram's own
  `telegram_payment_charge_id`). It still needs a real bot token and a deployed, publicly-reachable
  host to actually go live — see `server/README.md` for the BotFather + hosting steps. Don't assume
  it's live just because the code exists; check whether `BACKEND_URL` in `arena.js` is actually set.
- **The "Invite Friends" share button intentionally grants no reward.** Referral attribution that
  can be trusted (not just "click share, cancel, repeat") needs server-side verification tied to
  Telegram user IDs — ad-campaign attribution via `start_param` is already implemented server-side
  (`users.first_start_param`, visible in the `/admin` dashboard), but *organic* friend-invites are
  not tracked, on purpose, since there's no way to confirm who actually joined because of one.
- Gameplay state (gems, trophies, energy, achievements, sound preference) lives in the
  `merge_arena_v2` `localStorage` key with no server validation — any user can edit it via devtools.
  This is an accepted limitation of keeping gameplay client-side; only real-money purchases are
  server-verified. Don't try to "fix" this with client-side obfuscation.
- Core loop to smoke-test: tap **Get Hero** (costs 1 ⚡), drag two identical heroes together to
  merge/upgrade them, then tap **Fight!**. Every 5th level is a boss (2x rewards). Progress persists
  across reloads via the `merge_arena_v2` localStorage key; clear that key to reset game state.
