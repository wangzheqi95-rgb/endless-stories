// Endless Stories — app.js
// 前台：設計書 v0.2 新版；後台、購物車、結帳、EmailJS：沿用原邏輯
// ═══ CONFIG ═══
const OR_API = 'https://openrouter.ai/api/v1/chat/completions';

function getSbUrl(){ return ES_CONFIG.SB_URL; }
function getSbKey(){ return ES_CONFIG.SB_ANON_KEY; }

// ═══ STATE ═══
let products = [];
let cart = [];
let currentProd = null;
let currentQty = 1;
let currentSize = null;
let shippingFee = 65;
let currentPlatform = 'ig';
let selectedPostIds = new Set();
let currentPmCat = '全部';
let currentShopCat = '全部';

// ═══ ROUTING ═══

// ═══ SUPABASE ═══
const MOCK_MODE = new URLSearchParams(location.search).has('mock');   // 預覽模式：不連 Supabase，用假資料
async function sbFetch(path, opts={}) {
  if(MOCK_MODE) return mockFetch(path, opts);
  const url = getSbUrl().replace(/\/$/,'') + '/rest/v1/' + path;
  const key = getSbKey();
  const method = opts.method || 'GET';
  const headers = {'apikey': key, 'Content-Type': 'application/json', 'Accept': 'application/json'};
  if(opts.token) headers['Authorization'] = 'Bearer ' + opts.token;   // 訪客只送 apikey（新格式金鑰不是 JWT）
  if(method==='POST'||method==='PATCH') headers['Prefer'] = opts.prefer || 'return=representation';
  const fetchOpts = {method, headers};
  if(opts.body) fetchOpts.body = opts.body;
  const res = await fetch(url, fetchOpts);
  if(!res.ok){ const e=await res.text(); throw new Error(res.status+': '+e); }
  if(res.status===204) return null;
  const ct=res.headers.get('content-type');
  if(ct&&ct.includes('json')) return res.json();
  return null;
}

async function loadPublishedProducts() {
  try {
    const data = await sbFetch('products?published=eq.true&order=updated_at.desc');
    products = data || [];
  } catch(e) { products = []; }
}

async function loadAllProducts() {
  try {
    const data = await sbFetch('products?order=updated_at.desc');
    products = data || [];
  } catch(e) { products = []; }
}

// ═══ CATEGORIES ═══
let categories = [];

async function loadCategories() {
  try {
    const data = await sbFetch('categories?order=sort_order.asc');
    categories = data || [];
  } catch(e) { categories = []; }
}


function renderAdminCatFilter() {
  const el = document.getElementById('pm-cat-filter');
  if(!el) return;
  el.innerHTML = `<button class="cf-btn active" onclick="filterPmCat('全部',this)">All</button>` +
    categories.map(c => `<button class="cf-btn" onclick="filterPmCat('${c.name}',this)">${c.name}</button>`).join('');
}

function renderCatSelect() {
  const el = document.getElementById('add-cat');
  if(!el) return;
  el.innerHTML = categories.map(c => `<option value="${c.name}">${c.name}${c.name_en?' — '+c.name_en:''}</option>`).join('');
}


// ═══ SHOP ═══





function selSize(btn,s){ document.querySelectorAll('.sopt').forEach(b=>b.classList.remove('sel')); btn.classList.add('sel'); currentSize=s; }
function chgQty(d){ currentQty=Math.max(1,currentQty+d); document.getElementById('detail-qty-n').textContent=currentQty; }

function addToCart(){
  if(!currentSize&&(currentProd.sizes||[]).length>1){ alert('Please select a size'); return; }
  const size=currentSize||(currentProd.sizes||['Free'])[0];
  const ex=cart.find(c=>c.id===currentProd.id&&c.size===size);
  if(ex) ex.qty+=currentQty; else cart.push({...currentProd,size,qty:currentQty});
  updateCartCount(); openCart();
}

function updateCartCount(){
  const n=cart.reduce((s,c)=>s+c.qty,0);
  document.getElementById('cart-n').textContent=n;
}

function openCart(){ renderCartPanel(); document.getElementById('cart-side').classList.add('open'); document.getElementById('cart-ov-bg').classList.add('open'); document.body.style.overflow='hidden'; }
function closeCart(){ document.getElementById('cart-side').classList.remove('open'); document.getElementById('cart-ov-bg').classList.remove('open'); document.body.style.overflow=''; }

function renderCartPanel(){
  const el=document.getElementById('cart-items-wrap');
  if(!cart.length){ el.innerHTML='<div class="cart-empty">Your bag is empty.</div>'; document.getElementById('cart-subtotal').textContent='NT$0'; return; }
  el.innerHTML=cart.map((c,i)=>`
    <div class="citem">
      <div class="citem-img">${c.images&&c.images[0]?`<img src="${c.images[0]}" alt="${c.name}">`:'<div style="width:100%;height:100%;background:var(--gray)"></div>'}</div>
      <div class="citem-info">
        <div class="citem-name">${c.name}</div>
        <div class="citem-meta">Size: ${c.size} · Qty: ${c.qty}</div>
        <div class="citem-price">NT$${((c.price||0)*c.qty).toLocaleString()}</div>
      </div>
      <button class="citem-rm" onclick="removeCartItem(${i})">x</button>
    </div>
  `).join('');
  document.getElementById('cart-subtotal').textContent=`NT$${cart.reduce((s,c)=>s+(c.price||0)*c.qty,0).toLocaleString()}`;
}

function removeCartItem(i){ cart.splice(i,1); updateCartCount(); renderCartPanel(); }

function goCheckout(){
  if(typeof Member !== 'undefined' && Member.isIn()){ const fe=document.getElementById('f-email'); if(fe && !fe.value) fe.value = Member.email() || ''; }
  if(!cart.length){ alert('Your bag is empty'); return; }
  closeCart();
  const sub=cart.reduce((s,c)=>s+(c.price||0)*c.qty,0);
  document.getElementById('checkout-items-detail').innerHTML=cart.map(c=>`<div class="sum-row"><span>${c.name} x${c.qty} (${c.size})</span><span>NT$${((c.price||0)*c.qty).toLocaleString()}</span></div>`).join('')+`<div class="sum-row"><span>Shipping</span><span>NT$${shippingFee}</span></div>`;
  document.getElementById('checkout-total-amt').textContent=`NT$${(sub+shippingFee).toLocaleString()}`;
  showPage('checkout');
  window.scrollTo(0,0);
}

function selShip(el,fee,type){
  document.querySelectorAll('.ship-opt').forEach(o=>o.classList.remove('sel'));
  el.classList.add('sel'); shippingFee=fee;
  const sub=cart.reduce((s,c)=>s+(c.price||0)*c.qty,0);
  document.getElementById('checkout-total-amt').textContent=`NT$${(sub+shippingFee).toLocaleString()}`;
  // Update hint text based on store type
  const hints = {
    '711': '格式範例：7-11 台北忠孝門市，台北市大安區忠孝東路四段123號',
    'family': '格式範例：全家仁德上東城店，台南市仁德區文心路70號',
    'hilife': '格式範例：萊爾富台南仁德店，台南市仁德區文心路70號'
  };
  document.getElementById('cvs-hint').textContent = hints[type] || '';
  document.getElementById('f-cvs').placeholder = '輸入門市名稱或地址關鍵字...';
}

async function submitOrder(){
  const name=document.getElementById('f-name').value.trim();
  const phone=document.getElementById('f-phone').value.trim();
  const address = document.getElementById('f-cvs').value.trim();
  const cvsStore = document.getElementById('f-cvs').value.trim();
  if(!name||!phone){ alert('Please fill in name and phone'); return; }
  if(!cvsStore){ alert('請填寫取貨門市地址'); return; }
  const orderId='ES'+Date.now().toString().slice(-8);
  const total=cart.reduce((s,c)=>s+(c.price||0)*c.qty,0)+shippingFee;
  const shippingName=document.querySelector('.ship-opt.sel .ship-name').textContent;
  const orderData={order_no:orderId,customer_name:name,phone,email:document.getElementById('f-email').value.trim()||null,address:cvsStore,shipping_method:shippingName,shipping_fee:shippingFee,note:document.getElementById('f-note').value.trim()||null,items:JSON.parse(JSON.stringify(cart)),total,status:'待確認'};
  try { const mt = (typeof Member !== 'undefined' && Member.isIn()) ? await Member.token() : null; await sbFetch('orders',{method:'POST',prefer:'return=minimal',token: mt || undefined,body:JSON.stringify(orderData)}); } catch(e){ console.warn('Order save failed',e); showToast('訂單送出失敗，請稍後再試或聯絡我們（購物袋內容仍保留）'); return; }
  sendOrderNotification(orderData);
  document.getElementById('succ-detail').innerHTML=`<div style="font-size:10px;color:var(--mid);letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px">Order Details</div><div class="succ-row"><span>Order No.</span><span>${orderId}</span></div><div class="succ-row"><span>Name</span><span>${name}</span></div><div class="succ-row"><span>Phone</span><span>${phone}</span></div><div class="succ-row"><span>取貨門市</span><span>${address}</span></div><div class="succ-row"><span>Shipping</span><span>${shippingName}</span></div><div class="succ-row" style="font-weight:500"><span>Total</span><span>NT$${total.toLocaleString()}</span></div>`;
  cart=[]; updateCartCount();
  showPage('success');
  window.scrollTo(0,0);
  orderPopup(orderId);
}

// ── 下單後彈窗「已收到訂單，待確認」（Claude 加的）──
function orderPopup(no){
  const isIn = typeof Member!=='undefined' && Member.isIn();
  const old=document.getElementById('ord-pop'); if(old) old.remove();
  const el=document.createElement('div'); el.id='ord-pop'; el.className='ord-pop';
  el.innerHTML=`<div class="ord-bg" data-o="x"></div><div class="ord-box" role="dialog" aria-modal="true" aria-label="已收到訂單"><div class="ord-ic">✓</div><h3>已收到訂單，待確認</h3><div class="ord-no">${no}</div><p>確認成立後我們會與你聯繫。請記下訂單編號，之後可用來查詢訂單狀態。</p>
    <p class="ord-hint">${isIn?'登入狀態下，可在「我的訂單」查看物流進度。':'物流進度與單號僅提供會員查看。登入或註冊後，之後的訂單可在「我的訂單」追蹤。'}</p>
    <div class="ord-btns">${isIn?'<button data-o="my">查看我的訂單</button>':'<button data-o="login">登入／註冊</button>'}<button class="ghost" data-o="x">繼續逛逛</button></div></div>`;
  const close=()=>{el.remove();document.removeEventListener('keydown',esc);};
  const esc=e=>{if(e.key==='Escape')close();};
  el.addEventListener('click',e=>{const b=e.target.closest('[data-o]');if(!b)return;const v=b.dataset.o;close();
    if(v==='my')Member.openOrders();else if(v==='login')Member.open();});
  document.addEventListener('keydown',esc); document.body.appendChild(el);
}

// ═══ EMAILJS ═══
const EMAILJS_PUBLIC_KEY = ES_CONFIG.EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID = ES_CONFIG.EMAILJS_SERVICE_ID, EMAILJS_ORDER_NOTIFY_TEMPLATE = ES_CONFIG.EMAILJS_ORDER_NOTIFY_TEMPLATE, EMAILJS_CUSTOMER_TEMPLATE = ES_CONFIG.EMAILJS_CUSTOMER_TEMPLATE;

if(typeof emailjs !== 'undefined') {
  emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
}

async function sendOrderNotification(order) {
  if(MOCK_MODE){ console.log('預覽模式：不寄通知信'); return; }
  if(typeof emailjs === 'undefined') { console.warn('EmailJS not loaded'); return; }
  const itemsText = (order.items||[]).map(i => `${i.name} (尺寸:${i.size}) x${i.qty} — NT$${(i.price||0)*i.qty}`).join('\n');
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_ORDER_NOTIFY_TEMPLATE, {
      order_no: order.order_no,
      customer_name: order.customer_name,
      phone: order.phone,
      customer_email: order.email || '未提供',
      address: order.address,
      shipping_method: order.shipping_method,
      items: itemsText,
      total: order.total
    });
    console.log('Order notification sent');
  } catch(e) {
    console.warn('Failed to send order notification email', e);
  }
}

function showToast(msg){
  const t=document.getElementById('toast-el');
  t.textContent=msg; t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)';
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(60px)'; },3000);
}

// CVS STORE SEARCH
const CVS_SAMPLES = {
  '711': ['7-11 忠孝敦化門市，台北市大安區敦化南路一段161號','7-11 信義市政門市，台北市信義區市府路1號','7-11 板橋文化門市，新北市板橋區文化路一段188號'],
  'family': ['全家 大安復興店，台北市大安區復興南路一段135號','全家 信義松仁店，台北市信義區松仁路58號','全家 板橋新站店，新北市板橋區縣民大道二段3號'],
  'hilife': ['萊爾富 台北信義店，台北市信義區基隆路一段180號','萊爾富 板橋江翠店，新北市板橋區文化路二段385號']
};

function getCurrentStoreType() {
  const sel = document.querySelector('.ship-opt.sel');
  if(!sel) return '711';
  const onclick = sel.getAttribute('onclick');
  if(onclick.includes('711')) return '711';
  if(onclick.includes('family')) return 'family';
  if(onclick.includes('hilife')) return 'hilife';
  return '711';
}

function searchCvsStore(val) {
  const box = document.getElementById('cvs-suggestions');
  if(!val || val.length < 2) { box.style.display='none'; return; }
  const type = getCurrentStoreType();
  const samples = CVS_SAMPLES[type] || [];
  const matches = samples.filter(s => s.includes(val));
  if(!matches.length) { box.style.display='none'; return; }
  box.innerHTML = matches.map(m => `<div style="padding:8px 12px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border)" onmousedown="selectCvsStore('${m}')" onmouseover="this.style.background='var(--gray)'" onmouseout="this.style.background=''">${m}</div>`).join('');
  box.style.display = 'block';
}

function selectCvsStore(val) {
  document.getElementById('f-cvs').value = val;
  document.getElementById('cvs-suggestions').style.display = 'none';
}

// LIGHTBOX
function openLightbox(src){
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLightbox(){
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if(e.key==='Escape') closeLightbox(); });


// ═════════════════════════════════════════════
// 前台（新設計）— 設計書 v0.2
// 首頁 banner、瀑布式列表、商品頁、玻璃導覽、動態效果
// ═════════════════════════════════════════════
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(hover:hover) and (pointer:fine) and (min-width:900px)').matches;
const CAT_EN = {'上裝':'TOPS','下裝':'BOTTOMS','配飾':'ACCESSORY','外套':'OUTERWEAR','鞋子':'SHOES','包包':'BAGS'};
const PHOTO_RATIO = {'3:4':4/3,'4:5':5/4,'1:1':1};
const MIX_CYCLE = ['3:4','1:1','4:5','3:4','4:5','1:1']; // 僅 ?ratios=mix 預覽用，看瀑布效果
const MIX_RATIOS = new URLSearchParams(location.search).get('ratios') === 'mix';
const FIG_SVG = '<svg viewBox="0 0 150 331" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#202124" d="M 75 1 C 84.4 1 92 10.4 92 22 C 92 33.6 84.4 43 75 43 C 65.6 43 58 33.6 58 22 C 58 10.4 65.6 1 75 1 Z M 38 52 Q 75 44 112 52 L 118 150 L 150 330 L 82 330 L 75 205 L 68 330 L 0 330 L 32 150 Z"/></svg>';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad2 = n => String(n).padStart(2,'0');
let shopCat = '全部';
let wfList = [];
let wfShown = 0;
let wfCols = 0;
let wfHeights = [];
let slides = [];
let slideIdx = 0;
function reservedFeature(name){ showToast('「' + name + '」功能即將推出'); }

// 首頁輪播（Runway，取代 banner／衣竿／衣櫃；Claude 加的 2026-11-09）：已上架且有模特去背圖的商品，最新 8 件
function initRunway(){
  const el = document.getElementById('runway'); if(!el || typeof Runway === 'undefined') return;
  let list = products.filter(p => p.cutout_url).map(p => ({p, img: p.cutout_url}));
  if(MOCK_MODE && !list.length) list = products.slice(0, 6).map((p, i) => ({p: Object.assign({}, p, {name: p.name || '示範商品 ' + (i + 1)}), img: 'img/model-cut.png'}));
  Runway.init(el, list, {onPick: (p, size, act) => {
    currentProd = p; currentQty = 1; currentSize = size;
    if(act === 'bag') addToCart(); else openDetail(p.id);
  }});
}

function scrollToNew(){
  document.getElementById('new').scrollIntoView({behavior: REDUCED ? 'auto' : 'smooth', block:'start'});
}

// ── 分類導覽與標籤 ──
function renderShopNav(){
  const cats = ['全部'].concat(categories.map(c => c.name));
  const btn = c => '<button data-cat="' + esc(c) + '" class="' + (c === shopCat ? 'active' : '') + '">' + esc(c) + '</button>';
  document.getElementById('shop-nav').innerHTML = cats.map(btn).join('') + '<button data-about="1">關於</button>';
  document.getElementById('cat-tabs').innerHTML = cats.map(btn).join('');
}

function setNavActive(key){
  document.querySelectorAll('#shop-nav button, #cat-tabs button').forEach(b => {
    const on = key === '__about' ? b.hasAttribute('data-about') : (b.dataset.cat === key);
    b.classList.toggle('active', on);
  });
}

function shopFilterCat(cat, scroll){
  shopCat = cat;
  showPage('shop');
  setNavActive(cat);
  renderShop(cat);
  if(scroll) scrollToNew();
}

function goHome(){
  if(shopCat !== '全部'){ shopFilterCat('全部'); }
  else { showPage('shop'); setNavActive('全部'); }
}

function showPrivacy(){ showPage('privacy'); setNavActive('__privacy'); if(location.hash !== '#privacy') history.replaceState(null, '', '#privacy'); }
function showAbout(){
  showPage('about');
  setNavActive('__about');
}

// ── 頁面切換 ──
function showPage(page){
  const map = {shop:'page-shop', about:'page-about', privacy:'page-privacy', detail:'page-detail', checkout:'checkout-wrap', success:'success-wrap'};
  Object.keys(map).forEach(k => { document.getElementById(map[k]).style.display = (k === page) ? 'block' : 'none'; });
  document.body.classList.toggle('on-detail', page === 'detail');
  window.scrollTo(0,0);
  syncSmooth();
  setTimeout(() => initReveal(), 30);
}

// ── 瀑布式列表 ──
function colCount(){
  const w = window.innerWidth;
  return w < 768 ? 2 : (w < 1100 ? 3 : 4);
}

function pageStep(n){ return n === 2 ? 8 : (n === 3 ? 9 : 12); }

function ratioKeyOf(p, idx){
  if(p.cover_ratio && PHOTO_RATIO[p.cover_ratio]) return p.cover_ratio;
  return MIX_RATIOS ? MIX_CYCLE[idx % MIX_CYCLE.length] : '3:4';
}

function buildColumns(){
  const grid = document.getElementById('shop-grid');
  grid.innerHTML = '';
  wfCols = colCount();
  wfHeights = Array(wfCols).fill(0);
  for(let i = 0; i < wfCols; i++){
    const c = document.createElement('div');
    c.className = 'wf-col';
    grid.appendChild(c);
  }
}

function cardHTML(p, idx){
  const cut = p.cutout_url;
  const img = cut || (p.images && p.images[0]);
  const key = ratioKeyOf(p, idx);
  return '<div class="pc-photo-wrap"><div class="pc-photo" style="aspect-ratio:' + key.replace(':',' / ') + '">' +
    (img ? '<img class="' + (cut ? 'cut' : '') + '" src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async">' : '<span class="pc-none">No image</span>') +
    '<div class="pc-ov"><div class="pc-idx">' + pad2(idx + 1) + '&nbsp;&nbsp;' + esc(p.category || '') + '</div>' +
    '<div class="pc-name">' + esc(p.name) + '</div>' +
    '<div class="pc-price">NT$ ' + (p.price || 0).toLocaleString() + '</div></div>' +
    '</div><span class="es-mark es-sm"><b>E</b><i>S</i></span></div>';
}

function placeCard(p, idx){
  const grid = document.getElementById('shop-grid');
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 12;
  const colW = (grid.clientWidth - gap * (wfCols - 1)) / wfCols;
  const infoH = 0; // 文字已在照片內，不再佔額外高度
  // 新的一件放進目前最短的那一欄
  let k = 0;
  for(let i = 1; i < wfCols; i++){ if(wfHeights[i] < wfHeights[k] - 0.5) k = i; }
  const el = document.createElement('div');
  el.className = 'pc reveal';
  el.dataset.id = p.id;
  const row = grid.children[k].children.length;
  el.style.setProperty('--dl', (k % 2 ? 100 : 0) + 'ms');   // 左欄先、右欄晚 0.1 秒
  el.innerHTML = cardHTML(p, idx);
  grid.children[k].appendChild(el);
  wfHeights[k] += colW * PHOTO_RATIO[ratioKeyOf(p, idx)] + infoH + 26;
}

function updateMore(){
  const more = document.getElementById('wf-more');
  const total = wfList.length;
  more.style.display = total ? 'flex' : 'none';
  document.getElementById('wf-count').textContent = '已顯示 ' + wfShown + ' / ' + total + ' 件';
  document.getElementById('wf-btn').style.display = wfShown >= total ? 'none' : 'block';
}

function loadMore(){
  const next = wfList.slice(wfShown, wfShown + pageStep(wfCols));
  next.forEach((p, i) => placeCard(p, wfShown + i));
  wfShown += next.length;
  updateMore();
  initReveal();
}

function renderShop(cat, keepCount){
  currentShopCat = cat;
  shopCat = cat;
  wfList = cat === '全部' ? products.slice() : products.filter(p => p.category === cat);
  const want = keepCount ? Math.max(wfShown, 1) : 0;
  wfShown = 0;
  const grid = document.getElementById('shop-grid');
  if(!wfList.length){
    grid.innerHTML = '<div class="wf-empty">New arrivals coming soon.<br>Follow us on Instagram for updates.</div>';
    updateMore();
    return;
  }
  buildColumns();
  if(want > pageStep(wfCols)){
    wfList.slice(0, want).forEach((p, i) => placeCard(p, i));
    wfShown = Math.min(want, wfList.length);
    updateMore();
    initReveal();
  } else {
    loadMore();
  }
}

// ── 商品頁 ──
function openDetail(id){
  const p = products.find(x => String(x.id) === String(id));
  if(!p) return;
  currentProd = p; currentQty = 1; currentSize = null;
  slides = [];
  if(p.cutout_url) slides.push({src:p.cutout_url, cut:true});
  (p.images || []).forEach(s => slides.push({src:s, cut:false}));
  slideIdx = 0;
  const catEn = CAT_EN[p.category] || ((categories.find(c => c.name === p.category) || {}).name_en || p.category || '').toUpperCase();
  document.getElementById('dt-word').textContent = catEn;
  document.getElementById('detail-cat').textContent = catEn;
  document.getElementById('detail-name').textContent = p.name;
  document.getElementById('detail-price').textContent = 'NT$ ' + (p.price || 0).toLocaleString();
  document.getElementById('detail-desc').textContent = p.description || '—';
  const preEl = document.getElementById('detail-preorder');
  if(p.preorder){ preEl.style.display = 'inline-block'; preEl.textContent = '預購・預計 9～12 個工作日到貨'; }
  else { preEl.style.display = 'none'; }
  const sizes = p.sizes || [];
  document.getElementById('detail-size-opts').innerHTML = sizes.map(s => '<button class="sopt" onclick="selSize(this,\'' + esc(s) + '\')">' + esc(s) + '</button>').join('');
  document.getElementById('dt-sizes').innerHTML = sizes.length ? sizes.map(s => '<span>' + esc(s) + '</span>').join('') : '<span>Free</span>';
  document.getElementById('detail-qty-n').textContent = 1;
  dtTab('desc', document.querySelector('.dt-tabs button'));
  renderSlide();
  showPage('detail');
}

function renderSlide(){
  const s = slides[slideIdx];
  const img = document.getElementById('detail-main-img');
  const over = document.getElementById('dt-over');
  if(s){
    img.style.display = 'block';
    img.src = s.src;
    img.classList.toggle('cut', !!s.cut);
    img.onclick = () => openLightbox(s.src);
  } else {
    img.style.display = 'none'; img.removeAttribute('src');
  }
  // 混色標題只用在去背圖上（疊在淺底與黑衣上都看得清楚）
  over.textContent = (s && s.cut && currentProd) ? currentProd.name : '';
  over.style.display = (s && s.cut) ? 'block' : 'none';
  document.getElementById('dt-count').textContent = (slides.length ? slideIdx + 1 : 0) + ' / ' + slides.length;
  const th = document.getElementById('detail-thumbs');
  th.innerHTML = slides.length > 1 ? slides.map((x, i) =>
    '<button class="dt-thumb ' + (i === slideIdx ? 'active' : '') + '" data-i="' + i + '"><img src="' + esc(x.src) + '" alt="" loading="lazy"></button>').join('') : '';
}

function dtTab(name, btn){
  ['desc','size','note'].forEach(n => { document.getElementById('dtp-' + n).style.display = (n === name) ? 'block' : 'none'; });
  document.querySelectorAll('.dt-tabs button').forEach(b => b.classList.remove('on'));
  if(btn) btn.classList.add('on');
}

function buyNow(){
  if(!currentSize && (currentProd.sizes || []).length > 1){ alert('Please select a size'); return; }
  const size = currentSize || (currentProd.sizes || ['Free'])[0];
  const ex = cart.find(c => c.id === currentProd.id && c.size === size);
  if(ex) ex.qty += currentQty; else cart.push(Object.assign({}, currentProd, {size, qty: currentQty}));
  updateCartCount();
  goCheckout();
}

// ── 進場動畫（只播一次）──
let revealIO = null;
function initReveal(){
  const els = document.querySelectorAll('.reveal:not(.in)');
  if(REDUCED || !('IntersectionObserver' in window)){ els.forEach(e => e.classList.add('in')); return; }
  if(!revealIO){
    revealIO = new IntersectionObserver(entries => {
      entries.forEach(en => { if(en.isIntersecting){ en.target.classList.add('in'); revealIO.unobserve(en.target); } });
    }, {threshold:.08, rootMargin:'0px 0px -6% 0px'});
  }
  els.forEach(e => revealIO.observe(e));
}

function onScrollFx(){}

// ── 電腦版平滑捲動（用最簡單的方式：每一瞬間往目標走剩餘距離的一小部分）──
let sTarget = 0, sCur = 0, sRaf = 0;
function syncSmooth(){
  if(sRaf){ cancelAnimationFrame(sRaf); sRaf = 0; }
  sTarget = sCur = window.scrollY;
}
function smoothTick(){
  sCur += (sTarget - sCur) * 0.12;
  if(Math.abs(sTarget - sCur) < 0.5){ sCur = sTarget; window.scrollTo(0, sCur); sRaf = 0; return; }
  window.scrollTo(0, sCur);
  sRaf = requestAnimationFrame(smoothTick);
}
function smoothInit(){
  if(REDUCED || !FINE_POINTER) return;
  sTarget = sCur = window.scrollY;
  window.addEventListener('wheel', e => {
    if(e.ctrlKey || document.body.style.overflow === 'hidden') return;
    if(e.target.closest && e.target.closest('textarea, select, .cart-items-wrap, #cvs-suggestions')) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    sTarget = Math.max(0, Math.min(max, sTarget + dy));
    if(!sRaf) sRaf = requestAnimationFrame(smoothTick);
  }, {passive:false});
  window.addEventListener('scroll', () => { if(!sRaf){ sTarget = sCur = window.scrollY; } }, {passive:true});
}

// ── 事件綁定 ──
function bindShopEvents(){
  document.getElementById('shop-nav').addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    if(b.hasAttribute('data-about')) showAbout(); else shopFilterCat(b.dataset.cat, true);
  });
  document.getElementById('cat-tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    shopFilterCat(b.dataset.cat, false);
  });
  document.getElementById('shop-grid').addEventListener('click', e => {
    const c = e.target.closest('.pc'); if(c) openDetail(c.dataset.id);
  });
  document.getElementById('detail-thumbs').addEventListener('click', e => {
    const t = e.target.closest('.dt-thumb'); if(!t) return;
    slideIdx = parseInt(t.dataset.i, 10); renderSlide();
  });
  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if(document.getElementById('page-shop').style.display !== 'none' && colCount() !== wfCols && wfList.length) renderShop(shopCat, true);
    }, 200);
  });
}

// ── 初始化（取代舊的 initMode）──
function initMode(){
  if(window.location.search.includes('admin')){ location.replace('admin.html'); return; }
  document.getElementById('shop-mode').style.display = 'block';
  document.body.classList.add('shop');
  showPage('shop');
  if(location.hash === '#privacy') showPrivacy();
  window.addEventListener('hashchange', () => { if(location.hash === '#privacy') showPrivacy(); });
  loadCategories().then(() => {
    renderShopNav();
    return loadPublishedProducts();
  }).then(() => { renderShop('全部'); initRunway(); });
  bindShopEvents();
  smoothInit();
  window.addEventListener('scroll', onScrollFx, {passive:true});
}

// INIT
initMode();
