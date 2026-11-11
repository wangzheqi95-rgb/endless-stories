// 會員（客人用）：Email＋密碼、Google 登入；訪客仍可直接下單。
// 登入用 Supabase Auth；會員的尺碼資料存 member_profiles（只有本人讀寫）。
// 【未實測】真實登入需要你在 Supabase 開啟 Email 與 Google 供應商、設定 Redirect URL。預覽模式（?mock）用假登入。
const Member = (() => {
  const KEY = 'es_member_session', C = () => window.ES_CONFIG, MOCKM = new URLSearchParams(location.search).has('mock');
  const rd = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const sv = s => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (e) {} };
  const jwt = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; } };
  let S = rd(), panel = null, mode = 'in', msg = '';
  let view = 'main', orders = null, orderErr = '', lk = { no: '', res: null, err: '' };   // 我的訂單／訪客查單（Claude 加的）
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Google 登入回來時，網址 # 會帶 access_token
  (function fromHash() {
    const m = location.hash.match(/access_token=([^&]+).*refresh_token=([^&]+)/); if (!m) return;
    const t = decodeURIComponent(m[1]); S = { access_token: t, refresh_token: decodeURIComponent(m[2]), email: jwt(t).email, uid: jwt(t).sub, exp: (jwt(t).exp || 0) * 1000 };
    sv(S); history.replaceState(null, '', location.pathname + location.search);
  })();

  async function auth(path, body, q) {
    const r = await fetch(C().SB_URL + '/auth/v1/' + path + (q || ''), { method: 'POST', headers: { apikey: C().SB_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.msg || '失敗'); return j;
  }
  const mk = j => ({ access_token: j.access_token, refresh_token: j.refresh_token, email: j.user && j.user.email, uid: j.user && j.user.id, exp: Date.now() + j.expires_in * 1000 });
  async function token() {
    if (!S) return null; if (MOCKM) return 'mock';
    if (S.exp - Date.now() < 60000) { try { S = mk(await auth('token', { refresh_token: S.refresh_token }, '?grant_type=refresh_token')); sv(S); } catch (e) { S = null; sv(null); return null; } }
    return S.access_token;
  }
  async function rest(path, o = {}) {
    if (MOCKM) return [];
    const t = await token(); if (!t) throw new Error('未登入');
    const r = await fetch(C().SB_URL + '/rest/v1/' + path, { method: o.method || 'GET', headers: { apikey: C().SB_ANON_KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', Prefer: o.prefer || 'return=representation' }, body: o.body ? JSON.stringify(o.body) : undefined });
    if (!r.ok) throw new Error(await r.text()); return r.status === 204 ? null : r.json();
  }

  async function login(email, pw) { if (MOCKM) { S = { email, uid: 'mock', exp: Date.now() + 3e6 }; sv(S); return; } S = mk(await auth('token', { email, password: pw }, '?grant_type=password')); sv(S); await pull(); }
  async function signup(email, pw) {
    if (MOCKM) return login(email, pw);
    const j = await auth('signup', { email, password: pw }); if (j.access_token) { S = mk(j); sv(S); await pull(); return; }
    msg = '註冊成功，請到信箱點確認連結後再登入。';
  }
  const google = () => { if (MOCKM) { toast('預覽模式不連 Google'); return; } location.href = C().SB_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(location.origin + location.pathname); };
  const logout = () => { S = null; sv(null); changed(); };
  const toast = m => { if (typeof showToast === 'function') showToast(m); };

  // 尺碼資料同步：登入後拉回；尺碼面板每次變更時推上去（防抖）
  let pt = 0;
  async function pull() { try { const r = await rest('member_profiles?select=body&limit=1'); if (r && r[0] && r[0].body && typeof ESSize !== 'undefined') ESSize.setBody(r[0].body); } catch (e) { console.warn('讀取會員資料失敗', e); } changed(); }
  function push(body) { if (!S) return; clearTimeout(pt); pt = setTimeout(async () => { try { await rest('member_profiles?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { user_id: S.uid, body, updated_at: new Date().toISOString() } }); } catch (e) { console.warn('儲存會員資料失敗', e); } }, 800); }
  const listeners = []; const changed = () => { listeners.forEach(f => f(S)); if (panel && panel.classList.contains('on')) render(); };

  function render() {
    const b = panel.querySelector('.sz-body');
    if (S) { b.innerHTML = `<h3 style="font-family:var(--es-serif);font-weight:500">會員</h3><p class="sz-p">已登入：${esc(S.email)}</p><p class="sz-p">你的尺碼資料會跟著帳號保存，換裝置也能用。</p><div class="sz-nav" style="flex-direction:column"><button data-m="orders">我的訂單（含物流狀態）</button><button class="ghost" data-m="size">編輯我的尺碼</button><button class="ghost" data-m="out">登出</button></div>`; return; }
    b.innerHTML = `<div class="sz-seg"><button data-m="in" class="${mode === 'in' ? 'on' : ''}">登入</button><button data-m="up" class="${mode === 'up' ? 'on' : ''}">註冊</button></div>
      <form id="mf" class="sz-form"><div class="sz-f"><label>Email</label><input type="email" name="e" required autocomplete="email" style="width:100%;padding:10px;border:1px solid var(--es-line)"></div>
      <div class="sz-f"><label>密碼${mode === 'up' ? '（至少 6 字元）' : ''}</label><input type="password" name="p" required minlength="6" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" style="width:100%;padding:10px;border:1px solid var(--es-line)"></div>
      <div class="sz-w" id="mmsg">${esc(msg)}</div><button class="sz-go" style="margin-top:8px">${mode === 'up' ? '建立帳號' : '登入'}</button></form>
      <button class="sz-go" data-m="g" style="background:#fff;color:var(--es-ink);border:1px solid var(--es-ink)">使用 Google 繼續</button>
      <p class="sz-note">不想註冊也可以：結帳時直接以訪客下單。</p>`;
    b.querySelector('#mf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); msg = ''; const bt = e.target.querySelector('button'); bt.disabled = true;
      try { await (mode === 'up' ? signup : login)(f.get('e'), f.get('p')); changed(); } catch (x) { msg = x.message; render(); } };
  }
  // ── 訂單：會員看自己的訂單與物流；訪客只能用訂單編號查「狀態」（不含物流）──
  const STAGE = { '待確認': [0, '已收到，待確認'], '待出貨': [1, '已成立，備貨中'], '已出貨': [2, '已出貨'], '已完成': [3, '已完成'], '已婉拒': [-1, '未成立'] };
  const prog = st => { const s = STAGE[st] || [0, st || '']; if (s[0] < 0) return `<div class="mo-st bad">${esc(s[1])}</div>`;
    return `<div class="mo-prog">${['收到', '成立', '出貨', '完成'].map((n, i) => `<i class="${i <= s[0] ? 'on' : ''}"><b></b>${n}</i>`).join('')}</div><div class="mo-st">${esc(s[1])}</div>`; };
  async function fetchOrders() {
    if (MOCKM) return [{ order_no: 'ES00067890', status: '待確認', tracking_no: '', total: 1159, created_at: new Date().toISOString(), items: [{ name: '羽織（黑）', size: 'M', qty: 1 }] },
      { order_no: 'ES00012345', status: '已出貨', tracking_no: 'TW0123456789', total: 1359, created_at: new Date(Date.now() - 6 * 864e5).toISOString(), items: [{ name: '羽織（白）', size: 'L', qty: 1 }, { name: '戒指', size: '均碼', qty: 1 }] }];
    return rest('orders?select=order_no,status,tracking_no,items,total,created_at&order=created_at.desc&limit=50');   // RLS：只回本人的訂單
  }
  async function loadOrders() { try { orders = await fetchOrders(); orderErr = ''; } catch (e) { orders = []; orderErr = '讀取失敗，請稍後再試'; console.warn(e); } if (view === 'orders' && panel && panel.classList.contains('on')) render(); }
  function renderOrders() {
    const b = panel.querySelector('.sz-body'), d = s => s ? new Date(s).toLocaleDateString('zh-TW') : '';
    b.innerHTML = `<button class="sz-link" data-m="back">← 返回</button><h3 style="font-family:var(--es-serif);font-weight:500;margin:10px 0">我的訂單</h3>` +
      (orders === null ? '<p class="sz-p">讀取中…</p>' : orderErr ? `<p class="sz-w">${esc(orderErr)}</p>` : !orders.length ? '<p class="sz-p">還沒有訂單。以會員身分下的訂單會出現在這裡；訪客下的單不會自動歸入。</p>'
      : orders.map(o => `<div class="mo-card"><div class="mo-hd"><b>${esc(o.order_no)}</b><span>${d(o.created_at)}</span></div>${prog(o.status)}
        ${(o.status === '已出貨' || o.status === '已完成') && o.tracking_no ? `<div class="mo-tr">物流單號：<b>${esc(o.tracking_no)}</b></div>` : ''}
        <div class="mo-it">${(o.items || []).map(i => esc(i.name) + (i.size ? '（' + esc(i.size) + '）' : '') + ' ×' + (i.qty || 1)).join('、')}</div><div class="mo-tot">NT$${Number(o.total || 0).toLocaleString()}</div></div>`).join(''));
  }
  async function lookup(no) {
    if (MOCKM) return /^ES\d{6,}$/i.test(no) ? [{ order_no: no.toUpperCase(), status: '待確認' }] : [];
    const r = await fetch(C().SB_URL + '/rest/v1/rpc/order_status', { method: 'POST', headers: { apikey: C().SB_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_no: no }) });   // 函式一次只查一筆
    if (!r.ok) throw new Error('查詢失敗'); return r.json();
  }
  function bindLookup() {
    const b = panel.querySelector('.sz-body');
    b.insertAdjacentHTML('beforeend', `<div class="mo-lk"><h4>訂單狀態查詢</h4><p class="sz-note" style="margin:4px 0 8px">不用登入，輸入訂單編號即可查詢是否成立。物流進度與單號僅提供會員查看。</p>
      <form id="lkf" style="display:flex;gap:8px"><input name="no" value="${esc(lk.no)}" placeholder="訂單編號，例：ES12345678" style="flex:1;min-width:0;padding:10px;border:1px solid var(--es-line)"><button class="sz-nav-btn" style="padding:10px 16px;border:0;background:var(--es-ink);color:#fff;cursor:pointer">查詢</button></form>
      ${lk.err ? `<p class="sz-w">${esc(lk.err)}</p>` : lk.res ? `<p class="mo-st" style="margin-top:8px">${esc(lk.res.order_no)}：${esc(lk.res.status)}</p><p class="sz-note">想看物流進度？<button class="sz-link" data-m="in">登入會員</button>後到「我的訂單」。</p>` : ''}</div>`);
    b.querySelector('#lkf').onsubmit = async e => { e.preventDefault(); const no = String(new FormData(e.target).get('no') || '').trim().toUpperCase(); lk = { no, res: null, err: '' };
      if (!no) { render(); return; }
      try { const r = await lookup(no); lk.res = r && r[0] ? r[0] : null; if (!lk.res) lk.err = '查不到這個訂單編號，請確認後再試。'; } catch (x) { lk.err = '查詢失敗，請稍後再試。'; } render(); };
  }
  const _render0 = render;
  render = function () { if (S && view === 'orders') return renderOrders(); _render0(); if (!S) bindLookup(); };

  function open() {
    if (!panel) {
      panel = document.createElement('div'); panel.className = 'sz-panel'; panel.innerHTML = '<div class="sz-bg" data-m="x"></div><aside><header><b>會員</b><button data-m="x" aria-label="關閉">✕</button></header><div class="sz-body"></div></aside>'; document.body.appendChild(panel);
      panel.addEventListener('click', e => { const m = e.target.closest('[data-m]'); if (!m) return; const v = m.dataset.m;
        if (v === 'x') close(); else if (v === 'in' || v === 'up') { mode = v; msg = ''; render(); } else if (v === 'g') google(); else if (v === 'out') { view = 'main'; orders = null; logout(); } else if (v === 'orders') { view = 'orders'; orders = null; orderErr = ''; render(); loadOrders(); } else if (v === 'back') { view = 'main'; render(); } else if (v === 'size') { close(); ESSize.open(null); } });
    }
    render(); void panel.offsetWidth; panel.classList.add('on'); document.body.style.overflow = 'hidden';
  }
  function close() { panel.classList.remove('on'); const p = document.getElementById('pd'); if (!p || !p.classList.contains('on')) document.body.style.overflow = ''; }
  if (S && !MOCKM) pull();
  return { open, openOrders: () => { open(); if (S) { view = 'orders'; orders = null; orderErr = ''; render(); loadOrders(); } }, isIn: () => !!S, email: () => S && S.email, uid: () => S && S.uid, push, token, onChange: f => listeners.push(f) };
})();

// 頂部會員圖示：登入後顯示小圓點（Claude 加的）
(function(){const d=()=>document.getElementById('mem-dot'),f=s=>{const x=d();if(x)x.classList.toggle('on',!!s)};f(Member.isIn());Member.onChange(f);})();
// 登出時清掉尺碼資料，避免留在共用電腦（Claude 加的）
Member.onChange(s => { if (!s && typeof ESSize !== 'undefined') ESSize.clear(); });
