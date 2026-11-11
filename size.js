// 找我的尺碼：右側滑出面板（手機全螢幕）。三步：①版型＋身高體重 ②三圍（選填）③鬆緊偏好＋結果。
// 尺碼推薦僅限會員：訪客不能使用、也不保存任何身高體重；登入後資料存在會員帳號（member_profiles）。僅為示意，不構成保證。
const ESSize = (() => {
  const KEY = 'es_body';
  const isMem = () => typeof Member !== 'undefined' && Member.isIn();
  const DEF = { g: 'f', h: 165, w: 55, bust: '', waist: '', hip: '', fit: 'std' };
  let B = Object.assign({}, DEF), step = 1, prod = null, panel = null, onApply = null;
  try { localStorage.removeItem(KEY); } catch (e) {}   // 訪客舊資料一律清掉；會員資料由 Member 登入後拉回
  const save = () => { if (!isMem()) return; filled = true; try { localStorage.setItem(KEY, JSON.stringify(B)); } catch (e) {} if (typeof Member !== 'undefined') Member.push(B); };
  let filled = false;   // 會員是否已填過資料（沒填就不要用預設值亂推薦）
  const hasSaved = () => isMem() && filled;
  const num = v => (v === '' || v == null) ? NaN : parseFloat(v);
  const RANGE = { h: [130, 210], w: [30, 150], bust: [60, 140], waist: [45, 130], hip: [65, 150] };
  const LAB = { h: '身高 cm', w: '體重 kg', bust: '胸圍 cm', waist: '腰圍 cm', hip: '臀圍 cm' };

  // ── 體型示意（前視；只是比例示意，會隨數值變化）──
  function body() {
    const h = num(B.h) || 165, w = num(B.w) || 55, H = 300, k = H / h;           // 每公分幾個 px
    const bmi = w / Math.pow(h / 100, 2), base = Math.max(0, Math.min(1, (bmi - 17) / 14));   // 0..1
    const g = B.g, sh = (g === 'm' ? 1.0 : g === 'n' ? .9 : .8);
    const bustC = num(B.bust) || (g === 'm' ? 86 + base * 24 : 78 + base * 28);
    const waistC = num(B.waist) || (g === 'm' ? 74 + base * 28 : 62 + base * 28);
    const hipC = num(B.hip) || (g === 'm' ? 88 + base * 22 : 86 + base * 28);
    const fw = c => c / Math.PI * 1.22 * k;                                        // 圍度 → 前視寬度 px
    const cx = 100, y0 = 18, headR = 15, neck = y0 + headR * 2 + 4;
    const sY = neck + 10, bY = neck + 52, wY = neck + 92, hY = neck + 128, kY = y0 + H * .72, fY = y0 + H * .96;
    const shW = Math.max(fw(bustC) * .5 * (0.95 + sh * .15), 26) + (g === 'm' ? 6 : 0);
    const bW = fw(bustC) / 2, wW = fw(waistC) / 2, hW = fw(hipC) / 2, lg = Math.max(hW * .42, 11);
    const P = `M${cx - 6} ${neck} L${cx - shW} ${sY} C${cx - shW - 6} ${sY + 22} ${cx - bW - 4} ${bY - 6} ${cx - bW} ${bY}
      C${cx - bW + 2} ${bY + 18} ${cx - wW} ${wY - 18} ${cx - wW} ${wY} C${cx - wW} ${wY + 14} ${cx - hW} ${hY - 14} ${cx - hW} ${hY}
      L${cx - lg - 2} ${kY} L${cx - lg + 3} ${fY} L${cx - 3} ${fY} L${cx} ${hY + 14} L${cx + 3} ${fY} L${cx + lg - 3} ${fY} L${cx + lg + 2} ${kY} L${cx + hW} ${hY}
      C${cx + hW} ${hY - 14} ${cx + wW} ${wY + 14} ${cx + wW} ${wY} C${cx + wW} ${wY - 18} ${cx + bW - 2} ${bY + 18} ${cx + bW} ${bY}
      C${cx + bW + 4} ${bY - 6} ${cx + shW + 6} ${sY + 22} ${cx + shW} ${sY} L${cx + 6} ${neck} Z`;
    return `<svg viewBox="0 0 200 ${H + 40}" class="sz-fig" aria-label="體型示意"><circle cx="${cx}" cy="${y0 + headR}" r="${headR}" fill="#d9dadf"/><path d="${P}" fill="#d9dadf" stroke="#6b1a2a" stroke-width="1.2"/>
      <g stroke="#6b1a2a" stroke-width=".6" stroke-dasharray="2 2" opacity=".7"><line x1="${cx - bW - 10}" x2="${cx + bW + 10}" y1="${bY}" y2="${bY}"/><line x1="${cx - wW - 10}" x2="${cx + wW + 10}" y1="${wY}" y2="${wY}"/><line x1="${cx - hW - 10}" x2="${cx + hW + 10}" y1="${hY}" y2="${hY}"/></g>
      <g font-size="8" fill="#6b6f76"><text x="${cx + bW + 12}" y="${bY + 3}">胸</text><text x="${cx + wW + 12}" y="${wY + 3}">腰</text><text x="${cx + hW + 12}" y="${hY + 3}">臀</text></g></svg>`;
  }

  // ── 尺碼建議：優先「三圍＋尺碼表」，否則用身高體重粗估 ──
  const chartCache = {};
  async function getChart(p) {
    if (!p || !p.id) return null; if (p.id in chartCache) return chartCache[p.id];
    let c = null; try { const r = await sbFetch('size_charts?product_id=eq.' + p.id + '&confirmed=eq.true&select=headers,rows&limit=1'); c = r && r[0] || null; } catch (e) {}
    return chartCache[p.id] = c;
  }
  const FIT = { tight: [2, 8], std: [8, 16], loose: [16, 28] };
  function recommend(p, chart) {
    const sizes = (p && p.sizes && p.sizes.length) ? p.sizes : ['S', 'M', 'L'];
    const bust = num(B.bust);
    if (chart && chart.headers && !isNaN(bust)) {
      const ci = chart.headers.findIndex(h => /胸/.test(h));
      if (ci >= 0) {
        const [lo, hi] = FIT[B.fit] || FIT.std, mid = (lo + hi) / 2; let best = null;
        chart.rows.forEach(r => { let g = parseFloat(r[ci]); if (isNaN(g)) return; if (g < 80) g *= 2;   // 平量→圍度（假設；請核對你的尺碼表）
          const d = Math.abs(g - bust - mid); if (!best || d < best.d) best = { d, size: r[0], ease: g - bust }; });
        if (best) return { size: best.size, basis: '依你的胸圍與這件的尺碼表（衣服胸圍比你多約 ' + Math.round(best.ease) + ' cm）' };
      }
    }
    const h = num(B.h), w = num(B.w); if (isNaN(h) || isNaN(w)) return null;
    const bmi = w / Math.pow(h / 100, 2); let s = (bmi - 17) / 9 * (sizes.length - 1) + (h - 165) / 25;   // 粗估
    s += B.fit === 'loose' ? -.5 : B.fit === 'tight' ? .4 : 0;
    const i = Math.max(0, Math.min(sizes.length - 1, Math.round(s)));
    return { size: sizes[i], basis: '依身高體重粗估（填三圍並有尺碼表時會更準）' };
  }

  // ── 面板 ──
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function field(k) {
    const [a, b] = RANGE[k], v = B[k] === '' ? '' : B[k];
    return `<div class="sz-f"><label>${LAB[k]}${['bust', 'waist', 'hip'].includes(k) ? '（選填）' : ''}</label><div class="sz-r"><button data-d="${k}:-1" aria-label="減少">−</button>
      <input type="range" min="${a}" max="${b}" value="${v === '' ? Math.round((a + b) / 2) : v}" data-k="${k}" ${v === '' ? 'class="idle"' : ''}><button data-d="${k}:1" aria-label="增加">+</button>
      <input type="number" inputmode="decimal" data-n="${k}" value="${v}" placeholder="—"></div><div class="sz-w" id="w-${k}"></div></div>`;
  }
  function warn() {
    ['h', 'w', 'bust', 'waist', 'hip'].forEach(k => { const el = document.getElementById('w-' + k); if (!el) return; const v = num(B[k]); const [a, b] = RANGE[k];
      el.textContent = (!isNaN(v) && (v < a || v > b)) ? '這個數值比較少見，請再確認一次（可照實填寫）。' : ''; });
    const bu = num(B.bust), wa = num(B.waist), hi = num(B.hip);
    const el = document.getElementById('w-waist'); if (el && !el.textContent && !isNaN(bu) && !isNaN(wa) && !isNaN(hi) && (wa > bu + 25 || wa > hi + 25)) el.textContent = '三圍的比例看起來不太常見，請對照一下是否量到正確位置。';
  }
  async function render() {
    const p = panel.querySelector('.sz-body'); const tot = 3;
    let h = `<div class="sz-steps">${[1, 2, 3].map(n => `<i class="${n <= step ? 'on' : ''}"></i>`).join('')}</div><div class="sz-grid"><div class="sz-art">${body()}</div><div class="sz-form">`;
    if (step === 1) h += `<h3>版型與身高體重</h3><div class="sz-seg">${[['f', '女性版'], ['m', '男性版'], ['n', '中性版']].map(([k, n]) => `<button data-g="${k}" class="${B.g === k ? 'on' : ''}">${n}</button>`).join('')}</div>${field('h')}${field('w')}`;
    if (step === 2) h += `<h3>三圍（選填）</h3><p class="sz-p">有量過再填，會讓建議更準；不填也可以。右邊的示意圖會跟著變，看看像不像你。</p>${field('bust')}${field('waist')}${field('hip')}`;
    if (step === 3) {
      const r = recommend(prod, prod && await getChart(prod));
      h += `<h3>喜歡的鬆緊</h3><div class="sz-seg">${[['tight', '合身'], ['std', '標準'], ['loose', '寬鬆']].map(([k, n]) => `<button data-f="${k}" class="${B.fit === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="sz-res">${r ? `<small>${prod ? esc(prod.name) + ' 的' : ''}建議尺寸</small><b>${esc(r.size)}</b><span>${esc(r.basis)}</span>` : '資料不足，請回上一步補身高體重。'}</div>
      ${prod && r ? '<button class="sz-go" data-apply="' + esc(r.size) + '">套用這個尺寸</button>' : ''}`;
    }
    h += `<p class="sz-note">僅為示意：每個人的體型與穿著習慣不同，實際請以商品尺碼表為準。</p></div></div>
      <div class="sz-nav">${step > 1 ? '<button data-s="-1" class="ghost">上一步</button>' : '<span></span>'}${step < tot ? '<button data-s="1">下一步</button>' : '<button data-close="1">完成</button>'}</div>`;
    p.innerHTML = h; warn();
  }
  function ensure() {
    if (panel) return;
    panel = document.createElement('div'); panel.className = 'sz-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '找我的尺碼');
    panel.innerHTML = '<div class="sz-bg" data-close="1"></div><aside><header><b>找我的尺碼</b><button data-close="1" aria-label="關閉">✕</button></header><div class="sz-body"></div></aside>';
    document.body.appendChild(panel);
    panel.addEventListener('click', e => { const t = e.target.closest('button,[data-close]'); if (!t) return; const d = t.dataset;
      if (d.close) return close(); if (d.s) { step = Math.max(1, Math.min(3, step + +d.s)); save(); return render(); }
      if (d.g) { B.g = d.g; save(); return render(); } if (d.f) { B.fit = d.f; save(); return render(); }
      if (d.d) { const [k, dl] = d.d.split(':'), [a, b] = RANGE[k]; const cur = num(B[k]); B[k] = Math.max(a, Math.min(b, (isNaN(cur) ? Math.round((a + b) / 2) : cur) + +dl)); save(); return render(); }
      if (d.apply) { if (onApply) onApply(d.apply); close(); } });
    panel.addEventListener('input', e => { const t = e.target; let k = t.dataset.k || t.dataset.n; if (!k) return;
      B[k] = t.value === '' ? '' : +t.value; save(); if (t.dataset.k) panel.querySelector('[data-n="' + k + '"]').value = t.value; else { const r = panel.querySelector('[data-k="' + k + '"]'); if (r && t.value !== '') { r.value = t.value; r.classList.remove('idle'); } }
      panel.querySelector('.sz-art').innerHTML = body(); warn(); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('on')) close(); });
  }
  function open(p, apply) { if (!isMem()) { if (typeof Member !== 'undefined') Member.open(); return; } ensure(); prod = p || null; onApply = apply || null; step = 1; render(); document.body.style.overflow = 'hidden'; void panel.offsetWidth; panel.classList.add('on'); }
  function close() { panel.classList.remove('on'); if (!document.getElementById('pd') || !document.getElementById('pd').classList.contains('on')) document.body.style.overflow = ''; }

  // 商品頁：尺寸附近顯示「找我的尺碼」與（若已有資料）建議尺寸
  async function decorate(p, info) {
    const chips = info.querySelector('#pd-chips'); if (!chips) return;
    const box = document.createElement('div'); box.className = 'sz-rec'; chips.parentNode.appendChild(box);
    const pick = s => { chips.querySelectorAll('span').forEach(x => { if (x.dataset.s === s) x.click(); }); };
    if (!isMem()) { box.innerHTML = '<span>登入會員即可使用尺碼推薦</span> <button class="sz-link" type="button">登入／註冊</button>'; box.querySelector('button').onclick = () => Member.open(); return; }
    const btn = '<button class="sz-link" type="button">找我的尺碼</button>';
    box.innerHTML = btn; box.querySelector('button').onclick = () => open(p, pick);
    if (hasSaved()) { const r = recommend(p, await getChart(p)); if (r && box.isConnected) { box.innerHTML = '<span>建議尺寸 <b>' + esc(r.size) + '</b>（僅供參考）</span> ' + btn; box.querySelector('button').onclick = () => open(p, pick); } }
  }
  const setBody = b => { Object.assign(B, DEF, b || {}); filled = !!b; if (panel && panel.classList.contains('on')) render(); };
  const clear = () => { Object.assign(B, DEF); filled = false; try { localStorage.removeItem(KEY); } catch (e) {} };
  return { open, decorate, setBody, clear, getBody: () => Object.assign({}, B) };
})();
