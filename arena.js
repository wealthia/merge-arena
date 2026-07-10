(() => {
  const STORAGE_KEY = "merge_arena_v2";
  const COLS = 4;
  const ROWS = 4;
  const SIZE = COLS * ROWS;
  const ENERGY_MAX = 20;
  const BOSS_INTERVAL = 5;
  const BOSS_MULTIPLIER = 1.45;
  const BOSS_REWARD_MULTIPLIER = 2;

  const UNIT_DEFS = [
    { id: "spark", name: "Spark", icon: "⚡", rarity: "common", basePower: 12 },
    { id: "blade", name: "Blade", icon: "🗡", rarity: "common", basePower: 14 },
    { id: "ward", name: "Ward", icon: "🛡", rarity: "rare", basePower: 22 },
    { id: "nova", name: "Nova", icon: "✦", rarity: "rare", basePower: 26 },
    { id: "phantom", name: "Phantom", icon: "👁", rarity: "epic", basePower: 40 },
    { id: "titan", name: "Titan", icon: "🏛", rarity: "epic", basePower: 48 },
    { id: "sovereign", name: "Sovereign", icon: "👑", rarity: "legendary", basePower: 72 }
  ];

  const ACHIEVEMENTS = [
    { id: "first_win", title: "First Victory", desc: "Win your first battle.", reward: 20, check: (s) => s.wins >= 1 },
    { id: "merge_10", title: "Merge Novice", desc: "Combine heroes 10 times.", reward: 30, check: (s) => s.merges >= 10 },
    { id: "merge_30", title: "Merge Master", desc: "Combine heroes 30 times.", reward: 60, check: (s) => s.merges >= 30 },
    { id: "wave_5", title: "Getting Started", desc: "Reach Level 5.", reward: 40, check: (s) => s.bestWave >= 5 },
    { id: "wave_10", title: "Rising Star", desc: "Reach Level 10.", reward: 80, check: (s) => s.bestWave >= 10 },
    { id: "trophies_100", title: "Trophy Hunter", desc: "Earn 100 trophies.", reward: 60, check: (s) => s.trophies >= 100 },
    { id: "full_roster", title: "Collector", desc: "Discover every hero type.", reward: 150, check: (s) => s.discovered.length >= UNIT_DEFS.length },
    { id: "legendary", title: "Legendary", desc: "Unlock the Sovereign hero.", reward: 200, check: (s) => s.discovered.includes("sovereign") }
  ];

  const SHOP = {
    energy_refill: {
      title: "Full Energy",
      text: "Fill energy to 20 ⚡ instantly.",
      stars: 25,
      apply(state) {
        state.energy = ENERGY_MAX;
      }
    },
    energy_pack: {
      title: "+10 Energy",
      text: "Add 10 energy right now.",
      stars: 15,
      apply(state) {
        state.energy = Math.min(ENERGY_MAX, state.energy + 10);
      }
    },
    rare_summon: {
      title: "Rare Hero",
      text: "Put a guaranteed Rare hero on your board.",
      stars: 40,
      apply(state) {
        return placeGuaranteed(state, "rare");
      }
    },
    epic_summon: {
      title: "Epic Hero",
      text: "Put a guaranteed Epic hero on your board.",
      stars: 90,
      apply(state) {
        return placeGuaranteed(state, "epic");
      }
    },
    power_surge: {
      title: "Power Boost",
      text: "+30% power for your next 3 fights.",
      stars: 35,
      apply(state) {
        state.surgeBattles = Math.max(0, Number(state.surgeBattles || 0)) + 3;
      }
    },
    gem_starter: {
      title: "Gem Pack",
      text: "Receive exactly +500 gems.",
      stars: 50,
      apply(state) {
        state.gems += 500;
      }
    }
  };

  const defaultState = () => ({
    energy: 12,
    gems: 80,
    trophies: 0,
    wave: 1,
    bestWave: 1,
    wins: 0,
    merges: 0,
    highestPower: 0,
    surgeBattles: 0,
    soundOn: true,
    achievementsClaimed: [],
    discovered: ["spark", "blade"],
    board: Array(SIZE).fill(null),
    lastEnergyAt: Date.now()
  });

  let state = loadState();
  let toastTimer = null;
  let drag = null;
  let pendingPurchase = null;
  let battleBusy = false;

  const $ = (id) => document.getElementById(id);

  const els = {
    energyValue: $("energyValue"),
    gemValue: $("gemValue"),
    trophyValue: $("trophyValue"),
    energyChip: $("energyChip"),
    waveTitle: $("waveTitle"),
    powerValue: $("powerValue"),
    board: $("board"),
    boardHint: $("boardHint"),
    summonButton: $("summonButton"),
    battleButton: $("battleButton"),
    unitStrip: $("unitStrip"),
    rosterGrid: $("rosterGrid"),
    toast: $("toast"),
    battleModal: $("battleModal"),
    fighterYou: $("fighterYou"),
    fighterEnemy: $("fighterEnemy"),
    youBar: $("youBar"),
    enemyBar: $("enemyBar"),
    battleLog: $("battleLog"),
    resultModal: $("resultModal"),
    resultEyebrow: $("resultEyebrow"),
    resultTitle: $("resultTitle"),
    resultText: $("resultText"),
    resultRewards: $("resultRewards"),
    resultClose: $("resultClose"),
    payModal: $("payModal"),
    payTitle: $("payTitle"),
    payText: $("payText"),
    payCancel: $("payCancel"),
    payConfirm: $("payConfirm"),
    gloryWave: $("gloryWave"),
    gloryTrophies: $("gloryTrophies"),
    gloryWins: $("gloryWins"),
    gloryMerges: $("gloryMerges"),
    gloryPower: $("gloryPower"),
    soundToggle: $("soundToggle"),
    soundIcon: $("soundIcon"),
    matchupText: $("matchupText"),
    matchupWrap: $("matchupWrap"),
    battleStage: $("battleStage"),
    confettiLayer: $("confettiLayer"),
    achvList: $("achvList"),
    inviteButton: $("inviteButton")
  };

  function asNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function sanitizeUnit(unit) {
    if (!unit || typeof unit !== "object" || !unit.id) return null;
    const def = UNIT_DEFS.find((u) => u.id === unit.id);
    if (!def) return null;
    const level = Math.max(1, Math.min(5, Math.floor(asNumber(unit.level, 1))));
    return {
      uid: typeof unit.uid === "string" ? unit.uid : `${def.id}_${Date.now()}`,
      id: def.id,
      level,
      rarity: typeof unit.rarity === "string" ? unit.rarity : rarityForLevel(level)
    };
  }

  function sanitizeBoard(board) {
    const src = Array.isArray(board) ? board : [];
    const out = Array(SIZE).fill(null);
    for (let i = 0; i < SIZE; i += 1) {
      out[i] = sanitizeUnit(src[i]);
    }
    return out;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaultState();
      const base = defaultState();
      const discovered = Array.isArray(parsed.discovered)
        ? parsed.discovered.filter((id) => typeof id === "string" && UNIT_DEFS.some((u) => u.id === id))
        : base.discovered;
      const achievementsClaimed = Array.isArray(parsed.achievementsClaimed)
        ? parsed.achievementsClaimed.filter((id) => typeof id === "string" && ACHIEVEMENTS.some((a) => a.id === id))
        : base.achievementsClaimed;
      return {
        ...base,
        energy: Math.max(0, Math.min(ENERGY_MAX, Math.floor(asNumber(parsed.energy, base.energy)))),
        gems: Math.max(0, Math.floor(asNumber(parsed.gems, base.gems))),
        trophies: Math.max(0, Math.floor(asNumber(parsed.trophies, base.trophies))),
        wave: Math.max(1, Math.floor(asNumber(parsed.wave, base.wave))),
        bestWave: Math.max(1, Math.floor(asNumber(parsed.bestWave, base.bestWave))),
        wins: Math.max(0, Math.floor(asNumber(parsed.wins, base.wins))),
        merges: Math.max(0, Math.floor(asNumber(parsed.merges, base.merges))),
        highestPower: Math.max(0, Math.floor(asNumber(parsed.highestPower, base.highestPower))),
        surgeBattles: Math.max(0, Math.floor(asNumber(parsed.surgeBattles, base.surgeBattles))),
        soundOn: typeof parsed.soundOn === "boolean" ? parsed.soundOn : base.soundOn,
        achievementsClaimed,
        lastEnergyAt: asNumber(parsed.lastEnergyAt, base.lastEnergyAt),
        discovered: discovered.length ? discovered : base.discovered,
        board: sanitizeBoard(parsed.board)
      };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // private mode / quota — keep playing in memory
    }
  }

  function showToast(msg) {
    if (!els.toast) return;
    els.toast.hidden = false;
    els.toast.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2300);
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function defById(id) {
    return UNIT_DEFS.find((u) => u.id === id) || UNIT_DEFS[0];
  }

  function rarityForLevel(level) {
    if (level >= 5) return "legendary";
    if (level >= 4) return "epic";
    if (level >= 3) return "rare";
    return "common";
  }

  function powerOf(unit) {
    if (!unit || !unit.id) return 0;
    const def = defById(unit.id);
    if (!def) return 0;
    const lvl = Math.max(1, Math.min(5, asNumber(unit.level, 1)));
    return Math.round(def.basePower * Math.pow(1.65, lvl - 1));
  }

  function squadPower() {
    const raw = state.board.reduce((sum, u) => sum + powerOf(u), 0);
    if (state.surgeBattles > 0) return Math.round(raw * 1.3);
    return raw;
  }

  function isBossWave(wave) {
    return wave > 0 && wave % BOSS_INTERVAL === 0;
  }

  function enemyPower(wave) {
    const base = Math.round(28 + wave * 18 + Math.pow(wave, 1.35) * 4);
    return isBossWave(wave) ? Math.round(base * BOSS_MULTIPLIER) : base;
  }

  function emptySlots() {
    const slots = [];
    state.board.forEach((u, i) => {
      if (!u) slots.push(i);
    });
    return slots;
  }

  function randomCommonId() {
    const commons = UNIT_DEFS.filter((u) => u.rarity === "common");
    return commons[Math.floor(Math.random() * commons.length)].id;
  }

  function unitForRarity(rarity) {
    const pool = UNIT_DEFS.filter((u) => u.rarity === rarity);
    return pool[Math.floor(Math.random() * pool.length)] || UNIT_DEFS[0];
  }

  function makeUnit(id, level = 1) {
    const def = defById(id) || UNIT_DEFS[0];
    const safeLevel = Math.max(1, Math.min(5, Math.floor(asNumber(level, 1))));
    return {
      uid: `${def.id}_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
      id: def.id,
      level: safeLevel,
      rarity: rarityForLevel(safeLevel) === "common" ? def.rarity : rarityForLevel(safeLevel)
    };
  }

  function discover(id) {
    if (!state.discovered.includes(id)) state.discovered.push(id);
  }

  function placeGuaranteed(st, rarity) {
    const slots = [];
    st.board.forEach((u, i) => {
      if (!u) slots.push(i);
    });
    if (!slots.length) return "Board is full. Merge first.";
    const def = unitForRarity(rarity);
    const level = rarity === "epic" ? 4 : 3;
    const unit = makeUnit(def.id, level);
    unit.rarity = rarity;
    st.board[slots[0]] = unit;
    if (!st.discovered.includes(def.id)) st.discovered.push(def.id);
    return null;
  }

  function regenEnergy() {
    const now = Date.now();
    const lastEnergyAt = Number(state.lastEnergyAt || now);
    const elapsed = now - lastEnergyAt;
    const gained = Math.floor(elapsed / 60000);
    if (gained > 0 && state.energy < ENERGY_MAX) {
      state.energy = Math.min(ENERGY_MAX, state.energy + gained);
      state.lastEnergyAt = lastEnergyAt + gained * 60000;
      saveState();
    }
  }

  function initTelegram() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor("#12091F");
      if (tg.setBackgroundColor) tg.setBackgroundColor("#12091F");
    } catch {
      // browser
    }
  }

  function switchView(name) {
    document.querySelectorAll(".view").forEach((view) => {
      const active = view.dataset.view === name;
      view.classList.toggle("is-active", active);
      view.hidden = !active;
    });
    document.querySelectorAll(".dock__item").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.nav === name);
    });
    if (name === "roster") renderRoster();
    if (name === "rank") {
      renderGlory();
      renderAchievements();
    }
  }

  function setText(el, value) {
    if (el) el.textContent = String(value);
  }

  function renderHud() {
    regenEnergy();
    setText(els.energyValue, state.energy);
    setText(els.gemValue, state.gems);
    setText(els.trophyValue, state.trophies);
    setText(els.waveTitle, isBossWave(state.wave) ? `Level ${state.wave} · BOSS` : `Level ${state.wave}`);
    const power = squadPower();
    setText(els.powerValue, power);
    state.highestPower = Math.max(asNumber(state.highestPower, 0), power);
    if (els.summonButton) {
      els.summonButton.disabled = state.energy < 1 || emptySlots().length === 0;
    }
    if (els.battleButton) {
      els.battleButton.disabled = battleBusy || state.energy < 1 || power <= 0;
    }
    renderMatchup();
  }

  function renderBoard() {
    if (!els.board) return;
    els.board.innerHTML = "";
    for (let i = 0; i < SIZE; i += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.index = String(i);
      const unit = state.board[i];
      if (unit) {
        const def = defById(unit.id);
        const node = document.createElement("div");
        node.className = "unit";
        node.dataset.rarity = unit.rarity || def.rarity;
        node.dataset.index = String(i);
        node.innerHTML = `
          <span class="unit__lvl">L${unit.level}</span>
          <span class="unit__icon">${def.icon}</span>
          <span class="unit__pow">${powerOf(unit)}</span>
        `;
        bindUnitDrag(node, i);
        cell.appendChild(node);
      }
      els.board.appendChild(cell);
    }
    renderStrip();
    renderHud();
  }

  function renderStrip() {
    if (!els.unitStrip) return;
    const counts = {};
    state.board.forEach((u) => {
      if (!u) return;
      const key = `${u.id}_${u.level}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    const entries = Object.entries(counts);
    if (!entries.length) {
      els.unitStrip.innerHTML = `<div class="strip-card"><strong>Empty</strong><span>Tap Get Hero</span></div>`;
      return;
    }
    els.unitStrip.innerHTML = entries
      .map(([key, count]) => {
        const [id, level] = key.split("_");
        const def = defById(id);
        return `<div class="strip-card"><strong>${def.icon} ${def.name}</strong><span>L${level} · x${count}</span></div>`;
      })
      .join("");
  }

  function renderRoster() {
    if (!els.rosterGrid) return;
    els.rosterGrid.innerHTML = UNIT_DEFS.map((def) => {
      const unlocked = state.discovered.includes(def.id);
      return `
        <article class="roster-card ${unlocked ? "" : "is-locked"}">
          <div class="roster-card__unit" data-rarity="${def.rarity}" style="background:linear-gradient(160deg,rgba(255,255,255,.12),rgba(0,0,0,.2))">
            ${unlocked ? def.icon : "?"}
          </div>
          <h3>${unlocked ? def.name : "Locked"}</h3>
          <p>${def.rarity} · base ${def.basePower}</p>
        </article>
      `;
    }).join("");
  }

  function renderGlory() {
    setText(els.gloryWave, state.bestWave);
    setText(els.gloryTrophies, state.trophies);
    setText(els.gloryWins, state.wins);
    setText(els.gloryMerges, state.merges);
    setText(els.gloryPower, state.highestPower);
  }

  function renderMatchup() {
    if (!els.matchupText || !els.matchupWrap) return;
    const power = squadPower();
    const enemy = enemyPower(state.wave);
    const boss = isBossWave(state.wave);
    const ready = power >= enemy;
    els.matchupWrap.classList.toggle("is-ready", ready);
    els.matchupWrap.classList.toggle("is-short", !ready);
    els.matchupWrap.classList.toggle("is-boss", boss);
    const label = boss ? "BOSS needs" : "Level needs";
    const status = ready ? "Ready to win!" : `Need +${enemy - power} power`;
    setText(els.matchupText, `${label} ${enemy} power · ${status}`);
  }

  function renderAchievements() {
    if (!els.achvList) return;
    els.achvList.innerHTML = ACHIEVEMENTS.map((a) => {
      const claimed = state.achievementsClaimed.includes(a.id);
      const ready = !claimed && a.check(state);
      const label = claimed ? "Claimed" : ready ? "Claim" : "Locked";
      return `
        <article class="achv-card ${claimed ? "is-claimed" : ""} ${ready ? "is-ready" : ""}">
          <div class="achv-card__icon">${claimed ? "✓" : ready ? "★" : "🔒"}</div>
          <div class="achv-card__body">
            <h3>${a.title}</h3>
            <p>${a.desc}</p>
          </div>
          <button class="achv-card__claim" type="button" data-achv="${a.id}" ${claimed || !ready ? "disabled" : ""}>
            ${label}${!claimed ? ` · +${a.reward}💎` : ""}
          </button>
        </article>
      `;
    }).join("");
  }

  function claimAchievement(id) {
    const achievement = ACHIEVEMENTS.find((a) => a.id === id);
    if (!achievement) return;
    if (state.achievementsClaimed.includes(id)) return;
    if (!achievement.check(state)) return;
    state.gems += achievement.reward;
    state.achievementsClaimed.push(id);
    saveState();
    renderAchievements();
    renderHud();
    showToast(`${achievement.title} unlocked — +${achievement.reward} 💎`);
    soundWin();
    haptic("success");
  }

  function shakeStage() {
    if (!els.battleStage) return;
    els.battleStage.classList.remove("shake");
    // restart the animation even if triggered twice quickly
    void els.battleStage.offsetWidth;
    els.battleStage.classList.add("shake");
    setTimeout(() => els.battleStage.classList.remove("shake"), 420);
  }

  function spawnConfetti() {
    if (!els.confettiLayer) return;
    els.confettiLayer.innerHTML = "";
    const colors = ["#ffc857", "#ff5fb8", "#5ef0d0", "#7aa7ff", "#ff9ad8"];
    for (let i = 0; i < 24; i += 1) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 200}ms`;
      piece.style.animationDuration = `${900 + Math.random() * 500}ms`;
      els.confettiLayer.appendChild(piece);
    }
    setTimeout(() => {
      if (els.confettiLayer) els.confettiLayer.innerHTML = "";
    }, 1600);
  }

  function bindUnitDrag(node, index) {
    node.addEventListener("pointerdown", (event) => {
      if (battleBusy) return;
      event.preventDefault();
      drag = {
        from: index,
        node,
        pointerId: event.pointerId
      };
      node.classList.add("is-dragging");
      node.setPointerCapture(event.pointerId);
    });

    node.addEventListener("pointermove", (event) => {
      if (!drag || drag.from !== index) return;
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const cell = el && el.closest ? el.closest(".cell") : null;
      document.querySelectorAll(".cell").forEach((c) => {
        c.classList.remove("is-over", "is-merge");
      });
      if (!cell) return;
      const to = Number(cell.dataset.index);
      if (Number.isNaN(to) || to === drag.from) return;
      cell.classList.add("is-over");
      const a = state.board[drag.from];
      const b = state.board[to];
      if (a && b && a.id === b.id && a.level === b.level && a.level < 5) {
        cell.classList.add("is-merge");
      }
    });

    node.addEventListener("pointerup", (event) => {
      if (!drag || drag.from !== index) return;
      node.classList.remove("is-dragging");
      try {
        node.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const cell = el && el.closest ? el.closest(".cell") : null;
      document.querySelectorAll(".cell").forEach((c) => {
        c.classList.remove("is-over", "is-merge");
      });
      if (cell) {
        const to = Number(cell.dataset.index);
        if (!Number.isNaN(to) && to !== drag.from) {
          tryMove(drag.from, to);
        }
      }
      drag = null;
    });

    node.addEventListener("pointercancel", () => {
      if (!drag || drag.from !== index) return;
      node.classList.remove("is-dragging");
      document.querySelectorAll(".cell").forEach((c) => {
        c.classList.remove("is-over", "is-merge");
      });
      drag = null;
    });
  }

  function tryMove(from, to) {
    const a = state.board[from];
    const b = state.board[to];
    if (!a) return;

    if (!b) {
      state.board[to] = a;
      state.board[from] = null;
      saveState();
      renderBoard();
      return;
    }

    if (a.id === b.id && a.level === b.level && a.level < 5) {
      const merged = makeUnit(a.id, a.level + 1);
      merged.rarity = rarityForLevel(merged.level);
      if (merged.level >= 3) merged.rarity = rarityForLevel(merged.level);
      state.board[to] = merged;
      state.board[from] = null;
      state.merges += 1;
      state.gems += merged.level >= 4 ? 25 : 10;
      discover(merged.id);
      saveState();
      renderBoard();
      showToast(`Combined → ${defById(merged.id).name} L${merged.level}!`);
      haptic("success");
      soundMerge();
      return;
    }

    state.board[from] = b;
    state.board[to] = a;
    saveState();
    renderBoard();
  }

  function summon(forceId, forceLevel) {
    const slots = emptySlots();
    if (!slots.length) {
      showToast("Board full — combine heroes first.");
      return false;
    }
    if (state.energy < 1 && !forceId) {
      openPay("energy_pack");
      showToast("No energy left. Open Shop.");
      return false;
    }

    if (!forceId) {
      state.energy -= 1;
      state.lastEnergyAt = Date.now();
    }

    const id = forceId || randomCommonId();
    const unit = makeUnit(id, forceLevel || 1);
    if (forceLevel) unit.rarity = rarityForLevel(forceLevel);
    const slot = slots[Math.floor(Math.random() * slots.length)];
    state.board[slot] = unit;
    discover(id);
    saveState();
    renderBoard();
    if (!forceId) showToast(`${defById(id).name} joined your team`);
    haptic("light");
    soundSummon();
    return true;
  }

  async function startBattle() {
    if (battleBusy) return;
    const power = squadPower();
    if (power <= 0) {
      showToast("Get a hero before fighting.");
      return;
    }
    if (state.energy < 1) {
      openPay("energy_refill");
      showToast("Need energy to fight.");
      return;
    }

    battleBusy = true;
    state.energy -= 1;
    state.lastEnergyAt = Date.now();
    saveState();
    renderHud();

    const wave = state.wave;
    const enemy = enemyPower(wave);
    const boss = isBossWave(wave);
    if (els.battleModal) els.battleModal.hidden = false;
    setText(els.fighterYou, `YOU ${power}`);
    setText(els.fighterEnemy, `${boss ? "BOSS" : "L" + wave} ${enemy}`);
    if (els.youBar) els.youBar.style.width = "100%";
    if (els.enemyBar) els.enemyBar.style.width = "100%";
    setText(els.battleLog, boss ? "A boss approaches…" : "Fight starting…");
    if (boss) soundBoss();

    await wait(700);
    setText(els.battleLog, "Heroes clash!");
    shakeStage();
    await wait(700);

    // visual HP race based on power ratio
    const youRatio = power / (power + enemy || 1);
    const steps = 8;
    for (let i = 1; i <= steps; i += 1) {
      const progress = i / steps;
      const youLeft = Math.max(0, 100 - progress * 100 * (1 - youRatio) * 1.35);
      const enemyLeft = Math.max(0, 100 - progress * 100 * youRatio * 1.35);
      if (els.youBar) els.youBar.style.width = `${youLeft}%`;
      if (els.enemyBar) els.enemyBar.style.width = `${enemyLeft}%`;
      await wait(120);
    }

    const won = power >= enemy;
    if (state.surgeBattles > 0) state.surgeBattles -= 1;

    if (won) {
      const rewardMultiplier = boss ? BOSS_REWARD_MULTIPLIER : 1;
      const trophyGain = (8 + wave * 2) * rewardMultiplier;
      const gemGain = (20 + wave * 5) * rewardMultiplier;
      state.wins += 1;
      state.trophies += trophyGain;
      state.gems += gemGain;
      state.wave += 1;
      state.bestWave = Math.max(state.bestWave, state.wave);
      // consume 1 random weakest unit as battle cost feel
      consumeWeakest();
      saveState();
      if (els.battleModal) els.battleModal.hidden = true;
      showResult(true, wave, trophyGain, gemGain, boss);
      soundWin();
      haptic("success");
    } else {
      // soft loss: lose some trophies, keep wave
      const loss = Math.min(state.trophies, 4 + Math.floor(wave / 2));
      const gemGain = 5;
      state.trophies = Math.max(0, state.trophies - loss);
      state.gems += gemGain;
      consumeWeakest();
      saveState();
      if (els.battleModal) els.battleModal.hidden = true;
      showResult(false, wave, -loss, gemGain, false);
      soundLose();
      haptic("error");
    }

    battleBusy = false;
    renderBoard();
  }

  function consumeWeakest() {
    let weakestIdx = -1;
    let weakestPow = Infinity;
    state.board.forEach((u, i) => {
      if (!u) return;
      const p = powerOf(u);
      if (p < weakestPow) {
        weakestPow = p;
        weakestIdx = i;
      }
    });
    if (weakestIdx >= 0) state.board[weakestIdx] = null;
  }

  function showResult(won, wave, trophies, gems, boss) {
    if (!els.resultModal) return;
    els.resultModal.hidden = false;
    setText(els.resultEyebrow, won ? (boss ? "Boss Defeated" : "Victory") : "Defeat");
    setText(els.resultTitle, won ? `Level ${wave} Cleared` : `Level ${wave} Failed`);
    setText(
      els.resultText,
      won
        ? "Your team was stronger. Next level unlocked!"
        : "Combine more heroes, then fight again."
    );
    if (els.resultRewards) {
      els.resultRewards.innerHTML = `
        <span>${trophies >= 0 ? "+" : ""}${trophies} 🏆</span>
        <span>+${Math.max(0, gems)} 💎</span>
        ${boss ? "<span>Boss bonus x2</span>" : ""}
        ${won ? "<span>Next level unlocked</span>" : "<span>Try again stronger</span>"}
      `;
    }
    if (won) spawnConfetti();
  }

  function openPay(productId) {
    const product = SHOP[productId];
    if (!product || !els.payModal) return;
    pendingPurchase = productId;
    setText(els.payTitle, product.title);
    setText(els.payText, `${product.text} · Listed price: ${product.stars} ★ (not charged yet)`);
    els.payModal.hidden = false;
  }

  function closePay() {
    pendingPurchase = null;
    if (els.payModal) els.payModal.hidden = true;
  }

  function confirmPay() {
    if (!pendingPurchase) return;
    const productId = pendingPurchase;
    const product = SHOP[productId];
    if (!product) return;

    // Demo checkout — no real Telegram Stars payment is processed here yet.
    const ok = window.confirm(
      `Get ${product.title} for free?\n\nThis is a demo — no real Stars are charged. Real Telegram Stars checkout is coming soon.`
    );
    if (!ok) return;

    const err = product.apply(state);
    if (typeof err === "string") {
      closePay();
      showToast(err);
      return;
    }

    saveState();
    closePay();
    renderBoard();
    renderHud();
    showToast(`${product.title} unlocked`);
    haptic("success");
    if (productId === "rare_summon" || productId === "epic_summon") {
      switchView("play");
    }
  }

  function haptic(type) {
    const tg = window.Telegram && window.Telegram.WebApp;
    try {
      if (tg && tg.HapticFeedback) {
        if (type === "success" || type === "error") {
          tg.HapticFeedback.notificationOccurred(type === "success" ? "success" : "error");
        } else if (tg.HapticFeedback.impactOccurred) {
          tg.HapticFeedback.impactOccurred("light");
        }
      }
    } catch {
      // ignore
    }
  }

  let audioCtx = null;

  function getAudioCtx() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
    } catch {
      audioCtx = null;
    }
    return audioCtx;
  }

  function playTone(freq, duration, opts = {}) {
    if (!state.soundOn) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = opts.type || "sine";
      osc.frequency.value = freq;
      const volume = opts.volume || 0.07;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // ignore autoplay / audio errors
    }
  }

  function playSequence(notes) {
    notes.forEach((note) => {
      setTimeout(() => playTone(note.freq, note.duration, note), note.delay || 0);
    });
  }

  function soundMerge() {
    playTone(720, 0.12, { type: "triangle", volume: 0.06 });
  }

  function soundSummon() {
    playTone(480, 0.08, { type: "sine", volume: 0.045 });
  }

  function soundWin() {
    playSequence([
      { freq: 520, duration: 0.12, delay: 0 },
      { freq: 660, duration: 0.12, delay: 110 },
      { freq: 880, duration: 0.22, delay: 220 }
    ]);
  }

  function soundLose() {
    playSequence([
      { freq: 300, duration: 0.18, delay: 0, type: "sawtooth", volume: 0.05 },
      { freq: 220, duration: 0.28, delay: 150, type: "sawtooth", volume: 0.05 }
    ]);
  }

  function soundBoss() {
    playTone(150, 0.4, { type: "square", volume: 0.045 });
  }

  function updateSoundToggleUI() {
    if (els.soundIcon) els.soundIcon.textContent = state.soundOn ? "🔊" : "🔇";
    if (els.soundToggle) els.soundToggle.setAttribute("aria-pressed", String(!state.soundOn));
  }

  function toggleSound() {
    state.soundOn = !state.soundOn;
    saveState();
    updateSoundToggleUI();
    if (state.soundOn) playTone(600, 0.08, { volume: 0.05 });
  }

  // Honest, reward-free sharing: this app has no backend to verify who
  // actually invited whom, so it never grants a "referral" reward — that
  // would just be a free, unlimited currency farm (tap Share, cancel, repeat).
  function shareGame() {
    const shareUrl = "https://wealthia.github.io/merge-arena/";
    const shareText = "Come play Merge Arena with me! 🔥";
    const tg = window.Telegram && window.Telegram.WebApp;
    try {
      if (tg && tg.openTelegramLink) {
        const link = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
        tg.openTelegramLink(link);
        return;
      }
    } catch {
      // fall through to web share / clipboard below
    }
    if (navigator.share) {
      navigator.share({ title: "Merge Arena", text: shareText, url: shareUrl }).catch(() => {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(`${shareText} ${shareUrl}`)
        .then(() => showToast("Link copied — share it with a friend!"))
        .catch(() => showToast(`Share this link: ${shareUrl}`));
      return;
    }
    showToast(`Share this link: ${shareUrl}`);
  }

  function bind() {
    document.querySelectorAll(".dock__item").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.nav));
    });

    if (els.summonButton) els.summonButton.addEventListener("click", () => summon());
    if (els.battleButton) els.battleButton.addEventListener("click", () => startBattle());
    if (els.energyChip) {
      els.energyChip.addEventListener("click", () => {
        switchView("shop");
        openPay("energy_refill");
      });
    }

    document.querySelectorAll("[data-buy]").forEach((card) => {
      const buy = () => openPay(card.dataset.buy);
      card.addEventListener("click", buy);
      const cta = card.querySelector(".offer__cta");
      if (cta) cta.addEventListener("click", (e) => {
        e.stopPropagation();
        buy();
      });
    });

    if (els.resultClose) {
      els.resultClose.addEventListener("click", () => {
        if (els.resultModal) els.resultModal.hidden = true;
      });
    }
    if (els.payCancel) els.payCancel.addEventListener("click", closePay);
    if (els.payConfirm) els.payConfirm.addEventListener("click", confirmPay);

    if (els.soundToggle) els.soundToggle.addEventListener("click", toggleSound);
    if (els.inviteButton) els.inviteButton.addEventListener("click", shareGame);
    if (els.achvList) {
      els.achvList.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-achv]");
        if (btn) claimAchievement(btn.dataset.achv);
      });
    }
  }

  function seedIfEmpty() {
    if (state.board.some(Boolean)) return;
    // gentle onboarding: 2 units ready to merge
    state.board[5] = makeUnit("spark", 1);
    state.board[6] = makeUnit("spark", 1);
    state.board[9] = makeUnit("blade", 1);
    discover("spark");
    discover("blade");
    saveState();
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {
        // offline support is a bonus, never block the game on it
      });
    });
  }

  function boot() {
    initTelegram();
    seedIfEmpty();
    bind();
    updateSoundToggleUI();
    renderBoard();
    renderRoster();
    renderGlory();
    renderAchievements();
    registerServiceWorker();
    // soft energy tip
    if (state.energy <= 3) {
      setTimeout(() => showToast("Low energy — Shop keeps you playing."), 900);
    }
  }

  boot();
})();
