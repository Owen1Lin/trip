// Shared, dependency-free rules; page and model content are always untrusted.
export function validatePublicUrl(input) {
  if (typeof input !== 'string' || input.length > 1000) throw new Error('連結過長或格式不正確。');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('僅支援不含帳密的 HTTPS 公開連結。');
  const host = url.hostname.toLowerCase();
  let platform;
  if ((['www.google.com','google.com','maps.google.com','www.google.co.jp','google.co.jp'].includes(host) && (host === 'maps.google.com' || /^\/maps(?:\/|$)/.test(url.pathname))) || (host === 'maps.app.goo.gl' && url.pathname.length > 1) || (host === 'goo.gl' && url.pathname.startsWith('/maps/'))) platform = 'Google Maps';
  else if (['www.threads.net','threads.net','www.threads.com','threads.com'].includes(host) && /^\/@[^/]+\/post\/[^/]+\/?$/.test(url.pathname)) platform = 'Threads';
  else if (['www.instagram.com','instagram.com'].includes(host) && /^\/(p|reel|reels)\/[^/]+\/?$/.test(url.pathname)) platform = 'Instagram';
  else throw new Error('請使用 Google Maps 地點、Threads 貼文或 Instagram 公開貼文連結。');
  url.hash = '';
  return { url: url.href, platform };
}
function decode(value) {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1),16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
}
export function extractMetadata(html) {
  const values = new Map();
  // Ignore metadata-shaped strings in comments, scripts and templates.
  const documentHead = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] || html;
  const markup = documentHead.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  for (const tag of markup.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (['og:title','og:description','description'].includes(key) && typeof attrs.content === 'string') values.set(key, attrs.content.trim());
  }
  // A generic login/brand page is not evidence about the submitted place/post.
  const title = (values.get('og:title') || '').slice(0,300);
  const description = (values.get('og:description') || values.get('description') || '').slice(0,1600);
  if ((!title && !description) || /^(instagram|threads|google maps|login|log in|sign in)(\s*[-|].*)?$/i.test(title) || /log in to (instagram|threads)|sign in to continue|登入以繼續/i.test(description)) throw new Error('平台未提供可讀取的公開貼文資料，請手動填寫草稿。');
  return { title, description, evidence: [title,description].filter(Boolean).join('\n').slice(0,2000) };
}
export function groundModelDraft(output, metadata) {
  // Values must be verbatim parts of public evidence, accompanied by an exact quote.
  // Scheduling is intentionally excluded: post times and opening hours are not trip times.
  const next = { place:'',category:'自訂',notes:metadata.description.slice(0,1600) };
  if (!output || typeof output !== 'object') return next;
  for (const [field,max] of [['place',150],['notes',1600]]) {
    const item = output[field];
    if (item && typeof item.value === 'string' && item.value.trim() && item.value.length <= max && typeof item.quote === 'string' && item.quote.trim() && metadata.evidence.includes(item.quote) && item.quote.includes(item.value)) next[field] = item.value.trim();
  }
  return next;
}
export async function fetchPublicMetadata(input, fetcher = fetch) {
  let current = validatePublicUrl(input);
  const signal = AbortSignal.timeout(12000);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const response = await fetcher(current.url, { redirect:'manual',signal,headers:{'Accept':'text/html','User-Agent':'TripPublicLinkPreview/1.0'} });
    if ([301,302,303,307,308].includes(response.status)) {
      const target=response.headers.get('location');
      if (!target || redirect === 3) throw new Error('公開連結重新導向過多。');
      const next=validatePublicUrl(new URL(target,current.url).href);
      if (next.platform !== current.platform) throw new Error('平台重新導向不符合來源。');
      current=next; continue;
    }
    if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('無法取得公開頁面，請手動填寫草稿。');
    if (Number(response.headers.get('content-length')) > 1024*1024) throw new Error('公開頁面過大，請手動填寫草稿。');
    if (!response.body) throw new Error('公開頁面沒有內容。');
    const reader=response.body.getReader(), decoder=new TextDecoder(); let size=0,html='';
    try { while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>1024*1024) throw new Error('公開頁面過大，請手動填寫草稿。'); html+=decoder.decode(value,{stream:true}); } } finally { await reader.cancel(); }
    html+=decoder.decode(); return {...current,...extractMetadata(html)};
  }
  throw new Error('無法讀取公開連結。');
}
