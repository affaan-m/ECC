/* ============================================================================
   ChemQuest — Game Engine
   A turn-based study RPG. Learning science baked into the mechanics:
     • Active recall  — every turn is a retrieval attempt
     • Spaced repetition — missed cards resurface sooner (Leitner boxes)
     • Interleaving — boss battles mix a whole theme together
     • Feedback + elaboration — an explanation after every single answer
   ============================================================================ */
(function () {
  "use strict";

  /* -------------------------------------------------- tiny utils */
  const $ = (id) => document.getElementById(id);
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rand(a.length)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const now = () => Date.now();

  const DATA = window.CHEM_DATA;
  const SAVE_KEY = "chemquest.save.v1";

  /* -------------------------------------------------- persistence */
  const defaultState = () => ({
    firstRun: true,
    player: { name: "Avo", level: 1, xp: 0, coins: 0, cleared: {} },
    cards: {},            // cardId -> {box, seen, correct, wrong, due, lastWrong}
    settings: { sound: true, motion: true, timer: true },
    topics: {},           // zoneId -> bool override
    stats: { answered: 0, correct: 0 }
  });

  let S = load();
  function load() {
    try { const raw = localStorage.getItem(SAVE_KEY); if (raw) return Object.assign(defaultState(), JSON.parse(raw)); }
    catch (e) {}
    return defaultState();
  }
  let saveTimer = null;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }, 120); }

  /* -------------------------------------------------- progression math */
  const xpNeeded = (lvl) => 40 + lvl * 30;
  const maxHpFor = (lvl) => 60 + lvl * 12;

  function addXp(amount) {
    S.player.xp += amount;
    let leveled = 0;
    while (S.player.xp >= xpNeeded(S.player.level)) {
      S.player.xp -= xpNeeded(S.player.level);
      S.player.level++; leveled++;
    }
    if (leveled) onLevelUp(leveled);
    refreshXpBars();
    save();
    return leveled;
  }
  function onLevelUp(n) {
    sfx.levelup();
    const el = $("levelup");
    el.textContent = "⭐ Level " + S.player.level + "!";
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    fx.confetti(window.innerWidth / 2, window.innerHeight * 0.25, 60);
    // heal a little in battle as reward
    if (battle.active) { battle.playerHp = Math.min(battle.playerMaxHp = maxHpFor(S.player.level), battle.playerHp + 30); renderHp(); }
  }
  function refreshXpBars() {
    const pct = clamp(S.player.xp / xpNeeded(S.player.level) * 100, 0, 100);
    ["map-xp", "battle-xp"].forEach((id) => { const e = $(id); if (e) e.style.width = pct + "%"; });
    ["map-lv", "battle-lv"].forEach((id) => { const e = $(id); if (e) e.textContent = "Lv " + S.player.level; });
    if (currentScreen === "home") renderHomeStrip();
  }

  /* -------------------------------------------------- card / SR helpers */
  const cardId = (zoneId, idx) => zoneId + "#" + idx;
  function cardStat(id) {
    if (!S.cards[id]) S.cards[id] = { box: 0, seen: 0, correct: 0, wrong: 0, due: 0, lastWrong: 0 };
    return S.cards[id];
  }
  const BOX_INTERVAL = [0, 4 * 36e5, 24 * 36e5, 3 * 864e5, 7 * 864e5, 16 * 864e5]; // ms by box
  function recordAnswer(id, ok) {
    const c = cardStat(id);
    c.seen++; S.stats.answered++;
    if (ok) { c.correct++; S.stats.correct++; c.box = clamp(c.box + 1, 0, 5); }
    else { c.wrong++; c.box = clamp(c.box - 2, 0, 5); c.lastWrong = now(); }
    c.due = now() + BOX_INTERVAL[c.box];
    save();
  }
  // weight: weak / wrong / due cards are more likely to be drawn
  function cardWeight(id) {
    const c = S.cards[id];
    if (!c) return 6;                       // unseen — high priority (learn it)
    let w = (5 - c.box) + 1;                // lower box -> higher weight
    if (c.due && c.due <= now()) w += 2;    // overdue
    if (c.lastWrong && now() - c.lastWrong < 6e5) w += 3; // recently missed
    return Math.max(1, w);
  }

  /* -------------------------------------------------- zone helpers */
  function zoneEnabled(z) {
    const o = S.topics[z.id];
    return (o === undefined) ? z.on !== false : o;
  }
  const enabledZones = () => DATA.zones.filter(zoneEnabled);
  const themesInOrder = () => {
    const seen = [], out = [];
    enabledZones().forEach((z) => { if (!seen.includes(z.theme)) { seen.push(z.theme); out.push(z.theme); } });
    return out;
  };
  function zoneById(id) { return DATA.zones.find((z) => z.id === id); }
  function refsForZone(z) { return z.q.map((card, idx) => ({ zoneId: z.id, idx, card, hue: z.hue })); }
  function refsForTheme(theme) {
    let r = []; enabledZones().filter((z) => z.theme === theme).forEach((z) => { r = r.concat(refsForZone(z)); }); return r;
  }
  function zoneMastery(z) {
    let sum = 0; z.q.forEach((_, i) => { const c = S.cards[cardId(z.id, i)]; sum += c ? c.box : 0; });
    return Math.round((sum / (z.q.length * 5)) * 100);
  }

  /* campaign node list: per theme -> [zones..., boss] */
  function campaignNodes() {
    const nodes = [];
    themesInOrder().forEach((theme) => {
      const zs = enabledZones().filter((z) => z.theme === theme);
      zs.forEach((z) => nodes.push({ kind: "zone", id: z.id, theme, zone: z }));
      nodes.push({ kind: "boss", id: "boss_" + theme.replace(/\s+/g, ""), theme, zones: zs });
    });
    return nodes;
  }
  function nodeUnlocked(nodes, i) {
    if (i === 0) return true;
    return !!S.player.cleared[nodes[i - 1].id];
  }

  /* ==========================================================================
     AUDIO  (Web Audio, generated — no asset files)
     ========================================================================== */
  const sfx = (() => {
    let ctx = null;
    const on = () => S.settings.sound;
    function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return ctx; }
    function tone(freq, dur, type, vol, when) {
      if (!on()) return; const c = ac(); if (!c) return;
      const t = c.currentTime + (when || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      resume() { const c = ac(); if (c && c.state === "suspended") c.resume(); },
      click() { tone(420, 0.06, "triangle", 0.12); },
      correct() { [523, 659, 784].forEach((f, i) => tone(f, 0.14, "triangle", 0.16, i * 0.06)); },
      crit() { [659, 880, 1047, 1319].forEach((f, i) => tone(f, 0.14, "square", 0.13, i * 0.05)); },
      wrong() { tone(180, 0.22, "sawtooth", 0.14); tone(120, 0.28, "sine", 0.12, 0.04); },
      hit() { tone(140, 0.12, "square", 0.12); },
      levelup() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, "triangle", 0.16, i * 0.08)); },
      victory() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "triangle", 0.17, i * 0.12)); tone(1319, 0.4, "triangle", 0.16, 0.5); },
      defeat() { [392, 330, 262].forEach((f, i) => tone(f, 0.3, "sine", 0.15, i * 0.18)); }
    };
  })();

  /* ==========================================================================
     BACKGROUND CANVAS — drifting molecules
     ========================================================================== */
  (function bgCanvas() {
    const cv = $("bg"), ctx = cv.getContext("2d");
    let W, H, nodes = [];
    const COLORS = ["#22d3ee", "#a78bfa", "#f472b6", "#a3e635", "#fbbf24", "#60a5fa"];
    function resize() {
      W = cv.width = innerWidth * devicePixelRatio; H = cv.height = innerHeight * devicePixelRatio;
      cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
      const n = Math.min(46, Math.floor((innerWidth * innerHeight) / 26000));
      nodes = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.18 * devicePixelRatio, vy: (Math.random() - 0.5) * 0.18 * devicePixelRatio,
        r: (Math.random() * 2.2 + 1.4) * devicePixelRatio, c: pick(COLORS)
      }));
    }
    function frame() {
      ctx.clearRect(0, 0, W, H);
      const link = 130 * devicePixelRatio;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (S.settings.motion) { a.x += a.vx; a.y += a.vy; }
        if (a.x < 0 || a.x > W) a.vx *= -1; if (a.y < 0 || a.y > H) a.vy *= -1;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
          if (d < link) { ctx.globalAlpha = (1 - d / link) * 0.14; ctx.strokeStyle = "#9fb6ff"; ctx.lineWidth = devicePixelRatio; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
      }
      for (const a of nodes) {
        ctx.globalAlpha = 0.85; ctx.fillStyle = a.c; ctx.shadowColor = a.c; ctx.shadowBlur = 8 * devicePixelRatio;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      requestAnimationFrame(frame);
    }
    addEventListener("resize", resize); resize(); frame();
  })();

  /* ==========================================================================
     FX CANVAS — particle bursts & confetti
     ========================================================================== */
  const fx = (() => {
    const cv = $("fx"), ctx = cv.getContext("2d");
    let W, H, parts = [];
    function resize() { W = cv.width = innerWidth * devicePixelRatio; H = cv.height = innerHeight * devicePixelRatio; cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px"; }
    addEventListener("resize", resize); resize();
    function spawn(x, y, opts) {
      x *= devicePixelRatio; y *= devicePixelRatio;
      const n = opts.n || 22, colors = opts.colors || ["#22d3ee", "#a78bfa", "#f472b6"];
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * 7, sp = (Math.random() * (opts.speed || 6) + 1.5) * devicePixelRatio;
        parts.push({
          x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - (opts.up || 0) * devicePixelRatio,
          g: (opts.gravity == null ? 0.12 : opts.gravity) * devicePixelRatio,
          life: 1, decay: 0.012 + Math.random() * 0.02,
          r: (Math.random() * 3 + 1.5) * devicePixelRatio, c: pick(colors),
          shape: opts.shape || "circle"
        });
      }
      if (!running) { running = true; loop(); }
    }
    let running = false;
    function loop() {
      ctx.clearRect(0, 0, W, H);
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        if (S.settings.motion) { p.x += p.vx; p.y += p.vy; p.vy += p.g; }
        p.life -= p.decay;
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 6 * devicePixelRatio;
        if (p.shape === "rect") { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 8); ctx.fillRect(-p.r, -p.r, p.r * 2.2, p.r * 1.2); ctx.restore(); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      if (parts.length) requestAnimationFrame(loop); else running = false;
    }
    return {
      burst(x, y, n) { spawn(x, y, { n: n || 20, colors: ["#34d399", "#a3e635", "#22d3ee"], speed: 6 }); },
      crit(x, y) { spawn(x, y, { n: 34, colors: ["#fbbf24", "#fb7185", "#fde68a"], speed: 8 }); },
      hurt(x, y) { spawn(x, y, { n: 16, colors: ["#fb7185", "#f472b6"], speed: 5 }); },
      confetti(x, y, n) { spawn(x, y, { n: n || 80, colors: ["#22d3ee", "#a78bfa", "#f472b6", "#a3e635", "#fbbf24", "#60a5fa"], speed: 9, up: 4, gravity: 0.14, shape: "rect" }); }
    };
  })();

  /* ==========================================================================
     CREATURE SVGS
     ========================================================================== */
  function playerSVG() {
    return `<svg viewBox="0 0 120 120" width="100%" height="100%">
      <defs><radialGradient id="pg" cx="40%" cy="35%"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#2dd4bf"/></radialGradient></defs>
      <g>
        <ellipse cx="60" cy="58" rx="46" ry="42" fill="url(#pg)" stroke="#0b3b3b" stroke-width="2"/>
        <ellipse cx="60" cy="92" rx="30" ry="9" fill="#000" opacity=".18"/>
        <circle cx="46" cy="52" r="10" fill="#fff"/><circle cx="49" cy="54" r="5" fill="#06222b"/>
        <circle cx="76" cy="52" r="10" fill="#fff"/><circle cx="79" cy="54" r="5" fill="#06222b"/>
        <ellipse cx="61" cy="66" rx="6" ry="4" fill="#0b3b3b"/>
        <path d="M50 74 q10 8 20 0" stroke="#0b3b3b" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <circle cx="34" cy="40" r="3.4" fill="#a78bfa"/><circle cx="86" cy="40" r="3.4" fill="#f472b6"/>
        <ellipse cx="60" cy="50" rx="54" ry="20" fill="none" stroke="#a78bfa" stroke-width="1.6" opacity=".55" transform="rotate(25 60 50)"/>
      </g></svg>`;
  }
  function enemySVG(hue, sym, boss) {
    const c1 = `hsl(${hue} 80% 62%)`, c2 = `hsl(${hue} 70% 38%)`, dark = `hsl(${hue} 60% 16%)`;
    const spikes = boss ? `<path d="M60 6 l10 18 -20 0z M18 30 l4 20 -18 -8z M102 30 l-4 20 18 -8z" fill="${c2}" opacity=".9"/>` : "";
    const crown = boss ? `<path d="M40 18 l8 10 12 -12 12 12 8 -10 -4 22 -32 0z" fill="#fbbf24" stroke="#7c5b00" stroke-width="1.5"/>` : "";
    const r = boss ? 50 : 44;
    return `<svg viewBox="0 0 120 120" width="100%" height="100%">
      <defs><radialGradient id="eg${hue}${boss ? 'b' : ''}" cx="40%" cy="34%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs>
      ${spikes}
      <ellipse cx="60" cy="100" rx="30" ry="8" fill="#000" opacity=".2"/>
      <path d="M60 ${60 - r} a${r} ${r} 0 1 0 0.1 0 q-${r * 0.7} ${r} 0 ${r * 1.25} q${r * 0.7} -${r * 0.25} ${r * 1.0} 0 q${r * 0.7} ${r * 0.25} ${r * 1.0} 0 q${r * 0.7} -${r} 0 -${r * 1.25}z"
        fill="url(#eg${hue}${boss ? 'b' : ''})" stroke="${dark}" stroke-width="2.5"/>
      <circle cx="${60 - 15}" cy="${56}" r="9" fill="#fff"/><circle cx="${60 - 13}" cy="${58}" r="4.6" fill="#160a16"/>
      <circle cx="${60 + 15}" cy="${56}" r="9" fill="#fff"/><circle cx="${60 + 13}" cy="${58}" r="4.6" fill="#160a16"/>
      <path d="M${60 - 22} ${46} l14 5 M${60 + 22} ${46} l-14 5" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>
      <path d="M52 72 q8 -7 16 0" stroke="${dark}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <text x="60" y="92" font-family="Space Grotesk, sans-serif" font-weight="800" font-size="15" fill="${dark}" text-anchor="middle" opacity=".85">${esc(sym)}</text>
      ${crown}
    </svg>`;
  }
  // themed enemy name generator
  const NAME_PRE = ["Void", "Entropy", "Rogue", "Unstable", "Spectral", "Quantum", "Toxic", "Chaotic", "Phantom", "Volatile"];
  function enemyName(zone, boss) {
    if (boss) return "⚠ Warden of " + zone.theme;
    const suff = { "Structure 1": "Particle", "Structure 2": "Bondling", "Structure 3": "Element-wraith", "Reactivity 1": "Pyre", "Reactivity 2": "Flux" }[zone.theme] || "Anomaly";
    return pick(NAME_PRE) + " " + suff;
  }

  /* ==========================================================================
     SCREEN NAVIGATION
     ========================================================================== */
  let currentScreen = "home";
  function showScreen(name) {
    currentScreen = name;
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $("screen-" + name).classList.add("active");
    if (name === "home") renderHome();
    if (name === "map") renderMap();
    if (name === "lab") renderLab();
    window.scrollTo(0, 0);
  }

  /* ==========================================================================
     HOME
     ========================================================================== */
  function renderHome() { renderHomeStrip(); refreshXpBars(); }
  function renderHomeStrip() {
    const p = S.player;
    $("home-pstrip").innerHTML =
      `<div class="avatar">${playerSVG()}</div>
       <div class="xpwrap">
         <div class="lv">${esc(p.name)} &nbsp;<small>· Level ${p.level}</small></div>
         <div class="xpbar"><i style="width:${clamp(p.xp / xpNeeded(p.level) * 100, 0, 100)}%"></i></div>
         <div class="xptext">${p.xp} / ${xpNeeded(p.level)} XP</div>
       </div>
       <div class="coin">★ ${p.coins}</div>`;
  }

  /* ==========================================================================
     MAP
     ========================================================================== */
  function renderMap() {
    refreshXpBars();
    const nodes = campaignNodes();
    const host = $("map-zones"); host.innerHTML = "";
    let idx = 0;
    themesInOrder().forEach((theme) => {
      const block = document.createElement("div"); block.className = "theme-block";
      block.innerHTML = `<div class="theme-label">${esc(theme)}</div>`;
      const grid = document.createElement("div"); grid.className = "zones";
      // zones of theme
      enabledZones().filter((z) => z.theme === theme).forEach((z) => {
        const myIndex = nodes.findIndex((n) => n.id === z.id);
        const unlocked = nodeUnlocked(nodes, myIndex);
        const cleared = !!S.player.cleared[z.id];
        const m = zoneMastery(z);
        const tile = document.createElement("div");
        tile.className = "zone-tile" + (unlocked ? "" : " locked");
        tile.style.setProperty("--h", z.hue);
        tile.innerHTML =
          `${cleared ? '<span class="zt-badge done">CLEARED</span>' : (unlocked ? (z.hl ? '<span class="zt-badge hl">HL</span>' : "") : '<span class="zt-badge lock">🔒</span>')}
           <div class="zt-code">${esc(z.theme.replace(/[^0-9]/g, ""))}.${esc(z.code)}</div>
           <div class="zt-sym">${esc(z.sym)}</div>
           <div class="zt-title">${esc(z.title)}</div>
           <div class="zt-region">${esc(z.region)}</div>
           <div class="zt-foot"><span class="mastery"><i style="width:${m}%"></i></span><span class="mastery-pct">${m}%</span></div>`;
        if (unlocked) tile.onclick = () => { sfx.resume(); sfx.click(); startBattle({ mode: cleared ? "campaign" : "campaign", node: { kind: "zone", id: z.id, theme, zone: z } }); };
        else tile.onclick = () => toast("Clear the previous region first 🔒");
        grid.appendChild(tile);
      });
      // boss node
      const bn = nodes.find((n) => n.kind === "boss" && n.theme === theme);
      const bIndex = nodes.findIndex((n) => n.id === bn.id);
      const bUnlocked = nodeUnlocked(nodes, bIndex);
      const bCleared = !!S.player.cleared[bn.id];
      const bossTile = document.createElement("div");
      bossTile.className = "zone-tile" + (bUnlocked ? "" : " locked");
      bossTile.style.setProperty("--h", 350);
      bossTile.innerHTML =
        `${bCleared ? '<span class="zt-badge done">DEFEATED</span>' : (bUnlocked ? '<span class="crown">👑</span>' : '<span class="zt-badge lock">🔒</span>')}
         <div class="zt-code">BOSS</div>
         <div class="zt-sym">☠</div>
         <div class="zt-title">Warden of ${esc(theme.replace("Structure ", "S").replace("Reactivity ", "R"))}</div>
         <div class="zt-region">A mixed trial of the whole theme</div>
         <div class="zt-foot"><span class="muted" style="font-size:.76rem">Interleaved · all ${esc(theme)} topics</span></div>`;
      if (bUnlocked) bossTile.onclick = () => { sfx.resume(); sfx.click(); startBattle({ mode: "boss", node: bn }); };
      else bossTile.onclick = () => toast("Clear all of " + theme + " to challenge the Warden 🔒");
      grid.appendChild(bossTile);
      block.appendChild(grid); host.appendChild(block);
    });
  }

  /* ==========================================================================
     BATTLE ENGINE
     ========================================================================== */
  const battle = { active: false };

  function buildPool(opts) {
    if (opts.mode === "boss") return refsForTheme(opts.node.theme);
    if (opts.mode === "endless") { let r = []; enabledZones().forEach((z) => r = r.concat(refsForZone(z))); return r; }
    if (opts.mode === "review") {
      let r = []; enabledZones().forEach((z) => r = r.concat(refsForZone(z)));
      // prioritise seen-and-weak, then unseen; fall back to all
      const weak = r.filter((x) => { const c = S.cards[cardId(x.zoneId, x.idx)]; return c && (c.box <= 2 || (c.due && c.due <= now())); });
      const unseen = r.filter((x) => !S.cards[cardId(x.zoneId, x.idx)]);
      const poolR = weak.concat(unseen);
      return poolR.length >= 4 ? poolR : r;
    }
    return refsForZone(opts.node.zone); // campaign single zone
  }

  function startBattle(opts) {
    const pool = buildPool(opts);
    if (!pool.length) { toast("No topics enabled — turn some on in the Lab ⚙"); return; }
    const boss = opts.mode === "boss";
    const endless = opts.mode === "endless";
    const review = opts.mode === "review";

    const pMax = maxHpFor(S.player.level);
    Object.assign(battle, {
      active: true, mode: opts.mode, node: opts.node, pool,
      playerMaxHp: pMax, playerHp: pMax,
      enemyMaxHp: 0, enemyHp: 0,
      combo: 0, bestCombo: 0, correctCount: 0, askedCount: 0,
      recent: [], current: null, locked: false, xpEarned: 0,
      enemyIndex: 0, enemiesCleared: 0,
      hue: boss ? 350 : (opts.node && opts.node.zone ? opts.node.zone.hue : 200),
      title: review ? "Review Lab" : endless ? "Endless Trial" : boss ? ("Boss · " + opts.node.theme) : (opts.node.zone.theme + " " + opts.node.zone.code)
    });

    spawnEnemy();
    $("battle-title").textContent = battle.title;
    $("player-name").textContent = S.player.name;
    $("player-sprite").innerHTML = playerSVG();
    $("banner").classList.remove("show", "win", "lose");
    showScreen("battle");
    renderHp(); refreshXpBars();
    nextQuestion();
  }

  function enemyConfigFor() {
    const b = battle;
    if (b.mode === "boss") return { hp: 240 + S.player.level * 6, name: "⚠ Warden of " + b.node.theme, boss: true, hue: 350, sym: "☠" };
    if (b.mode === "endless") { const tier = b.enemiesCleared; return { hp: 90 + tier * 22, name: pick(NAME_PRE) + " Anomaly", boss: false, hue: rand(360), sym: "∞" }; }
    if (b.mode === "review") return { hp: 9999, name: "Memory Sprite", boss: false, hue: 265, sym: "🧠", endlessReview: true };
    const z = b.node.zone; return { hp: 100 + S.player.level * 3, name: enemyName(z, false), boss: false, hue: z.hue, sym: z.sym };
  }
  function spawnEnemy() {
    const cfg = enemyConfigFor();
    battle.enemyCfg = cfg; battle.hue = cfg.hue;
    battle.enemyMaxHp = cfg.hp; battle.enemyHp = cfg.hp;
    $("enemy-name").textContent = cfg.name;
    $("enemy-sub").textContent = cfg.boss ? "BOSS" : (battle.mode === "endless" ? "Wave " + (battle.enemiesCleared + 1) : "");
    const sp = $("enemy-sprite");
    sp.innerHTML = enemySVG(cfg.hue, cfg.sym, cfg.boss);
    sp.className = "sprite idle";
    if (cfg.boss) sp.style.transform = "scale(1.12)"; else sp.style.transform = "";
  }

  function hpClass(frac) { return frac <= 0.25 ? "low" : frac <= 0.5 ? "mid" : ""; }
  function renderHp() {
    const b = battle;
    const ef = clamp(b.enemyHp / b.enemyMaxHp, 0, 1);
    const eb = $("enemy-hpbar"); eb.className = "hpbar " + hpClass(ef);
    eb.querySelector("i").style.transform = `scaleX(${ef})`;
    $("enemy-hpnum").textContent = b.enemyCfg && b.enemyCfg.endlessReview ? "∞" : Math.max(0, Math.ceil(b.enemyHp)) + " / " + b.enemyMaxHp;
    const pf = clamp(b.playerHp / b.playerMaxHp, 0, 1);
    const pb = $("player-hpbar"); pb.className = "hpbar " + hpClass(pf);
    pb.querySelector("i").style.transform = `scaleX(${pf})`;
    $("player-hpnum").textContent = Math.max(0, Math.ceil(b.playerHp)) + " / " + b.playerMaxHp;
    $("player-sub").textContent = "Lv " + S.player.level;
  }

  function drawCard() {
    const b = battle;
    const avail = b.pool.filter((r) => !b.recent.includes(cardId(r.zoneId, r.idx)));
    const src = avail.length ? avail : b.pool;
    // weighted pick
    let total = 0; const ws = src.map((r) => { const w = cardWeight(cardId(r.zoneId, r.idx)); total += w; return w; });
    let roll = Math.random() * total, chosen = src[0];
    for (let i = 0; i < src.length; i++) { roll -= ws[i]; if (roll <= 0) { chosen = src[i]; break; } }
    const id = cardId(chosen.zoneId, chosen.idx);
    b.recent.push(id); if (b.recent.length > Math.min(5, b.pool.length - 1)) b.recent.shift();
    return chosen;
  }

  let timerInt = null;
  function clearTimer() { clearInterval(timerInt); timerInt = null; }

  function nextQuestion() {
    const b = battle; b.locked = false;
    const ref = drawCard(); b.current = ref;
    const card = ref.card;
    b.askedCount++;
    const z = zoneById(ref.zoneId);
    const options = shuffle([card.a].concat(card.x));
    const diff = card.d || 1;
    const keys = ["A", "B", "C", "D"];

    const panel = $("qpanel");
    panel.innerHTML =
      `<div class="qmeta">
         <span>${z ? esc(z.theme) + " · " + esc(z.title) : ""}</span>
         <span class="diff" title="Difficulty">${[1, 2, 3].map((i) => `<i class="${i <= diff ? "on" : ""}"></i>`).join("")}</span>
       </div>
       ${S.settings.timer ? '<div class="timerbar" id="timerbar"><i></i></div>' : ""}
       <div class="question card">${esc(card.q)}</div>
       <div class="answers">
         ${options.map((o, i) => `<button class="ans" data-opt="${i}"><span class="key">${keys[i]}</span>${esc(o)}</button>`).join("")}
       </div>`;

    panel.querySelectorAll(".ans").forEach((btn, i) => { btn.onclick = () => answer(options[i], card, btn); });

    if (S.settings.timer) startTimer(card, options, panel);
  }

  function startTimer(card, options, panel) {
    const total = 24000; let left = total;
    const bar = $("timerbar"); const fill = bar.querySelector("i");
    battle.timeFrac = 1; battle.tStart = now();
    clearTimer();
    timerInt = setInterval(() => {
      left -= 100; battle.timeFrac = clamp(left / total, 0, 1);
      fill.style.width = (battle.timeFrac * 100) + "%";
      bar.classList.toggle("warn", battle.timeFrac < 0.3);
      if (left <= 0) { clearTimer(); if (!battle.locked) timeUp(card, panel); }
    }, 100);
  }
  function timeUp(card, panel) {
    // gentle: counts as a miss, enemy strikes, but you still learn
    const correctOpt = card.a;
    const btns = panel.querySelectorAll(".ans");
    btns.forEach((b) => { if (b.textContent.trim().slice(1).trim() === correctOpt) {} });
    resolveAnswer(false, null, card, true);
  }

  function spriteRect(id) { const r = $(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function floatDmg(text, atId, cls) {
    const root = $("battle-root"); const r = $(atId).getBoundingClientRect(); const rootR = root.getBoundingClientRect();
    const d = document.createElement("div"); d.className = "dmg " + (cls || ""); d.textContent = text;
    d.style.left = (r.left - rootR.left + r.width / 2 - 14) + "px";
    d.style.top = (r.top - rootR.top + 8) + "px";
    root.appendChild(d); setTimeout(() => d.remove(), 1000);
  }

  function answer(chosen, card, btn) {
    if (battle.locked) return;
    battle.locked = true; clearTimer();
    sfx.resume();
    const ok = chosen === card.a;
    // mark buttons
    const panel = $("qpanel");
    panel.querySelectorAll(".ans").forEach((b) => {
      b.setAttribute("disabled", "");
      const txt = b.textContent.trim().replace(/^[A-D]\s*/, "");
      if (txt === card.a) b.classList.add("correct");
      else if (b === btn && !ok) b.classList.add("wrong");
      else b.classList.add("dim");
    });
    resolveAnswer(ok, chosen, card, false);
  }

  function resolveAnswer(ok, chosen, card, timedOut) {
    const b = battle;
    const id = cardId(b.current.zoneId, b.current.idx);
    recordAnswer(id, ok);

    if (ok) {
      b.combo++; b.bestCombo = Math.max(b.bestCombo, b.combo); b.correctCount++;
      const diff = card.d || 1;
      const speedFrac = S.settings.timer ? (b.timeFrac || 0) : 0.5;
      const crit = b.combo >= 4 && Math.random() < 0.25 + speedFrac * 0.15;
      let dmg = 14 + diff * 5 + Math.min(b.combo, 8) * 2 + Math.round(speedFrac * 8);
      if (crit) dmg = Math.round(dmg * 1.8);
      b.enemyHp -= dmg;

      // animate
      const ps = $("player-sprite"), es = $("enemy-sprite");
      ps.className = "sprite attack-p"; setTimeout(() => ps.className = "sprite idle", 420);
      setTimeout(() => { es.className = "sprite hurt"; setTimeout(() => es.className = "sprite idle", 360); }, 150);
      const ec = spriteRect("enemy-sprite");
      setTimeout(() => { (crit ? fx.crit : fx.burst)(ec.x, ec.y, 24); floatDmg((crit ? "✦" : "") + "-" + dmg, "enemy-sprite", "enemy" + (crit ? " crit" : "")); }, 160);
      crit ? sfx.crit() : sfx.correct();

      // XP per correct (ties XP to retrieval!)
      const xpGain = 5 + diff * 4 + Math.min(b.combo, 6) + (crit ? 6 : 0);
      b.xpEarned += xpGain; addXp(xpGain);

      updateCombo();
      renderHp();
      showFeedback(true, card, chosen, () => afterTurn());
    } else {
      b.combo = 0; updateCombo();
      const diff = card.d || 1;
      let dmg = 10 + diff * 3 + (b.enemyCfg.boss ? 6 : 0) + rand(4);
      b.playerHp -= dmg;
      const es = $("enemy-sprite"), ps = $("player-sprite");
      es.className = "sprite attack-e"; setTimeout(() => es.className = "sprite idle", 420);
      setTimeout(() => { ps.className = "sprite hurt"; setTimeout(() => ps.className = "sprite idle", 360); $("battle-root").classList.add("shake"); setTimeout(() => $("battle-root").classList.remove("shake"), 400); }, 150);
      const pc = spriteRect("player-sprite");
      setTimeout(() => { fx.hurt(pc.x, pc.y); floatDmg("-" + dmg, "player-sprite", "player-dmg"); }, 160);
      sfx.wrong();
      renderHp();
      showFeedback(false, card, chosen, () => afterTurn(), timedOut);
    }
  }

  function updateCombo() {
    const el = $("combo");
    if (battle.combo >= 2) { el.classList.add("show"); el.innerHTML = `<span class="flame">🔥</span> ${battle.combo}× combo`; }
    else el.classList.remove("show");
  }

  function showFeedback(ok, card, chosen, cont, timedOut) {
    const panel = $("qpanel");
    const verdict = ok ? "✓ Correct!" : (timedOut ? "⏰ Time's up!" : "✗ Not quite");
    const ansLine = ok ? "" : `<div class="ans-line">Answer: <b>${esc(card.a)}</b></div>`;
    panel.insertAdjacentHTML("beforeend",
      `<div class="feedback ${ok ? "good" : "bad"}" id="fb">
         <div class="verdict">${verdict}</div>
         ${ansLine}
         <div class="explain">${esc(card.e)}</div>
         <div class="next"><button class="btn primary" id="fb-next">Continue ▸</button></div>
       </div>`);
    const nx = $("fb-next");
    nx.onclick = () => { sfx.click(); cont(); };
    nx.focus();
  }

  function afterTurn() {
    const b = battle;
    if (b.playerHp <= 0) return defeat();
    if (b.enemyHp <= 0 && !(b.enemyCfg && b.enemyCfg.endlessReview)) {
      // enemy down
      const es = $("enemy-sprite"); es.className = "sprite faint";
      const ec = spriteRect("enemy-sprite"); fx.confetti(ec.x, ec.y, 40);
      if (b.mode === "endless") { b.enemiesCleared++; addXp(12); setTimeout(() => { spawnEnemy(); renderHp(); nextQuestion(); }, 800); return; }
      return setTimeout(victory, 800);
    }
    // review mode: run for a set number of questions then summarise
    if (b.enemyCfg && b.enemyCfg.endlessReview && b.askedCount >= Math.min(12, Math.max(8, b.pool.length))) {
      return setTimeout(reviewDone, 500);
    }
    nextQuestion();
  }

  /* ----- end states ----- */
  function showBanner(cls, big, rewardsHtml, actions) {
    const ban = $("banner");
    ban.className = "banner show " + cls;
    $("banner-big").textContent = big;
    $("banner-rewards").innerHTML = rewardsHtml || "";
    const act = $("banner-actions"); act.innerHTML = "";
    actions.forEach((a) => { const btn = document.createElement("button"); btn.className = "btn " + (a.cls || ""); btn.textContent = a.label; btn.onclick = () => { sfx.click(); a.fn(); }; act.appendChild(btn); });
  }

  function victory() {
    const b = battle; battle.active = true;
    sfx.victory();
    fx.confetti(window.innerWidth / 2, window.innerHeight * 0.3, 90);
    const boss = b.mode === "boss";
    const coinGain = (boss ? 50 : 20) + b.bestCombo * 2;
    const clearBonus = boss ? 80 : 35;
    S.player.coins += coinGain; addXp(clearBonus);
    if (b.mode === "campaign" || b.mode === "boss") { S.player.cleared[b.node.id] = true; }
    save();
    const acc = b.askedCount ? Math.round(b.correctCount / b.askedCount * 100) : 0;
    const rewards =
      `<div class="reward-chip"><b>+${b.xpEarned + clearBonus}</b><span>XP</span></div>
       <div class="reward-chip"><b>★${coinGain}</b><span>Reagents</span></div>
       <div class="reward-chip"><b>${b.bestCombo}×</b><span>Best combo</span></div>
       <div class="reward-chip"><b>${acc}%</b><span>Accuracy</span></div>`;
    const actions = [];
    // find next node
    const nodes = campaignNodes();
    const myI = nodes.findIndex((n) => n.id === (b.node && b.node.id));
    if ((b.mode === "campaign" || b.mode === "boss") && myI >= 0 && myI + 1 < nodes.length) {
      const nxt = nodes[myI + 1];
      actions.push({ label: nxt.kind === "boss" ? "⚔ Next: Boss" : "▸ Next region", cls: "primary", fn: () => startNode(nxt) });
    }
    actions.push({ label: "🗺 World Map", fn: () => showScreen("map") });
    actions.push({ label: "↺ Replay", fn: () => startBattle({ mode: b.mode, node: b.node }) });
    showBanner("win", boss ? "BOSS DEFEATED!" : "VICTORY!", rewards, actions);
    battle.active = false;
  }

  function startNode(n) {
    if (n.kind === "boss") startBattle({ mode: "boss", node: n });
    else startBattle({ mode: "campaign", node: n });
  }

  function defeat() {
    sfx.defeat();
    battle.active = false;
    const acc = battle.askedCount ? Math.round(battle.correctCount / battle.askedCount * 100) : 0;
    const rewards =
      `<div class="reward-chip"><b>+${battle.xpEarned}</b><span>XP kept</span></div>
       <div class="reward-chip"><b>${battle.correctCount}</b><span>Hits landed</span></div>
       <div class="reward-chip"><b>${acc}%</b><span>Accuracy</span></div>`;
    showBanner("lose", "DEFEATED", rewards, [
      { label: "↺ Retry", cls: "primary", fn: () => startBattle({ mode: battle.mode, node: battle.node }) },
      { label: "🗺 World Map", fn: () => showScreen("map") }
    ]);
  }

  function reviewDone() {
    sfx.victory(); fx.confetti(window.innerWidth / 2, window.innerHeight * 0.3, 70);
    battle.active = false;
    const acc = battle.askedCount ? Math.round(battle.correctCount / battle.askedCount * 100) : 0;
    const rewards =
      `<div class="reward-chip"><b>+${battle.xpEarned}</b><span>XP</span></div>
       <div class="reward-chip"><b>${battle.correctCount}/${battle.askedCount}</b><span>Recalled</span></div>
       <div class="reward-chip"><b>${acc}%</b><span>Accuracy</span></div>`;
    showBanner("win", "REVIEW COMPLETE", rewards, [
      { label: "🧪 Review again", cls: "primary", fn: () => startBattle({ mode: "review" }) },
      { label: "🏠 Home", fn: () => showScreen("home") }
    ]);
  }

  /* ==========================================================================
     LAB / STATS / SETTINGS
     ========================================================================== */
  function renderLab() {
    const acc = S.stats.answered ? Math.round(S.stats.correct / S.stats.answered * 100) : 0;
    let mastered = 0, totalCards = 0;
    DATA.zones.forEach((z) => z.q.forEach((_, i) => { totalCards++; const c = S.cards[cardId(z.id, i)]; if (c && c.box >= 4) mastered++; }));
    const clearedCount = Object.keys(S.player.cleared).length;

    const themeMastery = themesInOrder().map((t) => {
      const zs = enabledZones().filter((z) => z.theme === t);
      const m = Math.round(zs.reduce((s, z) => s + zoneMastery(z), 0) / Math.max(1, zs.length));
      return { t, m };
    });

    const setRow = (key, title, desc) =>
      `<div class="row"><div class="rt"><b>${title}</b><small>${desc}</small></div>
        <div class="toggle ${S.settings[key] ? "on" : ""}" data-set="${key}"></div></div>`;

    const topicGroups = themesInOrder().map((t) => {
      const zs = DATA.zones.filter((z) => z.theme === t);
      return `<div class="theme-label" style="margin-top:14px">${esc(t)}</div>` +
        zs.map((z) => `
          <div class="topic-toggle">
            <span class="code">${esc(z.code)}</span>
            <span class="nm">${esc(z.title)} ${z.hl ? '<span class="hl-tag">HL</span>' : ""}<small>${esc(z.blurb)}</small></span>
            <div class="toggle ${zoneEnabled(z) ? "on" : ""}" data-topic="${z.id}"></div>
          </div>`).join("");
    }).join("");

    $("lab-content").innerHTML = `
      <div class="info-callout">
        <h4>🔬 Why this game actually works</h4>
        Every turn makes you <b>retrieve</b> an answer (active recall — the single most
        effective study method). Cards you miss come back <b>sooner</b> (spaced repetition).
        Boss battles <b>mix topics together</b> (interleaving). And you get an
        <b>explanation after every answer</b> so mistakes turn into learning.
      </div>

      <div class="section-title">📊 Your progress</div>
      <div class="card" style="padding:16px">
        <div class="stat-grid">
          <div class="stat"><b>${S.player.level}</b><span>Level</span></div>
          <div class="stat"><b>${S.stats.answered}</b><span>Answered</span></div>
          <div class="stat"><b>${acc}%</b><span>Accuracy</span></div>
          <div class="stat"><b>${mastered}/${totalCards}</b><span>Cards mastered</span></div>
          <div class="stat"><b>${clearedCount}</b><span>Regions cleared</span></div>
          <div class="stat"><b>★ ${S.player.coins}</b><span>Reagents</span></div>
        </div>
        <div style="margin-top:16px">
          ${themeMastery.map((x) => `<div class="mastery-row"><div class="ml">${esc(x.t)}</div><div class="mbar"><i style="width:${x.m}%"></i></div><div class="mp">${x.m}%</div></div>`).join("")}
        </div>
      </div>

      <div class="section-title">⚙ Settings</div>
      <div class="card">
        ${setRow("sound", "Sound effects", "Beeps, hits & fanfares")}
        ${setRow("motion", "Animations", "Particles & motion (off = calmer / faster)")}
        ${setRow("timer", "Question timer", "On = bonus damage for speed · off = relaxed mode")}
      </div>

      <div class="section-title">📚 Exam scope — toggle your topics</div>
      <div class="info-callout" style="background:rgba(34,211,238,.07); border-color:rgba(34,211,238,.3)">
        Switch <b>off</b> anything that is crossed-out or highlighted on your exam sheet — it
        disappears from the map, battles and review instantly.
      </div>
      <div class="card" style="padding:14px; margin-top:10px">${topicGroups}</div>

      <div class="section-title">⚠ Danger zone</div>
      <div class="card" style="padding:16px; display:flex; align-items:center; gap:14px; flex-wrap:wrap">
        <div class="rt" style="flex:1; min-width:200px"><b>Reset all progress</b><br><small class="muted">Wipes level, XP and memory data. Cannot be undone.</small></div>
        <button class="btn" id="btn-reset" style="border-color:rgba(251,113,133,.5); color:var(--red)">Reset</button>
      </div>
      <div style="height:30px"></div>
    `;

    $("lab-content").querySelectorAll("[data-set]").forEach((t) => t.onclick = () => {
      const k = t.getAttribute("data-set"); S.settings[k] = !S.settings[k]; save(); sfx.click(); t.classList.toggle("on", S.settings[k]);
    });
    $("lab-content").querySelectorAll("[data-topic]").forEach((t) => t.onclick = () => {
      const id = t.getAttribute("data-topic"); const z = zoneById(id);
      const newVal = !zoneEnabled(z); S.topics[id] = newVal; save(); sfx.click(); t.classList.toggle("on", newVal);
    });
    $("btn-reset").onclick = () => confirmReset();
  }

  function confirmReset() {
    modal(`<h2>Reset everything?</h2>
      <p>This wipes your level, XP, coins, region progress and all spaced-repetition memory. This cannot be undone.</p>
      <div class="row-btns">
        <button class="btn ghost" id="m-cancel">Cancel</button>
        <button class="btn" id="m-ok" style="background:linear-gradient(135deg,var(--red),var(--magenta));border:none;color:#1a0408;font-weight:800">Reset</button>
      </div>`);
    $("m-cancel").onclick = closeModal;
    $("m-ok").onclick = () => { S = defaultState(); S.firstRun = false; save(); closeModal(); toast("Progress reset"); renderLab(); refreshXpBars(); };
  }

  /* ==========================================================================
     MODALS / TOAST / HOW-TO / FIRST RUN
     ========================================================================== */
  function modal(html) { $("modal-inner").innerHTML = html; $("modal").classList.add("show"); }
  function closeModal() { $("modal").classList.remove("show"); }
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });

  let toastT = null;
  function toast(msg) {
    let el = $("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);z-index:120;background:rgba(10,8,24,.92);border:1px solid var(--stroke);color:var(--ink);padding:12px 20px;border-radius:99px;font-weight:600;opacity:0;transition:.3s;backdrop-filter:blur(8px)"; document.body.appendChild(el); }
    el.textContent = msg; requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateX(-50%) translateY(0)"; });
    clearTimeout(toastT); toastT = setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateX(-50%) translateY(20px)"; }, 2200);
  }

  function howToModal() {
    modal(`<h2>⚗ How to play</h2>
      <p style="text-align:left">
        <b>The story.</b> Entropy is unravelling the Periodic Realm. You and your mole
        companion <b>${esc(S.player.name)}</b> travel region to region, restoring order by
        mastering chemistry.<br><br>
        <b>Battle.</b> Each turn a question appears. A <b>correct</b> answer makes you
        strike the monster; a <b>wrong</b> one lets it hit you. Build a <b>combo</b> for
        bigger hits and crits. Answer fast for bonus damage (or switch the timer off in the Lab).<br><br>
        <b>Level up.</b> Every correct recall earns XP. Clear regions to unlock new ones,
        then beat the <b>Boss</b> (a mixed trial) at the end of each theme.<br><br>
        <b>It's real studying.</b> Missed questions return sooner, and you get an
        explanation after <i>every</i> answer. Use the <b>Review Lab</b> to drill your
        weakest cards anytime.
      </p>
      <div class="row-btns"><button class="btn primary block" id="m-go">Got it ⚗️</button></div>`);
    $("m-go").onclick = closeModal;
  }

  function firstRunModal() {
    modal(`<h2>⚗️ Welcome to ChemQuest</h2>
      <p>A turn-based RPG that turns IB Chemistry revision into a battle adventure — powered by real learning science.</p>
      <p style="margin-top:6px"><b>Name your companion:</b></p>
      <div class="namebox" style="margin:10px auto 0"><input id="m-name" maxlength="14" placeholder="Avo" value="Avo" /></div>
      <div class="row-btns"><button class="btn primary block" id="m-start">Begin the adventure ▸</button></div>`);
    const inp = $("m-name"); setTimeout(() => inp.focus(), 100);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") $("m-start").click(); });
    $("m-start").onclick = () => {
      const nm = inp.value.trim().slice(0, 14) || "Avo";
      S.player.name = nm; S.firstRun = false; save(); closeModal(); sfx.resume();
      renderHome(); toast("Welcome, " + nm + "! 🧪");
    };
  }

  /* ==========================================================================
     WIRING
     ========================================================================== */
  function quitBattle() {
    if (battle.active && battle.enemyHp > 0 && battle.playerHp > 0 && !$("banner").classList.contains("show")) {
      modal(`<h2>Leave the battle?</h2><p>Your progress in this fight will be lost (XP already earned is kept).</p>
        <div class="row-btns"><button class="btn ghost" id="m-stay">Stay</button><button class="btn primary" id="m-leave">Leave</button></div>`);
      $("m-stay").onclick = closeModal;
      $("m-leave").onclick = () => { clearTimer(); battle.active = false; closeModal(); showScreen(battle.mode === "review" || battle.mode === "endless" ? "home" : "map"); };
    } else { clearTimer(); battle.active = false; showScreen(battle.mode === "review" || battle.mode === "endless" ? "home" : "map"); }
  }

  function wire() {
    $("btn-adventure").onclick = () => { sfx.resume(); sfx.click(); showScreen("map"); };
    $("btn-review").onclick = () => { sfx.resume(); sfx.click(); startBattle({ mode: "review" }); };
    $("btn-endless").onclick = () => { sfx.resume(); sfx.click(); startBattle({ mode: "endless" }); };
    $("btn-lab").onclick = () => { sfx.resume(); sfx.click(); showScreen("lab"); };
    $("btn-how").onclick = () => { sfx.resume(); sfx.click(); howToModal(); };
    $("battle-quit").onclick = quitBattle;
    document.querySelectorAll("[data-home]").forEach((b) => b.onclick = () => { sfx.click(); showScreen("home"); });

    // keyboard: 1-4 answers, enter/space continue
    document.addEventListener("keydown", (e) => {
      if (currentScreen !== "battle") return;
      if ($("banner").classList.contains("show")) return;
      const fbNext = $("fb-next");
      if (fbNext && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fbNext.click(); return; }
      if (!battle.locked && /^[1-4]$/.test(e.key)) {
        const btns = $("qpanel").querySelectorAll(".ans");
        const b = btns[+e.key - 1]; if (b) b.click();
      }
    });
  }

  /* ==========================================================================
     INIT
     ========================================================================== */
  function init() {
    wire();
    showScreen("home");
    refreshXpBars();
    if (S.firstRun) setTimeout(firstRunModal, 400);
  }
  init();

})();
