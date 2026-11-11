// 上架工作台：①照片與去背（含顏色） → ②商品資料與分類 → ③尺碼表 → ④社群貼文；右側即時預覽。
// 依賴 admin.js 的 R / up / esc / toast / guard / view / V / go / API。
// 本版新增（Claude 加的，請確認）：顏色分組、商品編號 sku、貼上 Sheet 列帶入售價、草稿自動存、圖片拖曳排序/設主圖、簡轉繁、上傳前壓縮。

// ── 去背（可抽換的一步）：目前用「瀏覽器內去背」；之後查證 Canva 可行再換 provider ──
const Cutout = {
  provider: 'browser',
  async run(file) {
    if (this.provider === 'browser') {
      // 第一次會下載模型（體積大），之後有快取。照片不會離開你的電腦。【未實測】
      const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm');
      // model:'isnet' 是完整版（約 170MB，第一次較久、之後快取），邊緣比預設的縮小版好；深色鞋踩深色地板仍可能切不乾淨
      const blob = await mod.removeBackground(file, { model: 'isnet', output: { format: 'image/png', quality: 1 } });
      return blob;
    }
    throw new Error('尚未設定的去背服務');
  }
};

// ── 上傳前壓縮：長邊最多 1600px；JPEG 重新編碼 0.85；PNG（去背圖）只縮小、保留透明 ──
async function compress(f) {
  try {
    if (!/^image\//.test(f.type) || f.type === 'image/gif') return f;
    const isPng = f.type === 'image/png';
    const bm = await createImageBitmap(f);
    const M = 1600, sc = Math.min(1, M / Math.max(bm.width, bm.height));
    if (sc === 1 && (isPng || f.size < 400 * 1024)) return f;
    const c = document.createElement('canvas'); c.width = Math.round(bm.width * sc); c.height = Math.round(bm.height * sc);
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    const type = isPng ? 'image/png' : 'image/jpeg';
    const b = await new Promise(r => c.toBlob(r, type, 0.85));
    if (!b || b.size >= f.size) return f;
    return new File([b], f.name.replace(/\.\w+$/, isPng ? '.png' : '.jpg'), { type });
  } catch (e) { return f; }
}
const upC = async f => up(await compress(f));

// ── 簡體轉繁體（台灣用語）：opencc-js，第一次用才載入。【未實測】 ──
let _cc = null;
async function toTW(s) {
  if (!s) return s;
  if (!_cc) { const m = await import('https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/+esm'); const OC = m.default || m; _cc = (OC.Converter || m.Converter)({ from: 'cn', to: 'twp' }); }
  return _cc(s);
}

// ── 貼上 Sheet 的列：建議連同標題列複製兩列，才對得到「商品編號」欄 ──
// ── 從 Sheet 自動檢索（Claude 加的，2026-11-09）：後台設定頁填 Apps Script 網址與密語；整表抓一次快取 10 分鐘，打字時在本機比對 ──
const SheetDB = {
  cfg: () => { try { return { url: localStorage.getItem('es_sheet_url') || '', token: localStorage.getItem('es_sheet_token') || '' }; } catch (e) { return { url: '', token: '' }; } },
  rows: null, at: 0, err: '',
  async load(force) {
    const { url, token } = this.cfg(); if (!url || !token) { this.err = '尚未設定（後台「設定檢查」→ Sheet 自動檢索）'; return []; }
    if (!force && this.rows && Date.now() - this.at < 600000) return this.rows;
    try { const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)); const j = await r.json();
      if (!j.ok) throw new Error(j.error || '查詢失敗'); this.rows = j.rows || []; this.at = Date.now(); this.err = j.hasSku === false ? 'Sheet 還沒有「商品編號」欄，帶入後編號會是空的' : ''; return this.rows; }
    catch (e) { this.err = '連不到 Sheet：' + (e.message || e); return this.rows || []; }
  },
  find(q) { q = (q || '').trim().toLowerCase(); if (!q || !this.rows) return []; return this.rows.filter(r => (r.sku || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q)).slice(0, 8); }
};
function parseSheetRow(txt) {
  const lines = (txt || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return null;
  const sp = l => l.split('\t'), num = v => { const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? '' : n; };
  let H, Rw;
  if (lines.length >= 2) { H = sp(lines[0]).map(x => x.trim()); Rw = sp(lines[1]); }
  else { H = ['商品名稱', '商品圖資料夾', '文案A', '文案B', '上架狀態', '上架時間', '賣出件數', '進貨價', '運費', '售價']; Rw = sp(lines[0]); }
  const g = k => { const i = H.indexOf(k); return i < 0 ? '' : (Rw[i] || '').trim(); };
  return { sku: g('商品編號'), name: g('商品名稱'), buy: num(g('進貨價')), ship: num(g('運費')), price: num(g('售價')), single: lines.length < 2 };
}

// ── 貼文圖合成：固定背景 + 去背模特圖（canvas，4:5）──
const BGS = [['淺灰', '#e3e4e7'], ['米白', '#f6f6f5'], ['沙色', '#d9cfc4'], ['墨黑', '#1e1f22']];
function loadImgEl(src) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
// ── 貼文模板（Claude 加的）：背景（底色或自己的圖）＋ 模特大小/位置 ＋ 浮水印字 ＋ 文案範本 ──
const TPL_CAP = '【新品預購】{商品名}\n{副標}\nNT${價格}　尺寸 {尺寸}\n預購制・9～12 個工作日到貨・超商取貨付款\n#EndlessStories #預購';
const TPL_PRESETS = BGS.map(([n, c], i) => ({ id: 'p' + i, name: n, preset: true, bg_color: c, bg_image: '', wm_on: true, wm_text: 'ENDLESS', scale: 0.86, x: 0, y: 0.04, caption_tpl: TPL_CAP }));
let TPLS = [], TPL_ERR = false;   // 自訂模板（存在 Supabase post_templates）
const isDark = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return false; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 110; };
const fillCaption = (tpl, s) => (tpl.caption_tpl || '').replace(/\{商品名\}/g, s.name || '').replace(/\{副標\}/g, s.sub || '').replace(/\{價格\}/g, s.price || '').replace(/\{尺寸\}/g, (s.sizes || '').split(',').map(x => x.trim()).filter(Boolean).join('/')).replace(/\{編號\}/g, s.sku || '').replace(/\n{3,}/g, '\n\n').trim();
async function composePost(imgUrl, t) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  if (t.bg_image) { const b = await loadImgEl(t.bg_image); const s = Math.max(W / b.width, H / b.height); x.drawImage(b, (W - b.width * s) / 2, (H - b.height * s) / 2, b.width * s, b.height * s); }
  else { x.fillStyle = t.bg_color || '#e3e4e7'; x.fillRect(0, 0, W, H); }
  if (t.wm_on && t.wm_text) { x.fillStyle = isDark(t.bg_color) && !t.bg_image ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.55)'; x.font = '300 360px "Cormorant Garamond", serif'; x.textAlign = 'center'; x.fillText(t.wm_text, W / 2, H * 0.52); }
  if (imgUrl) { const im = await loadImgEl(imgUrl); const sc = +t.scale || 0.86, s = Math.min((W * 0.95) / im.width, (H * sc) / im.height); /* 「模特大小」＝佔畫面高度的比例 */ const w = im.width * s, h = im.height * s; x.drawImage(im, (W - w) / 2 + W * (+t.x || 0), H - h - H * (+t.y || 0), w, h); }
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
}

let ST = null;   // 工作台狀態
const DK = 'es_studio_draft_v2';   // 草稿存在這台瀏覽器的 localStorage
// 換模特的預設提示詞（Claude 加的，2026-11-06）。英文對 Gemini 圖片模型服從度較好；可在處理面板修改，會記住。
const PROMPT_DEFAULT = `You are given two images.
IMAGE 1 is a GARMENT reference. IMAGE 2 is the BASE MODEL (the person to use).
Task: generate ONE photorealistic full-body fashion photo of the person from IMAGE 2 wearing the garment from IMAGE 1.
Rules:
- The garment must match IMAGE 1 exactly: same silhouette, length, color, fabric texture, pattern, layering and details. Do NOT redesign, recolor or simplify it.
- Keep the person, face, hair, body shape and pose style from IMAGE 2.
- Plain light-grey studio background, soft even lighting, standing pose, head to shoes visible.
- No text, no watermark, no logo, no extra props.
- If IMAGE 1 does not show a complete garment (e.g. only a close-up of fabric), do NOT guess: reply with text only, starting with "PARTIAL:" and explain why.
Output: the image only.`;
const PROMPT_NOTE = '中文說明：圖 1 是衣服、圖 2 是基準模特；衣服版型、顏色、花紋必須完全照圖 1；人物照圖 2；淺灰攝影棚背景、全身；不要文字浮水印；圖 1 不是完整衣服就不要生，回文字說明。';
const PK = 'es_model_prompt';
const loadPrompt = () => { try { return localStorage.getItem(PK) || PROMPT_DEFAULT; } catch (e) { return PROMPT_DEFAULT; } };
// 判斷是不是「特寫」（非全身）：直式且夠高才算全身。很粗略，猜錯可在成果區手動補跑。
const isCloseup = url => new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalHeight / im.naturalWidth < 1.15); im.onerror = () => res(false); im.src = url; });
// 並排雙人圖：去背後找中間的「透明縫」，切成左右兩張（Claude 加的，2026-11-07）。找不到縫就原樣回傳。
async function splitPair(blob) {
  const im = await createImageBitmap(blob); const W = im.width, H = im.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data; const col = new Uint32Array(W);
  for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) if (d[(y * W + x) * 4 + 3] > 24) n++; col[x] = n; }
  // 只在 30%–70% 寬度之間找最長的一段「幾乎全透明」的欄
  const lo = Math.floor(W * .3), hi = Math.ceil(W * .7), thr = H * 0.01; let best = [0, 0], run = 0, start = 0;
  for (let x = lo; x <= hi; x++) { const t = x < hi && col[x] <= thr; if (t) { if (!run) start = x; run++; } if ((!t || x === hi) && run) { if (run > best[1] - best[0]) best = [start, start + run]; run = 0; } }
  if (best[1] - best[0] < Math.max(4, W * 0.01)) return null;                    // 縫太窄，當作單人
  const mid = Math.round((best[0] + best[1]) / 2);
  const bbox = (x0, x1) => { let a = x1, b = x0; for (let x = x0; x < x1; x++) if (col[x] > 0) { a = Math.min(a, x); b = Math.max(b, x); } return b > a ? [a, b + 1] : null; };
  const L = bbox(0, mid), R = bbox(mid, W); if (!L || !R) return null;
  if ((L[1] - L[0]) < W * .12 || (R[1] - R[0]) < W * .12) return null;             // 一邊太小（可能是配件），不切
  const cut = ([a, b]) => new Promise(res => { const c = document.createElement('canvas'); const pad = Math.round(W * .01); c.width = (b - a) + pad * 2; c.height = H; c.getContext('2d').drawImage(cv, a - pad, 0, c.width, H, 0, 0, c.width, H); c.toBlob(res, 'image/png'); });
  return [await cut(L), await cut(R)];
}
const newColor = () => ({ name: '', images: [], cutout: '', model: '', results: [] });   // results：批次處理的成果（不存進資料庫，只用來挑）
const newST = () => ({ id: null, step: 1, images: [], colors: [newColor()], ac: 0, sel: [], proc: { cut: true, model: false }, prompt: loadPrompt(), ask: false, busy: false, busyMsg: '', modelBase: (() => { try { return localStorage.getItem('es_model_base') || ''; } catch (e) { return ''; } })(), sku: '', cost: { buy: '', ship: '' }, name: '', sub: '', price: '', category: '', arrival: '', sizes: 'S,M,L', desc: '', published: false,
  chart: { headers: [], rows: [], img: '', id: null }, post: { on: true, caption: '', img: '', platforms: ['facebook', 'instagram'], tplId: 'p0', tpl: { ...TPL_PRESETS[0] }, when: '' }, prev: 'card' });
const STEPS = ['照片與去背', '商品資料', '尺碼表', '社群貼文'];
const curC = () => ST.colors[ST.ac] || ST.colors[0];
const persist = () => { if (ST && !ST.id) { try { localStorage.setItem(DK, JSON.stringify(ST)); } catch (e) {} } };
const clearDraft = () => { try { localStorage.removeItem(DK); } catch (e) {} };
const listOf = k => k === 's' ? ST.images : curC().images;

V.studio = async () => {
  const [cs, scs, tps] = await Promise.all([R('categories?select=*&order=sort_order'), R('size_charts?select=*').catch(() => []), R('post_templates?select=*&order=id').catch(() => null)]);
  TPL_ERR = !tps; TPLS = tps || [];
  if (!ST || V.studio.reset) {
    ST = newST(); ST.category = (cs[0] || {}).name || ''; V.studio.restored = false;
    if (V.studio.editId) {
      const p = (await R('products?select=*&order=id.desc')).find(x => String(x.id) === String(V.studio.editId));
      if (p) {
        const cols = (p.colors && p.colors.length) ? p.colors.map(c => ({ name: c.name || '', images: c.images || [], cutout: c.cutout || '', model: c.model || '' })) : [{ name: '', images: [], cutout: p.cutout_url || '', model: '' }];
        Object.assign(ST, { id: p.id, images: p.images || [], colors: cols, sku: p.sku || '', name: p.name, sub: p.sub || '', price: p.price, category: p.category, arrival: p.arrival_date || '', sizes: (p.sizes || []).join(','), desc: p.description || '', published: !!p.published });
        const sc = scs.find(s => String(s.product_id) === String(p.id)); if (sc) ST.chart = { headers: sc.headers, rows: sc.rows, img: sc.image_url, id: sc.id };
      }
    } else {
      try { const d = JSON.parse(localStorage.getItem(DK) || 'null'); if (d && (d.name || d.images.length || d.colors.some(c => c.images.length || c.cutout))) { ST = Object.assign(newST(), d); if (!ST.colors || !ST.colors.length) ST.colors = [newColor()]; ST.busy = false; ST.ask = false; ST.sel = []; if (!ST.post.tpl) { ST.post.tpl = { ...TPL_PRESETS[0], bg_color: ST.post.bg || TPL_PRESETS[0].bg_color }; ST.post.tplId = 'p0'; } V.studio.restored = true; } } catch (e) {}
    }
    V.studio.reset = false; V.studio.editId = null;
  }
  const draw = () => {
    const s = ST; persist();
    view(`<h2>${s.id ? '編輯商品' : '上架工作台'}</h2>
    ${V.studio.restored && !s.id ? '<div class="note">已還原上次沒做完的草稿。　<button class="btn ghost sm" id="clrdraft">清除重來</button></div>' : ''}
    <div class="steps">${STEPS.map((n, i) => `<button class="${s.step === i + 1 ? 'on' : ''}" data-step="${i + 1}"><b>${i + 1}</b>${n}</button>`).join('')}</div>
    <div class="studio"><div class="card" id="stmain">${stepHTML(s, cs)}</div>
    <div class="card pvbox"><div class="bar">${[['card', '商品卡'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['threads', 'Threads']].map(([k, n]) => `<button class="btn ${s.prev === k ? '' : 'ghost'} sm" data-prev="${k}">${n}</button>`).join('')}</div><div id="pv"></div></div></div>
    <div class="bar" style="margin-top:6px">${s.step > 1 ? '<button class="btn ghost" data-nav="-1">← 上一步</button>' : ''}${s.step < 4 ? '<button class="btn" data-nav="1">下一步 →</button>' : ''}
    <button class="btn wine" id="finish" style="margin-left:auto">${s.id ? '儲存變更' : '完成上架（存成草稿商品）'}</button></div>`);
    preview(); bind();
  };
  let DR = null;   // 拖曳中的圖片 "s:0" / "c:2"
  const bind = () => {
    root.oninput = onInput; root.onchange = onChange; root.onclick = onClick;
    root.ondragstart = e => { const t = e.target.closest && e.target.closest('[data-dg]'); if (!t) return; DR = t.dataset.dg; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', DR); } catch (x) {} };
    root.ondragover = e => { if (DR && e.target.closest && e.target.closest('[data-dg]')) e.preventDefault(); };
    root.ondrop = e => { const t = e.target.closest && e.target.closest('[data-dg]'); if (!t || !DR) return; e.preventDefault();
      const [l, a] = DR.split(':'), [l2, b] = t.dataset.dg.split(':'); DR = null; if (l !== l2 || a === b) return;
      const arr = listOf(l); const [m] = arr.splice(+a, 1); arr.splice(+b, 0, m); redraw(); };
    root.ondragend = () => { DR = null; };
  };
  const sync = () => { // 把目前表單欄位讀回 ST
    const g = id => document.getElementById(id);
    if (g('f_name')) Object.assign(ST, { name: g('f_name').value, sub: g('f_sub').value, price: g('f_price').value, category: g('f_cat').value, sizes: g('f_sizes') ? g('f_sizes').value : ST.sizes, desc: g('f_desc').value, sku: g('f_sku').value });
    if (g('f_cname')) curC().name = g('f_cname').value;
    if (g('f_cap')) ST.post.caption = g('f_cap').value;
    if (g('f_when')) ST.post.when = g('f_when').value;
    persist();
  };
  const redraw = () => { sync(); draw(); };
  V.studio.draw = draw;
  const root = $('#view');
  // 把模板欄位讀回目前這篇貼文的模板副本（不動模板本身，要按「另存/更新」才會存）
  const readTpl = () => { const g = id => document.getElementById(id); if (!g('t_color')) return; const t = ST.post.tpl;
    t.bg_color = g('t_color').value; t.wm_text = g('t_wm').value; t.wm_on = g('t_wmon').checked; t.scale = +g('t_scale').value / 100; t.x = +g('t_x').value / 100; t.y = +g('t_y').value / 100; t.caption_tpl = g('t_cap').value; persist(); };
  const onInput = e => { const t = e.target;
    if (t.id === 'f_sq') { const box = document.getElementById('sq_list'), q = t.value; SheetDB.load().then(() => { const m = SheetDB.find(q); box.innerHTML = m.map((r, i) => `<button type="button" data-sq="${i}"><b>${esc(r.sku || '—')}</b> ${esc(r.name)} <span>NT$${r.price}</span></button>`).join(''); box.style.display = m.length ? 'block' : 'none'; SheetDB._m = m; const msg = document.getElementById('sq_msg'); if (msg) msg.textContent = SheetDB.err || (q && !m.length ? '找不到符合的商品' : ''); }); return; }
    if (t.id === 'p_prompt') { ST.prompt = t.value; try { localStorage.setItem(PK, ST.prompt); } catch (x) {} return; }
    if (t.id && t.id.startsWith('t_') && t.id !== 't_name') { readTpl(); preview(); return; } if (t.dataset.h) ST.chart.headers[+t.dataset.h] = t.value; if (t.dataset.r) { const rows = ST.chart.rows; rows[+t.dataset.r][+t.dataset.c] = t.value; const fc = rows.map(r => String(r[0] || '').trim()).filter(Boolean); if (fc.length) ST.sizes = fc.join(','); } if (['f_name', 'f_price', 'f_cap', 'f_sub', 'f_cat', 'f_sku', 'f_cname'].includes(t.id)) { sync(); preview(); } };
  const onChange = guard(async e => { const t = e.target;
    if (t.id === 'f_files') { for (const f of t.files) ST.images.push(await upC(f)); redraw(); }
    if (t.id === 'f_cfiles') { for (const f of t.files) curC().images.push(await upC(f)); redraw(); }
    if (t.id === 'f_cutfile') { curC().cutout = await upC(t.files[0]); redraw(); }
    if (t.id === 'f_bgfile') { readTpl(); ST.post.tpl.bg_image = await upC(t.files[0]); redraw(); }
    if (t.id === 't_wmon') { readTpl(); preview(); }
    if (t.id === 'f_basefile') { ST.modelBase = await upC(t.files[0]); try { localStorage.setItem('es_model_base', ST.modelBase); } catch (x) {} redraw(); }
    if (t.id === 'p_cut' || t.id === 'p_model') { ST.proc[t.id === 'p_cut' ? 'cut' : 'model'] = t.checked; ST.ask = false; redraw(); }
    if (t.dataset.sel) { const [k, i] = t.dataset.sel.split(':'); const u = listOf(k)[+i]; ST.sel = ST.sel.filter(x => x !== u); if (t.checked) ST.sel.push(u); ST.ask = false; redraw(); }
    if (t.dataset.pl) { const a = ST.post.platforms, k = t.dataset.pl; if (t.checked) a.push(k); else ST.post.platforms = a.filter(x => x !== k); preview(); persist(); }
    if (t.id === 'f_on') { ST.post.on = t.checked; redraw(); }
    if (t.id === 'f_when') ST.post.when = t.value;
    if (t.id === 'f_chartimg') { ST.chart.img = await upC(t.files[0]); toast('截圖已上傳，按「AI 讀取」'); }
  });
  const onClick = guard(async e => { const t = e.target, d = t.dataset;
    if (t.id === 'clrdraft') { clearDraft(); ST = null; V.studio.restored = false; V.studio.reset = true; return V.studio(); }
    if (d.step) { sync(); ST.step = +d.step; return draw(); }
    if (d.nav) { sync(); ST.step = Math.max(1, Math.min(4, ST.step + +d.nav)); return draw(); }
    if (d.prev) { ST.prev = d.prev; return draw(); }
    if (d.ac !== undefined) { sync(); ST.ac = +d.ac; return draw(); }
    if (t.id === 'addcol') { sync(); ST.colors.push(newColor()); ST.ac = ST.colors.length - 1; return draw(); }
    if (d.rmcol) { sync(); ST.colors.splice(ST.ac, 1); ST.ac = Math.max(0, ST.ac - 1); return draw(); }
    if (d.rmimg) { const [k, i] = d.rmimg.split(':'); listOf(k).splice(+i, 1); return redraw(); }
    if (d.main) { const [k, i] = d.main.split(':'); const arr = listOf(k); const [m] = arr.splice(+i, 1); arr.unshift(m); return redraw(); }
    if (d.mkcut) { // 對某張原圖去背，存成目前顏色的「模特去背圖」
      const [k, i] = d.mkcut.split(':'); t.textContent = '去背中…（第一次較久）'; const src = listOf(k)[+i]; const f = await (await fetch(src)).blob();
      try { const b = await Cutout.run(f); const pair = await splitPair(b).catch(() => null);
        if (pair) { curC().pick = [await upC(new File([pair[0]], 'cut-a.png', { type: 'image/png' })), await upC(new File([pair[1]], 'cut-b.png', { type: 'image/png' }))]; toast('這張是並排雙人圖，已切成兩張，請在下方點一張'); }
        else { curC().cutout = await upC(new File([b], 'cutout.png', { type: 'image/png' })); curC().pick = null; toast('去背完成，請放大檢查邊緣'); }
      } catch (x) { toast('自動去背失敗：' + x.message + '。可改用「上傳已去背 PNG」'); }
      return redraw(); }
    if (d.pickcut !== undefined) { const c = curC(); if (c.pick && c.pick[+d.pickcut]) { c.cutout = c.pick[+d.pickcut]; c.pick = null; } return redraw(); }
    if (d.postimg !== undefined) { sync(); ST.post.img = d.postimg; return draw(); }
    if (t.id === 'selall') { sync(); ST.sel = [...new Set([...ST.images, ...curC().images])]; ST.ask = false; return draw(); }
    if (t.id === 'runproc') { sync();
      if (!ST.sel.length) return toast('請先勾選要處理的圖片（圖片右下角的框）');
      if (!ST.proc.cut && !ST.proc.model) return toast('請至少選一項：去背或換模特');
      if (ST.proc.model && API.live() && !ST.modelBase) return toast('換模特需要先上傳「基準模特圖」');
      ST.ask = true; return draw(); }
    if (t.id === 'p_reset') { ST.prompt = PROMPT_DEFAULT; try { localStorage.removeItem(PK); } catch (x) {} return draw(); }
    if (d.remodel !== undefined) { const r = (curC().results || [])[+d.remodel]; if (!r) return; if (!ST.modelBase && API.live()) return toast('請先上傳「基準模特圖」');
      if (!confirm('這張會呼叫付費的 AI 1 次，確定？')) return; (async () => { ST.busy = true; ST.busyMsg = '換模特中…'; draw();
        try { const m = await API.makeModel({ imageUrl: r.cutout || r.src, baseUrl: ST.modelBase || '', prompt: ST.prompt }); r.model = m.url; r.stub = !!m.stub; r.skip = ''; r.err = ''; } catch (x) { r.err = x.message || String(x); }
        ST.busy = false; ST.busyMsg = ''; draw(); })(); return; }
    if (d.delres !== undefined) { (curC().results || []).splice(+d.delres, 1); return draw(); }
    if (t.id === 'clearres') { if (!confirm('清空這個顏色的所有處理成果？（已選用的模特去背圖不受影響）')) return; curC().results = []; return draw(); }
    if (d.sq !== undefined) { const r = (SheetDB._m || [])[+d.sq]; if (!r) return; sync(); ST.sku = r.sku || ''; ST.name = r.name; ST.price = r.price || ''; ST.cost = { buy: r.buy === '' ? '' : r.buy, ship: r.ship === '' ? '' : r.ship }; toast(r.sku ? '已帶入 ' + r.sku : '已帶入（Sheet 沒有編號欄）'); return draw(); }
    if (t.id === 'runno') { ST.ask = false; return draw(); }
    if (t.id === 'runok') { ST.ask = false; return runProc(); }
    if (d.usecut) { const r = (curC().results || [])[+d.usecut]; if (r) curC().cutout = r.cutout; return redraw(); }
    if (d.usemodel) { const r = (curC().results || [])[+d.usemodel]; if (r) curC().model = r.model; return redraw(); }
    if (d.rmcut) { curC().cutout = ''; return redraw(); }
    if (d.rmmodel) { curC().model = ''; return redraw(); }
    if (d.tpl) { sync(); const x = [...TPL_PRESETS, ...TPLS].find(v => String(v.id) === d.tpl); if (x) { ST.post.tplId = x.id; ST.post.tpl = { ...x }; } return draw(); }
    if (t.id === 't_bgclr') { ST.post.tpl.bg_image = ''; return draw(); }
    if (t.id === 't_applycap') { sync(); readTpl(); ST.post.caption = fillCaption(ST.post.tpl, ST); return draw(); }
    const tplBody = () => { readTpl(); const x = ST.post.tpl; return { bg_color: x.bg_color, bg_image: x.bg_image || '', wm_on: !!x.wm_on, wm_text: x.wm_text || '', scale: +x.scale, x: +x.x, y: +x.y, caption_tpl: x.caption_tpl || '' }; };
    if (t.id === 't_save') { const nm = (document.getElementById('t_name').value || '').trim(); if (!nm) return toast('請先幫新模板取個名字');
      const r = await R('post_templates', { method: 'POST', body: { name: nm, ...tplBody() } }); TPLS = await R('post_templates?select=*&order=id'); ST.post.tplId = r[0].id; ST.post.tpl = { ...r[0] }; toast('已另存為新模板'); return draw(); }
    if (t.id === 't_upd') { await R('post_templates?id=eq.' + ST.post.tplId, { method: 'PATCH', body: tplBody() }); TPLS = await R('post_templates?select=*&order=id'); toast('已更新模板'); return draw(); }
    if (d.tdel) { if (!sure(e)) return; await R('post_templates?id=eq.' + d.tdel, { method: 'DELETE' }); TPLS = await R('post_templates?select=*&order=id'); ST.post.tplId = 'p0'; ST.post.tpl = { ...TPL_PRESETS[0] }; toast('已刪除模板'); return draw(); }
    if (t.id === 'aimodel') return toast('「AI 生成模特圖」尚未接上（之後與 Gemini 一起設定）；現在可先上傳模特圖');
    if (d.tw) { sync(); const map = { name: 'f_name', sub: 'f_sub', desc: 'f_desc' }; const id = map[d.tw]; const el = document.getElementById(id); t.textContent = '轉換中…';
      try { el.value = await toTW(el.value); sync(); toast('已轉成繁體，請檢查用語'); } catch (x) { toast('轉換失敗（可能無法載入轉換工具）：' + x.message); } return draw(); }
    if (t.id === 'sheetgo') { sync(); const r = parseSheetRow(document.getElementById('f_sheet').value);
      if (!r || (!r.name && r.price === '')) return toast('讀不到資料：請在 Sheet 連同標題列一起複製兩列再貼上');
      ST.sku = r.sku;   // 沒帶編號就清空，避免留著上一個商品的編號
      if (r.name) ST.name = r.name; if (r.price !== '') ST.price = r.price; ST.cost = { buy: r.buy, ship: r.ship };
      toast(r.single ? '已帶入（只貼一列，用舊欄位順序；要帶商品編號請連同標題列）' : '已帶入編號、名稱、售價；進貨價只在後台顯示'); return draw(); }
    if (t.id === 'cread') { if (!ST.chart.img) return toast('請先上傳尺碼表截圖'); t.textContent = '讀取中…'; t.disabled = true;
      try { const r = await API.readSizeChart(ST.chart.img); Object.assign(ST.chart, { headers: r.headers, rows: r.rows }); const fc = r.rows.map(x => String(x[0] || '').trim()).filter(Boolean); if (fc.length) ST.sizes = fc.join(','); toast(r.stub ? '（示範資料）請逐格確認' : '讀取完成，請逐格確認'); }
      catch (x) { toast('AI 讀取失敗：' + (x.message || x) + '。可改按「手動建立空白表」'); t.textContent = 'AI 讀取'; t.disabled = false; return; }
      return redraw(); }
    if (t.id === 'cblank') { Object.assign(ST.chart, { headers: ['尺寸', '肩寬', '胸圍', '衣長'], rows: [['S', '', '', ''], ['M', '', '', ''], ['L', '', '', '']] }); return redraw(); }
    if (t.id === 'caddr') { ST.chart.rows.push(ST.chart.headers.map(() => '')); return redraw(); }
    if (t.id === 'caddc') { ST.chart.headers.push('新欄'); ST.chart.rows.forEach(r => r.push('')); return redraw(); }
    if (d.crr) { ST.chart.rows.splice(+d.crr, 1); return redraw(); }
    if (t.id === 'gen') { sync(); if (!ST.name) return toast('請先在第②步填商品名稱'); t.textContent = '產生中…'; t.disabled = true;
      try { const r = await API.genCaption({ name: ST.name, sub: ST.sub, price: ST.price, sizes: ST.sizes.split(',') }); ST.post.caption = r.caption; toast(r.stub ? '（示範文案，尚未接 AI）' : '已產生，請檢查再發'); }
      catch (x) { toast('AI 產生失敗：' + (x.message || x) + '。可改用「用範本產生文案」'); t.textContent = 'AI 產生文案'; t.disabled = false; return; }
      return draw(); }
    if (t.id === 'finish') return save();
  });
  // 依序處理勾選的圖片；每張失敗不影響下一張，成果放進目前顏色的 results 讓你挑
  async function runProc() {
    const urls = ST.sel.slice(), c = curC(); c.results = c.results || []; let ok = 0, bad = 0;
    ST.busy = true;
    for (let i = 0; i < urls.length; i++) {
      ST.busyMsg = '處理中 ' + (i + 1) + ' / ' + urls.length + '…（第一次去背會先下載模型，較久）'; draw();
      const r = { src: urls[i], cutout: '', model: '', err: '', stub: false, skip: '' };
      try {
        if (ST.proc.cut) { const b = await Cutout.run(await (await fetch(urls[i])).blob());
          const pair = await splitPair(b).catch(() => null);
          if (pair) {   // 並排雙人圖：切成左右兩張，各自一列
            for (const pb of pair) { const rr = { src: urls[i], cutout: await upC(new File([pb], 'cutout.png', { type: 'image/png' })), model: '', err: '', stub: false, skip: '', note: '由並排圖自動分割' }; c.results.push(rr); if (!c.cutout) c.cutout = rr.cutout; }
            ok++; continue;
          }
          r.cutout = await upC(new File([b], 'cutout.png', { type: 'image/png' })); }
        if (ST.proc.model) {
          if (await isCloseup(urls[i])) r.skip = '看起來是特寫（非直式全身），自動略過換模特，省一次呼叫';
          else { const m = await API.makeModel({ imageUrl: r.cutout || urls[i], baseUrl: ST.modelBase || '', prompt: ST.prompt }); r.model = m.url; r.stub = !!m.stub; }
        }
        ok++;
      } catch (x) { r.err = x.message || String(x); bad++; }
      c.results.push(r);
      if (r.cutout && !c.cutout) c.cutout = r.cutout;   // 還沒有的才自動帶入，之後可在成果區改選
      if (r.model && !c.model) c.model = r.model;
    }
    ST.busy = false; ST.busyMsg = ''; ST.sel = []; draw();
    toast('處理完成：成功 ' + ok + ' 張' + (bad ? '，失敗 ' + bad + ' 張（見成果區）' : '') + '。請放大檢查邊緣');
  }
  async function save() {
    sync();
    if (!ST.name.trim() || ST.price === '') { ST.step = 2; draw(); return toast('請填商品名稱與價格'); }
    const cols = ST.colors.filter(c => c.name.trim() || c.images.length || c.cutout || c.model).map(c => ({ name: c.name.trim(), images: c.images, cutout: c.cutout || '', model: c.model || '' }));
    const c0 = cols[0] || {};
    // 進貨價與運費只留在後台畫面，不寫進公開的 products 表
    const body = { name: ST.name.trim(), sub: ST.sub.trim(), price: +ST.price, category: ST.category, arrival_date: null, sizes: (ST.chart.rows.map(r => String(r[0] || '').trim()).filter(Boolean).length ? ST.chart.rows.map(r => String(r[0] || '').trim()).filter(Boolean) : ST.sizes.split(',').map(x => x.trim()).filter(Boolean)),
      description: ST.desc, images: ST.images, cutout_url: c0.cutout || null, sku: ST.sku.trim() || null, colors: cols, updated_at: new Date().toISOString() };
    let pid = ST.id;
    if (pid) await R('products?id=eq.' + pid, { method: 'PATCH', body }); else { const r = await R('products', { method: 'POST', body: { ...body, published: false } }); pid = r[0].id; }
    if (ST.chart.rows.length) { const cb = { product_id: pid, image_url: ST.chart.img, headers: ST.chart.headers, rows: ST.chart.rows, confirmed: true };
      if (ST.chart.id) await R('size_charts?id=eq.' + ST.chart.id, { method: 'PATCH', body: cb }); else await R('size_charts', { method: 'POST', body: cb }); }
    if (ST.post.on && ST.post.caption.trim() && ST.post.platforms.length && !ST.id) {
      const blob = await composePost(postImg(ST), ST.post.tpl); const img = await up(new File([blob], 'post.jpg', { type: 'image/jpeg' }));
      await R('social_posts', { method: 'POST', body: { product_id: pid, platforms: ST.post.platforms, caption: ST.post.caption, image_url: img, status: 'draft', scheduled_at: ST.post.when ? new Date(ST.post.when).toISOString() : null } }); }
    clearDraft(); toast('已儲存。商品為草稿，到「商品」頁按上架才會公開'); ST = null; go('products');
  }
  draw();
};

const thumbs = (list, key) => list.map((u, i) => `<div draggable="true" data-dg="${key}:${i}" title="可拖曳調整順序"><img src="${esc(u)}" alt="" draggable="false">${i === 0 ? '<i style="position:absolute;left:0;top:0;background:var(--wine,#6B1A2A);color:#fff;font-size:11px;font-style:normal;padding:1px 6px">主圖</i>' : `<button class="btn ghost sm" data-main="${key}:${i}" style="position:absolute;left:0;top:0;padding:1px 6px">設主圖</button>`}<b data-rmimg="${key}:${i}">×</b><button class="btn ghost sm" data-mkcut="${key}:${i}" style="position:absolute;left:0;bottom:0;padding:1px 6px">去背</button></div>`).join('');

// 模板區：選模板 → 微調（只影響這篇貼文）→ 可另存成新模板／更新自訂模板
function tplHTML(s) {
  const all = [...TPL_PRESETS, ...TPLS], t = s.post.tpl, cur = all.find(x => String(x.id) === String(s.post.tplId));
  return `<label style="margin-top:12px">貼文模板（固定背景＋模特去背圖）</label>
  <div class="bar">${all.map(x => `<button class="btn ${String(x.id) === String(s.post.tplId) ? '' : 'ghost'} sm" data-tpl="${esc(x.id)}">${esc(x.name)}${x.preset ? '' : '＊'}</button>`).join('')}</div>
  ${TPL_ERR ? '<div class="note" style="margin-top:6px">尚未建立 post_templates 資料表（sql/06），自訂模板暫時存不了；內建模板與微調仍可使用。</div>' : ''}
  <div class="card" style="margin:8px 0">
  <div class="row"><div><label>背景底色</label><input type="color" id="t_color" value="${esc(t.bg_color || '#e3e4e7')}" style="height:38px;padding:2px"></div>
  <div><label>背景圖（優先於底色）</label><input type="file" id="f_bgfile" accept="image/*">${t.bg_image ? '<button class="btn ghost sm" id="t_bgclr" style="margin-top:4px">清除背景圖</button>' : ''}</div></div>
  <div class="row" style="margin-top:8px"><div><label>浮水印文字</label><input id="t_wm" value="${esc(t.wm_text || '')}"></div><div style="align-self:end"><label style="display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" id="t_wmon" style="width:auto" ${t.wm_on ? 'checked' : ''}>顯示浮水印</label></div></div>
  <div class="row" style="margin-top:8px"><div><label>模特大小</label><input type="range" id="t_scale" min="40" max="100" value="${Math.round((+t.scale || .86) * 100)}"></div>
  <div><label>左右位置</label><input type="range" id="t_x" min="-40" max="40" value="${Math.round((+t.x || 0) * 100)}"></div>
  <div><label>離底部（也可直接在預覽圖上拖曳模特）</label><input type="range" id="t_y" min="-10" max="30" value="${Math.round((+t.y || 0) * 100)}"></div></div>
  <label style="margin-top:8px">文案範本（可用 {商品名} {副標} {價格} {尺寸} {編號}）</label><textarea id="t_cap" style="min-height:96px">${esc(t.caption_tpl || '')}</textarea>
  <div class="bar" style="margin-top:6px"><button class="btn ghost sm" id="t_applycap">用範本產生文案</button>
  <input id="t_name" placeholder="新模板名稱" style="max-width:160px"><button class="btn wine sm" id="t_save" ${TPL_ERR ? 'disabled' : ''}>另存為新模板</button>
  ${cur && !cur.preset && !TPL_ERR ? '<button class="btn ghost sm" id="t_upd">更新「' + esc(cur.name) + '」</button><button class="btn danger sm" data-tdel="' + esc(cur.id) + '">刪除此模板</button>' : ''}</div></div>`;
}

// 批次處理區：勾選圖片 → 選「去背」「換模特」→ 處理 → 從成果挑要用的
function procHTML(s, c) {
  const n = s.sel.length, calls = s.proc.model ? n : 0, res = c.results || [];
  return `<div class="card" style="margin:12px 0;background:var(--bg2,#fafafa)"><b>批次處理（去背＋換模特）</b>
  <div class="note" style="margin:8px 0">先勾選上方圖片右下角的框，再選要做哪一步。去背在你的瀏覽器內完成、免費（第一次會下載約 170MB 模型，之後有快取）。兩人並排的淘寶圖會自動切成左右兩張。成果在下方：全身圖去背後按「用作模特去背圖」。AI 換模特先收起來不用。</div>
  <div class="bar"><label style="display:flex;gap:4px;align-items:center;margin:0"><input type="checkbox" id="p_cut" style="width:auto" ${s.proc.cut ? 'checked' : ''}>去背（模特去背圖）</label>
  <button class="btn ghost sm" id="selall">全選這個顏色＋共用圖</button><span style="color:var(--gray)">已勾選 ${n} 張</span></div>
  <details style="margin-top:6px" ${s.proc.model ? 'open' : ''}><summary style="cursor:pointer;color:var(--gray)">AI 換模特（實驗中，預設關閉；目前模型效果不佳，先不用）</summary>
  <label style="display:flex;gap:4px;align-items:center;margin:6px 0 0"><input type="checkbox" id="p_model" style="width:auto" ${s.proc.model ? 'checked' : ''}>換模特（AI，付費）</label>
  ${s.proc.model ? `<div class="bar" style="margin-top:6px"><label style="margin:0">基準模特圖（一次上傳，之後都用同一位）：</label>${s.modelBase ? `<img src="${esc(s.modelBase)}" style="height:56px" alt="">` : '<span style="color:var(--gray)">尚未上傳</span>'}<input type="file" id="f_basefile" accept="image/*" style="max-width:220px"></div>` : ''}
  ${s.proc.model ? `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--gray)">AI 提示詞（可修改，會記住）</summary><textarea id="p_prompt" rows="9" style="width:100%;font-size:12px;margin-top:4px">${esc(s.prompt)}</textarea><div class="note">${esc(PROMPT_NOTE)} <button class="btn ghost sm" id="p_reset">還原預設</button></div></details>` : ''}
  </details>
  ${s.ask ? `<div class="note" style="margin-top:8px">將處理 ${n} 張：${s.proc.cut ? '去背 ' + n + ' 次（在你的瀏覽器內做，免費）' : ''}${s.proc.cut && s.proc.model ? '；' : ''}${s.proc.model ? '換模特 ' + calls + ' 次（會呼叫付費的 AI ' + calls + ' 次）' : ''}。確定嗎？ <button class="btn wine sm" id="runok">確定執行</button> <button class="btn ghost sm" id="runno">取消</button></div>`
  : `<div class="bar" style="margin-top:8px"><button class="btn wine sm" id="runproc" ${s.busy ? 'disabled' : ''}>${s.busy ? esc(s.busyMsg) : '處理勾選的圖片'}</button></div>`}
  ${res.length ? `<div style="margin-top:10px"><b>成果</b>（目前顏色）<button class="btn ghost sm" id="clearres" style="margin-left:8px">清空成果</button>${res.map((r, i) => `<div class="bar" style="margin-top:6px;align-items:flex-start"><img src="${esc(r.src)}" style="height:90px" alt="原圖">${r.cutout ? `<div class="checker"><img src="${esc(r.cutout)}" style="height:90px" alt="去背"></div>` : ''}${r.model ? `<div class="checker"><img src="${esc(r.model)}" style="height:90px" alt="模特"></div>` : ''}
  <div>${r.err ? `<div style="color:var(--wine,#6B1A2A);white-space:pre-wrap">失敗：${esc(r.err)}</div>` : ''}${r.note ? `<div style="color:var(--gray)">${esc(r.note)}</div>` : ''}${r.skip ? `<div style="color:var(--gray)">${esc(r.skip)} <button class="btn ghost sm" data-remodel="${i}">仍要換模特</button></div>` : ''}${!r.skip && !r.model && r.err ? `<button class="btn ghost sm" data-remodel="${i}">重試換模特</button> ` : ''}${r.stub ? '<div style="color:var(--gray)">（模特為示範圖，AI 尚未接上）</div>' : ''}${r.cutout ? `<button class="btn ghost sm" data-usecut="${i}">用作模特去背圖</button> ` : ''}${r.model ? `<button class="btn ghost sm" data-usemodel="${i}">用作模特圖</button> ` : ''}<button class="btn ghost sm" data-delres="${i}" title="只從清單移除，不刪雲端圖檔">刪除</button></div></div>`).join('')}</div>` : ''}</div>`;
}

// 貼文可用的圖：模特去背圖優先，再來是所有照片（Claude 加的，2026-11-09）
const postPool = s => { const c0 = s.colors[0] || {}; return [...new Set([c0.cutout, ...(c0.images || []), ...s.images].filter(Boolean))]; };
const postImg = s => s.post.img && postPool(s).includes(s.post.img) ? s.post.img : postPool(s)[0] || '';
function stepHTML(s, cs) {
  if (s.step === 1) { const c = curC(); const pool = [...(c.images.length ? c.images : s.images)]; return `<h3>① 照片與模特去背圖</h3>
  <div class="note"><b>每張圖會去哪裡：</b>第一張（標「主圖」）→ 商品卡片與商品頁第一張；全部照片 → 商品頁相簿；下方「模特去背圖」→ 首頁輪播、商品頁、社群貼文。<br>做法：把淘寶圖整批丟進來 → 拖曳排順序、按「設主圖」 → 在一張<b>全身</b>照片上按「去背」，結果會直接進下方的去背圖槽。</div>
  <label>共用照片（所有顏色都會用）</label><input type="file" id="f_files" accept="image/*" multiple>
  <div class="thumbs" style="margin:10px 0">${thumbs(s.images, 's') || '<span style="color:var(--gray)">尚未上傳</span>'}</div>
  <label>顏色</label>
  <div class="bar">${s.colors.map((x, i) => `<button class="btn ${i === s.ac ? '' : 'ghost'} sm" data-ac="${i}">${esc(x.name || ('顏色' + (i + 1)))}</button>`).join('')}<button class="btn ghost sm" id="addcol">＋ 顏色</button></div>
  <div class="row" style="margin-top:8px"><div><label>顏色名稱（單色商品可留空）</label><input id="f_cname" value="${esc(c.name)}" placeholder="例：黑、米白"></div>${s.colors.length > 1 ? '<div style="align-self:end"><button class="btn danger sm" data-rmcol="1">刪除這個顏色</button></div>' : ''}</div>
  <label style="margin-top:8px">此顏色專屬的照片（沒有就沿用共用照片）</label><input type="file" id="f_cfiles" accept="image/*" multiple>
  <div class="thumbs" style="margin:10px 0">${thumbs(c.images, 'c') || '<span style="color:var(--gray)">無（沿用共用照片）</span>'}</div>
  <div class="card" style="margin-top:12px;background:var(--bg2,#fafafa)"><b>模特去背圖</b><span style="color:var(--gray)">　${esc(c.name || '此顏色')}一張；沒有這張的商品不會進首頁輪播</span>
    ${c.pick ? `<div class="note" style="margin-top:8px">並排圖已切成兩張，點一張當去背圖：</div><div class="bar">${c.pick.map((u, i) => `<div style="text-align:center"><div class="checker"><img src="${esc(u)}" style="height:160px" alt=""></div><button class="btn wine sm" data-pickcut="${i}" style="margin-top:4px">選這張</button></div>`).join('')}</div>` : ''}
    <div class="bar" style="margin-top:8px;align-items:flex-start">${c.cutout ? `<div class="checker"><img src="${esc(c.cutout)}" style="height:200px" alt=""></div><div style="display:flex;flex-direction:column;gap:6px"><span style="color:var(--gray)">要換一張：到上方照片按另一張的「去背」即可覆蓋</span><button class="btn danger sm" data-rmcut="1">移除</button></div>` : '<span style="color:var(--gray)">尚無。在上方照片按「去背」（建議選全身照），或上傳已去背 PNG。第一次去背會下載約 170MB 模型。</span>'}</div>
    <div class="bar" style="margin-top:8px"><label style="margin:0">上傳已去背 PNG：</label><input type="file" id="f_cutfile" accept="image/png" style="max-width:240px"></div></div>`; }
  if (s.step === 2) { const cost = s.cost || {}, hasCost = cost.buy !== '' && cost.buy !== undefined;
    const profit = hasCost && s.price !== '' ? (+s.price - +cost.buy - (+cost.ship || 0)) : null;
    return `<h3>② 商品資料與分類</h3>
  <div class="note"><b>從 Sheet 帶入</b>：輸入商品編號或名稱的幾個字，從「商品總表」自動找。會帶入編號、名稱、售價；進貨價與運費只顯示在後台，不存進網站資料庫。
    <div style="position:relative;margin-top:6px"><input id="f_sq" placeholder="輸入編號（ES-0001）或名稱關鍵字…" autocomplete="off" style="width:100%"><div id="sq_list" class="sq-list"></div></div>
    <div id="sq_msg" style="color:var(--gray);margin-top:4px;font-size:12px">${esc(SheetDB.err || '')}</div>
    <details style="margin-top:6px"><summary style="cursor:pointer;color:var(--gray)">改用貼上兩列（備援）</summary><textarea id="f_sheet" placeholder="貼上 Sheet 的標題列＋商品那一列" style="min-height:60px;margin-top:6px"></textarea><button class="btn wine sm" id="sheetgo" style="margin-top:6px">帶入</button></details></div>
  <div class="row"><div><label>名稱 * <button class="btn ghost sm" data-tw="name" type="button">簡→繁</button></label><input id="f_name" value="${esc(s.name)}"></div><div><label>副標 <button class="btn ghost sm" data-tw="sub" type="button">簡→繁</button></label><input id="f_sub" value="${esc(s.sub)}"></div></div>
  <div class="row" style="margin-top:8px"><div><label>商品編號（與 Sheet 相同）</label><input id="f_sku" value="${esc(s.sku)}" placeholder="ES-0001"></div><div><label>售價（NT$）*</label><input id="f_price" type="number" min="0" value="${esc(s.price)}"></div><div><label>分類</label><select id="f_cat">${catOpts(cs, s.category)}</select></div></div>
  ${hasCost ? `<div class="note" style="margin-top:8px">進貨 NT$ ${Math.round(+cost.buy || 0)}　運費 NT$ ${Math.round(+cost.ship || 0)}　${profit === null ? '' : '單件利潤 NT$ ' + Math.round(profit)}　（僅後台顯示）</div>` : ''}
  <div style="margin-top:8px"><label>說明 <button class="btn ghost sm" data-tw="desc" type="button">簡→繁</button></label><textarea id="f_desc">${esc(s.desc)}</textarea></div>`; }
  if (s.step === 3) { const fromChart = s.chart.rows.map(r => String(r[0] || '').trim()).filter(Boolean); return `<h3>③ 尺碼表與尺寸</h3>
  <div class="note">尺寸由尺碼表的第一欄（S、M、L…）自動產生，買家在商品頁選的就是這些。沒有尺碼表的商品（戒指、領帶等）直接在下方填尺寸。</div>
  ${fromChart.length ? `<div class="bar" style="margin-bottom:8px"><b>尺寸：</b>${fromChart.map(x => `<span class="tag ok">${esc(x)}</span>`).join(' ')}<span style="color:var(--gray)">（來自尺碼表）</span></div>`
  : `<div style="margin-bottom:8px"><label>尺寸（沒有尺碼表時手填；逗號分隔，均碼可填「均碼」）</label><input id="f_sizes" value="${esc(s.sizes)}" placeholder="均碼 或 S,M,L"></div>`}
  <h4 style="margin:12px 0 6px;font-weight:500">尺碼表</h4>${API.live() ? '' : '<div class="note">「AI 讀取」目前是示範假資料；表格可手動修改。</div>'}
  <div class="bar"><input type="file" id="f_chartimg" accept="image/*" style="max-width:260px"><button class="btn wine sm" id="cread">AI 讀取</button><button class="btn ghost sm" id="cblank">手動建立空白表</button></div>
  ${s.chart.headers.length ? `<div class="scroll"><table><tr>${s.chart.headers.map((h, i) => `<th><input value="${esc(h)}" data-h="${i}"></th>`).join('')}<th></th></tr>${s.chart.rows.map((r, ri) => `<tr>${r.map((c, ci) => `<td><input value="${esc(c)}" data-r="${ri}" data-c="${ci}"></td>`).join('')}<td><button class="btn ghost sm" data-crr="${ri}">刪列</button></td></tr>`).join('')}</table></div>
  <div class="bar" style="margin-top:8px"><button class="btn ghost sm" id="caddr">＋ 列</button><button class="btn ghost sm" id="caddc">＋ 欄</button><span style="color:var(--gray)">AI 讀到的數字可能有誤，請對照原圖逐格確認。</span></div>` : '<div style="color:var(--gray);margin-top:8px">可略過；之後也能補。</div>'}`; }
  return `<h3>④ 社群貼文</h3><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="f_on" style="width:auto" ${s.post.on ? 'checked' : ''}>同時建立貼文草稿</label>
  ${s.post.on ? `<label style="margin-top:8px">貼文用圖（預設模特去背圖；點一張換）</label><div class="thumbs" style="margin:6px 0">${postPool(s).map(u => `<div style="cursor:pointer;outline:${(s.post.img || postPool(s)[0]) === u ? '3px solid var(--wine,#6B1A2A)' : '1px solid var(--line,#ddd)'}" data-postimg="${esc(u)}"><img src="${esc(u)}" alt="" style="pointer-events:none"></div>`).join('') || '<span style="color:var(--gray)">先在第 ① 步放照片</span>'}</div>
  <div class="bar" style="margin-top:8px"><button class="btn ghost sm" id="gen">AI 產生文案</button></div><label>文案</label><textarea id="f_cap" style="min-height:130px">${esc(s.post.caption)}</textarea>
  <div class="bar" style="margin-top:8px">${Object.entries(PL).map(([k, n]) => `<label style="display:flex;gap:4px;align-items:center;margin:0"><input type="checkbox" data-pl="${k}" style="width:auto" ${s.post.platforms.includes(k) ? 'checked' : ''}>${n}</label>`).join('')}</div>
  ${tplHTML(s)}
  <label>排程時間（可留空，之後在「社群發文」頁排程）</label><input type="datetime-local" id="f_when" value="${esc(s.post.when)}" style="max-width:240px">
  <div class="note" style="margin-top:10px">貼文只會存成草稿，不會自動發出；送審、核准與發布在「社群發文」頁。</div>` : ''}`;
}

function preview() {
  const s = ST, p = document.getElementById('pv'); if (!p) return;
  const c0 = s.colors[0] || {};
  const img = postImg(s);
  const t = s.post.tpl || TPL_PRESETS[0], dark = isDark(t.bg_color) && !t.bg_image;
  const bg = t.bg_image ? `url(${esc(t.bg_image)}) center/cover` : (t.bg_color || '#e3e4e7');
  const post = `<div class="postimg" style="background:${bg}">${t.wm_on && t.wm_text ? `<span class="wm" style="color:${dark ? '#ffffff14' : '#ffffff99'}">${esc(t.wm_text)}</span>` : ''}${img ? `<img src="${esc(img)}" alt="" draggable="false" style="--s:${Math.round((+t.scale || .86) * 100)}%;--x:${(+t.x || 0) * 100}%;--y:${(+t.y || 0) * 100}%" title="可拖曳調整位置">` : ''}</div>`;
  const cap = esc(s.post.caption || '（文案預覽）');
  if (s.prev === 'card') p.innerHTML = `<div class="pcprev"><div class="phto"><img src="${esc(s.images[0] || (c0.images && c0.images[0]) || img)}" alt=""></div><b>${esc(s.name || '商品名稱')}</b><span>NT$ ${esc(s.price || '—')}　${esc(s.category)}</span></div>`;
  if (s.prev === 'facebook') p.innerHTML = `<div class="fb"><div class="hd"><i></i><div><b>Endless Stories</b><small>剛剛 · 🌐</small></div></div><div class="tx">${cap}</div>${post}<div class="ft">👍 讚　💬 留言　↪ 分享</div></div>`;
  if (s.prev === 'instagram') p.innerHTML = `<div class="ig"><div class="hd"><i></i><b>endlessstories</b></div>${post}<div class="ic">♡　💬　➤</div><div class="tx"><b>endlessstories</b> ${cap}</div></div>`;
  if (s.prev === 'threads') p.innerHTML = `<div class="th"><i></i><div><b>endlessstories</b><div class="tx">${cap}</div><div class="timg">${post}</div><div class="ic">♡ 💬 ⟲ ➤</div></div></div>`;
  // 在預覽圖上直接拖曳模特（Claude 加的，2026-11-09）：拖動改 x／y，放開後寫回滑桿與模板
  const pi = p.querySelector('.postimg'); const im = pi && pi.querySelector('img');
  if (im) { im.onpointerdown = e => { e.preventDefault(); const r = pi.getBoundingClientRect(), t = ST.post.tpl, x0 = +t.x || 0, y0 = +t.y || 0, sx = e.clientX, sy = e.clientY; im.setPointerCapture(e.pointerId);
      im.onpointermove = ev => { t.x = Math.max(-0.4, Math.min(0.4, x0 + (ev.clientX - sx) / r.width)); t.y = Math.max(-0.1, Math.min(0.3, y0 - (ev.clientY - sy) / r.height)); im.style.setProperty('--x', (t.x * 100) + '%'); im.style.setProperty('--y', (t.y * 100) + '%'); };
      im.onpointerup = im.onpointercancel = () => { im.onpointermove = null; const gx = document.getElementById('t_x'), gy = document.getElementById('t_y'); if (gx) gx.value = Math.round(t.x * 100); if (gy) gy.value = Math.round(t.y * 100); persist(); }; }; }
}
