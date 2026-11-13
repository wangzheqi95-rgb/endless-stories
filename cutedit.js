// 模特去背圖：自動裁空白 ＋ 手動修圖編輯器（Claude 新增，2026-11-13）
// 1) trimAlpha：把四周透明空白切掉，讓圖剛好包住人，首頁輪播的大小才一致。
// 2) CutEditor：擦除殘渣／從原圖還原誤刪部分，可調筆刷、縮放、復原，存檔後換成新圖。

// 裁掉透明空白：回傳 { blob, ox, oy, w, h }（ox/oy＝裁掉的左、上距離，用來對齊原圖）
async function trimAlpha(blob, padRatio = 0.012) {
  const im = await createImageBitmap(blob); const W = im.width, H = im.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data; let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) { const row = y * W * 4; for (let x = 0; x < W; x++) if (d[row + x * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < 0) return { blob, ox: 0, oy: 0, w: W, h: H };
  const p = Math.round(Math.max(W, H) * padRatio);
  x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p); x1 = Math.min(W - 1, x1 + p); y1 = Math.min(H - 1, y1 + p);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (x0 === 0 && y0 === 0 && w === W && h === H) return { blob, ox: 0, oy: 0, w, h, same: true };
  const o = document.createElement('canvas'); o.width = w; o.height = h; o.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, w, h);
  return { blob: await new Promise(r => o.toBlob(r, 'image/png')), ox: x0, oy: y0, w, h };
}

// 裁空白後上傳；src＝去背前的原圖網址（給「還原筆刷」對位用），ox/oy＝這張在原圖中的位移
async function upCut(blob, src, ox = 0, oy = 0) {
  const t = await trimAlpha(blob);
  const url = await upC(new File([t.blob], 'cutout.png', { type: 'image/png' }));
  return { url, meta: src ? { src, ox: ox + t.ox, oy: oy + t.oy } : null };
}

const CutEditor = {
  open(c, onDone) {
    const bust = s => (s.startsWith('blob:') || s.startsWith('data:')) ? s : s + (s.includes('?') ? '&' : '?') + 'ce=' + Date.now();
    const ld = s => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('讀不到圖片')); i.src = bust(s); });
    const el = document.createElement('div'); el.className = 'ce'; el.innerHTML = '<div class="ce-load">載入中…</div>'; document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    const close = () => { el.remove(); document.body.style.overflow = ''; removeEventListener('keydown', key); };
    let key = () => {};
    (async () => {
      let im, src = null;
      try { im = await ld(c.cutout); } catch (e) { close(); toast('讀不到去背圖：' + e.message); return; }
      if (c.cutMeta && c.cutMeta.src) src = await ld(c.cutMeta.src).catch(() => null);
      const ox = c.cutMeta ? +c.cutMeta.ox || 0 : 0, oy = c.cutMeta ? +c.cutMeta.oy || 0 : 0;
      const W = im.naturalWidth, H = im.naturalHeight;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d'); x.drawImage(im, 0, 0);
      try { x.getImageData(0, 0, 1, 1); } catch (e) { close(); toast('這張圖的來源不允許編輯（跨網域限制）。請改用上方照片重新去背後再修。'); return; }
      el.innerHTML = `<div class="ce-bar">
        <div class="ce-seg"><button data-ce="erase" class="on">擦除</button><button data-ce="restore" ${src ? '' : 'disabled title="這張沒有原圖可還原（直接上傳的 PNG 或舊資料）。要用還原，請從上方照片重新去背。"'}>還原</button></div>
        <label>筆刷 <input type="range" id="ce_size" min="4" max="160" value="36"></label>
        <label>縮放 <input type="range" id="ce_zoom" min="50" max="400" value="100"></label>
        ${src ? '<label class="ce-chk"><input type="checkbox" id="ce_ghost" checked> 原圖淡影</label>' : ''}
        <label class="ce-chk">底色 <select id="ce_bg"><option value="checker">格子</option><option value="#ffffff">白</option><option value="#17181a">黑</option><option value="#e3e4e7">灰</option></select></label>
        <button data-ce="undo" title="Cmd/Ctrl + Z">復原</button>
        <span class="ce-sp"></span><button data-ce="cancel">取消</button><button data-ce="save" class="wine">儲存</button></div>
        <div class="ce-tip">擦除：塗掉殘渣、浮水印、多出來的背景。還原：把被誤刪的衣角、髮絲從原圖補回來（淡影就是原圖位置）。滑鼠滾輪可上下捲動，放大後拖曳捲軸移動。</div>
        <div class="ce-wrap"><div class="ce-stage checker">${src ? '<img class="ce-ghost" alt="">' : ''}</div><div class="ce-ring"></div></div>`;
      const stage = el.querySelector('.ce-stage'), wrap = el.querySelector('.ce-wrap'), ring = el.querySelector('.ce-ring'), ghost = el.querySelector('.ce-ghost');
      stage.appendChild(cv);
      if (ghost) { ghost.src = src.src; }
      let mode = 'erase', size = 36, zoom = 1, undo = [];
      const fit = () => Math.min((wrap.clientHeight - 24) / H, (wrap.clientWidth - 24) / W, 1.5);
      const layout = () => { const k = fit() * zoom, dw = Math.round(W * k), dh = Math.round(H * k);
        stage.style.width = dw + 'px'; stage.style.height = dh + 'px'; cv.style.width = dw + 'px'; cv.style.height = dh + 'px';
        if (ghost) { ghost.style.width = (src.naturalWidth * k) + 'px'; ghost.style.left = (-ox * k) + 'px'; ghost.style.top = (-oy * k) + 'px'; }
        ring.style.width = ring.style.height = size + 'px'; };
      layout(); addEventListener('resize', layout);
      const toCanvas = e => { const r = cv.getBoundingClientRect(), k = W / r.width; return { px: (e.clientX - r.left) * k, py: (e.clientY - r.top) * k, k }; };
      const dab = (px, py, rad) => {
        if (mode === 'erase') { x.save(); x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill(); x.restore(); }
        else if (src) { x.save(); x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.clip(); x.clearRect(px - rad, py - rad, rad * 2, rad * 2); x.drawImage(src, -ox, -oy); x.restore(); }
      };
      let down = false, last = null;
      cv.addEventListener('pointerdown', e => { if (mode === 'restore' && !src) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); down = true;
        undo.push(x.getImageData(0, 0, W, H)); if (undo.length > 15) undo.shift();
        const p = toCanvas(e); last = p; dab(p.px, p.py, size / 2 * p.k); });
      cv.addEventListener('pointermove', e => { ring.style.transform = `translate(${e.clientX - wrap.getBoundingClientRect().left + wrap.scrollLeft - size / 2}px,${e.clientY - wrap.getBoundingClientRect().top + wrap.scrollTop - size / 2}px)`; ring.style.opacity = 1;
        if (!down) return; const p = toCanvas(e), rad = size / 2 * p.k, dx = p.px - last.px, dy = p.py - last.py, dist = Math.hypot(dx, dy), step = Math.max(1, rad / 3);
        for (let s = step; s <= dist; s += step) dab(last.px + dx * s / dist, last.py + dy * s / dist, rad);
        last = p; });
      const up = () => { down = false; last = null; };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', () => { ring.style.opacity = 0; });
      const doUndo = () => { const s = undo.pop(); if (s) x.putImageData(s, 0, 0); };
      key = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); } if (e.key === 'Escape') { close(); } };
      addEventListener('keydown', key);
      el.addEventListener('input', e => {
        if (e.target.id === 'ce_size') { size = +e.target.value; ring.style.width = ring.style.height = size + 'px'; }
        if (e.target.id === 'ce_zoom') { zoom = +e.target.value / 100; layout(); }
      });
      el.addEventListener('change', e => {
        if (e.target.id === 'ce_ghost' && ghost) ghost.style.display = e.target.checked ? '' : 'none';
        if (e.target.id === 'ce_bg') { const v = e.target.value; stage.classList.toggle('checker', v === 'checker'); stage.style.background = v === 'checker' ? '' : v; }
      });
      el.addEventListener('click', async e => { const b = e.target.closest('[data-ce]'); if (!b || b.disabled) return; const a = b.dataset.ce;
        if (a === 'erase' || a === 'restore') { mode = a; el.querySelectorAll('.ce-seg button').forEach(z => z.classList.toggle('on', z === b)); ring.classList.toggle('restore', a === 'restore'); }
        if (a === 'undo') doUndo();
        if (a === 'cancel') close();
        if (a === 'save') { b.disabled = true; b.textContent = '儲存中…';
          try { const blob = await new Promise(r => cv.toBlob(r, 'image/png')); const t = await trimAlpha(blob);
            const url = await upC(new File([t.blob], 'cutout.png', { type: 'image/png' }));
            c.cutout = url; c.cutMeta = src ? { src: c.cutMeta.src, ox: ox + t.ox, oy: oy + t.oy } : null;
            close(); toast('已儲存修圖'); onDone && onDone(); }
          catch (err) { b.disabled = false; b.textContent = '儲存'; toast('儲存失敗：' + (err.message || err)); } }
      });
    })();
  }
};
