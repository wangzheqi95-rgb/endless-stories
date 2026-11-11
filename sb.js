// Supabase 連線＋管理員登入（Auth REST）。登入後的 token 只存在這個瀏覽器的 localStorage。
const SB = (() => {
  const C = window.ES_CONFIG, KEY = 'es_admin_session';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const save = s => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} };
  const jwt = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch { return {}; } };
  async function auth(grant, body) {
    const r = await fetch(C.SB_URL + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST', headers: { apikey: C.SB_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.msg || '登入失敗');
    return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000, email: j.user && j.user.email };
  }
  async function token() {
    let s = read(); if (!s) return null;
    if (s.expires_at - Date.now() < 60000) {
      try { s = await auth('refresh_token', { refresh_token: s.refresh_token }); save(s); } catch { save(null); return null; }
    }
    return s.access_token;
  }
  const isAdmin = () => { const s = read(); return !!s && (jwt(s.access_token).app_metadata || {}).role === 'admin'; };
  async function login(email, pw) {
    const s = await auth('password', { email, password: pw });
    if ((jwt(s.access_token).app_metadata || {}).role !== 'admin') throw new Error('此帳號不是管理員');
    save(s); return s;
  }
  async function rest(path, opts = {}) {
    const t = await token(), m = opts.method || 'GET';
    const h = { apikey: C.SB_ANON_KEY, 'Content-Type': 'application/json' };
    if (t) h.Authorization = 'Bearer ' + t;   // 沒登入就只送 apikey（新格式 sb_publishable_ 金鑰不是 JWT，不能放進 Bearer）
    if (m !== 'GET' && m !== 'DELETE') h.Prefer = opts.prefer || 'return=representation';
    const r = await fetch(C.SB_URL + '/rest/v1/' + path, { method: m, headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined });
    if (!r.ok) throw new Error(r.status + ': ' + await r.text());
    return r.status === 204 ? null : (r.headers.get('content-type') || '').includes('json') ? r.json() : null;
  }
  async function upload(file) {
    const t = await token(); if (!t) throw new Error('未登入');
    const name = Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + (file.name.split('.').pop() || 'jpg');
    const r = await fetch(C.SB_URL + '/storage/v1/object/product-images/' + name, { method: 'POST',
      headers: { apikey: C.SB_ANON_KEY, Authorization: 'Bearer ' + t, 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!r.ok) throw new Error('上傳失敗 ' + r.status);
    return C.SB_URL + '/storage/v1/object/public/product-images/' + name;
  }
  return { login, logout: () => save(null), isAdmin, rest, upload, email: () => (read() || {}).email };
})();
