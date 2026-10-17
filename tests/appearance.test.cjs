// Synthetic travel fixtures; Google, member lookup and shared storage are mocked.
const fs=require('node:fs');
const {browser,assert,mockBackend,login,navigate,openEditor,openDetails,editActivity,addActivity}=require('./helpers.cjs');
const COLORS=['white','rose','peach','lemon','mint','sky','lavender'];
const LABELS={'景點':'📍','購物':'🛍️','美食':'🍚','交通':'🚆','住宿':'🏨','自訂':'✨'};
async function chooseColor(p,color){
 const control=p.locator('#activity-color');
 await control.evaluate(e=>{const section=e.closest('details');if(section)section.open=true;});
 await control.selectOption(color);
}
const trips=p=>p.evaluate(()=>window.TripPlanner.getTrips());
const overflow=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#activity-editor').scrollWidth<=document.querySelector('#activity-editor').clientWidth);
(async()=>{
 const b=await browser();
 try{for(const width of [320,390]){
  const c=await b.newContext({viewport:{width,height:844},acceptDownloads:true}),state=await mockBackend(c),p=await c.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await login(p);await openEditor(p);
  assert.deepEqual(await p.locator('#activity-category option').evaluateAll(options=>options.map(e=>[e.value,e.textContent])),Object.entries(LABELS).map(([value,emoji])=>[value,`${value} ${emoji}`]));
  assert.equal(await p.locator('#activity-color').inputValue(),'white');
  await p.locator('#activity-category').selectOption('美食');await p.locator('#activity-text').fill('10/21 0900-1000 虛構早餐');await p.locator('#activity-submit').click();
  assert.equal((await trips(p))[0].days[0][0].color,'white');assert.equal((await trips(p))[0].days[0][0].category,'美食');assert.match(await p.locator('.row-category').innerText(),/美食 🍚/);
  await navigate(p,'sync');await p.locator('#cloud-save').click();await p.waitForFunction(()=>!document.querySelector('#cloud-save').disabled&&document.querySelector('#save-reminder').hidden);
  await editActivity(p,'虛構早餐');await chooseColor(p,'rose');await p.locator('#activity-submit').click();
  assert.equal((await trips(p))[0].days[0][0].color,'rose');assert.equal(await p.locator('#save-reminder').evaluate(e=>e.hidden),false);assert.equal(await p.locator('.activity-card').getAttribute('data-activity-color'),'rose');
  await openEditor(p);assert.equal(await p.locator('#activity-color').inputValue(),'white','new activity must not inherit last edited color');await chooseColor(p,'lavender');
  await p.locator('#activity-category').selectOption('交通');await p.locator('#activity-text').fill('10/25 23:50～10/26 01:30 虛構跨日交通');assert.ok(await overflow(p));await p.locator('#activity-submit').click();
  assert.equal((await trips(p))[0].days[4][0].color,'lavender');assert.equal((await trips(p))[0].days[4][0].endDayOffset,1);
  const card=p.locator('.activity-card');await openDetails(card);await p.locator('.transfer-day').selectOption('0');await p.getByRole('button',{name:'複製活動：虛構跨日交通',exact:true}).click();
  await p.locator('#day-tabs button').first().click();const copied=p.locator('.activity-card').filter({hasText:'虛構跨日交通'});await openDetails(copied);await copied.locator('.transfer-day').selectOption('3');await p.getByRole('button',{name:'移動活動：虛構跨日交通',exact:true}).click();
  let data=await trips(p);for(const day of [3,4]){assert.equal(data[0].days[day][0].color,'lavender');assert.equal(data[0].days[day][0].endDayOffset,1);assert.equal(data[0].days[day][0].createdBy,'owen');}
  await navigate(p,'sync');const downloading=p.waitForEvent('download');await p.locator('#export-trips').click();const backup=JSON.parse(fs.readFileSync(await(await downloading).path(),'utf8'));
  await p.locator('#import-file').setInputFiles({name:'fictional-appearance.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await p.waitForTimeout(80);assert.deepEqual(await trips(p),backup.trips);
  await p.locator('#cloud-save').click();await p.waitForFunction(()=>!document.querySelector('#cloud-save').disabled);assert.deepEqual(state.snapshot.trips,backup.trips);
  const other=await b.newContext();await mockBackend(other,{snapshot:state.snapshot});const op=await other.newPage();await login(op);assert.deepEqual(await trips(op),backup.trips);await other.close();
  const immutable=JSON.stringify(await trips(p));
  for(const malicious of ['#fff','url(https://invalid.example/track)',null,{},'pink','white;background:red']){
   assert.equal(await p.evaluate(value=>{const candidate=window.TripPlanner.getTrips();candidate[0].days[0][0].color='mint';candidate[0].days[4][0].color=value;try{window.TripPlanner.replaceTrips(candidate);return false;}catch{return true;}},malicious),true);
   assert.equal(JSON.stringify(await trips(p)),immutable,'invalid color must not partially replace existing trip');
  }
  assert.equal(await p.evaluate(()=>{const template={confirmed:true,date:'2026-10-21',category:'美食',place:'虛構匯入色彩',sources:[]};try{window.TripPlanner.addImportedDrafts([{...template,importKey:'color-safe',color:'mint'},{...template,importKey:'color-unsafe',color:'url(https://invalid.example/)'}]);return false;}catch{return true;}}),true);
  assert.equal(JSON.stringify(await trips(p)),immutable,'invalid second import color must reject the whole batch');
  const legacy=structuredClone(backup.trips);for(const day of legacy[0].days)for(const activity of day)delete activity.color;
  await p.evaluate(value=>window.TripPlanner.replaceTrips(value),legacy);assert.ok((await trips(p))[0].days.flat().every(a=>a.color==='white'));
  // Exercise every palette color against actual rendered styles, independently of identity.
  await p.evaluate(colors=>{const t=window.TripPlanner.getTrips(),template=t[0].days[0][0];t[0].days[0]=colors.map((color,i)=>({...template,id:`color-${i}`,color,place:`色彩虛構${i}`,createdBy:i%2?'winnie':'owen'}));window.TripPlanner.replaceTrips(t);},COLORS);
  await navigate(p,'itinerary');assert.equal(await p.locator('.activity-card').count(),7);
  const contrast=await p.locator('.activity-card').evaluateAll(cards=>{
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   return cards.map(card=>{const bg=lum(rgb(getComputedStyle(card).backgroundColor)),fg=lum(rgb(getComputedStyle(card.querySelector('.row-title')).color));return {color:card.dataset.activityColor,ratio:(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05),actor:getComputedStyle(card.querySelector('.row-actor')).color};});
  });
  assert.deepEqual(contrast.map(x=>x.color),COLORS);assert.ok(contrast.every(x=>x.ratio>=4.5),JSON.stringify(contrast));assert.notEqual(contrast[0].actor,contrast[1].actor,'blue/pink identity must remain distinct');
  // Short visible viewport approximates keyboard-reduced space; this is not physical iOS.
  await p.setViewportSize({width,height:390});await editActivity(p,'色彩虛構0');await p.locator('#activity-place').fill('鍵盤可見虛構文字');await p.locator('#activity-place').focus();await p.waitForTimeout(160);
  assert.ok(await overflow(p));const bounds=await p.locator('#activity-place').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=390,'focused text must remain inside reduced visible viewport');
  await chooseColor(p,'mint');await p.locator('#activity-submit').click();assert.equal((await trips(p))[0].days[0].find(a=>a.id==='color-0').color,'mint');assert.deepEqual(errors,[]);await c.close();
 }
 console.log('PASS appearance: emoji labels/plain values, default/legacy white, all 7 colors and text contrast, edit/save reminder, overnight/copy/move/backup/shared preservation, invalid colors rejected atomically, blue/pink identity, 320/390 mobile and reduced-viewport input. Google/storage mocked; physical iPhone not exercised.');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
