(() => {
  'use strict';

  // =====================================================
  // Setup and constants
  // =====================================================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 960
  const H = canvas.height;  // 520
  const T = 40;             // tile size
  const COLS = 24;
  const ROWS = 13;

  const GRAVITY = 1800;
  const MOVE_SPEED = 220;
  const JUMP_SPEED = 610;   // about 2.5 tiles high
  const MAX_FALL = 900;

  const WAVE_SPEED = 260;
  const ICE_LIFE = 6;       // seconds before ice melts
  const ICE_MAX = 5;        // max ice blocks at once
  const STEAM_LIFE = 3;
  const STEAM_HEIGHT = 8;   // tiles
  const STEAM_LIFT = 320;
  const STEAM_DAMAGE = 22;  // health per second
  const ACTION_COOLDOWN = 0.3;

  const COLORS = {
    yellow: '#FFC907',
    navy: '#003366',
    blue: '#2E9DF7',
    aqua: '#8BD1CB',
    ink: '#1F2937',
  };

  const MODES = {
    liquid: { name: 'Liquid', key: '1', color: '#2E9DF7' },
    ice:    { name: 'Ice',    key: '2', color: '#7FD8F5' },
    steam:  { name: 'Steam',  key: '3', color: '#9AA8B5' },
  };
  const MODE_ORDER = ['liquid', 'ice', 'steam'];

  // =====================================================
  // Levels
  // # = ground   B = crate   P = player   J = jerry can   F = flag
  // =====================================================
  const E = '........................';
  const G = '########################';

  const LEVELS = [
    {
      name: 'Getting Started',
      modes: [],
      hint: 'A / D to move, W to jump. Reach the flag!',
      map: [
        E, E, E, E, E, E, E, E, E,
        '..............##........',
        '.P.......###..##.....F..',
        G, G,
      ],
    },
    {
      name: 'Liquid Water',
      modes: ['liquid'],
      hint: 'Grab the jerry can, then press Space to pour water and push the crate.',
      map: [
        E, E, E, E, E, E, E,
        '......................F.',
        '...................#####',
        '...................#####',
        '.P..J..B...........#####',
        G, G,
      ],
    },
    {
      name: 'Ice',
      modes: ['ice'],
      hint: 'Space places ice. Hold S + Space to build a bridge. Ice melts fast!',
      map: [
        E, E, E, E, E, E, E,
        '......................F.',
        '..................######',
        '..................######',
        '.P................######',
        '######......############',
        '######......############',
      ],
    },
    {
      name: 'Steam',
      modes: ['steam'],
      hint: 'Space makes steam. Walk into it to float up. Careful, steam hurts!',
      map: [
        E, E, E,
        '......................F.',
        '..............##########',
        E, E, E, E, E,
        '.P......................',
        G, G,
      ],
    },
    {
      name: 'All Modes',
      modes: ['liquid', 'ice', 'steam'],
      hint: 'Press 1 / 2 / 3 to switch modes. Use everything you have learned!',
      map: [
        E, E, E, E,
        '......................F.',
        '...................#####',
        E, E,
        '.........##.............',
        '.........##.............',
        '.P.J.B...##.............',
        '###########.....########',
        '###########.....########',
      ],
    },
  ];

  // =====================================================
  // Game state
  // =====================================================
  let state = 'title'; // title | playing | complete | gameover | win
  let levelIndex = 0;
  let totalScore = 0;
  let levelTime = 0;
  let time = 0;

  let tiles = [];
  let player = null;
  let blocks = [];
  let ices = [];
  let steams = [];
  let waves = [];
  let particles = [];
  let can = null;
  let flag = null;

  let currentMode = null;
  let actionTimer = 0;
  let hurtTimer = 0;
  let hurtSoundTimer = 0;
  const toast = { text: '', time: 0 };

  // =====================================================
  // Input
  // =====================================================
  const keys = {};
  const pressed = {};

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    // Let focused buttons handle their own Enter/Space clicks
    if (e.target && e.target.tagName === 'BUTTON' && (k === 'enter' || k === ' ')) return;
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (!keys[k]) pressed[k] = true;
    keys[k] = true;
    ensureAudio();
    handleMenuKeys(k);
  });

  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
  });

  function clearPressed() {
    for (const k in pressed) delete pressed[k];
  }

  function handleMenuKeys(k) {
    if (state === 'title' && (k === 'enter' || k === ' ')) startGame();
    else if (state === 'complete' && (k === 'enter' || k === ' ')) nextLevel();
    else if (state === 'gameover' && (k === 'enter' || k === 'r')) retryLevel();
    else if (state === 'win' && k === 'enter') startGame();
    else if (state === 'playing') {
      if (k === 'r') retryLevel();
      else if (k === 'escape') goToTitle();
      else if (k === '1' || k === '2' || k === '3') selectMode(MODE_ORDER[Number(k) - 1]);
    }
  }

  // =====================================================
  // Sound (simple Web Audio tones, no files needed)
  // =====================================================
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (err) { audioCtx = null; }
    } else if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function tone(freq, dur, { type = 'sine', vol = 0.1, to = null, delay = 0 } = {}) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(dur, { vol = 0.15, filter = 'lowpass', freq = 800 } = {}) {
    if (!audioCtx) return;
    const len = Math.floor(audioCtx.sampleRate * dur);
    const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const f = audioCtx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const gain = audioCtx.createGain();
    const t0 = audioCtx.currentTime;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(gain).connect(audioCtx.destination);
    src.start(t0);
  }

  const sfx = {
    jump:   () => tone(380, 0.15, { type: 'square', vol: 0.05, to: 720 }),
    splash: () => noise(0.35, { freq: 900, vol: 0.25 }),
    ice:    () => { tone(1400, 0.08, { type: 'triangle', vol: 0.1 }); tone(1900, 0.1, { type: 'triangle', vol: 0.08, delay: 0.05 }); },
    melt:   () => tone(600, 0.25, { vol: 0.06, to: 250 }),
    steam:  () => noise(0.6, { filter: 'highpass', freq: 2500, vol: 0.12 }),
    hurt:   () => tone(220, 0.12, { type: 'sawtooth', vol: 0.05, to: 120 }),
    pickup: () => [523, 659, 784].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.1, delay: i * 0.07 })),
    error:  () => tone(160, 0.15, { type: 'square', vol: 0.04 }),
    win:    () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.12, delay: i * 0.1 })),
    lose:   () => [392, 330, 262].forEach((f, i) => tone(f, 0.25, { type: 'square', vol: 0.05, delay: i * 0.15 })),
  };

  // =====================================================
  // Screens (HTML overlay)
  // =====================================================
  const overlay = document.getElementById('overlay');
  const SCREENS = ['title', 'complete', 'gameover', 'win'];

  function showScreen(name) {
    SCREENS.forEach((n) => {
      document.getElementById('screen-' + n).classList.toggle('hidden', n !== name);
    });
    overlay.classList.toggle('hidden', !name);
  }

  function onClick(id, fn) {
    document.getElementById(id).addEventListener('click', (e) => {
      ensureAudio();
      e.currentTarget.blur();
      fn();
    });
  }

  onClick('start-btn', startGame);
  onClick('next-btn', nextLevel);
  onClick('retry-btn', retryLevel);
  onClick('title-btn', goToTitle);
  onClick('replay-btn', startGame);

  // =====================================================
  // Game flow
  // =====================================================
  function startGame() {
    levelIndex = 0;
    totalScore = 0;
    loadLevel(levelIndex);
  }

  function nextLevel() {
    levelIndex++;
    loadLevel(levelIndex);
  }

  function retryLevel() {
    loadLevel(levelIndex);
  }

  function goToTitle() {
    state = 'title';
    showScreen('title');
  }

  function loadLevel(i) {
    const def = LEVELS[i];
    const rows = def.map.map((r) => r.padEnd(COLS, '.'));
    tiles = rows.map((r) => r.split('').map((ch) => (ch === '#' ? '#' : '.')));
    blocks = [];
    ices = [];
    steams = [];
    waves = [];
    particles = [];
    can = null;
    flag = null;

    rows.forEach((row, r) => {
      row.split('').forEach((ch, c) => {
        if (ch === 'P') player = makePlayer(c * T + 7, (r + 1) * T - 34);
        if (ch === 'B') blocks.push({ x: c * T, y: r * T, w: T, h: T, vy: 0 });
        if (ch === 'J') can = { x: c * T + 8, y: r * T + 8, w: 24, h: 30, taken: false };
        if (ch === 'F') flag = { x: c * T + 14, y: (r + 1) * T - 120, w: 14, h: 120 };
      });
    });

    currentMode = def.modes[0] || null;
    levelTime = 0;
    actionTimer = 0;
    hurtTimer = 0;
    toast.time = 0;
    state = 'playing';
    showScreen(null);
    clearPressed();
  }

  function makePlayer(x, y) {
    return { x, y, w: 26, h: 34, vx: 0, vy: 0, onGround: false, facing: 1, hp: 100, hasCan: false, walk: 0 };
  }

  function completeLevel() {
    const seconds = Math.floor(levelTime);
    const timeBonus = Math.max(0, 600 - seconds * 10);
    const levelScore = 1000 + timeBonus;
    totalScore += levelScore;
    const stars = seconds <= 15 ? 3 : seconds <= 30 ? 2 : 1;
    sfx.win();
    burst(flag.x, flag.y + 10, COLORS.yellow, 30, { speed: 220 });

    if (levelIndex === LEVELS.length - 1) {
      state = 'win';
      document.getElementById('win-score').textContent = `Final score: ${totalScore}`;
      showScreen('win');
    } else {
      state = 'complete';
      document.getElementById('complete-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      document.getElementById('complete-details').textContent =
        `Time: ${seconds}s  •  Level score: ${levelScore}  •  Total: ${totalScore}`;
      showScreen('complete');
    }
  }

  function gameOver(reason) {
    state = 'gameover';
    sfx.lose();
    document.getElementById('gameover-reason').textContent = reason;
    showScreen('gameover');
  }

  function showToast(text) {
    toast.text = text;
    toast.time = 2;
  }

  function selectMode(id) {
    const def = LEVELS[levelIndex];
    if (!def.modes.includes(id)) {
      showToast(def.modes.length ? `${MODES[id].name} isn't available in this level` : 'No water modes yet, just reach the flag!');
      sfx.error();
      return;
    }
    currentMode = id;
  }

  // =====================================================
  // Collision helpers
  // =====================================================
  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function tileAt(c, r) {
    if (c < 0 || c >= COLS) return '#'; // side walls
    if (r < 0 || r >= ROWS) return '.'; // open sky and open pits
    return tiles[r][c];
  }

  // Returns every solid rectangle that overlaps rect
  function getSolids(rect, self, opts = {}) {
    const hits = [];
    const c0 = Math.floor(rect.x / T);
    const c1 = Math.floor((rect.x + rect.w - 0.01) / T);
    const r0 = Math.floor(rect.y / T);
    const r1 = Math.floor((rect.y + rect.h - 0.01) / T);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (tileAt(c, r) === '#') hits.push({ x: c * T, y: r * T, w: T, h: T });
      }
    }
    if (opts.blocks !== false) blocks.forEach((b) => { if (b !== self && overlaps(rect, b)) hits.push(b); });
    if (opts.ice !== false) ices.forEach((ic) => { if (ic !== self && overlaps(rect, ic)) hits.push(ic); });
    return hits;
  }

  function moveX(e, dx, opts) {
    if (!dx) return false;
    e.x += dx;
    const hits = getSolids(e, e, opts);
    if (!hits.length) return false;
    if (dx > 0) e.x = Math.min(...hits.map((h) => h.x)) - e.w;
    else e.x = Math.max(...hits.map((h) => h.x + h.w));
    return true;
  }

  function moveY(e, dy, opts) {
    if (!dy) return null;
    e.y += dy;
    const hits = getSolids(e, e, opts);
    if (!hits.length) return null;
    if (dy > 0) { e.y = Math.min(...hits.map((h) => h.y)) - e.h; return 'down'; }
    e.y = Math.max(...hits.map((h) => h.y + h.h));
    return 'up';
  }

  function cellIsFree(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
    if (tileAt(col, row) === '#') return false;
    const cell = { x: col * T, y: row * T, w: T, h: T };
    if (overlaps(cell, player)) return false;
    if (blocks.some((b) => overlaps(cell, b))) return false;
    if (ices.some((ic) => overlaps(cell, ic))) return false;
    return true;
  }

  // =====================================================
  // Water modes
  // =====================================================
  function useWater() {
    if (actionTimer > 0) return;
    if (!currentMode) {
      showToast('No water modes yet, just reach the flag!');
      return;
    }
    actionTimer = ACTION_COOLDOWN;
    if (currentMode === 'liquid') pourWater();
    else if (currentMode === 'ice') placeIce();
    else if (currentMode === 'steam') makeSteam();
  }

  function pourWater() {
    if (!player.hasCan) {
      showToast('Find the yellow jerry can first!');
      sfx.error();
      return;
    }
    const wave = {
      x: player.facing > 0 ? player.x + player.w : player.x - 30,
      y: player.y + player.h - 16,
      w: 30, h: 16, vy: 0, dir: player.facing, life: 3.5,
    };
    sfx.splash();
    if (getSolids(wave, null, { blocks: false }).length) {
      burst(wave.x + 15, wave.y, COLORS.blue, 10);
      return;
    }
    waves.push(wave);
  }

  function placeIce() {
    const feetRow = Math.floor((player.y + player.h - 1) / T);
    let col;
    let row;
    if (keys.s || keys.arrowdown) {
      // Bridge mode: place ice in the space just below and in front
      row = feetRow + 1;
      col = player.facing > 0 ? Math.floor((player.x + player.w + 2) / T) : Math.floor((player.x - 2) / T);
      if (!cellIsFree(col, row)) col += player.facing;
    } else {
      // Step mode: place ice right in front of the player
      row = feetRow;
      col = player.facing > 0 ? Math.floor((player.x + player.w - 1) / T) + 1 : Math.floor(player.x / T) - 1;
    }
    if (!cellIsFree(col, row)) {
      showToast('No room for ice there');
      sfx.error();
      return;
    }
    ices.push({ x: col * T, y: row * T, w: T, h: T, life: ICE_LIFE });
    if (ices.length > ICE_MAX) meltIce(ices.shift());
    sfx.ice();
    burst(col * T + 20, row * T + 20, '#CFF4FF', 8);
  }

  function makeSteam() {
    const row = Math.floor((player.y + player.h - 1) / T);
    const col = player.facing > 0 ? Math.floor((player.x + player.w - 1) / T) + 1 : Math.floor(player.x / T) - 1;
    if (col < 0 || col >= COLS || tileAt(col, row) === '#') {
      showToast('No room for steam there');
      sfx.error();
      return;
    }
    let top = row;
    while (row - top + 1 < STEAM_HEIGHT && top - 1 >= 0 && tileAt(col, top - 1) !== '#') top--;
    steams.push({ x: col * T, y: top * T, w: T, h: (row - top + 1) * T, life: STEAM_LIFE });
    sfx.steam();
  }

  function meltIce(ic) {
    sfx.melt();
    burst(ic.x + 20, ic.y + 20, '#9BE7FF', 12, { gravity: 600 });
  }

  // =====================================================
  // Particles
  // =====================================================
  function burst(x, y, color, count, { speed = 140, gravity = 300, size = 4 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - speed * 0.3,
        life: 0.6 + Math.random() * 0.4,
        max: 1,
        color, size, gravity,
      });
    }
  }

  // =====================================================
  // Update
  // =====================================================
  function update(dt) {
    const def = LEVELS[levelIndex];
    levelTime += dt;
    actionTimer = Math.max(0, actionTimer - dt);
    hurtTimer = Math.max(0, hurtTimer - dt);
    hurtSoundTimer = Math.max(0, hurtSoundTimer - dt);
    toast.time = Math.max(0, toast.time - dt);

    if (pressed[' ']) useWater();

    // ----- Player -----
    let dir = 0;
    if (keys.a || keys.arrowleft) dir -= 1;
    if (keys.d || keys.arrowright) dir += 1;
    player.vx = dir * MOVE_SPEED;
    if (dir) player.facing = dir;
    if (dir && player.onGround) player.walk += dt * 14;

    if ((pressed.w || pressed.arrowup) && player.onGround) {
      player.vy = -JUMP_SPEED;
      sfx.jump();
    }

    player.vy = Math.min(player.vy + GRAVITY * dt, MAX_FALL);

    const inSteam = steams.some((s) => overlaps(player, s));
    if (inSteam) {
      player.vy = Math.max(player.vy - 2800 * dt, -STEAM_LIFT);
      player.hp -= STEAM_DAMAGE * dt;
      hurtTimer = 0.25;
      if (hurtSoundTimer <= 0) { sfx.hurt(); hurtSoundTimer = 0.35; }
    }

    moveX(player, player.vx * dt);
    player.onGround = false;
    const hitY = moveY(player, player.vy * dt);
    if (hitY === 'down') { player.onGround = true; player.vy = 0; }
    if (hitY === 'up') player.vy = 0;

    // ----- Crates -----
    blocks.forEach((b) => {
      b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
      if (steams.some((s) => overlaps(b, s))) b.vy = Math.max(b.vy - 2800 * dt, -200);
      if (moveY(b, b.vy * dt)) b.vy = 0;
    });
    blocks = blocks.filter((b) => b.y < H + 80);

    // ----- Water waves (push crates) -----
    waves.forEach((wave) => {
      const dx = wave.dir * WAVE_SPEED * dt;
      const front = { x: wave.x + (wave.dir > 0 ? 2 : -2), y: wave.y, w: wave.w, h: wave.h };
      blocks.forEach((b) => {
        if (!overlaps(front, b)) return;
        const before = b.x;
        moveX(b, dx);
        if (Math.abs(b.x - before) < Math.abs(dx) - 0.01) wave.dead = true; // crate hit a wall
      });
      if (moveX(wave, dx, { blocks: false })) wave.dead = true;
      wave.vy = Math.min(wave.vy + GRAVITY * dt, MAX_FALL);
      if (moveY(wave, wave.vy * dt, { blocks: false })) wave.vy = 0;
      wave.life -= dt;
      if (wave.life <= 0 || wave.y > H) wave.dead = true;
      if (Math.random() < 0.5) {
        particles.push({
          x: wave.x + Math.random() * wave.w, y: wave.y,
          vx: -wave.dir * 30, vy: -60 - Math.random() * 60,
          life: 0.4, max: 0.4, color: '#BDE6FF', size: 3, gravity: 500,
        });
      }
      if (wave.dead) burst(wave.x + wave.w / 2, wave.y, COLORS.blue, 10);
    });
    waves = waves.filter((w) => !w.dead);

    // ----- Ice (melts over time or in steam) -----
    ices.forEach((ic) => {
      ic.life -= dt;
      if (steams.some((s) => overlaps(ic, s))) ic.life = 0;
      if (ic.life > 0 && ic.life < 2 && Math.random() < 0.15) {
        particles.push({
          x: ic.x + 5 + Math.random() * 30, y: ic.y + ic.h,
          vx: 0, vy: 30, life: 0.5, max: 0.5, color: '#7FD8F5', size: 3, gravity: 600,
        });
      }
    });
    ices = ices.filter((ic) => {
      if (ic.life <= 0) { meltIce(ic); return false; }
      return true;
    });

    // ----- Steam -----
    steams.forEach((s) => { s.life -= dt; });
    steams = steams.filter((s) => s.life > 0);

    // ----- Particles -----
    particles.forEach((p) => {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    });
    particles = particles.filter((p) => p.life > 0);

    // ----- Pickups and goals -----
    if (can && !can.taken && overlaps(player, can)) {
      can.taken = true;
      player.hasCan = true;
      sfx.pickup();
      burst(can.x + 12, can.y + 15, COLORS.yellow, 16);
      showToast('Jerry can collected! Press Space to pour water.');
    }

    if (flag && overlaps(player, flag)) {
      completeLevel();
      return;
    }

    if (player.hp <= 0) {
      player.hp = 0;
      gameOver('The steam was too hot! Try spending less time in it.');
    } else if (player.y > H + 40) {
      gameOver(def.modes.includes('ice') ? 'You fell! Try building an ice bridge with S + Space.' : 'You fell off the level!');
    }
  }

  // =====================================================
  // Drawing helpers
  // =====================================================
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawDrop(x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x + s * 0.9, y + s * 0.1, x, y + s * 0.7);
    ctx.quadraticCurveTo(x - s * 0.9, y + s * 0.1, x, y - s);
    ctx.fill();
  }

  function drawJerryCan(x, y, w, h) {
    ctx.fillStyle = COLORS.yellow;
    roundRect(x, y + 6, w, h - 6, 4);
    ctx.fill();
    ctx.strokeStyle = '#C79A00';
    ctx.lineWidth = 2;
    ctx.stroke();
    // handle
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.25, y + 6);
    ctx.lineTo(x + w * 0.25, y + 1);
    ctx.lineTo(x + w * 0.6, y + 1);
    ctx.lineTo(x + w * 0.6, y + 6);
    ctx.stroke();
    // spout
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(x + w * 0.72, y + 1, w * 0.18, 6);
  }

  function drawWavyLine(x, yTop, yBottom, amp, phase, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let y = yBottom; y >= yTop; y -= 4) {
      const px = x + Math.sin(y * 0.06 + phase) * amp;
      if (y === yBottom) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
  }

  // =====================================================
  // Title screen background
  // =====================================================
  function drawTitleBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#BFE6FF');
    sky.addColorStop(1, '#F0FAFF');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // sun
    ctx.fillStyle = 'rgba(255, 201, 7, 0.85)';
    ctx.beginPath();
    ctx.arc(820, 90, 46, 0, Math.PI * 2);
    ctx.fill();

    // steam rising from the ocean
    for (let i = 0; i < 9; i++) {
      const x = 90 + i * 100;
      drawWavyLine(x, 120, 380, 8, time * 2 + i, 'rgba(255, 255, 255, 0.75)', 4);
    }

    // ocean
    const sea = ctx.createLinearGradient(0, 360, 0, H);
    sea.addColorStop(0, COLORS.blue);
    sea.addColorStop(1, COLORS.navy);
    ctx.fillStyle = sea;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 10) ctx.lineTo(x, 380 + Math.sin(x * 0.02 + time * 2) * 6);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // icebergs drifting
    [0, 1, 2].forEach((i) => {
      const x = ((i * 340 + time * 18) % (W + 200)) - 100;
      const y = 380 + Math.sin(time * 1.5 + i) * 4;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(x - 50, y);
      ctx.lineTo(x - 20, y - 50);
      ctx.lineTo(x + 5, y - 30);
      ctx.lineTo(x + 25, y - 60);
      ctx.lineTo(x + 55, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#CFEFFF';
      ctx.beginPath();
      ctx.moveTo(x + 5, y - 30);
      ctx.lineTo(x + 25, y - 60);
      ctx.lineTo(x + 55, y);
      ctx.lineTo(x + 10, y);
      ctx.closePath();
      ctx.fill();
    });

    // wave highlights
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    for (let row = 0; row < 3; row++) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 10) {
        const y = 420 + row * 32 + Math.sin(x * 0.03 + time * 2 + row) * 4;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // =====================================================
  // World drawing
  // =====================================================
  function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#CDEBFF');
    sky.addColorStop(1, '#F5FBFF');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // soft clouds
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    [[140, 90], [520, 60], [790, 120]].forEach(([cx, cy], i) => {
      const x = (cx + time * (6 + i * 3)) % (W + 120) - 60;
      ctx.beginPath();
      ctx.arc(x, cy, 22, 0, Math.PI * 2);
      ctx.arc(x + 24, cy - 10, 26, 0, Math.PI * 2);
      ctx.arc(x + 50, cy, 20, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawTiles() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (tiles[r][c] !== '#') continue;
        const x = c * T;
        const y = r * T;
        ctx.fillStyle = '#6B7C8A';
        ctx.fillRect(x, y, T, T);
        ctx.strokeStyle = '#56656F';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
        if (tileAt(c, r - 1) !== '#') {
          ctx.fillStyle = '#9FB4C3';
          ctx.fillRect(x, y, T, 6);
        }
      }
    }
  }

  function drawFlag() {
    if (!flag) return;
    const px = flag.x + 5;
    const bottom = flag.y + flag.h;
    ctx.fillStyle = '#6B7280';
    ctx.fillRect(px, flag.y, 4, flag.h);
    ctx.fillRect(px - 8, bottom - 6, 20, 6);
    const wave = Math.sin(time * 5) * 4;
    ctx.fillStyle = COLORS.yellow;
    ctx.beginPath();
    ctx.moveTo(px + 4, flag.y + 2);
    ctx.quadraticCurveTo(px + 24, flag.y + 8 + wave, px + 44, flag.y + 14);
    ctx.quadraticCurveTo(px + 24, flag.y + 22 - wave, px + 4, flag.y + 30);
    ctx.closePath();
    ctx.fill();
    drawDrop(px + 18, flag.y + 15, 6, '#FFFFFF');
  }

  function drawCan() {
    if (!can || can.taken) return;
    const bob = Math.sin(time * 3) * 3;
    ctx.fillStyle = 'rgba(255, 201, 7, 0.25)';
    ctx.beginPath();
    ctx.arc(can.x + 12, can.y + 16 + bob, 22, 0, Math.PI * 2);
    ctx.fill();
    drawJerryCan(can.x, can.y + bob, can.w, can.h);
  }

  function drawBlocks() {
    blocks.forEach((b) => {
      ctx.fillStyle = '#B07A45';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#7A5230';
      ctx.lineWidth = 3;
      ctx.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 8; i < b.w; i += 8) {
        ctx.moveTo(b.x + i, b.y + 3);
        ctx.lineTo(b.x + i - 6, b.y + b.h - 3);
      }
      ctx.stroke();
    });
  }

  function drawIces() {
    ices.forEach((ic) => {
      const ratio = Math.max(0, ic.life / ICE_LIFE);
      const shrink = ic.life < 1.5 ? ((1.5 - ic.life) / 1.5) * 5 : 0;
      const x = ic.x + shrink;
      const y = ic.y + shrink;
      const s = T - shrink * 2;
      ctx.fillStyle = `rgba(175, 228, 255, ${0.6 + 0.35 * ratio})`;
      roundRect(x, y, s, s, 5);
      ctx.fill();
      ctx.strokeStyle = '#4FB3E0';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 7, y + 14);
      ctx.lineTo(x + 14, y + 7);
      ctx.stroke();
      if (ic.life < 2.5) {
        ctx.strokeStyle = 'rgba(40, 120, 170, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + s * 0.5, y + 4);
        ctx.lineTo(x + s * 0.4, y + s * 0.45);
        ctx.lineTo(x + s * 0.65, y + s * 0.6);
        ctx.lineTo(x + s * 0.55, y + s - 4);
        ctx.stroke();
      }
    });
  }

  function drawWaves() {
    waves.forEach((w) => {
      ctx.fillStyle = 'rgba(46, 157, 247, 0.85)';
      roundRect(w.x, w.y, w.w, w.h, 7);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(w.x + 6 + i * 9, w.y + 3 + Math.sin(time * 12 + i) * 1.5, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawSteams() {
    steams.forEach((s) => {
      const alpha = Math.min(1, s.life / 0.5);
      ctx.fillStyle = `rgba(235, 240, 244, ${0.35 * alpha})`;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      for (let k = 0; k < 3; k++) {
        drawWavyLine(s.x + 8 + k * 12, s.y + 4, s.y + s.h, 4, time * 6 + k * 2, `rgba(255, 255, 255, ${0.9 * alpha})`, 3);
      }
      ctx.fillStyle = `rgba(255, 255, 255, ${0.6 * alpha})`;
      for (let k = 0; k < 3; k++) {
        const py = s.y + 8 - ((time * 30 + k * 10) % 20);
        ctx.beginPath();
        ctx.arc(s.x + 10 + k * 10, py, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawPlayer() {
    const p = player;
    const blink = hurtTimer > 0 && Math.floor(time * 20) % 2 === 0;
    const color = blink ? '#FF3B30' : COLORS.ink;
    const cx = p.x + p.w / 2;
    const top = p.y;
    const moving = Math.abs(p.vx) > 0 && p.onGround;
    const swing = moving ? Math.sin(p.walk) * 6 : 0;

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    // legs
    ctx.beginPath();
    ctx.moveTo(cx, top + 23);
    ctx.lineTo(cx - 5 + swing, top + 34);
    ctx.moveTo(cx, top + 23);
    ctx.lineTo(cx + 5 - swing, top + 34);
    // body
    ctx.moveTo(cx, top + 14);
    ctx.lineTo(cx, top + 23);
    // arms
    ctx.moveTo(cx, top + 17);
    ctx.lineTo(cx + p.facing * 10, top + 21);
    ctx.moveTo(cx, top + 17);
    ctx.lineTo(cx - p.facing * 8, top + 22 - swing * 0.3);
    ctx.stroke();

    // head
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, top + 7, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + p.facing * 3, top + 6, 1.5, 0, Math.PI * 2);
    ctx.fill();

    if (p.hasCan) drawJerryCan(cx + (p.facing > 0 ? 7 : -19), top + 16, 12, 15);
    ctx.lineCap = 'butt';
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawModeIcon(id, x, y, color) {
    if (id === 'liquid') {
      drawDrop(x, y, 9, color);
    } else if (id === 'ice') {
      ctx.fillStyle = color;
      roundRect(x - 8, y - 8, 16, 16, 3);
      ctx.fill();
    } else {
      for (let k = 0; k < 3; k++) drawWavyLine(x - 6 + k * 6, y - 9, y + 9, 2, time * 6 + k, color, 2);
    }
  }

  function drawHUD() {
    const def = LEVELS[levelIndex];

    // Left panel: level, health, time, score
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    roundRect(12, 12, 270, 66, 10);
    ctx.fill();
    ctx.fillStyle = COLORS.navy;
    ctx.font = '600 16px Fredoka, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`Level ${levelIndex + 1}: ${def.name}`, 24, 34);

    ctx.fillStyle = '#E5E7EB';
    roundRect(24, 44, 120, 12, 6);
    ctx.fill();
    const hp = Math.max(0, player.hp);
    ctx.fillStyle = hp > 50 ? '#34C759' : hp > 25 ? '#FFB020' : '#FF3B30';
    if (hp > 0) {
      roundRect(24, 44, Math.max(12, 120 * (hp / 100)), 12, 6);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.ink;
    ctx.font = '500 13px Fredoka, sans-serif';
    ctx.fillText(`HP ${Math.ceil(hp)}`, 150, 55);
    ctx.fillText(`Time ${Math.floor(levelTime)}s`, 24, 72);
    ctx.fillText(`Score ${totalScore}`, 150, 72);

    // Right panel: water modes
    const slotW = 84;
    const startX = W - 12 - slotW * 3 - 12;
    MODE_ORDER.forEach((id, i) => {
      const m = MODES[id];
      const x = startX + i * (slotW + 6);
      const unlocked = def.modes.includes(id);
      const selected = currentMode === id;
      ctx.fillStyle = unlocked ? 'rgba(255, 255, 255, 0.92)' : 'rgba(229, 231, 235, 0.8)';
      roundRect(x, 12, slotW, 54, 10);
      ctx.fill();
      ctx.lineWidth = selected ? 4 : 1.5;
      ctx.strokeStyle = selected ? COLORS.yellow : '#CBD5E1';
      ctx.stroke();
      drawModeIcon(id, x + 18, 34, unlocked ? m.color : '#B6BDC6');
      ctx.fillStyle = unlocked ? COLORS.ink : '#9CA3AF';
      ctx.font = '600 13px Fredoka, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${m.key} ${m.name}`, x + 32, 38);
      ctx.font = '500 10px Fredoka, sans-serif';
      let sub = '';
      if (!unlocked) sub = 'locked';
      else if (id === 'liquid' && !player.hasCan) sub = 'need can';
      else if (id === 'ice') sub = `${ICE_MAX - ices.length} left`;
      if (sub) ctx.fillText(sub, x + 32, 54);
    });

    // Hint at the bottom
    ctx.font = '500 15px Fredoka, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(def.hint).width + 30;
    ctx.fillStyle = 'rgba(0, 51, 102, 0.85)';
    roundRect(W / 2 - tw / 2, H - 40, tw, 28, 14);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(def.hint, W / 2, H - 21);

    // Toast message
    if (toast.time > 0) {
      ctx.globalAlpha = Math.min(1, toast.time / 0.3);
      ctx.font = '600 16px Fredoka, sans-serif';
      const w2 = ctx.measureText(toast.text).width + 36;
      ctx.fillStyle = COLORS.yellow;
      roundRect(W / 2 - w2 / 2, 92, w2, 32, 16);
      ctx.fill();
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(toast.text, W / 2, 113);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  }

  function render() {
    if (state === 'title') {
      drawTitleBackground();
      return;
    }
    drawSky();
    drawTiles();
    drawFlag();
    drawCan();
    drawBlocks();
    drawIces();
    drawWaves();
    drawPlayer();
    drawSteams();
    drawParticles();
    drawHUD();
  }

  // =====================================================
  // Main loop
  // =====================================================
  let last = performance.now();

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    time += dt;
    if (state === 'playing') update(dt);
    render();
    clearPressed();
    requestAnimationFrame(frame);
  }

  showScreen('title');
  requestAnimationFrame(frame);
})();
