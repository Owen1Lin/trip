// Mock public-source/model acceptance; live social platforms and model services require integration validation.
const {browser,assert,URL_BASE,mockBackend,login,ensureLocked}=require('./helpers.cjs');
const SOURCES={maps:'https://www.google.com/maps/place/Hakata',threads:'https://www.threads.net/@traveller/post/ABC123',instagram:'https://www.instagram.com/p/ABC123/'};
const malicious='<img src=x onerror="window.__linkXss=1">';
function result(url,model='metadata') {
 return {sourceUrl:url,platform:url.includes('instagram')?'instagram':url.includes('threads')?'threads':'google-maps',title:'公開旅行分享',evidence:`公開描述：博多散步 ${malicious}`,draft:{place:'',notes:`公開描述：博多散步 ${malicious}`,category:'自訂'},missing:['place','date','period','startTime','endTime'],modelUsed:model,warning:''};
}
(async()=>{
 const {validatePublicUrl,extractMetadata,groundModelDraft,fetchPublicMetadata}=await import('../supabase/functions/link-import/core.mjs');
 for(const url of Object.values(SOURCES))assert.ok(validatePublicUrl(url).platform);
 for(const url of ['https://127.0.0.1/','https://www.instagram.com.evil.example/p/a/','https://user:pass@www.instagram.com/p/a/','http://www.instagram.com/p/a/','https://www.google.com/search?q=trip'])assert.throws(()=>validatePublicUrl(url));
 const metadata=extractMetadata('<meta property="og:title" content="博多散步"><meta content="拉麵 &amp; 神社" name="description">');assert.equal(metadata.description,'拉麵 & 神社');
 const realHead=extractMetadata('<html><head><!-- <meta property="og:title" content="fake comment"> --><script>const fake = &quot;<meta property="og:title" content="fake script">&quot;;</script><meta property="og:title" content="真正公開來源"></head><body><meta property="og:title" content="fake body"></body></html>');assert.equal(realHead.title,'真正公開來源');
 assert.throws(()=>extractMetadata('<meta property="og:title" content="Instagram"><meta name="description" content="Log in to Instagram">'));
 const fabricated=groundModelDraft({place:{value:'不存在的餐廳',quote:'不存在的餐廳'},notes:{value:'自訂虛構備註',quote:'自訂虛構備註'},date:'2026-10-21',startTime:'10:00'},metadata);assert.equal(fabricated.place,'');assert.equal(fabricated.notes,metadata.description);assert.equal(fabricated.date,undefined);assert.equal(fabricated.startTime,undefined);
 const grounded=groundModelDraft({place:{value:'博多',quote:'博多散步'},notes:{value:'拉麵',quote:'拉麵 & 神社'}},metadata);assert.equal(grounded.place,'博多');assert.equal(grounded.notes,'拉麵');
 let calls=0;await assert.rejects(()=>fetchPublicMetadata(SOURCES.instagram,async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});}));assert.equal(calls,1,'SSRF redirect must be blocked before second fetch');
 await assert.rejects(()=>fetchPublicMetadata(SOURCES.instagram,async()=>new Response(null,{status:302,headers:{location:SOURCES.threads}})));
 await assert.rejects(()=>fetchPublicMetadata(SOURCES.instagram,async()=>new Response('<meta property="og:title" content="post">',{headers:{'content-type':'text/html','content-length':String(1024*1024+1)}})));
 await assert.rejects(()=>fetchPublicMetadata(SOURCES.instagram,async()=>new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'text/html'}})));
 const redirectSignals=[];await fetchPublicMetadata('https://maps.app.goo.gl/Abc123',async(url,options)=>{redirectSignals.push(options.signal);return redirectSignals.length===1?new Response(null,{status:302,headers:{location:SOURCES.maps}}):new Response('<meta property="og:title" content="博多散步">',{headers:{'content-type':'text/html'}});});assert.equal(redirectSignals.length,2);assert.strictEqual(redirectSignals[0],redirectSignals[1],'redirect chain shares one deadline');
 const fetchedMetadata=await fetchPublicMetadata(SOURCES.instagram,async()=>new Response('<meta property="og:title" content="公開地點"><meta property="og:description" content="公開描述">',{headers:{'content-type':'text/html'}}));assert.match(fetchedMetadata.evidence,/公開描述/);
 // Run the actual Edge handler with mocked platform APIs; no private credential values are used.
 const originalFetch=global.fetch,originalDeno=global.Deno;let handler;
 const env={SUPABASE_URL:'https://backend.testing',SUPABASE_ANON_KEY:'fake-public-key'};
 global.Deno={env:{get:key=>env[key]},serve:fn=>{handler=fn;}};
 await import('../supabase/functions/link-import/index.ts');
 let member=true,modelOutput={},modelFailure=false,backendCalls=[];
 global.fetch=async(url,options={})=>{
  const target=String(url);backendCalls.push({url:target,options});
  if(target.endsWith('/rpc/is_private_trip_member'))return Response.json(member);
  if(target==='https://models.testing/completions'&&modelFailure)throw new Error('Model timeout');
  if(target==='https://models.testing/completions')return Response.json({choices:[{message:{content:JSON.stringify(modelOutput)}}]});
  if(Object.values(SOURCES).includes(target))return new Response('<meta property="og:title" content="博多散步"><meta property="og:description" content="拉麵 &amp; 神社">',{headers:{'content-type':'text/html'}});
  throw new Error('Unexpected backend fetch '+target);
 };
 const edge=async(body,headers={})=>handler(new Request('https://backend.testing/functions/v1/link-import',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:3000',Authorization:'Bearer fake-user-token',...headers},body:JSON.stringify(body)}));
 try{
  const deniedOrigin=await edge({url:SOURCES.maps,model:'metadata'},{Origin:'https://evil.example'});assert.equal(deniedOrigin.status,403);assert.equal(backendCalls.length,0);
  const anonymous=await edge({url:SOURCES.maps,model:'metadata'},{Authorization:''});assert.equal(anonymous.status,401);assert.equal(backendCalls.length,0);
  member=false;assert.equal((await edge({url:SOURCES.maps,model:'metadata'})).status,403);assert.equal(backendCalls.length,1);assert.ok(backendCalls[0].url.endsWith('/rpc/is_private_trip_member'));member=true;
  assert.equal((await edge({url:SOURCES.maps,model:'unknown'})).status,400);
  const fallback=await(await edge({url:SOURCES.maps,model:'qwen'})).json();assert.equal(fallback.modelUsed,'metadata');assert.match(fallback.warning,/尚未設定/);assert.equal(fallback.draft.place,'');assert.deepEqual(fallback.missing,['place','date','period','startTime','endTime']);
  for(const model of ['qwen','llama']){
   const prefix=model.toUpperCase();env[prefix+'_MODEL_URL']='https://models.testing/completions';env[prefix+'_MODEL_KEY']='fake-model-key';env[prefix+'_MODEL_NAME']='fake-'+model;
   modelOutput={place:{value:'虛構景點',quote:'虛構景點'},date:'2026-10-21',startTime:'09:00'};let response=await(await edge({url:SOURCES.maps,model})).json();assert.equal(response.modelUsed,model);assert.equal(response.draft.place,'');assert.equal(response.draft.date,undefined);assert.equal(response.draft.startTime,undefined);
   modelOutput={place:{value:'博多',quote:'博多散步'}};response=await(await edge({url:SOURCES.maps,model})).json();assert.equal(response.draft.place,'博多');assert.ok(response.missing.includes('date'));assert.equal(backendCalls.filter(call=>call.url==='https://models.testing/completions').at(-1).options.redirect,'error');
  }
  modelFailure=true;const degraded=await(await edge({url:SOURCES.maps,model:'qwen'})).json();assert.equal(degraded.modelUsed,'metadata');assert.match(degraded.warning,/無法/);assert.equal(degraded.draft.notes,'拉麵 & 神社');
 }finally{global.fetch=originalFetch;if(originalDeno===undefined)delete global.Deno;else global.Deno=originalDeno;}
 const b=await browser(); const c=await b.newContext({viewport:{width:1440,height:1000}}); const p=await c.newPage(); const errors=[];p.on('pageerror',e=>errors.push(e.message));await mockBackend(c);p.on('dialog',d=>d.accept());
 let status=200,reply=null,delay=null,hit=null; const requests=[];
 await c.route('https://testing.supabase.co/functions/v1/link-import',async r=>{
  const data=r.request().postDataJSON();requests.push(data);if(hit)hit();if(delay)await delay;
  try{await r.fulfill({status,contentType:'application/json',body:JSON.stringify(reply || result(data.url,data.model))});}catch{}
 });
 const fetchDraft=async(url,model='metadata')=>{await p.locator('#link-url').fill(url);await p.locator('#link-model').selectOption(model);await p.locator('#link-fetch').click();await p.locator('#link-draft-form').waitFor({state:'visible'});};
 const trips=()=>p.evaluate(()=>window.TripPlanner.getTrips());
 const schedule=async(date='2026-10-22',period='noon',start='13:00',end='14:00')=>{await p.locator('#draft-date').selectOption(date);await p.locator('#draft-period').selectOption(period);await p.locator('#draft-start').fill(start);await p.locator('#draft-end').fill(end);};
 const submitBypass=()=>p.locator('#link-draft-form').evaluate(e=>e.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 try{
  await p.goto(URL_BASE);await ensureLocked(p);assert.ok(await p.locator('#link-import-form').evaluate(e=>e.closest('#private-app')!==null));
  await login(p);
  for(const url of [SOURCES.maps,SOURCES.threads,SOURCES.instagram,'https://maps.app.goo.gl/Abc123'])assert.ok(await p.evaluate(url=>{try{window.TripLinkImport.validateUrl(url);return true;}catch{return false;}},url),url);
  for(const url of ['http://www.instagram.com/p/ABC/','https://instagram.com.evil.example/p/ABC/','https://user:pass@www.instagram.com/p/ABC/','https://127.0.0.1/maps','https://www.google.com/search?q=trip','javascript:alert(1)','https://www.instagram.com:8443/p/ABC/'])assert.equal(await p.evaluate(url=>{try{window.TripLinkImport.validateUrl(url);return true;}catch{return false;}},url),false,url);
  const initial=JSON.stringify(await trips());
  await p.locator('#link-url').fill('https://evil.example/post');await p.locator('#link-fetch').click();assert.equal(requests.length,0);assert.equal(JSON.stringify(await trips()),initial);
  for(const [platform,url] of Object.entries(SOURCES)){
   await fetchDraft(url);assert.equal(JSON.stringify(await trips()),initial,`${platform} fetch must never add`);
   assert.equal(await p.locator('#draft-place').inputValue(),'');assert.match(await p.locator('#draft-pending').innerText(),/待確認/);
   for(const id of ['date','period','start','end'])assert.equal(await p.locator('#draft-'+id).inputValue(),'');
   assert.equal(await p.locator('#draft-confirm').isChecked(),false);assert.equal(await p.locator('#draft-add').isDisabled(),true);
   assert.equal(await p.locator('#draft-source').getAttribute('href'),url);assert.match(await p.locator('#draft-evidence').inputValue(),/博多散步/);
   assert.equal(await p.locator('#link-draft-form img,#link-draft-form script').count(),0);assert.equal(await p.evaluate(()=>window.__linkXss),undefined);
   await submitBypass();assert.equal(JSON.stringify(await trips()),initial);
   await p.locator('#draft-cancel').click();await p.locator('#link-draft-form').waitFor({state:'hidden'});
  }
  await fetchDraft(SOURCES.maps,'qwen');assert.equal(requests.at(-1).model,'qwen');await p.locator('#draft-cancel').click();await fetchDraft(SOURCES.threads,'llama');assert.equal(requests.at(-1).model,'llama');
  await p.locator('#draft-place').fill('手動核對的博多活動');await p.locator('#draft-shopping').fill('伴手禮');await p.locator('#draft-notes').fill(malicious);await schedule();await submitBypass();assert.equal(JSON.stringify(await trips()),initial,'schedule requires explicit confirmation');
  for(const [id,valid] of [['date','2026-10-22'],['period','noon'],['start','13:00'],['end','14:00']]){
   const control=p.locator('#draft-'+id);if(id==='date'||id==='period')await control.selectOption('');else await control.fill('');await p.locator('#draft-confirm').check();await submitBypass();assert.equal(JSON.stringify(await trips()),initial,`missing ${id} rejects despite confirmation`);if(id==='date'||id==='period')await control.selectOption(valid);else await control.fill(valid);
  }
  await p.locator('#draft-confirm').check();await p.locator('#draft-end').fill('12:00');await submitBypass();assert.equal(JSON.stringify(await trips()),initial,'reversed time rejected');
  await p.locator('#draft-end').fill('14:00');assert.equal(await p.locator('#draft-confirm').isChecked(),false);await p.locator('#draft-confirm').check();await p.locator('#draft-add').click();const added=(await trips())[0].days[1][0];assert.equal(added.place,'手動核對的博多活動');assert.equal(added.period,'noon');assert.equal(added.startTime,'13:00');assert.equal(added.endTime,'14:00');assert.equal(added.shopping,'伴手禮');assert.equal(added.createdBy,'owen');assert.equal(added.fields.find(f=>f.label==='匯入來源').value,SOURCES.threads);assert.equal(await p.evaluate(()=>window.__linkXss),undefined);
  const after=JSON.stringify(await trips());
  status=503;await p.locator('#link-url').fill(SOURCES.instagram);await p.locator('#link-fetch').click();await p.waitForFunction(()=>!document.querySelector('#link-fetch').disabled);assert.match(await p.locator('#link-import-status').innerText(),/手動|無法|失敗/);assert.equal(JSON.stringify(await trips()),after);assert.equal(await p.locator('#draft-evidence').inputValue(),'');assert.equal(await p.locator('#draft-place').inputValue(),'');await p.locator('#draft-place').fill('手動填寫的備用活動');await schedule('2026-10-23','evening','18:00','19:00');await p.locator('#draft-confirm').check();await p.locator('#draft-add').click();assert.equal((await trips())[0].days[2][0].place,'手動填寫的備用活動');status=200;
  for(const width of [390,320]){
   await p.setViewportSize({width,height:844});await fetchDraft(SOURCES.maps);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`mobile overflow at ${width}`);
   await p.locator('#draft-place').focus();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'draft-category');
   await p.locator('#draft-cancel').click();
  }
  let release;delay=new Promise(resolve=>release=resolve);const fetched=new Promise(resolve=>hit=resolve);
  await p.locator('#link-url').fill(SOURCES.maps);await p.locator('#link-fetch').click();await fetched;const pendingTrips=JSON.stringify(await trips());await p.evaluate(()=>{document.querySelector('#draft-place').value='舊草稿不應加入';document.querySelector('#draft-date').value='2026-10-21';document.querySelector('#draft-period').value='morning';document.querySelector('#draft-start').value='09:00';document.querySelector('#draft-end').value='10:00';document.querySelector('#draft-confirm').checked=true;document.querySelector('#link-draft-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});assert.equal(JSON.stringify(await trips()),pendingTrips,'hidden pending draft cannot be submitted');await p.locator('#sign-out').click();await ensureLocked(p);release();await p.waitForTimeout(200);await ensureLocked(p);
  assert.equal(await p.locator('#link-url').inputValue(),'');assert.equal(await p.locator('#draft-place').inputValue(),'');assert.equal(await p.locator('#draft-notes').inputValue(),'');assert.ok(await p.locator('#link-draft-form').evaluate(e=>e.hidden));assert.deepEqual(errors,[]);
  console.log('PASS (mock Edge/public/model API): membership/CORS/model validation and safe fallback; SSRF redirects and shared deadline; bounded metadata; grounded Qwen/Llama responses; Maps/Threads/Instagram URL restrictions; editable evidence-backed draft; missing data stays blank; explicit schedule confirmation; invalid times; Qwen/Llama selection; manual failure guidance; attribution/source retention; XSS; keyboard/mobile; pending-response logout race.');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
