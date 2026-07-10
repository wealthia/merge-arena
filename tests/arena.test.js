// Lightweight regression suite for Merge Arena's client-side logic.
// Runs entirely in jsdom — no browser, no network. `npm test` / `node tests/arena.test.js`.
//
// Why this exists: a previous change shipped straight to `main` broke live
// play ("everything resets"). This suite exercises the real DOM + arena.js
// together so regressions like that get caught before deploy.

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const arenaJs = fs.readFileSync(path.join(ROOT, "arena.js"), "utf8");

let failures = 0;
let passed = 0;

function check(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ok - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${label}`);
  }
}

/**
 * Boots a fresh jsdom window running arena.js.
 * @param {object} [opts]
 * @param {object} [opts.stateOverride] - written to localStorage before boot so
 *   loadState() picks it up (only the fields you pass are overridden).
 * @param {boolean} [opts.fastTimers] - make setTimeout fire synchronously so
 *   battle sequences (which use real timers) resolve instantly.
 */
function boot(opts = {}) {
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });
  const { window } = dom;
  window.confirm = () => true;

  if (opts.fastTimers) {
    window.setTimeout = (fn) => {
      if (typeof fn === "function") fn();
      return 0;
    };
  }

  if (opts.stateOverride) {
    window.localStorage.setItem("merge_arena_v2", JSON.stringify(opts.stateOverride));
  }

  window.eval(arenaJs);
  return window;
}

function click(window, id) {
  const el = window.document.getElementById(id);
  assert(el, `expected element #${id} to exist`);
  el.dispatchEvent(new window.Event("click", { bubbles: true }));
}

function getSavedState(window) {
  return JSON.parse(window.localStorage.getItem("merge_arena_v2"));
}

// arena.js's battle sequence is a chain of `await wait(ms)` calls. Even with
// fastTimers making those timers fire instantly, each `await` still defers to
// a microtask tick. A real (Node-side, not window-side) macrotask delay lets
// all of those microtasks flush before we inspect the resulting state.
function flush(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
console.log("Test 1: fresh boot renders the board and default UI");
{
  const window = boot();
  const cells = window.document.querySelectorAll("#board .cell");
  check("renders 16 board cells", cells.length === 16);
  const units = window.document.querySelectorAll("#board .unit");
  check("seeds 3 starter units", units.length === 3);
  check("sound icon defaults to on", window.document.getElementById("soundIcon").textContent === "🔊");
  check("energy value rendered", window.document.getElementById("energyValue").textContent === "12");
  check(
    "matchup preview text is populated",
    window.document.getElementById("matchupText").textContent.length > 0
  );
}

console.log("Test 2: sound toggle persists across reloads");
{
  const window = boot();
  click(window, "soundToggle");
  check("icon switches to muted", window.document.getElementById("soundIcon").textContent === "🔇");
  check("soundOn persisted as false", getSavedState(window).soundOn === false);

  const window2 = boot({ stateOverride: getSavedState(window) });
  check("mute persists after reload", window2.document.getElementById("soundIcon").textContent === "🔇");
}

console.log("Test 3: merging two identical heroes still works (regression)");
{
  const window = boot();
  const board = window.document.getElementById("board");
  // seeded board: index 5 & 6 = spark L1, index 9 = blade L1
  const fromNode = board.querySelector('.unit[data-index="5"]');
  const toCell = board.querySelector('.cell[data-index="6"]');
  check("drag source unit exists", !!fromNode);
  check("drag target cell exists", !!toCell);

  const pointerDown = new window.Event("pointerdown");
  fromNode.setPointerCapture = () => {};
  fromNode.dispatchEvent(pointerDown);

  Object.defineProperty(window.document, "elementFromPoint", {
    value: () => toCell,
    configurable: true
  });
  const pointerUp = new window.Event("pointerup");
  fromNode.releasePointerCapture = () => {};
  fromNode.dispatchEvent(pointerUp);

  const merged = window.document.querySelector('#board .cell[data-index="6"] .unit');
  check("merge produced a level-2 unit", !!merged && merged.querySelector(".unit__lvl").textContent === "L2");
  check("merges counter incremented", getSavedState(window).merges === 1);
  check("merge gem reward granted", getSavedState(window).gems === 80 + 10);
}

console.log("Test 4: achievements are locked until earned, then claimable exactly once");
{
  const window = boot();
  window.document.querySelector('[data-nav="rank"]').dispatchEvent(new window.Event("click"));
  const firstWinBtn = window.document.querySelector('[data-achv="first_win"]');
  check("first_win button starts disabled (locked)", firstWinBtn.disabled === true);

  const window2 = boot({ stateOverride: { wins: 1 } });
  window2.document.querySelector('[data-nav="rank"]').dispatchEvent(new window.Event("click"));
  const readyBtn = window2.document.querySelector('[data-achv="first_win"]');
  check("first_win button is claimable once won", readyBtn.disabled === false);

  const gemsBefore = getSavedState(window2).gems;
  readyBtn.dispatchEvent(new window2.Event("click", { bubbles: true }));
  const stateAfterClaim = getSavedState(window2);
  check("claiming grants the reward gems", stateAfterClaim.gems === gemsBefore + 20);
  check("achievement recorded as claimed", stateAfterClaim.achievementsClaimed.includes("first_win"));

  const claimedBtn = window2.document.querySelector('[data-achv="first_win"]');
  check("button becomes disabled after claiming", claimedBtn.disabled === true);
  claimedBtn.dispatchEvent(new window2.Event("click", { bubbles: true }));
  check("double-claim does not grant gems again", getSavedState(window2).gems === gemsBefore + 20);
}

console.log("Test 5: boss levels (every 5th wave) double battle rewards");
{
  const strongBoard = new Array(16).fill(null);
  strongBoard[0] = { id: "sovereign", level: 5, rarity: "legendary" };
  const window = boot({
    fastTimers: true,
    stateOverride: { wave: 5, trophies: 0, gems: 80, energy: 5, board: strongBoard, discovered: ["sovereign"] }
  });
  check("wave 5 is flagged as a boss level in the UI", window.document.getElementById("waveTitle").textContent.includes("BOSS"));

  click(window, "battleButton");
  await flush();
  const finalState = getSavedState(window);
  // wave 5 win: base trophy gain = 8 + 5*2 = 18, boss doubles it to 36; base gems = 20 + 5*5 = 45, boss doubles to 90.
  check("boss win advances the wave", finalState.wave === 6);
  check("boss win doubles trophy reward", finalState.trophies === 36);
  check("boss win doubles gem reward", finalState.gems === 80 + 90);
}

console.log("Test 6: regular (non-boss) levels do not get the boss multiplier");
{
  const strongBoard = new Array(16).fill(null);
  strongBoard[0] = { id: "sovereign", level: 5, rarity: "legendary" };
  const window = boot({
    fastTimers: true,
    stateOverride: { wave: 4, trophies: 0, gems: 80, energy: 5, board: strongBoard, discovered: ["sovereign"] }
  });
  check("wave 4 is not flagged as boss", !window.document.getElementById("waveTitle").textContent.includes("BOSS"));

  click(window, "battleButton");
  await flush();
  const finalState = getSavedState(window);
  // wave 4 win: trophy gain = 8 + 4*2 = 16 (no multiplier); gems = 20 + 4*5 = 40.
  check("normal win does not double trophies", finalState.trophies === 16);
  check("normal win does not double gems", finalState.gems === 80 + 40);
}

console.log("Test 7: shop checkout is clearly disclosed as a free demo (no real payment)");
{
  const window = boot();
  window.document.querySelector('[data-nav="shop"]').dispatchEvent(new window.Event("click"));
  click(window, "energyChip"); // energyChip also opens the energy_refill pay modal directly
  const payText = window.document.getElementById("payModal").textContent;
  check("pay modal discloses this is a demo / not a real charge", /demo/i.test(payText) && /no real/i.test(payText));
}

console.log("Test 8: inviting friends never grants a reward (no farmable referral exploit)");
{
  const window = boot();
  window.document.querySelector('[data-nav="rank"]').dispatchEvent(new window.Event("click"));
  const gemsBefore = getSavedState(window).gems;
  const trophiesBefore = getSavedState(window).trophies;
  // jsdom has no navigator.share / clipboard, so this exercises the final toast fallback path.
  click(window, "inviteButton");
  const stateAfter = getSavedState(window);
  check("share button grants no gems", stateAfter.gems === gemsBefore);
  check("share button grants no trophies", stateAfter.trophies === trophiesBefore);
}

console.log("Test 9: manifest.json and service-worker.js are well-formed");
{
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  check("manifest has icons array with 2 entries", Array.isArray(manifest.icons) && manifest.icons.length === 2);
  check("manifest icons referenced on disk exist", manifest.icons.every((icon) => fs.existsSync(path.join(ROOT, icon.src.replace("./", "")))));
  const sw = fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8");
  check("service worker references CACHE_NAME", sw.includes("CACHE_NAME"));
}

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) {
  process.exitCode = 1;
}
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
