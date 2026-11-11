// 正式專案設定（2026-11-11 切換）。測試專案設定備份在 config.test.js。
// 網站設定（前端公開值；機密金鑰一律放 Supabase Edge Functions 的 Secrets，不放這裡）
window.ES_CONFIG = {
  SB_URL: 'https://owrklkuqsnmzkmnvernh.supabase.co',
  SB_ANON_KEY: 'sb_publishable_0yEK4Dv5qHRgU8ZkciL9wA_FC7Q-WfL',   // 正式專案公開金鑰（新格式）
  EMAILJS_PUBLIC_KEY: 'xLtU4Cu9PLB68FXYW',
  EMAILJS_SERVICE_ID: 'service_3b0vkqb',
  EMAILJS_ORDER_NOTIFY_TEMPLATE: 'template_t9aa9hi',
  EMAILJS_CUSTOMER_TEMPLATE: 'template_c419nzq',
  SHOP_URL: 'https://wangzheqi95-rgb.github.io/endless-stories',
  FN_BASE: 'https://owrklkuqsnmzkmnvernh.supabase.co/functions/v1'          // Edge Functions 網址（之後填：https://owrklkuqsnmzkmnvernh.supabase.co/functions/v1）
};
