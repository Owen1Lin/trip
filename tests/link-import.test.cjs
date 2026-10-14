// Mock public-source/model acceptance; live social platforms and model services require integration validation.
const {browser,assert,URL_BASE,mockBackend,login,ensureLocked}=require('./helpers.cjs');
const SOURCES={maps:'https://www.google.com/maps/place/Hakata',threads:'https://www.threads.net/@traveller/post/ABC123',instagram:'https://www.instagram.com/p/ABC123/'};
const EXACT_MAPS_LINK='https://maps.app.goo.gl/WATLthGABRLNZ3fb9';
const MAPS_LITERAL_URL='https://www.google.com/maps/place/'+encodeURIComponent('燒肉垂榕')+'/';
const GENERIC_MAPS_HTML='<html><head><meta property="og:title" content="Google Maps"><meta name="description" content="Find local businesses, view maps and get driving directions in Google Maps."></head></html>';
const malicious='<img src=x onerror="window.__linkXss=1">';
function result(url,model='metadata') {
 return {sourceUrl:url,platform:url.includes('instagram')?'instagram':url.includes('threads')?'threads':'google-maps',title:'公開旅行分享',evidence:`公開描述：博多散步 ${malicious}`,draft:{place:'',notes:`公開描述：博多散步 ${malicious}`,category:'自訂'},missing:['place','date','period','startTime','endTime'],modelUsed:model,warning:''};
}
(async()=>{
 const {validatePublicUrl,extractMetadata,groundModelDraft,fetchPublicMetadata,parseModelContent}=await import('../supabase/functions/link-import/core.mjs');
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
 const literalMaps=await fetchPublicMetadata(EXACT_MAPS_LINK,async url=>url===EXACT_MAPS_LINK?new Response(null,{status:302,headers:{location:MAPS_LITERAL_URL}}):new Response(GENERIC_MAPS_HTML,{headers:{'content-type':'text/html'}}));assert.equal(literalMaps.linkPlace,'燒肉垂榕');assert.equal(literalMaps.description,'');assert.match(literalMaps.evidence,/公開連結地點文字.*待確認/);assert.match(literalMaps.warning,/尚未核實/);assert.equal(groundModelDraft(null,literalMaps).place,'燒肉垂榕');assert.equal(groundModelDraft(null,literalMaps).notes,'');assert.deepEqual(groundModelDraft({place:{value:'來源連結',quote:literalMaps.evidence},notes:{value:MAPS_LITERAL_URL,quote:literalMaps.evidence}},literalMaps),{place:'燒肉垂榕',category:'自訂',notes:''});
 for(const url of ['https://www.google.com/maps/','https://www.google.com/maps/search/restaurant/','https://www.google.com/maps/place/@33,130/','https://www.google.com/maps/place/!4m6/','https://www.google.com/maps/place/data=foo/','https://www.google.com/maps/place/%00Fake/','https://www.google.com/maps/place/'+encodeURIComponent('a'.repeat(151))+'/'])await assert.rejects(()=>fetchPublicMetadata(url,async()=>new Response(GENERIC_MAPS_HTML,{headers:{'content-type':'text/html'}})));
 await assert.rejects(()=>fetchPublicMetadata(MAPS_LITERAL_URL,async()=>new Response(GENERIC_MAPS_HTML,{status:404,headers:{'content-type':'text/html'}})));
 if(process.env.TEST_LIVE_MAPS==='1'){
  const live=await fetchPublicMetadata(EXACT_MAPS_LINK);assert.equal(live.platform,'Google Maps');assert.equal(live.linkPlace,'燒肉垂榕');assert.equal(live.description,'');assert.equal(groundModelDraft(null,live).place,'燒肉垂榕');assert.match(live.warning,/尚未核實/);console.log('PASS (live Maps exact link): public redirect/page read; URL literal name 燒肉垂榕 only; business details and itinerary remain unconfirmed.');
 }
 // Run the actual Edge handler with mocked platform APIs; no private credential values are used.
 const originalFetch=global.fetch,originalDeno=global.Deno;let handler;
 const env={SUPABASE_URL:'https://backend.testing',SUPABASE_ANON_KEY:'fake-public-key'};
 global.Deno={env:{get:key=>env[key]},serve:fn=>{handler=fn;}};
 await import('../supabase/functions/link-import/index.ts');
 let member=true,modelOutput={},modelContent=null,modelFailure=false,backendCalls=[];
 global.fetch=async(url,options={})=>{
  const target=String(url);backendCalls.push({url:target,options});
  if(target.endsWith('/rpc/is_private_trip_member'))return Response.json(member);
  if(['https://models.testing/completions','https://openrouter.ai/api/v1/chat/completions','https://openrouter.ai.evil.example/completions'].includes(target)&&modelFailure)throw new Error('Model timeout');
  if(['https://models.testing/completions','https://openrouter.ai/api/v1/chat/completions','https://openrouter.ai.evil.example/completions'].includes(target))return Response.json({choices:[{message:{content:modelContent===null?JSON.stringify(modelOutput):modelContent}}]});
  if(target===MAPS_LITERAL_URL)return new Response(GENERIC_MAPS_HTML,{headers:{'content-type':'text/html'}});
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
  const literalResponse=await(await edge({url:MAPS_LITERAL_URL,model:'qwen'})).json();assert.equal(literalResponse.draft.place,'燒肉垂榕');assert.equal(literalResponse.draft.notes,'');assert.ok(literalResponse.missing.includes('place'));assert.match(literalResponse.warning,/尚未核實/);assert.match(literalResponse.warning,/尚未設定/);for(const field of ['date','period','startTime','endTime'])assert.equal(literalResponse.draft[field],undefined);
  for(const model of ['qwen','llama']){
   const prefix=model.toUpperCase();env[prefix+'_MODEL_URL']='https://models.testing/completions';env[prefix+'_MODEL_KEY']='fake-model-key';env[prefix+'_MODEL_NAME']='fake-'+model;
   modelOutput={place:{value:'虛構景點',quote:'虛構景點'},date:'2026-10-21',startTime:'09:00'};let response=await(await edge({url:SOURCES.maps,model})).json();assert.equal(response.modelUsed,model);assert.equal(response.draft.place,'');assert.equal(response.draft.date,undefined);assert.equal(response.draft.startTime,undefined);
   modelOutput={place:{value:'博多',quote:'博多散步'}};response=await(await edge({url:SOURCES.maps,model})).json();assert.equal(response.draft.place,'博多');assert.ok(response.missing.includes('date'));assert.equal(backendCalls.filter(call=>call.url==='https://models.testing/completions').at(-1).options.redirect,'error');
  }
  for(const model of ['qwen','llama']){
   const response=await(await edge({url:MAPS_LITERAL_URL,model})).json();assert.equal(response.modelUsed,model);assert.equal(response.draft.place,'燒肉垂榕');assert.equal(response.draft.notes,'');assert.match(response.evidence,/來源連結：https:/);assert.equal(response.sourceUrl,MAPS_LITERAL_URL);const call=backendCalls.filter(item=>item.url==='https://models.testing/completions').at(-1),payload=JSON.parse(call.options.body),input=JSON.parse(payload.messages[1].content);assert.equal(input.publicMetadata,'燒肉垂榕');assert.equal(input.publicMetadata.includes('https:'),false);assert.ok(response.missing.includes('place'));
  }
  const completeFence='```json\n'+JSON.stringify({place:{value:'博多',quote:'博多散步'},notes:{value:'虛構',quote:'虛構'},date:'2026-10-21',startTime:'09:00'})+'\n```';
  for(const content of [completeFence,completeFence.replace('```json','```'),completeFence.replaceAll('\n','\r\n')]){
   modelContent=content;const fenced=await(await edge({url:SOURCES.maps,model:'qwen'})).json();assert.equal(fenced.modelUsed,'qwen');assert.equal(fenced.draft.place,'博多');assert.equal(fenced.draft.notes,'拉麵 & 神社');assert.equal(fenced.draft.date,undefined);assert.equal(fenced.draft.startTime,undefined);assert.ok(parseModelContent(content).place);
  }
  for(const content of ['', '{"place":', completeFence+'\nExtra prose', 'Extra prose\n'+completeFence,completeFence.slice(0,-3),'<think>reasoning</think>\n'+completeFence]){
   modelContent=content;const fallback=await(await edge({url:SOURCES.maps,model:'qwen'})).json();assert.equal(fallback.modelUsed,'metadata');assert.equal(fallback.draft.place,'');assert.equal(fallback.draft.notes,'拉麵 & 神社');assert.match(fallback.warning,/無法/);for(const field of ['date','period','startTime','endTime'])assert.equal(fallback.draft[field],undefined);
  }
  modelContent=null;
  for(const [model,endpoint,expected] of [['qwen','https://openrouter.ai/api/v1/chat/completions',{type:'json_object'}],['llama','https://openrouter.ai/api/v1/chat/completions',{type:'json_object'}],['qwen','https://models.testing/completions',undefined],['qwen','https://openrouter.ai.evil.example/completions',undefined]]){
   env[model.toUpperCase()+'_MODEL_URL']=endpoint;modelOutput={place:{value:'博多',quote:'博多散步'}};const response=await(await edge({url:SOURCES.maps,model})).json();assert.equal(response.modelUsed,model);const call=backendCalls.filter(item=>item.url===endpoint).at(-1),payload=JSON.parse(call.options.body);assert.deepEqual(payload.response_format,expected);assert.equal(payload.reasoning,undefined);assert.match(payload.messages[0].content,/notes at most 200/);assert.equal(JSON.parse(payload.messages[1].content).publicMetadata,metadata.evidence);
  }
  env.QWEN_MODEL_URL='https://models.testing/completions';modelFailure=true;const degraded=await(await edge({url:SOURCES.maps,model:'qwen'})).json();assert.equal(degraded.modelUsed,'metadata');assert.match(degraded.warning,/無法/);assert.equal(degraded.draft.notes,'拉麵 & 神社');
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
  reply={sourceUrl:MAPS_LITERAL_URL,platform:'Google Maps',evidence:literalMaps.evidence,draft:groundModelDraft(null,literalMaps),warning:literalMaps.warning,missing:['place','date','period','startTime','endTime']};await fetchDraft(EXACT_MAPS_LINK);assert.equal(await p.locator('#draft-place').inputValue(),'燒肉垂榕');assert.equal(await p.locator('#draft-notes').inputValue(),'');assert.match(await p.locator('#link-import-status').innerText(),/尚未核實/);for(const id of ['date','period','start','end'])assert.equal(await p.locator('#draft-'+id).inputValue(),'');assert.equal(await p.locator('#draft-confirm').isChecked(),false);assert.equal(await p.locator('#draft-add').isDisabled(),true);assert.equal(JSON.stringify(await trips()),initial);await p.locator('#draft-cancel').click();reply=null;
  await fetchDraft(SOURCES.maps,'qwen');assert.equal(requests.at(-1).model,'qwen');await p.locator('#draft-cancel').click();await fetchDraft(SOURCES.threads,'llama');assert.equal(requests.at(-1).model,'llama');
  await p.locator('#draft-place').fill('手動核對的博多活動');await p.locator('#draft-shopping').fill('伴手禮');await p.locator('#draft-notes').fill(malicious);await schedule();await submitBypass();assert.equal(JSON.stringify(await trips()),initial,'schedule requires explicit confirmation');
  for(const [id,valid] of [['date','2026-10-22'],['period','noon'],['start','13:00'],['end','14:00']]){
   const control=p.locator('#draft-'+id);if(id==='date'||id==='period')await control.selectOption('');else await control.fill('');await p.locator('#draft-confirm').check();await submitBypass();assert.equal(JSON.stringify(await trips()),initial,`missing ${id} rejects despite confirmation`);if(id==='date'||id==='period')await control.selectOption(valid);else await control.fill(valid);
  }
  await p.locator('#draft-confirm').check();await p.locator('#draft-end').fill('12:00');await submitBypass();assert.equal(JSON.stringify(await trips()),initial,'reversed time rejected');
  await p.locator('#draft-end').fill('14:00');assert.equal(await p.locator('#draft-confirm').isChecked(),false);await p.locator('#draft-confirm').check();await p.locator('#draft-add').click();const added=(await trips())[0].days[1][0];assert.equal(added.place,'手動核對的博多活動');assert.equal(added.period,'noon');assert.equal(added.startTime,'13:00');assert.equal(added.endTime,'14:00');assert.equal(added.shopping,'伴手禮');assert.equal(added.createdBy,'owen');assert.equal(added.fields.find(f=>f.label==='匯入來源').value,SOURCES.threads);assert.equal(await p.evaluate(()=>window.__linkXss),undefined);
  const after=JSON.stringify(await trips());
  status=503;await p.locator('#link-url').fill(SOURCES.instagram);await p.locator('#link-fetch').click();await p.waitForFunction(()=>!document.querySelector('#link-fetch').disabled);assert.match(await p.locator('#link-import-status').innerText(),/手動|無法|失敗/);assert.equal(JSON.stringify(await trips()),after);assert.equal(await p.locator('#draft-evidence').inputValue(),'');assert.equal(await p.locator('#draft-place').inputValue(),'');await p.locator('#draft-place').fill('手動填寫的備用活動');await schedule('2026-10-23','evening','18:00','19:00');await p.locator('#draft-confirm').check();await p.locator('#draft-add').click();assert.equal((await trips())[0].days[2][0].place,'手動填寫的備用活動');status=200;
  const preserved=JSON.stringify(await trips());
  for(const [code,message,expected] of [[404,'Function not found',/未部署|尚未.*部署/],[422,'Source unavailable',/公開|平台|來源/]]){
   status=code;reply={error:message};await p.locator('#link-url').fill(SOURCES.instagram);await p.locator('#link-fetch').click();await p.waitForFunction(()=>!document.querySelector('#link-fetch').disabled);assert.match(await p.locator('#link-import-status').innerText(),expected);assert.match(await p.locator('#link-import-status').innerText(),/手動/);assert.ok(await p.locator('#link-draft-form').isVisible());assert.equal(await p.locator('#draft-place').inputValue(),'');assert.equal(await p.locator('#draft-evidence').inputValue(),'');assert.equal(JSON.stringify(await trips()),preserved);await p.locator('#draft-cancel').click();
  }
  status=200;reply=null;const countBeforeMismatch=requests.length;
  await p.evaluate(()=>{window.__savedTripAuth=window.TripAuth;window.TripAuth=Object.freeze({requireMembership:window.TripAuth.requireMembership});});
  await p.locator('#link-url').fill(SOURCES.maps);await p.locator('#link-fetch').click();await p.waitForFunction(()=>!document.querySelector('#link-fetch').disabled);assert.match(await p.locator('#link-import-status').innerText(),/版本|重新整理|快取/);assert.match(await p.locator('#link-import-status').innerText(),/手動/);assert.ok(await p.locator('#link-draft-form').isVisible());assert.equal(await p.locator('#draft-evidence').inputValue(),'');assert.equal(JSON.stringify(await trips()),preserved);assert.equal(requests.length,countBeforeMismatch);
  await p.evaluate(()=>{window.TripAuth=window.__savedTripAuth;delete window.__savedTripAuth;});await p.locator('#draft-cancel').click();
  for(const width of [390,320]){
   await p.setViewportSize({width,height:844});await fetchDraft(SOURCES.maps);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`mobile overflow at ${width}`);
   await p.locator('#draft-place').focus();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'draft-category');
   await p.locator('#draft-cancel').click();
  }
  let release;delay=new Promise(resolve=>release=resolve);const fetched=new Promise(resolve=>hit=resolve);
  await p.locator('#link-url').fill(SOURCES.maps);await p.locator('#link-fetch').click();await fetched;const pendingTrips=JSON.stringify(await trips());await p.evaluate(()=>{document.querySelector('#draft-place').value='舊草稿不應加入';document.querySelector('#draft-date').value='2026-10-21';document.querySelector('#draft-period').value='morning';document.querySelector('#draft-start').value='09:00';document.querySelector('#draft-end').value='10:00';document.querySelector('#draft-confirm').checked=true;document.querySelector('#link-draft-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});assert.equal(JSON.stringify(await trips()),pendingTrips,'hidden pending draft cannot be submitted');await p.locator('#sign-out').click();await ensureLocked(p);release();await p.waitForTimeout(200);await ensureLocked(p);
  assert.equal(await p.locator('#link-url').inputValue(),'');assert.equal(await p.locator('#draft-place').inputValue(),'');assert.equal(await p.locator('#draft-notes').inputValue(),'');assert.ok(await p.locator('#link-draft-form').evaluate(e=>e.hidden));assert.deepEqual(errors,[]);
  delay=null;hit=null;
  for(const deniedStatus of [401,403]){
   status=200;reply=null;await login(p);await p.locator('#activity-start').fill('09:00');await p.locator('#activity-end').fill('10:00');await p.locator('#activity-place').fill('拒絕後清除私人活動');await p.locator('#activity-submit').click();assert.equal(await p.locator('.activity-card').count(),1);
   status=deniedStatus;reply={error:'Authorization denied'};await p.locator('#link-url').fill(SOURCES.maps);await p.locator('#link-fetch').click();await p.waitForFunction(()=>document.querySelector('#private-app').hidden);await ensureLocked(p);assert.equal(await p.locator('#link-url').inputValue(),'');assert.equal(await p.locator('#draft-evidence').inputValue(),'');assert.ok(await p.locator('#link-draft-form').evaluate(e=>e.hidden));assert.equal(await p.locator('.activity-card').count(),0);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS (mock Edge/public/model API): membership/CORS/model validation and safe fallback; SSRF redirects and shared deadline; bounded metadata; grounded Qwen/Llama responses; Maps/Threads/Instagram URL restrictions; editable evidence-backed draft; missing data stays blank; explicit schedule confirmation; invalid times; Qwen/Llama selection; manual failure guidance; version mismatch/404/422 recovery and 401/403 lock; attribution/source retention; XSS; keyboard/mobile; pending-response logout race.');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
