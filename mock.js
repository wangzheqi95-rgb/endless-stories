// 預覽用假資料（網址加 ?mock 才會啟用；不連 Supabase、不寫入任何資料）
(function(){
  const svg = (c1, c2, t) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="600" height="800" fill="url(#g)"/><text x="300" y="420" font-size="44" text-anchor="middle" fill="#fff" font-family="serif" opacity=".8">${t}</text></svg>`);
  const pal = [['#c9b8a6','#8a6f5a'],['#a8b5a2','#5f7358'],['#b8a9c9','#6d5a8a'],['#d4b5b0','#9a6a64'],['#9fb4c7','#566f86'],['#d9c9a0','#9a8450']];
  const names = ['亞麻襯衫','寬版西裝外套','落肩針織衫','高腰直筒褲','半身長裙','風衣外套','條紋襯衫','羊毛大衣','牛仔外套','針織背心','百褶裙','工裝褲'];
  const products = names.map((n, i) => ({
    id: 'm' + (i + 1), name: n, sub: 'Sample ' + (i + 1), description: '預覽用假資料', price: 1280 + i * 150,
    category: i % 2 ? '上衣' : '外套', sizes: ['S','M','L'], images: [svg(...pal[i % 6], n)], cutout_url: null,
    style_tags: [], arrival_date: '2026-10-' + String(10 + i).padStart(2, '0'), published: true, cover_ratio: ['3:4','1:1','4:5','3:4','4:5','1:1'][i % 6]
  }));
  const cats = [{id:1,name:'上衣',name_en:'Tops',sort_order:1},{id:2,name:'外套',name_en:'Outerwear',sort_order:2}];
  const banners = [{bg_word:'AUTUMN',title:'秋季新品',image_url:null,published:true,sort_order:1},{bg_word:'COAT',title:'大衣特輯',image_url:null,published:true,sort_order:2}];
  window.mockFetch = async function(path, opts){
    if((opts && opts.method) && opts.method !== 'GET') return null;
    if(path.startsWith('products')) return products;
    if(path.startsWith('categories')) return cats;
    if(path.startsWith('banners')) return banners;
    if(path.startsWith('size_charts')) return [{headers:['尺寸','肩寬','胸圍','衣長'],rows:[['S','40','96','62'],['M','42','102','64'],['L','44','108','66']]}];
    return [];
  };
})();
