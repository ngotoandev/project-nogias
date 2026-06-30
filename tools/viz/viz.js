// Dev visualizer: drives the real Sim (dist/sim-bundle.js) and draws RunState to a canvas.
// Nothing here re-implements game logic — it only calls Sim.initRun / Sim.runTick and renders
// the returned state. This is the same Sim.* contract the Godot client will use.
'use strict';
(function () {
  const Sim = globalThis.Sim;
  if (!Sim || !Sim.initRun) { document.body.innerHTML = '<p style="padding:20px">Could not load <code>dist/sim-bundle.js</code> — run <code>npm run bundle</code> first.</p>'; return; }

  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const THRESH = globalThis.VIZ_TRAVEL_THRESHOLD || 100;

  // colors
  const OWNER = { player: '#1d3b2a', enemy: '#3b1d22', neutral: '#262a31' };
  const OWNER_LINE = { player: '#4f9e6e', enemy: '#b5564d', neutral: '#4a515c' };
  const STATE = { garrisoned: '#5b8def', travelling: '#e7c061', contested: '#ef8a4a', retreating: '#b07ad0' };
  const TYPE_TAG = { boss: '★BOSS', rest: 'REST+', muster: 'MUSTER', boon: 'BOON+', cache: 'CACHE', start: 'start', enemy: 'enemy' };

  // state
  let run = null, layout = {}, rects = {}, selected = null, pending = [], timer = null;

  const CW = 168, CH = 150, BOX_W = 132, BOX_H = 96, PAD = 28;

  function start() {
    const name = $('setup').value;
    const seed = parseInt($('seed').value, 10) || 0;
    run = Sim.initRun(JSON.parse(JSON.stringify(SETUPS[name])), seed); // deep-copy: setups are reused
    layout = computeLayout(run.map.tiles);
    selected = null; pending = []; stopAuto();
    render();
  }

  function tick() {
    if (!run || run.status !== 'active') { stopAuto(); return; }
    const cmds = pending; pending = [];
    Sim.runTick(run, cmds);
    if (run.status !== 'active') stopAuto();
    render();
  }

  function stopAuto() { if (timer) { clearInterval(timer); timer = null; } $('auto').classList.remove('on'); $('auto').textContent = 'Auto ▶'; }
  function toggleAuto() {
    if (timer) { stopAuto(); return; }
    if (!run || run.status !== 'active') return;
    timer = setInterval(tick, parseInt($('speed').value, 10));
    $('auto').classList.add('on'); $('auto').textContent = 'Auto ⏸';
  }

  // ── geometry ───────────────────────────────────────────────────────────────
  function bounds() {
    let minX = Infinity, minY = Infinity;
    for (const id in layout) { minX = Math.min(minX, layout[id].x); minY = Math.min(minY, layout[id].y); }
    return { minX: minX === Infinity ? 0 : minX, minY: minY === Infinity ? 0 : minY };
  }
  function tileCenter(id) {
    const b = bounds(), g = layout[id]; if (!g) return { x: 60, y: 60 };
    return { x: PAD + (g.x - b.minX) * CW + BOX_W / 2, y: PAD + (g.y - b.minY) * CH + BOX_H / 2 };
  }

  // ── render ───────────────────────────────────────────────────────────────────
  function render() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    rects = {};
    const m = run.map;
    // tiles
    for (const t of m.tiles) {
      const c = tileCenter(t.id), x = c.x - BOX_W / 2, y = c.y - BOX_H / 2;
      rects[t.id] = { x: x, y: y, w: BOX_W, h: BOX_H };
      ctx.fillStyle = OWNER[t.owner] || '#262a31';
      ctx.strokeStyle = OWNER_LINE[t.owner] || '#4a515c';
      ctx.lineWidth = 2; roundRect(x, y, BOX_W, BOX_H, 8); ctx.fill(); ctx.stroke();
      // dispatch-target highlight
      if (selected && t.owner !== 'player') { ctx.strokeStyle = '#e7c061'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); roundRect(x + 3, y + 3, BOX_W - 6, BOX_H - 6, 6); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = '#cfd6df'; ctx.font = '700 13px ui-monospace, monospace'; ctx.textBaseline = 'top';
      ctx.fillText(t.id, x + 8, y + 7);
      ctx.fillStyle = t.type === 'boss' ? '#f0c14b' : '#8b97a8'; ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(TYPE_TAG[t.type] || t.type, x + 8, y + 24);
      if (t.garrison && t.garrison.length) { ctx.fillStyle = '#d98c84'; ctx.fillText('def ×' + t.garrison.length, x + 8, y + 41); }
      const extra = []; if (t.muster && t.muster.length) extra.push('+army'); if (t.boon) extra.push('+' + t.boon.amount + ' ' + t.boon.attr);
      if (extra.length) { ctx.fillStyle = '#7fd0a0'; ctx.fillText(extra.join(' '), x + 8, y + 58); }
    }
    // armies (interpolated while moving)
    const byTile = {}; m.armies.forEach((a) => { (byTile[a.tile] = byTile[a.tile] || []).push(a); });
    for (const a of m.armies) {
      let p;
      if ((a.state === 'travelling' || a.state === 'retreating') && a.route && a.route.length) {
        const from = tileCenter(a.tile), to = tileCenter(a.route[0]), f = Math.max(0, Math.min(1, a.travelGauge / THRESH));
        p = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
      } else {
        const grp = byTile[a.tile], i = grp.indexOf(a);
        const c = tileCenter(a.tile); p = { x: c.x - 18 + i * 20, y: c.y + 30 };
      }
      const wounded = a.units.some((u) => u.startHp != null);
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7);
      ctx.fillStyle = STATE[a.state] || '#888'; ctx.fill();
      if (selected === a.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke(); }
      ctx.fillStyle = '#0e1116'; ctx.font = '700 11px ui-monospace, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText('' + a.units.length, p.x, p.y); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#cfd6df'; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(a.id + (wounded ? ' ♥' : ''), p.x + 14, p.y - 6);
    }
    drawBattles();
    sidebar();
  }

  function drawBattles() {
    const bs = run.map.battles || []; if (!bs.length) return;
    const b = bs[0], f = b.fight, W = 180, H = 180, ox = cv.width - W - 12, oy = 12, n = f.grid.width || 8, cell = (W - 16) / n;
    ctx.fillStyle = 'rgba(10,13,18,.92)'; ctx.strokeStyle = '#ef8a4a'; ctx.lineWidth = 1.5;
    roundRect(ox, oy, W, H + 22, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ef8a4a'; ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillText('FIGHT @ ' + b.tile + '  t' + f.totalTicks + (bs.length > 1 ? '  (+' + (bs.length - 1) + ')' : ''), ox + 8, oy + 5);
    const gx = ox + 8, gy = oy + 22;
    ctx.strokeStyle = '#222831'; ctx.lineWidth = 1;
    for (let i = 0; i <= n; i++) { line(gx + i * cell, gy, gx + i * cell, gy + n * cell); line(gx, gy + i * cell, gx + n * cell, gy + i * cell); }
    for (const u of f.units) {
      if (u.hp <= 0 || u.exited) continue;
      const cx = gx + (u.pos.x + 0.5) * cell, cy = gy + (u.pos.y + 0.5) * cell;
      ctx.beginPath(); ctx.arc(cx, cy, cell * 0.32, 0, 7);
      ctx.fillStyle = u.side === 'A' ? '#5b8def' : '#ef6a5e'; ctx.fill();
      const frac = Math.max(0, Math.min(1, u.hp / (u.derived ? u.derived.maxHp : u.hp)));
      ctx.fillStyle = '#0e1116'; ctx.fillRect(cx - cell * 0.34, cy + cell * 0.34, cell * 0.68, 3);
      ctx.fillStyle = frac > 0.5 ? '#5fd08a' : frac > 0.25 ? '#e7c061' : '#f0736a';
      ctx.fillRect(cx - cell * 0.34, cy + cell * 0.34, cell * 0.68 * frac, 3);
    }
  }

  // ── sidebar ────────────────────────────────────────────────────────────────
  function sidebar() {
    const m = run.map;
    const st = $('status'); st.textContent = run.status.toUpperCase(); st.className = 's-' + run.status;
    $('meta').textContent = 'tick ' + m.totalTicks + ' · armies ' + m.armies.length + ' · battles ' + (m.battles ? m.battles.length : 0);
    $('sel').innerHTML = selected
      ? 'Selected <b>' + selected + '</b>. Click a non-owned tile to dispatch (or an owned army to reselect).'
      : '<span class="hint">Click one of your armies, then a target tile to dispatch.</span>';
    // roster
    $('roster').innerHTML = m.armies.map((a) => {
      const hp = a.units.map((u) => (u.startHp != null ? u.startHp : '·')).join('/');
      return '<div>' + (a.id === selected ? '▸ ' : '') + '<b>' + a.id + '</b> [' + a.tile + ' ' + a.state + (a.target ? '→' + a.target : '') + '] ×' + a.units.length + ' <span class="hint">♥' + hp + '</span></div>';
    }).join('') || '<span class="hint">no armies</span>';
    // events (tail)
    const evs = m.events.slice(-16).reverse().map((e) => '<div class="ev">' + fmtEv(e) + '</div>').join('');
    $('log').innerHTML = evs;
    // buttons
    const done = run.status !== 'active';
    $('step').disabled = done; $('auto').disabled = done; $('extract').disabled = done;
  }

  function fmtEv(e) {
    switch (e.t) {
      case 'dispatched': return '<b>' + e.armyId + '</b> → ' + e.toTile;
      case 'hopped': return e.armyId + ' moved ' + e.from + '→' + e.to;
      case 'captured': return '✔ <b>' + e.tile + '</b> captured by ' + e.by;
      case 'battleOpened': return '⚔ battle @ ' + e.tile + ' (' + e.attackers.join(',') + ')';
      case 'reinforced': return '+ ' + e.armyId + ' joined @ ' + e.tile;
      case 'repelled': return '✗ repelled @ ' + e.tile;
      case 'retreated': return e.armyId + ' retreated → ' + e.to;
      case 'slotFreed': return 'slot freed @ ' + e.tile + ' (' + e.armyId + ')';
      case 'rejected': return '⃠ ' + e.armyId + ': ' + e.reason;
      default: return JSON.stringify(e);
    }
  }

  // ── input ────────────────────────────────────────────────────────────────────
  cv.addEventListener('click', (ev) => {
    if (!run) return;
    const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    let hit = null;
    for (const id in rects) { const q = rects[id]; if (x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) { hit = id; break; } }
    if (!hit) { selected = null; render(); return; }
    const tile = run.map.tiles.find((t) => t.id === hit);
    if (selected && tile.owner !== 'player') {
      pending.push({ t: 'dispatch', armyId: selected, toTile: hit }); // sim validates (rejects if busy/unreachable)
      selected = null;
    } else {
      const here = run.map.armies.filter((a) => a.tile === hit);
      if (here.length) { const i = here.findIndex((a) => a.id === selected); selected = here[(i + 1) % here.length].id; }
      else selected = null;
    }
    render();
  });

  $('new').addEventListener('click', start);
  $('step').addEventListener('click', tick);
  $('auto').addEventListener('click', toggleAuto);
  $('extract').addEventListener('click', () => { pending.push({ t: 'extract' }); tick(); });
  $('speed').addEventListener('change', () => { if (timer) { stopAuto(); toggleAuto(); } });

  // helpers
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function line(a, b, c, d) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }

  start();
})();
