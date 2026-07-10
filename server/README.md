# Merge Arena — Backend

Real Telegram Stars payments, analytics, and an admin dashboard for the Merge Arena Mini App.
Node.js + Express + SQLite. No framework magic, no external services required besides Telegram itself.

The game (`index.html` / `arena.js` at the repo root) still works perfectly with **no backend at all** —
it only calls this server when a `BACKEND_URL` is configured in `arena.js` and the game is running
inside Telegram. Nothing here is required to keep the game playable; it's required to make Shop
purchases real and to get analytics/ad-attribution data.

## What this does

- **Real Telegram Stars payments.** Creates real invoices (`createInvoiceLink`, currency `XTR`),
  handles Telegram's `pre_checkout_query` and `successful_payment` webhook events, and only grants
  an item after Telegram itself confirms the payment — never on a client-side "it worked" callback
  alone. Prices are looked up server-side by product ID; the client can never influence what it's
  charged.
- **Analytics + ad attribution.** Records session starts (with the Telegram `start_param`, which is
  how a t.me link or Telegram Ad campaign identifies itself), and arbitrary gameplay events
  (merges, battles, achievements, purchases).
- **Admin dashboard** at `/admin` (password protected): total users, DAU/WAU, total Stars revenue,
  revenue by product, installs & revenue by ad campaign, achievement claim counts, and recent
  purchases/events.

## 1. Create a Telegram bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. `/newbot` → follow the prompts → copy the **bot token** it gives you (looks like `123456:AA...`).
3. `/mybots` → your bot → **Bot Settings** → **Menu Button** → set it to your Mini App URL
   (e.g. `https://wealthia.github.io/merge-arena/`) so `/start` opens the game.
4. Stars payments work out of the box for every bot — there is no separate "enable payments" step
   or payment provider token needed (that's only for old-style third-party currencies, not Stars).

## 2. Deploy this server

This folder (`server/`) needs to run somewhere with a **public HTTPS URL** — GitHub Pages cannot
host it (it's static-only). Pick one:

### Option A — Render.com (free tier, easiest)
1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In the Render dashboard: **New +** → **Blueprint** → point it at this repo. It will read
   `server/render.yaml` automatically and provision a web service with a persistent disk for the
   SQLite file.
3. Fill in the environment variables Render prompts for (see [Environment variables](#3-environment-variables) below).
4. Once deployed, Render gives you a URL like `https://merge-arena-server.onrender.com` — that's
   your `PUBLIC_URL`.

### Option B — Railway / Fly.io / any Docker host
- Use the included `Dockerfile`. Mount a persistent volume at `/app/data` (SQLite needs to survive
  restarts/redeploys — without a persistent volume, all purchase/analytics history is lost on every
  deploy).
- Set the same environment variables as below.

### Option C — Your own VPS
- `git clone` this repo, `cd server && npm install && npm start`, put it behind a reverse proxy
  (Caddy/Nginx) with a real TLS certificate, and run it with a process manager (systemd/pm2) so it
  survives reboots.

## 3. Environment variables

Copy `.env.example` to `.env` for local dev, or set these directly on your host (Render/Railway
have an "Environment" tab in their dashboards; for Cursor Cloud Agents specifically, add secrets in
**Cloud Agents → Secrets** so future agents can access them too).

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | Yes | From BotFather. Keep this secret — anyone with it can send messages/invoices as your bot. |
| `PUBLIC_URL` | Yes | The public HTTPS URL of *this* server once deployed. Used to auto-register the Telegram webhook on startup. |
| `WEBHOOK_SECRET_PATH` | Yes | Random string, part of the webhook URL path. Generate with `openssl rand -hex 24`. |
| `WEBHOOK_SECRET_TOKEN` | Yes | Random string Telegram echoes back on every webhook call, verified server-side. Generate the same way. |
| `ADMIN_PASSWORD` | Yes | Password for `/admin`. Pick something strong — it guards real revenue data. |
| `SESSION_SECRET` | Yes | Random string used to sign the admin login cookie. |
| `CORS_ORIGIN` | Recommended | Restrict API calls to your game's origin, e.g. `https://wealthia.github.io`. Defaults to `*` if unset. |
| `PORT` | No | Defaults to `3000`. Most hosts set this automatically. |
| `DB_PATH` | No | Where the SQLite file lives. Defaults to `./data/merge-arena.sqlite`. **Must be on a persistent volume in production.** |

On startup, if both `BOT_TOKEN` and `PUBLIC_URL` are set, the server automatically calls Telegram's
`setWebhook` for you — there's no manual webhook registration step.

## 4. Point the game at this backend

Once deployed and healthy (check `https://<your-url>/health` returns `{"ok":true}`), open
`arena.js` at the repo root and set:

```js
const BACKEND_URL = "https://<your-deployed-backend-url>";
```

Commit and push — GitHub Pages redeploys automatically. From then on, Shop purchases made inside
Telegram go through real Stars payments, and gameplay events are recorded for the admin dashboard.
If `BACKEND_URL` is left empty, or the game is opened outside Telegram, everything falls back to
the previous free/local-only behavior — the game never breaks because of this.

## 5. Check it's working

1. `curl https://<your-url>/health` → `{"ok":true}`.
2. Open the game inside Telegram, open the Shop, buy something small. You should see a real
   Telegram payment sheet (not the old demo confirm dialog).
3. Log into `https://<your-url>/admin` with `ADMIN_PASSWORD` and confirm the purchase shows up.

## Development

```bash
cd server
npm install
cp .env.example .env   # fill in a fake BOT_TOKEN etc. for local testing
npm start
npm test                # runs the full test suite, no real Telegram calls made
```

## Notes on the data model

- All game *play* state (heroes, board, wave, gems earned by playing) stays in the browser's
  `localStorage`, exactly as before — this backend does not turn the game into a server-authoritative
  game, that would be a much bigger rewrite. It only makes **real-money purchases** server-verified.
- A purchase is recorded once, tied to Telegram's own `telegram_payment_charge_id` (unique), so a
  retried/duplicated webhook delivery from Telegram can never double-grant an item.
- `first_start_param` on the `users` table is captured only on a user's *first* session, so ad
  campaign attribution reflects which campaign actually brought the user in, not whatever link they
  most recently clicked.
