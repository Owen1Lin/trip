// Mocked API tests only: these do not validate a real Supabase project's RLS or email delivery.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const b = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  const context = await b.newContext();
  const p = await context.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const url=process.env.TEST_URL || 'http://127.0.0.1:3000';
  let snapshot=null,conflict=false;const requests=[];
  await context.route('**/cloud-config.js',r=>r.fulfill({contentType:'application/javascript',body:"window.TRIP_CLOUD_CONFIG={url:'https://testing.supabase.co',publishableKey:'sb_publishable_testing'};"}));
  await context.route('https://testing.supabase.co/**',r=>{
    const req=r.request(), u=new URL(req.url()), method=req.method();requests.push({path:u.pathname,query:u.search,method,body:req.postDataJSON()});
    let data=null;
    if(u.pathname==='/auth/v1/otp')data={};
    else if(u.pathname==='/auth/v1/verify')data={access_token:'access',refresh_token:'refresh',expires_in:3600,user:{id:'11111111-1111-1111-1111-111111111111',email:'travel@example.com'}};
    else if(u.pathname==='/auth/v1/user')data={id:'11111111-1111-1111-1111-111111111111',email:'travel@example.com'};
    else if(u.pathname==='/auth/v1/logout')data={};
    else if(u.pathname==='/rest/v1/trip_snapshots'){
      if(method==='GET')data=snapshot?[snapshot]:[];
      else if(method==='POST'){snapshot={trips:req.postDataJSON().trips,updated_at:'2026-10-14T00:00:00Z'};data=null;}
      else if(method==='PATCH')data=conflict?[]:[{...snapshot,trips:req.postDataJSON().trips}];
    }
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  p.on('dialog',d=>d.accept());
  try{
    await p.goto(url);await p.locator('#cloud-email').fill('travel@example.com');await p.getByRole('button',{name:'寄送登入連結',exact:true}).click();
    await p.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('已寄出'));
    const otp=requests.find(x=>x.path==='/auth/v1/otp');assert.equal(otp.body.email,'travel@example.com');assert.match(otp.query,/redirect_to=/);
    await p.locator('#cloud-code').fill('123456');await p.getByRole('button',{name:'驗證登入',exact:true}).click();
    await p.getByRole('button',{name:'上傳行程',exact:true}).waitFor();
    await p.locator('#trip-name').fill('雲端測試');await p.locator('#trip-destination').fill('京都');await p.locator('#trip-start').fill('2026-11-01');await p.locator('#trip-form button[type="submit"]').click();
    await p.getByRole('button',{name:'上傳行程',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('已上傳'));
    assert.equal(snapshot.trips[0].name,'雲端測試');
    snapshot.trips[0].name='另一装置行程';await p.getByRole('button',{name:'下載行程',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('已下載'));
    assert.equal(await p.locator('#active-trip-name').textContent(),'另一装置行程');
    const previous=await p.locator('#active-trip-name').textContent();snapshot.trips=[{bad:true}];await p.getByRole('button',{name:'下載行程',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('格式不正確'));
    assert.equal(await p.locator('#active-trip-name').textContent(),previous);
    snapshot.trips=await p.evaluate(()=>window.TripPlanner.getTrips());conflict=true;
    await p.getByRole('button',{name:'上傳行程',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.cloud-status').textContent.includes('其他裝置已更新'));
    await p.getByRole('button',{name:'登出',exact:true}).click();await p.locator('#cloud-email').waitFor();
    assert.equal(await p.evaluate(()=>localStorage.getItem('trip-cloud-session-v1')),null);
    assert.deepEqual(errors,[]);console.log('PASS (mocked API): OTP redirect, verification, upload/download, invalid remote preservation, optimistic conflict detection, logout. Real Supabase remains unverified.');
  }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
