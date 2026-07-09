(() => {
  const STORAGE_KEY = "merge_arena_v2";
  const COLS = 4;
  const ROWS = 4;
  const SIZE = COLS * ROWS;
  const ENERGY_MAX = 20;
  const DAILY_READY_MS = 20 * 60 * 60 * 1000; // claimable after 20h
  const DAILY_RESET_MS = 48 * 60 * 60 * 1000; // streak breaks after 48h

  const DAILY_REWARDS = [
    { energy: 4, gems: 20 },
    { energy: 5, gems: 30 },
    { energy: 6, gems: 40 },
    { energy: 8, gems: 55 },
    { energy: 10, gems: 70 },
    { energy: 12, gems: 90 },
    { energy: 20, gems: 150 }
  ];

  const UNIT_DEFS = [
    { id: "spark", name: "Spark", icon: "⚡", rarity: "common", basePower: 12 },
    { id: "blade", name: "Blade", icon: "🗡", rarity: "common", basePower: 14 },
    { id: "ward", name: "Ward", icon: "🛡", rarity: "rare", basePower: 22 },
    { id: "nova", name: "Nova", icon: "✦", rarity: "rare", basePower: 26 },
    { id: "phantom", name: "Phantom", icon: "👁", rarity: "epic", basePower: 40 },
    { id: "titan", name: "Titan", icon: "🏛", rarity: "epic", basePower: 48 },
    { id: "sovereign", name: "Sovereign", icon: "👑", rarity: "legendary", basePower: 72 }
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
    dailyStreak: 0,
    lastDailyClaim: 0,
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
    gloryStreak: $("gloryStreak"),
    dailyCard: $("dailyCard"),
    dailyCardText: $("dailyCardText"),
    dailyCardButton: $("dailyCardButton"),
    dailyModal: $("dailyModal"),
    dailyTitle: $("dailyTitle"),
    dailyText: $("dailyText"),
    dailyRewards: $("dailyRewards"),
    dailyClaim: $("dailyClaim"),
    rankBadge: $("rankBadge"),
    resetButton: $("resetButton")
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
        dailyStreak: Math.max(0, Math.min(7, Math.floor(asNumber(parsed.dailyStreak, base.dailyStreak)))),
        lastDailyClaim: Math.max(0, Math.floor(asNumber(parsed.lastDailyClaim, base.lastDailyClaim))),
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

  function enemyPower(wave) {
    return Math.round(28 + wave * 18 + Math.pow(wave, 1.35) * 4);
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

  function dailyStatus() {
    const now = Date.now();
    const last = Number(state.lastDailyClaim || 0);
    if (!last) {
      return { ready: true, nextDay: 1, msRemaining: 0 };
    }
    const elapsed = now - last;
    if (elapsed >= DAILY_READY_MS) {
      const missed = elapsed >= DAILY_RESET_MS;
      const streak = missed ? 0 : state.dailyStreak;
      const nextDay = (streak % DAILY_REWARDS.length) + 1;
      return { ready: true, nextDay, msRemaining: 0 };
    }
    return { ready: false, nextDay: (state.dailyStreak % DAILY_REWARDS.length) + 1, msRemaining: DAILY_READY_MS - elapsed };
  }

  function formatDuration(ms) {
    const totalMin = Math.max(0, Math.ceil(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h <= 0) return `${m}m`;
    return `${h}h ${m}m`;
  }

  function updateDailyUI() {
    const status = dailyStatus();
    if (els.rankBadge) els.rankBadge.hidden = !status.ready;
    if (els.dailyCard) els.dailyCard.classList.toggle("is-claimed", !status.ready);
    if (els.dailyCardButton) {
      els.dailyCardButton.disabled = !status.ready;
      els.dailyCardButton.textContent = status.ready ? "Claim" : "Claimed";
    }
    if (els.dailyCardText) {
      els.dailyCardText.textContent = status.ready
        ? `Day ${status.nextDay} reward is ready to claim!`
        : `Next reward (Day ${status.nextDay}) in ${formatDuration(status.msRemaining)}. Streak: ${state.dailyStreak}/7`;
    }
  }

  function openDailyModal(autoTriggered) {
    const status = dailyStatus();
    if (!status.ready) {
      if (!autoTriggered) showToast(`Next reward in ${formatDuration(status.msRemaining)}.`);
      return;
    }
    if (!els.dailyModal) return;
    const reward = DAILY_REWARDS[status.nextDay - 1];
    setText(els.dailyTitle, `Day ${status.nextDay} Streak`);
    setText(els.dailyText, "Claim today's reward and come back tomorrow for more.");
    if (els.dailyRewards) {
      els.dailyRewards.innerHTML = `
        <span>+${reward.energy} ⚡</span>
        <span>+${reward.gems} 💎</span>
      `;
    }
    els.dailyModal.hidden = false;
  }

  function claimDaily() {
    const status = dailyStatus();
    if (!status.ready) {
      if (els.dailyModal) els.dailyModal.hidden = true;
      return;
    }
    const reward = DAILY_REWARDS[status.nextDay - 1];
    state.energy = Math.min(ENERGY_MAX, state.energy + reward.energy);
    state.gems += reward.gems;
    state.dailyStreak = status.nextDay;
    state.lastDailyClaim = Date.now();
    saveState();
    if (els.dailyModal) els.dailyModal.hidden = true;
    updateDailyUI();
    renderHud();
    showToast(`Day ${status.nextDay} reward claimed — +${reward.energy} ⚡ +${reward.gems} 💎`);
    haptic("success");
  }

  function resetProgress() {
    const ok = window.confirm(
      "Reset all progress? Heroes, gems, trophies and your daily streak will be lost."
    );
    if (!ok) return;
    state = defaultState();
    saveState();
    renderBoard();
    renderRoster();
    renderGlory();
    updateDailyUI();
    showToast("Progress reset. Fresh start!");
    haptic("light");
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
      updateDailyUI();
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
    setText(els.waveTitle, `Level ${state.wave}`);
    const power = squadPower();
    setText(els.powerValue, power);
    state.highestPower = Math.max(asNumber(state.highestPower, 0), power);
    if (els.summonButton) {
      els.summonButton.disabled = state.energy < 1 || emptySlots().length === 0;
    }
    if (els.battleButton) {
      els.battleButton.disabled = battleBusy || state.energy < 1 || power <= 0;
    }
    updateDailyUI();
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
    setText(els.gloryStreak, state.dailyStreak);
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
    if (els.battleModal) els.battleModal.hidden = false;
    setText(els.fighterYou, `YOU ${power}`);
    setText(els.fighterEnemy, `L${wave} ${enemy}`);
    if (els.youBar) els.youBar.style.width = "100%";
    if (els.enemyBar) els.enemyBar.style.width = "100%";
    setText(els.battleLog, "Fight starting…");

    await wait(700);
    setText(els.battleLog, "Heroes clash!");
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
      const trophyGain = 8 + wave * 2;
      const gemGain = 20 + wave * 5;
      state.wins += 1;
      state.trophies += trophyGain;
      state.gems += gemGain;
      state.wave += 1;
      state.bestWave = Math.max(state.bestWave, state.wave);
      // consume 1 random weakest unit as battle cost feel
      consumeWeakest();
      saveState();
      if (els.battleModal) els.battleModal.hidden = true;
      showResult(true, wave, trophyGain, gemGain);
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
      showResult(false, wave, -loss, gemGain);
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

  function showResult(won, wave, trophies, gems) {
    if (!els.resultModal) return;
    els.resultModal.hidden = false;
    setText(els.resultEyebrow, won ? "Victory" : "Defeat");
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
        ${won ? "<span>Next level unlocked</span>" : "<span>Try again stronger</span>"}
      `;
    }
  }

  function openPay(productId) {
    const product = SHOP[productId];
    if (!product || !els.payModal) return;
    pendingPurchase = productId;
    setText(els.payTitle, product.title);
    setText(els.payText, `${product.text} · Exact price: ${product.stars} Stars`);
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

    // Demo Stars purchase — exact item, no RNG shop packs.
    const ok = window.confirm(
      `Pay ${product.stars} Stars for ${product.title}?\n\nYou get exactly what is listed.`
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

    if (els.dailyCardButton) els.dailyCardButton.addEventListener("click", () => openDailyModal(false));
    if (els.dailyClaim) els.dailyClaim.addEventListener("click", claimDaily);
    if (els.resetButton) els.resetButton.addEventListener("click", resetProgress);
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

  function boot() {
    initTelegram();
    seedIfEmpty();
    bind();
    renderBoard();
    renderRoster();
    renderGlory();
    updateDailyUI();
    // soft energy tip
    if (state.energy <= 3) {
      setTimeout(() => showToast("Low energy — Shop keeps you playing."), 900);
    }
    if (dailyStatus().ready) {
      setTimeout(() => openDailyModal(true), 600);
    }
  }

  boot();
})();
