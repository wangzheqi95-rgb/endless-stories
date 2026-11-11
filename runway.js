// Runway（Claude 新增，2026-11-09）：首頁 3D 環狀模特輪播，取代原本的 banner／衣竿／衣櫃。
// 規格來源：使用者提供的「Try the Look — Runway」規格；數值照規格，外觀改成 ES 的顏色與字體。
// 一格＝一件商品（商品的「模特去背圖」cutout_url）。右側面板：名稱、價格、尺寸、加入購物袋。
// 桌機（≥750px）＝ring 環狀；手機＝classic 斜線排列（手機版尚未細修）。
const Runway = (() => {
  const RED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const K = 95, C = 2 * Math.sqrt(K), LAG = 0.04, SPEED = 5000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = n => String(n).padStart(2, '0');
  const wrapPi = a => { a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a; };

  let root, stage, actors, ticksEl, panelEl, liveEl, autoBtn, walkEl;
  let items = [], n = 0, N = 0, bodies = [];
  let index = 0, target = 0, cur = 0, vel = 0, still = false;
  let raf = 0, last = 0, visible = true, playing = false, timer = 0, dragging = false, panelHover = false, engaged = false;
  let W = 0, H = 0, unit = 120, fs = 1, mobile = false, vh = innerHeight, lastW = innerWidth;
  let onPick = null;   // (p, size, act) => void   act: 'bag' | 'detail'

  // ── 標記 ──
  function build() {
    root.innerHTML = `<div class="rw__grid">
      <div class="rw__left">
        <div class="rw__head"><div class="rw__intro"><h2 class="rw__title">Try the Look<span>*</span></h2><p class="rw__sub">${n} 款新品，整身穿搭。左右拖曳或點兩側模特瀏覽。</p></div><span class="rw__sr" aria-live="polite" aria-atomic="true"></span></div>
        <div class="rw__stage" tabindex="0" role="region" aria-roledescription="carousel" aria-label="本季穿搭 — 左右鍵或滑動切換"><div class="rw__actors"></div><span class="rw__sweep"></span><span class="rw__walk"><span class="rw__walk-line"></span></span></div>
        <div class="rw__controls">
          <button class="rw__icon" data-rw-prev aria-label="上一個"><svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M25 7H1M7 1L1 7l6 6"/></svg></button>
          <div class="rw__ticks">${items.map((it, i) => `<button class="rw__tick" data-rw-tick="${i}" aria-current="${i === 0}" aria-label="第 ${i + 1} 款：${esc(it.p.name)}"><span class="rw__tick-bar"></span><span class="rw__tick-label">${pad2(i + 1)}<span class="rw__tick-name">&nbsp;&nbsp;${esc(it.p.name)}</span></span></button>`).join('')}</div>
          <button class="rw__icon rw__auto" data-rw-auto aria-pressed="false" aria-label="自動播放"><svg class="rw__play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z"/></svg><svg class="rw__pause" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 4.5h3.5v15H6.5zM14 4.5h3.5v15H14z"/></svg></button>
          <button class="rw__icon" data-rw-next aria-label="下一個"><svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7h24M19 1l6 6-6 6"/></svg></button>
        </div>
      </div>
      <aside class="rw__panel"><div class="rw__panel-inner"><div class="rw__panel-head"><h3 class="rw__panel-title">This look</h3><span class="rw__label" data-rw-count></span></div><div class="rw__look"></div></div></aside>
    </div>`;
    stage = root.querySelector('.rw__stage'); actors = root.querySelector('.rw__actors'); ticksEl = root.querySelector('.rw__ticks');
    panelEl = root.querySelector('.rw__panel'); liveEl = root.querySelector('.rw__sr'); autoBtn = root.querySelector('[data-rw-auto]'); walkEl = root.querySelector('.rw__walk-line');
    // 人物：N 個 body，第 a 個顯示第 a mod n 件
    N = n * Math.ceil(8 / n); bodies = [];
    for (let a = 0; a < N; a++) {
      const it = items[a % n], el = document.createElement('div');
      el.className = 'rw__model'; el.dataset.index = a; el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `<span class="rw__shadow"></span><div class="rw__figure"><div class="rw__art"><img src="${esc(it.img)}" alt="${esc(it.p.name)}" draggable="false" decoding="async" ${a >= n ? 'loading="lazy"' : ''}><button class="rw__hit" data-rw-go="${a}" aria-label="第 ${a % n + 1} 款：${esc(it.p.name)}" tabindex="-1"></button></div></div>`;
      const img = el.querySelector('img'); (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => img.classList.add('is-decoded'));
      actors.appendChild(el); bodies.push({ el, art: el.querySelector('.rw__art'), w: 0, x: 0, g: 0, v: 0, from: 0, trip: false, blur: -1 });
    }
    items.forEach((it, i) => probeFeet(it.img, i));
  }

  // 腳底偵測：找圖片最底下有像素的那一列，讓鞋底貼地（規格 14）
  function probeFeet(src, i) {
    try {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => { try {
        const w = 48, h = Math.max(1, Math.round(w * im.naturalHeight / im.naturalWidth)); const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data; let lastRow = h - 1;
        for (let y = h - 1; y >= 0; y--) { let hit = false; for (let px = 0; px < w; px++) if (d[(y * w + px) * 4 + 3] > 40) { hit = true; break; } if (hit) { lastRow = y; break; } }
        const foot = Math.min(0.4, Math.max(0, (h - 1 - lastRow) / h));
        bodies.forEach((b, a) => { if (a % n === i) b.art.style.setProperty('--rw-foot', foot.toFixed(3)); });
      } catch (e) {} };
      im.src = src;
    } catch (e) {}
  }

  // ── 量測 ──
  function measure() {
    mobile = innerWidth < 750;
    if (Math.abs(innerHeight - vh) >= 160 || innerWidth !== lastW) { vh = innerHeight; lastW = innerWidth; }
    const headerH = (document.querySelector('.es-header') || {}).offsetHeight || 0;
    const frameH = mobile ? Math.round(vh * 1.09) : Math.max(380, innerHeight - headerH);
    root.style.setProperty('--rw-frame-h', frameH + 'px');
    const r = stage.getBoundingClientRect(); W = r.width; H = r.height;
    fs = mobile ? 1 : 1.08; root.style.setProperty('--rw-fs', fs);
    const modelH = mobile ? Math.max(200, Math.round(H - 24 - 18)) : Math.max(200, Math.round((H - 34 - 18) / 1.08));
    stage.style.setProperty('--rw-model-h', modelH + 'px');
    unit = mobile ? Math.max(90, W * 0.32 * 1.6) : Math.max(120, 0.3 * W);
    bodies.forEach(b => { b.w = b.el.offsetWidth || modelH * 0.5625; });
    kick();
  }

  // ── 擺放 ──
  function put(s, x, bottom, scale, op, blur, z) {
    if (x + s.w * scale / 2 < -4 || x - s.w * scale / 2 > W + 4) op = 0;
    const st = s.el.style;
    st.transform = `translate3d(${x}px,${-bottom}px,0) translateX(-50%) scale(${scale})`;
    st.opacity = op.toFixed(3); st.zIndex = z; st.visibility = op < 0.01 ? 'hidden' : 'visible'; st.pointerEvents = op < 0.5 ? 'none' : '';
    const b = Math.round(blur * 10) / 10; if (b !== s.blur) { s.blur = b; st.filter = b <= 0.05 ? '' : `blur(${b}px)`; }
  }
  function renderRing() {
    const cx = 0.5 * W, R = 0.62 * W, P = 1.65 * W, floor = H - 34, horizon = 0.36 * H, step = 2 * Math.PI / N;
    bodies.forEach((s, a) => {
      const phi = wrapPi((a - cur) * step), z = R * (1 - Math.cos(phi)), persp = P / (P + z), sl = Math.abs(phi) / step;
      const scale = persp * (1 + (fs - 1) * Math.min(1, Math.max(0, 1 - sl)));
      const x = cx + R * Math.sin(phi) * persp, feet = horizon + (floor - horizon) * persp;
      const blur = sl <= 1 ? 1.8 * sl : Math.min(1.8 + (sl - 1) * 2, 6.5);
      const op = Math.min(1, Math.max(0, (Math.cos(phi) + 0.55) / 0.3));
      put(s, x, H - feet, scale, op, blur, Math.round(scale * 1000));
      s.el.classList.toggle('is-front', sl < 0.5);
    });
  }
  function renderClassic(dt) {
    const ax = 0.3, ay = 22, sx = 0.32, sy = 22, sr = 0.76, ex = 0.55, d = 4;
    bodies.forEach((s, a) => {
      const goal = ((a - target) % N + N) % N;
      if (s.goalPrev !== undefined && Math.abs(goal - s.goalPrev) > N / 2) { s.trip = true; s.from = s.x; }
      s.goalPrev = goal;
      if (RED) { s.x = goal; s.g = goal; s.v = 0; } else {
        const tau = dragging ? 0.016 : s.trip ? 0.1 : 0.03 + LAG * Math.min(goal, 4);
        s.g += (goal - s.g) * (1 - Math.exp(-dt / tau));
        const h = dt / 3; for (let i = 0; i < 3; i++) { const acc = -K * (s.x - s.g) - C * s.v; s.v += acc * h; s.x += s.v * h; }
        if (Math.abs(s.x - s.g) < 0.0006 && Math.abs(s.v) < 0.0006) { s.x = s.g; s.v = 0; }
      }
      if (s.trip && Math.abs(s.x - goal) < 0.02) s.trip = false;
      let k = s.x, e = -1;
      if (s.trip) { const u = Math.abs(s.x - s.from) / Math.max(1e-6, Math.abs(goal - s.from));
        if (goal > s.from) { if (u < 0.5) e = 2 * u * 1.4; else k = goal + 2 * (1 - u); }
        else { if (u < 0.5) k = s.from + 2 * u; else e = 2 * (1 - u) * 1.4; } }
      else if (k < 0) e = Math.min(-k, 1.4);
      if (e >= 0) put(s, W * (ax - ex * e), ay - 22 * e, 1 + 0.14 * e, Math.max(0, 1 - 1.05 * e), 4 * Math.min(e, 1), 1100);
      else { const op = k <= d - 1 ? 1 - 0.13 * k : Math.max(0, 0.61 * (4 - k)); put(s, W * (ax + sx * k), ay + sy * k, Math.pow(sr, k), op, Math.min(0.9 * k, 3.2), 1000 - Math.round(10 * k)); }
      s.el.classList.toggle('is-front', Math.abs(k) < 0.5 && e < 0);
    });
  }
  function settledClassic() { return bodies.every(s => Math.abs(s.x - s.g) < 0.001 && Math.abs(s.v) < 0.001 && Math.abs(s.g - (((s.goalPrev || 0)))) < 0.001); }

  // ── 迴圈 ──
  function loop(t) {
    raf = 0; const dt = last ? Math.min(0.034, (t - last) / 1000) : 1 / 60; last = t;
    let moving;
    if (mobile) { renderClassic(dt); moving = !settledClassic(); }
    else {
      if (RED) { cur = target; vel = 0; } else { const h = dt / 3; for (let i = 0; i < 3; i++) { const acc = -K * (cur - target) - C * vel; vel += acc * h; cur += vel * h; } }
      if (Math.abs(cur - target) <= 0.0005 && Math.abs(vel) <= 0.0005) { cur = target; vel = 0; }
      renderRing(); moving = cur !== target;
    }
    setStill(!moving && !dragging);
    if ((moving || dragging) && visible && !document.hidden) raf = requestAnimationFrame(loop); else last = 0;
  }
  function kick() { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(loop); } }
  function setStill(v) { if (still === v) return; still = v; root.classList.toggle('rw--still', v); }

  // ── 切換 ──
  function setIndex(i, silent) {
    const changed = i !== index; index = i;
    root.style.setProperty('--rw-progress', ((i + 1) / n).toFixed(3));
    ticksEl.querySelectorAll('.rw__tick').forEach((t, j) => { t.setAttribute('aria-current', j === i); t.classList.toggle('is-past', j < i); });
    bodies.forEach((b, a) => { const k = mobile ? ((a - index) % N + N) % N : Math.abs(wrapK(a - index)); const hit = b.el.querySelector('.rw__hit'); const on = k !== 0 && k <= (mobile ? 3 : 2); hit.tabIndex = on ? 0 : -1; b.el.setAttribute('aria-hidden', on ? 'false' : 'true'); });
    renderPanel(i, !silent);
    if (!silent && changed) { liveEl.textContent = `第 ${i + 1} 款：${items[i].p.name}`; if (!RED) { stage.classList.remove('is-sweep'); void stage.offsetWidth; stage.classList.add('is-sweep'); } }
    restartBar();
  }
  const wrapK = a => { let k = ((a % N) + N) % N; if (k > N / 2) k -= N; return k; };
  function moveTo(T) { target = T; setStill(false); setIndex(((Math.round(T) % n) + n) % n); kick(); }
  const next = () => moveTo(Math.round(target) + 1), prev = () => moveTo(Math.round(target) - 1);
  function go(i) { let d = ((i - index) % n + n) % n; if (d > n / 2) d -= n; moveTo(Math.round(target) + d); }

  // ── 自動播放 ──
  function play(v) { playing = v; root.classList.toggle('is-playing', v); autoBtn.setAttribute('aria-pressed', String(v)); restartBar(); }
  function restartBar() {
    clearTimeout(timer);
    ticksEl.querySelectorAll('.rw__tick').forEach(t => t.classList.remove('is-run'));
    if (playing) { const t = ticksEl.children[index]; if (t) { void t.offsetWidth; t.classList.add('is-run'); } }
    timer = setTimeout(() => { if (playing && visible && !dragging && !document.hidden && !panelHover && !engaged) next(); else restartBar(); }, SPEED);
  }
  function engage() { if (engaged) return; engaged = true; play(false); }

  // ── 右側面板（一件商品）──
  function renderPanel(i, replay) {
    const p = items[i].p, look = root.querySelector('.rw__look'), sizes = (p.sizes || []).filter(Boolean);
    root.querySelector('[data-rw-count]').textContent = pad2(i + 1) + ' / ' + pad2(n);
    look.innerHTML = `<div class="rw__item">
      <span class="rw__type">${esc(p.category || '')}${p.sku ? '　' + esc(p.sku) : ''}</span>
      <h4 class="rw__name">${esc(p.name)}</h4>
      ${p.sub ? `<p class="rw__psub">${esc(p.sub)}</p>` : ''}
      <div class="rw__price">NT$ ${(p.price || 0).toLocaleString()}</div>
      ${sizes.length ? `<fieldset class="rw__opt"><legend class="rw__opt-name">尺寸</legend><div class="rw__pills">${sizes.map((s, k) => `<label class="rw__pill"><input type="radio" name="rw-size" value="${esc(s)}" ${sizes.length === 1 && k === 0 ? 'checked' : ''}><span class="rw__pill-label">${esc(s)}</span></label>`).join('')}</div></fieldset>` : ''}
      <p class="rw__msg" role="status" aria-live="polite"></p>
      <button class="rw__confirm" data-rw-bag><span>加入購物袋</span></button>
      <button class="rw__more" data-rw-detail>查看商品細節 →</button>
    </div>`;
    if (replay && !RED) { look.classList.remove('is-in'); void look.offsetWidth; look.classList.add('is-in'); } else look.classList.add('is-in');
  }

  // ── 事件 ──
  function bind() {
    root.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('[data-rw-next]')) return next();
      if (t.closest('[data-rw-prev]')) return prev();
      const tk = t.closest('[data-rw-tick]'); if (tk) return go(+tk.dataset.rwTick);
      if (t.closest('[data-rw-auto]')) { if (!playing) engaged = false; return play(!playing); }
      const g = t.closest('[data-rw-go]'); if (g) { const a = +g.dataset.rwGo; const k = mobile ? ((a - target) % N + N) % N : wrapK(a - Math.round(target)); if (k !== 0 && Math.abs(k) < 6) moveTo(Math.round(target) + k); else if (onPick) onPick(items[index].p, null, 'detail'); return; }
      if (t.closest('[data-rw-detail]')) { engage(); if (onPick) onPick(items[index].p, null, 'detail'); return; }
      if (t.closest('[data-rw-bag]')) { engage(); const p = items[index].p, sizes = (p.sizes || []).filter(Boolean), sel = root.querySelector('input[name="rw-size"]:checked');
        const msg = root.querySelector('.rw__msg'); if (sizes.length > 1 && !sel) { msg.textContent = '請先選尺寸'; return; } msg.textContent = '';
        if (onPick) onPick(p, sel ? sel.value : (sizes[0] || 'Free'), 'bag'); return; }
    });
    panelEl.addEventListener('change', engage); panelEl.addEventListener('click', e => { if (e.target.closest('button,a,input,label')) engage(); });
    panelEl.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') panelHover = true; });
    panelEl.addEventListener('pointerleave', () => { panelHover = false; restartBar(); });
    stage.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); next(); } if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); } });
    // 拖曳／滑動
    let sx = 0, sy = 0, t0 = 0, pid = null, samples = [], drag = false, abandoned = false;
    stage.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; sx = e.clientX; sy = e.clientY; t0 = target; pid = e.pointerId; samples = [{ x: e.clientX, t: performance.now() }]; drag = false; abandoned = false; });
    stage.addEventListener('pointermove', e => { if (pid !== e.pointerId || abandoned) return; const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!drag) { if (Math.abs(dy) > 10 && Math.abs(dx) <= 8) { abandoned = true; return; } if (Math.abs(dx) > 8 && Math.abs(dx) > 1.2 * Math.abs(dy)) { drag = true; dragging = true; root.classList.add('is-dragging'); try { stage.setPointerCapture(pid); } catch (x) {} } else return; }
      if (e.pointerType === 'mouse' && e.buttons === 0) return end(e);
      samples.push({ x: e.clientX, t: performance.now() }); if (samples.length > 6) samples.shift();
      target = t0 - dx / unit; kick(); });
    const end = e => { if (pid !== e.pointerId) return; pid = null; if (!drag) return; drag = false; dragging = false; root.classList.remove('is-dragging');
      const f = samples[0], l = samples[samples.length - 1], vx = l.t > f.t ? (l.x - f.x) / (l.t - f.t) : 0, dx = e.clientX - sx, from = Math.round(t0);
      if (mobile) { if (Math.abs(dx) > 30 || Math.abs(vx) > 0.3) moveTo(from + (dx > 0 ? -1 : 1)); else moveTo(from); }
      else { let i = Math.round(target + -vx * 160 / unit); if (i === from && Math.abs(vx) > 0.3) i = from + (vx < 0 ? 1 : -1); i = Math.max(from - 2, Math.min(from + 2, i)); moveTo(i); }
      suppressClick = performance.now() + 60; };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    let suppressClick = 0; root.addEventListener('click', e => { if (performance.now() < suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
    // 觸控板橫向
    let acc = 0, lock = 0; stage.addEventListener('wheel', e => { if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; e.preventDefault(); if (performance.now() < lock) return; acc += e.deltaX; if (Math.abs(acc) > 45) { acc > 0 ? next() : prev(); acc = 0; lock = performance.now() + 520; } }, { passive: false });
    // 可見性
    new IntersectionObserver(en => { visible = en[0].isIntersecting; if (visible) kick(); }, { threshold: 0 }).observe(root);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { kick(); restartBar(); } });
    let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(measure, 120); });
    if ('ResizeObserver' in window) new ResizeObserver(() => measure()).observe(stage);
    // 進場
    const io = new IntersectionObserver(en => { if (!en[0].isIntersecting) return; io.disconnect(); requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-revealed'))); }, { threshold: 0, rootMargin: '0px 0px -22% 0px' });
    if (RED) root.classList.add('is-revealed'); else { io.observe(root); setTimeout(() => root.classList.add('is-revealed'), 1500); }   // 保險：觀察器沒觸發也要出現
  }

  function init(el, list, opts = {}) {
    root = el; onPick = opts.onPick || null; items = list.slice(0, 8); n = items.length;
    if (!n) { root.hidden = true; return; }
    root.hidden = false; root.classList.add('rw', 'rw--js'); build(); bind(); measure();
    cur = RED ? 0 : -1.15; target = 0; bodies.forEach((s, a) => { s.goalPrev = a; s.g = a; s.x = RED ? a : a + 1.15; });
    setIndex(0, true); kick();
    if (!RED) play(true);
  }
  return { init, next, prev, go };
})();
