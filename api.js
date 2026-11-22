// 呼叫 Supabase Edge Functions 的薄層。FN_BASE 為空時走「假回應」，讓前端畫面能先測；
// 之後我們一起部署 Functions、填入 FN_BASE，就會自動改走真的（金鑰都在 Supabase Secrets，不在瀏覽器）。
const API = (() => {
  const live = () => !!window.ES_CONFIG.FN_BASE && !new URLSearchParams(location.search).has('mock');   // 預覽模式（?mock）一律用假回應，不碰付費 API
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function call(name, body) {
    const t = await (async () => { try { return JSON.parse(localStorage.getItem('es_admin_session')).access_token; } catch { return ''; } })();
    const r = await fetch(window.ES_CONFIG.FN_BASE + '/' + name, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('錯誤 ' + r.status));
    return j;
  }
  return {
    live,
    // 讀尺碼表圖片 → 回傳 {headers:[], rows:[[]]}（AI 預填，由人確認）
    async readSizeChart(imageUrl) {
      if (live()) return call('size-chart-read', { imageUrl });
      await wait(900);
      return { stub: true, headers: ['尺寸', '肩寬', '胸圍', '衣長', '袖長'],
        rows: [['S', '40', '92', '62', '58'], ['M', '42', '96', '64', '59'], ['L', '44', '100', '66', '60']] };
    },
    async genCaption(p) {
      if (live()) return call('ai-caption', p);
      await wait(900);
      return { stub: true, caption: `【新品預購】${p.name}\n${p.sub || ''}\nNT$${p.price}　尺寸 ${(p.sizes || []).join('/')}\n預購制・7–14 個工作天到貨・超商取貨付款\n#EndlessStories #預購 #韓系穿搭` };
    },
    // 換模特（AI）：衣服圖 +（可選）基準模特圖 → 回傳 {url}。正式走 Edge Function `gen-model`（Gemini，金鑰在 Supabase Secrets）；
    // 尚未部署時回示範圖（stub:true），只用來測畫面與流程。【Gemini 連線未實測】
    async makeModel({ imageUrl, baseUrl, prompt }) {
      if (live()) return call('gen-model', { imageUrl, baseUrl: baseUrl || '', prompt: prompt || '' });
      await wait(1200);
      return { stub: true, url: 'img/model-cut.png' };
    },
    async publishNow(post) { if (live()) return call('social-publish', { id: post.id }); await wait(700); return { stub: true, ok: true }; },
    async secretsStatus() {
      if (live()) { try { return await call('secrets-status', {}); } catch (e) { return { stub: true, unavailable: true, secrets: {} }; } }   // 函式尚未部署時不要讓設定頁整頁壞掉
      await wait(300);
      return { stub: true, secrets: { GEMINI_API_KEY: false, OPENROUTER_API_KEY: false, META_PAGE_TOKEN: false, META_PAGE_ID: false, IG_USER_ID: false, THREADS_TOKEN: false, THREADS_USER_ID: false } };
    }
  };
})();
