// ES 後台（前端）。?mock = 預覽模式：不登入、不連 Supabase，資料只在記憶體。
const MOCK = new URLSearchParams(location.search).has('mock');
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, nolog) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), m.length > 60 ? 6000 : 2200); if (!nolog && /失敗|錯誤|error|Error|沒有權限|forbidden/.test(m)) ErrLog.add(m); };
// ── 錯誤紀錄區（Claude 加的，2026-11-09）：所有錯誤訊息都留在右下角的面板裡，可展開、複製 ──
const ErrLog = {
  items: [],
  add(msg, detail) { const t = new Date(); this.items.unshift({ t: t.toLocaleTimeString('zh-TW', { hour12: false }), msg: String(msg), detail: detail ? String(detail).slice(0, 600) : '' }); if (this.items.length > 50) this.items.pop(); this.render(); },
  render() { let b = document.getElementById('errlog'); if (!b) { b = document.createElement('div'); b.id = 'errlog'; document.body.appendChild(b);
      b.addEventListener('click', e => { if (e.target.id === 'el_tg') b.classList.toggle('open'); if (e.target.id === 'el_clear') { this.items = []; this.render(); } if (e.target.id === 'el_copy') { navigator.clipboard.writeText(this.items.map(i => `[${i.t}] ${i.msg}${i.detail ? '\n    ' + i.detail : ''}`).join('\n')).then(() => toast('已複製錯誤紀錄')); } }); }
    const n = this.items.length; b.hidden = !n;
    b.innerHTML = `<button id="el_tg">⚠ 錯誤紀錄 ${n}</button><div class="el_box"><div class="el_hd"><b>錯誤紀錄</b><span><button id="el_copy">複製全部</button><button id="el_clear">清除</button></span></div>${this.items.map(i => `<div class="el_it"><small>${i.t}</small><div>${esc(i.msg)}</div>${i.detail ? `<pre>${esc(i.detail)}</pre>` : ''}</div>`).join('')}</div>`; }
};
window.addEventListener('error', e => ErrLog.add('程式錯誤：' + (e.message || ''), (e.filename || '') + ':' + (e.lineno || '') + (e.error && e.error.stack ? '\n' + e.error.stack : '')));
window.addEventListener('unhandledrejection', e => { const r = e.reason || {}; ErrLog.add('未處理的錯誤：' + (r.message || String(r)), r.stack || ''); });
const fmtT = s => s ? new Date(s).toLocaleString('zh-TW', { hour12: false }) : '';

// ── 資料層（真 / 假）──
const mem = {
  products: [{ id: 1, name: '亞麻襯衫', sub: 'Linen Shirt', description: '', price: 1280, category: '上衣', sizes: ['S', 'M', 'L'], images: [], published: true, arrival_date: '2026-11-10' }],
  categories: [{ id: 1, name: '上衣', name_en: 'Tops', sort_order: 1 }, { id: 2, name: '外套', name_en: 'Outerwear', sort_order: 2 }],
  banners: [{ id: 1, bg_word: 'AUTUMN', title: '秋季新品', image_url: '', published: true, sort_order: 1 }],
  orders: [{ id: 1, order_no: 'ES1103A', customer_name: '王小明', phone: '0912345678', email: '', address: '7-11 示範門市', shipping_method: '7-11 取貨付款', shipping_fee: 60, items: [{ name: '亞麻襯衫', size: 'M', qty: 1, price: 1280 }], total: 1340, status: '待確認', tracking_no: '', created_at: new Date().toISOString() }],
  size_charts: [], social_posts: [], post_templates: []
};
async function R(path, o = {}) {
  if (!MOCK) return SB.rest(path, o);
  const [tbl, qs = ''] = path.split('?'); const t = mem[tbl]; const m = o.method || 'GET';
  const idm = qs.match(/id=eq\.(\d+)/); const id = idm && +idm[1];
  if (m === 'GET') return t.map(x => ({ ...x })).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (m === 'POST') { const r = { id: Date.now(), created_at: new Date().toISOString(), ...o.body }; t.push(r); return [r]; }
  const i = t.findIndex(x => x.id === id);
  if (m === 'PATCH' && i >= 0) { Object.assign(t[i], o.body); return [t[i]]; }
  if (m === 'DELETE' && i >= 0) t.splice(i, 1);
  return null;
}
async function up(file) { return MOCK ? URL.createObjectURL(file) : SB.upload(file); }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast('發生錯誤：' + e.message, true); ErrLog.add('發生錯誤：' + e.message, e.stack || ''); console.error(e); } };
// 兩段式刪除：第一次按變成「再按一次確認」
const sure = e => { if (e.target.dataset.sure) return true; e.target.textContent = '再按一次確認'; e.target.dataset.sure = 1; return false; };

// ── 登入 ──
function showApp() { $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#who').textContent = MOCK ? '預覽模式' : SB.email(); go(location.hash.slice(1) || 'studio'); }
$('#lf').onsubmit = async e => { e.preventDefault(); $('#lerr').textContent = '';
  try { await SB.login($('#le').value.trim(), $('#lp').value); showApp(); } catch (x) { $('#lerr').textContent = x.message; } };
$('#out').onclick = () => { SB.logout(); location.reload(); };

// ── 導覽 ──
const TABS = [['studio', '上架工作台'], ['products', '商品'], ['orders', '訂單'], ['categories', '分類'], ['sizecharts', '尺碼表'], ['social', '社群發文'], ['settings', '設定檢查']];
$('#nav').innerHTML = TABS.map(([k, n]) => `<button data-k="${k}">${n}</button>`).join('');
$('#nav').onclick = e => { const k = e.target.dataset.k; if (k) go(k); };
const V = {};
function go(k) { if (!V[k]) k = 'studio'; location.hash = k;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  $('#view').innerHTML = '<div style="color:var(--gray)">載入中…</div>';
  V[k]().catch(e => { console.error(e); $('#view').innerHTML = `<div class="note"><b>這一頁載入失敗</b><br>${esc(e.message || e)}<br><span style="color:var(--gray)">把這段文字截圖給 Claude。</span></div><div class="bar"><button class="btn ghost sm" onclick="location.reload()">重新載入</button><button class="btn danger sm" onclick="localStorage.removeItem('es_studio_draft_v2');location.reload()">清除草稿後重新載入</button></div>`; }); }
const view = h => { const v = $('#view'); v.onclick = v.onchange = v.oninput = null; v.innerHTML = h; };
const catOpts = (cats, cur) => cats.map(c => `<option ${c.name === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

// ── 商品（依分類分組）──
V.products = async () => {
  const [ps, cs] = await Promise.all([R('products?select=*&order=id.desc'), R('categories?select=*&order=sort_order')]);
  const names = cs.map(c => c.name); ps.forEach(p => { if (!names.includes(p.category)) names.push(p.category || '未分類'); });
  const card = p => `<div class="pcard"><img src="${esc((p.images || [])[0] || p.cutout_url || '')}" alt=""><b>${esc(p.name)}</b>
    <span>NT$${esc(p.price)}${p.cutout_url ? '　<span class="tag ok">有去背圖</span>' : '　<span class="tag warn">無去背圖</span>'}</span><span>${p.published ? '<span class="tag ok">已上架</span>' : '<span class="tag warn">草稿</span>'}</span>
    <div class="bar" style="margin:4px 0 0"><button class="btn ghost sm" data-a="edit" data-id="${p.id}">編輯</button><button class="btn ghost sm" data-a="pub" data-id="${p.id}">${p.published ? '下架' : '上架'}</button><button class="btn danger sm" data-a="del" data-id="${p.id}">刪除</button></div></div>`;
  view(`<h2>商品</h2><div class="bar"><button class="btn wine" id="np">＋ 新增商品（上架工作台）</button><span style="color:var(--gray)">共 ${ps.length} 件，已上架 ${ps.filter(p => p.published).length} 件</span></div>
  ${names.map(n => { const g = ps.filter(p => (p.category || '未分類') === n); return g.length ? `<div class="card"><h3>${esc(n)}　<small style="color:var(--gray);font-weight:400">${g.length} 件（已上架 ${g.filter(p => p.published).length}）</small></h3><div class="grid">${g.map(card).join('')}</div></div>` : ''; }).join('') || '<div style="color:var(--gray)">還沒有商品</div>'}`);
  $('#view').onclick = guard(async e => { const t = e.target, a = t.dataset.a, id = String(t.dataset.id);
    if (t.id === 'np') { V.studio.reset = true; V.studio.editId = null; return go('studio'); }
    if (!a) return; const p = ps.find(x => String(x.id) === id);
    if (a === 'edit') { V.studio.reset = true; V.studio.editId = id; return go('studio'); }
    if (a === 'pub') { await R('products?id=eq.' + id, { method: 'PATCH', body: { published: !p.published } }); V.products(); }
    if (a === 'del') { if (!sure(e)) return; await R('products?id=eq.' + id, { method: 'DELETE' }); toast('已刪除'); V.products(); } });
};

// ── 訂單 ──
const STAT = ['待確認', '待出貨', '已出貨', '已完成', '已婉拒'];
const itemsText = o => (o.items || []).map(i => `${i.name} (尺寸:${i.size}) x${i.qty} — NT$${(i.price || 0) * i.qty}`).join('\n');
async function mail(o, approved) {
  if (MOCK || !o.email || typeof emailjs === 'undefined') return;
  const C = window.ES_CONFIG; emailjs.init(C.EMAILJS_PUBLIC_KEY);
  await emailjs.send(C.EMAILJS_SERVICE_ID, C.EMAILJS_CUSTOMER_TEMPLATE, { email: o.email, customer_name: o.customer_name, order_no: o.order_no, items: itemsText(o), total: o.total, approved });
}
V.orders = async () => {
  const os = await R('orders?select=*&order=created_at.desc');
  const f = V.orders.f || '待確認'; const list = os.filter(o => f === '全部' || o.status === f);
  view(`<h2>訂單</h2><div class="bar">${['全部', ...STAT].map(s => `<button class="btn ${s === f ? '' : 'ghost'} sm" data-f="${s}">${s}（${s === '全部' ? os.length : os.filter(o => o.status === s).length}）</button>`).join('')}<button class="btn ghost sm" id="csv" style="margin-left:auto">匯出 CSV</button></div>
  ${list.map(o => `<div class="card"><div class="bar"><b>${esc(o.order_no)}</b><span class="tag">${esc(o.status)}</span><span style="color:var(--gray)">${fmtT(o.created_at)}</span><span style="margin-left:auto"><b>NT$${esc(o.total)}</b></span></div>
    <div>${esc(o.customer_name)}　${esc(o.phone)}　${esc(o.email || '')}</div><div style="color:var(--gray)">${esc(o.shipping_method)}｜${esc(o.address)}</div><pre style="font:inherit;margin:6px 0">${esc(itemsText(o))}</pre>
    <div class="bar">${o.status === '待確認' ? `<button class="btn wine sm" data-a="ok" data-id="${o.id}">確認成立</button><button class="btn danger sm" data-a="no" data-id="${o.id}">婉拒</button>` : ''}
    ${o.status === '待出貨' || o.status === '已出貨' ? `<input id="tr${o.id}" value="${esc(o.tracking_no || '')}" placeholder="物流單號" style="max-width:200px"><button class="btn ghost sm" data-a="ship" data-id="${o.id}">存單號並標為已出貨</button>` : ''}
    ${o.status === '已出貨' ? `<button class="btn ghost sm" data-a="done" data-id="${o.id}">標為已完成</button>` : ''}<button class="btn danger sm" data-a="del" data-id="${o.id}">刪除</button></div></div>`).join('') || '<div style="color:var(--gray)">沒有訂單</div>'}`);
  $('#view').onclick = guard(async e => {
    if (e.target.dataset.f) { V.orders.f = e.target.dataset.f; return V.orders(); }
    if (e.target.id === 'csv') { const rows = [['單號', '狀態', '姓名', '電話', '配送', '門市/地址', '品項', '總額', '物流單號', '時間'], ...os.map(o => [o.order_no, o.status, o.customer_name, o.phone, o.shipping_method, o.address, itemsText(o).replace(/\n/g, '；'), o.total, o.tracking_no || '', o.created_at])];
      const csv = '﻿' + rows.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'orders.csv'; a.click(); return; }
    const a = e.target.dataset.a, id = String(e.target.dataset.id); if (!a) return; const o = os.find(x => String(x.id) === id); const P = body => R('orders?id=eq.' + id, { method: 'PATCH', body });
    if (a === 'ok') { await P({ status: '待出貨' }); await mail(o, true).catch(() => toast('狀態已更新，但通知信寄送失敗')); }
    if (a === 'no') { await P({ status: '已婉拒' }); await mail(o, false).catch(() => {}); }
    if (a === 'ship') await P({ status: '已出貨', tracking_no: $('#tr' + id).value.trim() });
    if (a === 'done') await P({ status: '已完成' });
    if (a === 'del') { if (!sure(e)) return; await R('orders?id=eq.' + id, { method: 'DELETE' }); }
    toast('已更新'); V.orders();
  });
};

// ── 分類 ──
V.categories = async () => {
  const cs = await R('categories?select=*&order=sort_order');
  view(`<h2>分類</h2><div class="card scroll"><table><tr><th>排序</th><th>中文名</th><th>英文名</th><th></th></tr>${cs.map(c => `<tr><td><input type="number" value="${c.sort_order}" data-f="sort_order" data-id="${c.id}" style="width:70px"></td><td><input value="${esc(c.name)}" data-f="name" data-id="${c.id}"></td><td><input value="${esc(c.name_en || '')}" data-f="name_en" data-id="${c.id}"></td><td><button class="btn danger sm" data-del="${c.id}">刪除</button></td></tr>`).join('')}</table></div>
  <div class="card bar"><input id="cn" placeholder="新分類中文名" style="max-width:200px"><input id="ce" placeholder="英文名" style="max-width:200px"><button class="btn wine" id="ca">新增</button></div>`);
  $('#view').onchange = guard(async e => { const t = e.target; if (!t.dataset.f) return; await R('categories?id=eq.' + t.dataset.id, { method: 'PATCH', body: { [t.dataset.f]: t.dataset.f === 'sort_order' ? +t.value : t.value } }); toast('已儲存'); });
  $('#view').onclick = guard(async e => { if (e.target.id === 'ca') { if (!$('#cn').value.trim()) return; await R('categories', { method: 'POST', body: { name: $('#cn').value.trim(), name_en: $('#ce').value.trim(), sort_order: cs.length + 1 } }); V.categories(); }
    if (e.target.dataset.del) { if (!sure(e)) return; await R('categories?id=eq.' + e.target.dataset.del, { method: 'DELETE' }); V.categories(); } });
};

// （Banner 管理頁已移除：首頁改為 Runway 輪播，直接用商品的模特去背圖；2026-11-09）

// ── 尺碼表：上傳截圖 → AI 預填 → 人工確認／修改 → 儲存 ──
V.sizecharts = async () => {
  const [ps, scs] = await Promise.all([R('products?select=id,name&order=id.desc'), R('size_charts?select=*').catch(() => null)]);
  if (!scs) return view('<h2>尺碼表</h2><div class="note">尚未建立 size_charts 資料表。請先執行 sql/03_新資料表.sql。</div>');
  let st = { headers: [], rows: [], img: '' };
  view(`<h2>尺碼表</h2>${API.live() ? '' : '<div class="note">目前「AI 讀取」是示範假資料（尚未接 AI）；表格可手動修改，儲存功能是真的。</div>'}
  <div class="card"><div class="row"><div><label>商品</label><select id="sp">${ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div><div><label>尺碼表截圖</label><input type="file" id="sf" accept="image/*"></div></div>
  <div class="bar" style="margin-top:10px"><button class="btn wine" id="sread">AI 讀取</button><button class="btn ghost" id="sblank">手動建立空白表</button></div><div id="sed"></div></div>
  <h2 style="font-size:18px">已儲存</h2><div class="card scroll"><table><tr><th>商品</th><th>狀態</th><th>內容</th><th></th></tr>${scs.map(s => `<tr><td>${esc((ps.find(p => p.id === s.product_id) || {}).name || s.product_id)}</td><td>${s.confirmed ? '<span class="tag ok">已確認</span>' : '<span class="tag warn">未確認</span>'}</td><td>${esc((s.headers || []).join(' / '))}（${(s.rows || []).length} 列）</td><td><button class="btn danger sm" data-del="${s.id}">刪除</button></td></tr>`).join('') || '<tr><td colspan="4" style="color:var(--gray)">尚無</td></tr>'}</table></div>`);
  const draw = () => { $('#sed').innerHTML = `<div class="scroll" style="margin-top:12px"><table><tr>${st.headers.map((h, i) => `<th><input value="${esc(h)}" data-h="${i}"></th>`).join('')}<th></th></tr>
    ${st.rows.map((r, ri) => `<tr>${r.map((c, ci) => `<td><input value="${esc(c)}" data-r="${ri}" data-c="${ci}"></td>`).join('')}<td><button class="btn ghost sm" data-rr="${ri}">刪列</button></td></tr>`).join('')}</table></div>
    <div class="bar" style="margin-top:8px"><button class="btn ghost sm" id="addr">＋ 列</button><button class="btn ghost sm" id="addc">＋ 欄</button><span style="color:var(--gray)">AI 讀到的數字可能有誤，請對照原圖逐格確認。</span></div>
    <div class="bar"><button class="btn wine" id="ssave">我已確認，儲存</button></div>`; };
  $('#view').oninput = e => { const t = e.target; if (t.dataset.h) st.headers[+t.dataset.h] = t.value; if (t.dataset.r) st.rows[+t.dataset.r][+t.dataset.c] = t.value; };
  $('#view').onclick = guard(async e => { const id = e.target.id;
    if (id === 'sblank') { st = { headers: ['尺寸', '肩寬', '胸圍', '衣長'], rows: [['S', '', '', ''], ['M', '', '', ''], ['L', '', '', '']], img: st.img }; draw(); }
    if (id === 'sread') { const f = $('#sf').files[0]; if (!f) return toast('請先選擇截圖'); e.target.textContent = '讀取中…'; st.img = await up(f);
      const r = await API.readSizeChart(st.img); st = { headers: r.headers, rows: r.rows, img: st.img }; e.target.textContent = 'AI 讀取'; draw(); toast(r.stub ? '（示範資料）請確認內容' : '讀取完成，請逐格確認'); }
    if (id === 'addr') { st.rows.push(st.headers.map(() => '')); draw(); } if (id === 'addc') { st.headers.push('新欄'); st.rows.forEach(r => r.push('')); draw(); }
    if (e.target.dataset.rr) { st.rows.splice(+e.target.dataset.rr, 1); draw(); }
    if (id === 'ssave') { const pid = $('#sp').value; const old = scs.find(s => String(s.product_id) === String(pid)); const body = { product_id: pid, image_url: st.img, headers: st.headers, rows: st.rows, confirmed: true };
      if (old) await R('size_charts?id=eq.' + old.id, { method: 'PATCH', body }); else await R('size_charts', { method: 'POST', body }); toast('已儲存'); V.sizecharts(); }
    if (e.target.dataset.del) { if (!sure(e)) return; await R('size_charts?id=eq.' + e.target.dataset.del, { method: 'DELETE' }); V.sizecharts(); } });
};

// ── 社群發文：文案 → 草稿 → 審核 → 排程 → 發布 ──
const PL = { facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads' };
const SS = { draft: ['草稿', 'warn'], review: ['待審核', 'warn'], scheduled: ['已排程', ''], published: ['已發布', 'ok'], failed: ['失敗', 'err'] };
V.social = async () => {
  const [ps, posts] = await Promise.all([R('products?select=*&order=id.desc'), R('social_posts?select=*&order=id.desc').catch(() => null)]);
  if (!posts) return view('<h2>社群發文</h2><div class="note">尚未建立 social_posts 資料表。請先執行 sql/03_新資料表.sql。</div>');
  view(`<h2>社群發文</h2><div class="note">流程：產生文案 → 存成草稿 → 送審 → 你核准並設定時間（排程）或立即發布。目前 Facebook／Instagram／Threads 尚未串接${API.live() ? '' : '，按鈕為示範'}；<b>示範階段不會有任何貼文真的送出</b>。</div>
  <div class="card"><div class="row"><div><label>商品</label><select id="sp">${ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div></div>
  <div class="bar" style="margin-top:10px"><button class="btn ghost" id="gen">AI 產生文案</button></div>
  <label>文案</label><textarea id="cap" style="min-height:120px"></textarea>
  <div class="bar" style="margin-top:8px">${Object.entries(PL).map(([k, n]) => `<label style="display:flex;gap:4px;align-items:center;margin:0"><input type="checkbox" value="${k}" class="pl" style="width:auto" ${k !== 'threads' ? 'checked' : ''}>${n}</label>`).join('')}<button class="btn wine" id="sd" style="margin-left:auto">存成草稿</button></div></div>
  <div class="card scroll"><table><tr><th>商品</th><th>平台</th><th>文案</th><th>狀態</th><th>排程時間</th><th></th></tr>${posts.map(p => { const s = SS[p.status] || [p.status, '']; return `<tr><td>${esc((ps.find(x => x.id === p.product_id) || {}).name || '')}</td><td>${(p.platforms || []).map(k => PL[k]).join('、')}</td><td style="max-width:260px;white-space:pre-wrap">${esc((p.caption || '').slice(0, 80))}</td><td><span class="tag ${s[1]}">${s[0]}</span>${p.error ? `<div class="err">${esc(p.error)}</div>` : ''}</td>
  <td>${p.status === 'review' || p.status === 'scheduled' ? `<input type="datetime-local" id="at${p.id}" value="${p.scheduled_at ? p.scheduled_at.slice(0, 16) : ''}" style="min-width:170px">` : fmtT(p.published_at || p.scheduled_at)}</td>
  <td><div class="bar" style="margin:0">${p.status === 'draft' ? `<button class="btn ghost sm" data-a="review" data-id="${p.id}">送審</button>` : ''}${p.status === 'review' || p.status === 'scheduled' ? `<button class="btn wine sm" data-a="sched" data-id="${p.id}">核准並排程</button><button class="btn ghost sm" data-a="now" data-id="${p.id}">立即發布</button>` : ''}${p.status === 'failed' ? `<button class="btn ghost sm" data-a="review" data-id="${p.id}">改回待審核</button>` : ''}<button class="btn danger sm" data-a="del" data-id="${p.id}">刪除</button></div></td></tr>`; }).join('') || '<tr><td colspan="6" style="color:var(--gray)">尚無貼文</td></tr>'}</table></div>`);
  $('#view').onclick = guard(async e => { const id = e.target.id, a = e.target.dataset.a, pid = String(e.target.dataset.id);
    if (id === 'gen') { const p = ps.find(x => String(x.id) === $('#sp').value); e.target.textContent = '產生中…'; const r = await API.genCaption(p); $('#cap').value = r.caption; e.target.textContent = 'AI 產生文案'; toast(r.stub ? '（示範文案，尚未接 AI）' : '已產生，請檢查後再用'); }
    if (id === 'sd') { const pl = [...document.querySelectorAll('.pl:checked')].map(x => x.value); if (!$('#cap').value.trim() || !pl.length) return toast('請填文案並選擇平台');
      const p = ps.find(x => String(x.id) === $('#sp').value); await R('social_posts', { method: 'POST', body: { product_id: p.id, platforms: pl, caption: $('#cap').value, image_url: (p.images || [])[0] || '', status: 'draft' } }); toast('已存成草稿'); V.social(); }
    if (!a) return; const P = body => R('social_posts?id=eq.' + pid, { method: 'PATCH', body }); const post = posts.find(x => String(x.id) === pid);
    if (a === 'review') await P({ status: 'review', error: null });
    if (a === 'sched') { const v = $('#at' + pid).value; if (!v) return toast('請先選擇排程時間'); if (new Date(v) < new Date()) return toast('排程時間已過'); await P({ status: 'scheduled', scheduled_at: new Date(v).toISOString() }); }
    if (a === 'now') { try { await API.publishNow(post); await P({ status: 'published', published_at: new Date().toISOString() }); } catch (x) { await P({ status: 'failed', error: x.message }); } }
    if (a === 'del') { if (!sure(e)) return; await R('social_posts?id=eq.' + pid, { method: 'DELETE' }); }
    V.social(); });
};

// ── 設定檢查：只顯示「有沒有設」，不顯示金鑰內容 ──
V.settings = async () => {
  const r = await API.secretsStatus(); const names = { OPENROUTER_API_KEY: 'AI（OpenRouter）金鑰', META_PAGE_TOKEN: 'Facebook 粉專 Token', META_PAGE_ID: 'Facebook 粉專 ID', IG_USER_ID: 'Instagram 商業帳號 ID', THREADS_TOKEN: 'Threads Token', THREADS_USER_ID: 'Threads 使用者 ID' };
  view(`<h2>設定檢查</h2>${r.unavailable ? '<div class="note">金鑰狀態查不到：Edge Function <code>secrets-status</code> 尚未部署，下表暫時全部顯示未設定。</div>' : r.stub ? '<div class="note">目前是示範資料（尚未部署 Edge Functions），所以全部顯示未設定。</div>' : ''}
  <div class="card"><table><tr><th>項目</th><th>狀態</th></tr>${Object.entries(names).map(([k, n]) => `<tr><td>${n}<div style="color:var(--gray);font-size:11px">${k}</div></td><td>${r.secrets[k] ? '<span class="tag ok">已設定</span>' : '<span class="tag err">未設定</span>'}</td></tr>`).join('')}</table></div>
  <div class="card"><b>Sheet 自動檢索</b><div class="note" style="margin-top:6px">在「商品總表」試算表：擴充功能 → Apps Script → 貼上 <code>sheets/apps-script-商品查詢.gs</code> → 部署為網頁應用程式（執行身分：我；存取：任何人）。把網址與你在程式裡設的密語填在這裡（只存在這台瀏覽器）。</div>
    <label>Apps Script 網頁應用程式網址</label><input id="sheet_url" value="${esc(localStorage.getItem('es_sheet_url') || '')}" placeholder="https://script.google.com/macros/s/…/exec" style="width:100%">
    <label style="margin-top:8px">密語（token）</label><input id="sheet_token" type="password" value="${esc(localStorage.getItem('es_sheet_token') || '')}" style="width:100%">
    <div class="bar" style="margin-top:8px"><button class="btn wine sm" id="sheet_save">儲存並測試</button><span id="sheet_msg" style="color:var(--gray)"></span></div></div>
  <div class="card"><b>金鑰放哪裡？</b><div style="color:var(--gray)">全部放在 Supabase 的 Edge Function Secrets，不放在網頁、不放在這個後台。這頁只回報「有沒有設」，永遠看不到金鑰本身。</div></div>`);
  $('#view').onclick = guard(async e => { if (e.target.id !== 'sheet_save') return;
    const url = $('#sheet_url').value.trim(), tk = $('#sheet_token').value.trim(); localStorage.setItem('es_sheet_url', url); localStorage.setItem('es_sheet_token', tk);
    $('#sheet_msg').textContent = '測試中…'; if (typeof SheetDB !== 'undefined') { const rows = await SheetDB.load(true); $('#sheet_msg').textContent = SheetDB.err && !rows.length ? SheetDB.err : '可以連線：讀到 ' + rows.length + ' 件商品' + (SheetDB.err ? '（' + SheetDB.err + '）' : ''); } });
};

// 啟動（放最後，確保上面都定義完）
window.addEventListener('load', () => { if (MOCK || SB.isAdmin()) showApp(); });
