# MERGE ARENA

Telegram mini-app: combine heroes, grow power, win fights.

## Play

**https://wealthia.github.io/merge-arena/**

Backup (same game): https://wealthia.github.io/wealthia/merge-arena/

## Pages setup note
Do **not** put `wealthia.github.io/merge-arena/` in **Custom domain**.
Leave Custom domain **empty**. Source should be **GitHub Actions**.

## How to play
1. Tap **Get Hero**
2. Drag two same heroes together to combine / upgrade
3. Tap **Fight!** when your power is higher than the level
4. Every 5th level is a **BOSS** level — win it for double trophies and gems
5. Check **Progress** for one-time **Achievements** with gem rewards
6. Tap the speaker icon to mute/unmute sound effects

## BotFather
```
https://wealthia.github.io/merge-arena/
```

## Development

This is a static site — `index.html`, `arena.css`, `arena.js` — with no build step.
Just open `index.html` in a browser, or serve the folder with any static file server.

### Tests

A regression test suite runs against a real DOM (via `jsdom`) to catch bugs before they
ship — this is what the deploy workflow runs on every push to `main` before the site
goes live.

```bash
npm install
npm test
```

## Backend (real Stars payments, analytics, admin dashboard)

The game works fully with no backend (free demo Shop purchases, no analytics — this is the
default). An optional backend lives in [`server/`](server/README.md) that adds:

- Real Telegram Stars payments for the Shop (with server-side price verification and Telegram
  webhook confirmation — no purchase is ever granted on a client-side callback alone).
- Analytics + ad-campaign attribution (which `start_param` / ad link brought which installs).
- A password-protected `/admin` dashboard: users, DAU/WAU, revenue, revenue by product, revenue by
  campaign, achievement claim counts, recent purchases/events.

Setting it up requires a Telegram bot token and deploying `server/` somewhere with a public HTTPS
URL — GitHub Pages can't host it. Full step-by-step instructions: **[server/README.md](server/README.md)**.
Once deployed, point the game at it by setting `BACKEND_URL` near the top of `arena.js`.
