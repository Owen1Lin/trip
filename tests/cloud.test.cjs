// Mock API acceptance only; cannot establish real OAuth, membership/RLS, or shared account access.
const {browser,assert,URL_BASE,SCOPE,googleUser,authHash,mockBackend,login,ensureLocked}=require('./helpers.cjs');
(async()=>{
 const b=await browser();
 async function denied(options){const c=await b.newContext();await mockBackend(c,options);const p=await c.newPage();await p.goto(URL_BASE+'/'+authHash(options.user || googleUser(),options.authMethod || 'oauth'));await p.waitForTimeout(500);await ensureLocked(p);assert.equal(await p.locator('.activity-card').count(),0);await c.close();}
 try{
  await denied({user:googleUser('outsider@gmail.com'),member:false});
  const nongoogle=googleUser();nongoogle.app_metadata={provider:'email',providers:['email']};nongoogle.identities=[{provider:'email'}];await denied({user:nongoogle});
  await denied({user:googleUser(),authMethod:'otp'});
  const linked=googleUser();linked.app_metadata={provider:'email',providers:['email','google']};
  const linkedContext=await b.newContext();await mockBackend(linkedContext,{user:linked});const linkedPage=await linkedContext.newPage();await login(linkedPage,linked);assert.ok(await linkedPage.locator('#private-app').evaluate(e=>!e.hidden));await linkedContext.close();
  await denied({status:429});
  const oauth=await b.newContext();await mockBackend(oauth);const oauthPage=await oauth.newPage();await oauthPage.goto(URL_BASE);
  await oauth.route('https://testing.supabase.co/auth/v1/settings',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({external:{google:false}})}));
  await oauthPage.locator('#google-sign-in').click();await oauthPage.waitForFunction(()=>document.querySelector('.auth-status').textContent.includes('Google') && !document.querySelector('#google-sign-in').disabled);await ensureLocked(oauthPage);
  await oauth.unroute('https://testing.supabase.co/auth/v1/settings');const authorizeP=oauthPage.waitForRequest(r=>r.url().includes('/auth/v1/authorize'));await oauthPage.locator('#google-sign-in').click();const authorize=new URL((await authorizeP).url());assert.equal(authorize.searchParams.get('provider'),'google');assert.equal(authorize.searchParams.get('prompt'),'select_account');assert.equal(authorize.searchParams.get('redirect_to'),URL_BASE+'/');await oauth.close();
  const c=await b.newContext();const state=await mockBackend(c);const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  await p.goto(URL_BASE);await ensureLocked(p);assert.equal(await p.locator('#auth-panel input[type="email"]').count(),0);
  // OAuth navigation uses Google's provider, not an email-only login route.
  const googleLink=p.getByRole('button',{name:/Google/});assert.equal(await googleLink.count(),1);
  await login(p);assert.ok(!p.url().includes('access_token')&&!p.url().includes('refresh_token'));await p.locator('#activity-start').fill('09:00');await p.locator('#activity-end').fill('10:00');await p.locator('#activity-place').fill('兩人共享活動');await p.locator('#activity-submit').click();
  await p.locator('#cloud-save').click();await p.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('已')&&!document.querySelector('#cloud-save').disabled);
  assert.equal(state.snapshot.trips[0].days[0][0].place,'兩人共享活動');assert.equal(state.snapshot.trips[0].days[0][0].createdBy,'owen');assert.ok(state.requests.filter(r=>r.path==='/rest/v1/shared_trip_snapshots').every(r=>r.method==='POST'?r.body.scope===SCOPE:r.query.includes(SCOPE)));
  await p.getByRole('button',{name:'編輯活動：兩人共享活動',exact:true}).click();await p.locator('#activity-place').fill('未儲存的本機草稿');await p.locator('#activity-submit').click();
  await p.reload();await p.waitForFunction(()=>!document.querySelector('#private-app').hidden && document.querySelector('#sync-status').textContent.length>0);assert.match(await p.locator('#activity-list').innerText(),/未儲存的本機草稿/);
  state.snapshot.updated_at='2026-10-14T10:05:00Z';state.snapshot.trips[0].days[0][0].place='另一裝置已保存';
  await p.reload();await p.waitForFunction(()=>!document.querySelector('#private-app').hidden && document.querySelector('#sync-status').textContent.length>0);assert.match(await p.locator('#activity-list').innerText(),/未儲存的本機草稿/);
  await p.locator('#cloud-save').click();await p.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('另一位')||document.querySelector('#sync-status').textContent.includes('衝突'));assert.equal(state.snapshot.trips[0].days[0][0].place,'另一裝置已保存');
  state.snapshot.trips[0].days[0][0].place='另一位的調整';state.snapshot.trips[0].days[0][0].updatedBy='winnie';await p.locator('#cloud-load').click();await p.waitForFunction(()=>document.querySelector('#activity-list').textContent.includes('另一位的調整'));
  assert.match(await p.locator('.activity-card').innerText(),/歐文建立[\s\S]*溫妮更新/);
  const previous=await p.evaluate(()=>JSON.stringify(window.TripPlanner.getTrips()));const valid=state.snapshot.trips;state.snapshot={...state.snapshot,trips:[{bad:true}]};await p.locator('#cloud-load').click();await p.waitForFunction(()=>!document.querySelector('#cloud-load').disabled);assert.equal(await p.evaluate(()=>JSON.stringify(window.TripPlanner.getTrips())),previous);state.snapshot.trips=valid;
  state.conflict=true;await p.locator('#cloud-save').click();await p.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('另一位')||document.querySelector('#sync-status').textContent.includes('衝突'));state.conflict=false;
  state.status=429;await p.locator('#cloud-load').click();await p.waitForFunction(()=>!document.querySelector('#cloud-load').disabled);assert.equal(await p.evaluate(()=>JSON.stringify(window.TripPlanner.getTrips())),previous);state.status=200;
  state.member=false;await p.locator('#cloud-load').click();await p.waitForTimeout(300);await ensureLocked(p);assert.deepEqual(errors,[]);await c.close();
  // A second member uses the identical shared scope and retains attribution.
  const other=await b.newContext();await mockBackend(other,{user:googleUser('winnietravel@gmail.com','22222222-2222-2222-2222-222222222222'),snapshot:{trips:valid,updated_at:'2026-10-14T11:00:00Z'}});const op=await other.newPage();op.on('dialog',d=>d.accept());await login(op,googleUser('winnietravel@gmail.com','22222222-2222-2222-2222-222222222222'));await op.locator('#cloud-load').click();await op.waitForFunction(()=>document.querySelector('#activity-list').textContent.includes('另一位的調整'));await op.getByRole('button',{name:'編輯活動：另一位的調整',exact:true}).click();await op.locator('#activity-place').fill('溫妮更新活動');await op.locator('#activity-submit').click();const activity=(await op.evaluate(()=>window.TripPlanner.getTrips()))[0].days[0][0];assert.equal(activity.createdBy,'owen');assert.equal(activity.updatedBy,'winnie');
  let release;const delayed=new Promise(resolve=>{release=resolve;});let hit;const fetched=new Promise(resolve=>{hit=resolve;});
  await other.route('https://testing.supabase.co/rest/v1/shared_trip_snapshots?**',async r=>{hit();await delayed;try{await r.fulfill({contentType:'application/json',body:JSON.stringify([{trips:valid,updated_at:'2026-10-14T11:01:00Z'}])});}catch{}});
  await op.locator('#cloud-load').click();await fetched;await op.locator('#sign-out').click();await ensureLocked(op);release();await op.waitForTimeout(200);await ensureLocked(op);assert.equal(await op.evaluate(()=>sessionStorage.getItem('trip-google-session-v2')),null);await other.close();
  console.log('PASS (mock API): unauthorized/non-Google/OTP rejection, linked Google OAuth acceptance, rate limits, two-member same-scope snapshots, actor attribution, invalid remote preservation, conflict rejection, draft reload preservation, stale draft conflict, revoked membership lock, OAuth URL/config, callback token clearing, pending-response logout race. Real Google OAuth and RLS remain unverified.');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
