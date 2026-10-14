// Mock-authenticated browser tests; real Google OAuth and RLS require separate integration acceptance.
const fs = require('node:fs');
const {browser,assert,URL_BASE,mockBackend,login,ensureLocked}=require('./helpers.cjs');
(async()=>{
 const b=await browser();const context=await b.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await mockBackend(context);p.on('dialog',d=>d.accept());
 const add=async(start,end,place,period='morning')=>{await p.locator('#activity-start').fill(start);await p.locator('#activity-end').fill(end);await p.locator('#activity-place').fill(place);await p.locator('#activity-period').selectOption(period);await p.locator('#activity-submit').click();};
 const upload=async(name,text)=>p.locator('#import-file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(text)});
 try{
  await p.goto(URL_BASE);await ensureLocked(p);
  await p.evaluate(()=>{document.querySelector('#activity-start').value='09:00';document.querySelector('#activity-end').value='10:00';document.querySelector('#activity-place').value='未登入不得新增';document.querySelector('#activity-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));document.querySelector('#add-custom-field').click();});
  await ensureLocked(p);assert.equal(await p.locator('#custom-fields input').count(),0);
  await login(p);assert.equal(await p.locator('#day-tabs button').count(),5);assert.match(await p.locator('#day-tabs').innerText(),/10 \/ 21[\s\S]*10 \/ 25/);assert.equal(await p.locator('.period-section').count(),3);
  await add('10:00','09:00','不合法時間');assert.equal(await p.locator('.activity-card').count(),0);
  await p.locator('#activity-shopping').fill('明太子\n手信');await p.locator('#activity-notes').fill('先預約');await p.locator('#activity-category').selectOption('購物');await p.locator('#add-custom-field').click();await p.getByRole('textbox',{name:'自訂欄位名稱',exact:true}).fill('預約號碼');await p.getByRole('textbox',{name:'自訂欄位內容',exact:true}).fill('ABC123');
  await add('14:00','15:00','購物時間','noon');assert.match(await p.locator('.activity-card').innerText(),/明太子[\s\S]*ABC123/);
  await p.getByRole('button',{name:'編輯活動：購物時間',exact:true}).click();assert.equal(await p.locator('#activity-shopping').inputValue(),'明太子\n手信');await p.locator('#activity-place').fill('博多購物');await p.locator('#activity-submit').click();assert.equal(await p.locator('.activity-card').count(),1);
  await p.getByRole('button',{name:'編輯活動：博多購物',exact:true}).click();await p.locator('#activity-place').fill('取消修改');await p.locator('#activity-cancel').click();assert.doesNotMatch(await p.locator('#activity-list').innerText(),/取消修改/);
  await p.getByRole('checkbox',{name:'標記完成：博多購物',exact:true}).check();assert.ok(await p.locator('.activity-card').evaluate(e=>e.classList.contains('is-completed')));
  let card=p.locator('.activity-card');await card.locator('.transfer-day').selectOption('1');await card.locator('.transfer-period').selectOption('evening');await p.getByRole('button',{name:'複製活動：博多購物',exact:true}).click();assert.equal(await p.locator('.activity-card').count(),1);
  await p.locator('#day-tabs button').nth(1).click();assert.equal(await p.locator('[data-period="evening"] .activity-card').count(),1);await p.locator('.activity-card .transfer-day').selectOption('2');await p.getByRole('button',{name:'移動活動：博多購物',exact:true}).click();assert.equal(await p.locator('.activity-card').count(),0);
  await p.locator('#day-tabs button').nth(2).click();assert.equal(await p.locator('.activity-card').count(),1);await p.getByRole('button',{name:'刪除活動：博多購物',exact:true}).click();assert.equal(await p.locator('.activity-card').count(),0);
  await p.locator('#day-tabs button').first().click();const payload='<img src=x onerror="window.__xss=1">';await add('09:00','10:00',payload);await add('08:00','08:30','早餐');assert.match(await p.locator('[data-period="morning"]').innerText(),/早餐[\s\S]*<img/);assert.equal(await p.locator('#activity-list img').count(),0);assert.equal(await p.evaluate(()=>window.__xss),undefined);
  const downloadP=p.waitForEvent('download');await p.locator('#export-trips').click();const backup=fs.readFileSync(await(await downloadP).path(),'utf8');assert.equal(JSON.parse(backup).version,2);
  const before=await p.evaluate(()=>JSON.stringify(window.TripPlanner.getTrips()));
  for(const [name,data] of [['bad.json','{broken'],['big.json',' '.repeat(5*1024*1024+1)],['shape.json',JSON.stringify({version:2,trips:[]})]]){await upload(name,data);await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>JSON.stringify(window.TripPlanner.getTrips())),before);}
  const bad=JSON.parse(backup);bad.trips[0].days[0][0].endTime='01:00';await upload('bad-time.json',JSON.stringify(bad));await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>JSON.stringify(window.TripPlanner.getTrips())),before);
  const imported=JSON.parse(backup);imported.trips[0].days[0][0].fields=[{label:payload,value:'<script>window.__xss=2</script>'}];await upload('valid.json',JSON.stringify(imported));await p.waitForTimeout(100);assert.equal(await p.locator('#activity-list script,#activity-list img').count(),0);assert.equal(await p.evaluate(()=>window.__xss),undefined);
  await p.reload();await p.waitForFunction(()=>!document.querySelector('#private-app').hidden);assert.equal(await p.locator('.activity-card').count(),3);
  await p.locator('#activity-place').focus();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'activity-shopping');
  for(const width of [390,320]){await p.setViewportSize({width,height:844});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);assert.ok(await p.locator('#activity-submit').isVisible());}
  await p.locator('#activity-place').fill('登出必須清除');await p.locator('#activity-shopping').fill('私密清單');await p.locator('#add-custom-field').click();await p.locator('#sign-out').click();await ensureLocked(p);assert.equal(await p.locator('#activity-place').inputValue(),'');assert.equal(await p.locator('#activity-shopping').inputValue(),'');assert.equal(await p.locator('#custom-fields input').count(),0);assert.equal(await p.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('trip-private-session'))),false);assert.deepEqual(errors,[]);
  await login(p);
  await p.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('trip-private-session'))throw new Error('quota');return original.call(this,key,value);};});
  await add('09:00','10:00','儲存失敗測試');
  assert.match(await p.locator('#storage-status').innerText(),/無法儲存/);
  await p.locator('#sign-out').click();await ensureLocked(p);
  console.log('PASS (mock Google): auth gate, fixed five days, periods, times, shopping/custom fields, edit/cancel/delete/copy/move/completion, XSS, JSON safety, session restore, logout clearing, keyboard/mobile.');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
