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
