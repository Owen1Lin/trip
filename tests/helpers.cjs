// Only mocked Supabase authentication is used by browser acceptance tests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const URL_BASE = process.env.TEST_URL || 'http://127.0.0.1:3000';
const SCOPE = 'owen-winnie-20261021';
const USER_ID = '11111111-1111-1111-1111-111111111111';
async function browser() { return chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']}); }
const publicConfig = () => ({url:'https://testing.supabase.co',publishableKey:'sb_publishable_testing'});
async function configRoute(context, config=publicConfig()) {
  await context.route(/\/cloud-config\.js(?:\?.*)?$/, r => r.fulfill({contentType:'application/javascript',body:`window.TRIP_CLOUD_CONFIG=${JSON.stringify(config)};`}));
}
function googleUser(email='owentravel@gmail.com',id=USER_ID) {
  return {id,email,email_confirmed_at:'2026-10-14T00:00:00Z',app_metadata:{provider:'google',providers:['google']},identities:[{provider:'google',identity_data:{email,email_verified:true}}]};
}

function accessToken(user=googleUser(), method='oauth') {
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const now=Math.floor(Date.now()/1000);
  const payload=Buffer.from(JSON.stringify({sub:user.id,email:user.email,role:'authenticated',aud:'authenticated',iat:now,exp:now+3600,amr:[{method,timestamp:now}]})).toString('base64url');
  return `${header}.${payload}.test-signature`;
}
function authHash(user=googleUser(),method='oauth') {
  return '#'+new URLSearchParams({access_token:accessToken(user,method),refresh_token:'test-refresh',expires_in:'3600'}).toString();
}

async function mockBackend(context, options={}) {
  await configRoute(context);
  const state={user:googleUser(),member:true,snapshot:null,conflict:false,status:200,requests:[],...options};
  await context.route('https://testing.supabase.co/**',r=>{
    const req=r.request(),u=new URL(req.url()),method=req.method();
    const record={path:u.pathname,query:u.search,method,body:req.postDataJSON(),headers:req.headers()};state.requests.push(record);
    if(state.status!==200)return r.fulfill({status:state.status,contentType:'application/json',body:JSON.stringify({code:'rate_limit',message:'Request refused'})});
    let body=null;
    if(u.pathname==='/auth/v1/settings')body={external:{google:true}};
    else if(u.pathname==='/auth/v1/user')body=state.user;
    else if(u.pathname==='/auth/v1/token')body={access_token:accessToken(state.user,state.authMethod || 'oauth'),refresh_token:'test-refresh',expires_in:3600,user:state.user};
    else if(u.pathname==='/auth/v1/logout')body={};
    else if(u.pathname==='/rest/v1/private_trip_members')body=state.member?[{email:state.user.email,display_name:state.user.email.startsWith('owentravel')?'歐文':'溫妮',actor:state.user.email.startsWith('owentravel')?'owen':'winnie'}]:[];
    else if(u.pathname==='/rest/v1/shared_trip_snapshots'){
      if(method==='GET')body=state.snapshot?[state.snapshot]:[];
      else if(method==='POST'){state.snapshot={trips:record.body.trips,updated_at:'2026-10-14T10:00:00Z',updated_by:state.user.id};body=[state.snapshot];}
      else if(method==='PATCH'){
        if(state.conflict || u.searchParams.get('updated_at') !== 'eq.'+state.snapshot?.updated_at)body=[];
        else{state.snapshot={trips:record.body.trips,updated_at:'2026-10-14T10:01:00Z',updated_by:state.user.id};body=[state.snapshot];}
      }
    }
    else return r.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'Unexpected mocked route'})});
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  return state;
}
let loginCounter = 0;
async function login(page,user=googleUser(),method='oauth') {
  await page.goto(URL_BASE+'/?test-login='+(++loginCounter)+authHash(user,method));
  await page.waitForFunction(()=>document.querySelector('#private-app') && !document.querySelector('#private-app').hidden && document.querySelector('#sync-status').textContent.includes('共同'));
}
async function ensureLocked(page) {
  assert.ok(await page.locator('#private-app').evaluate(e=>e.hidden && e.inert));
  assert.equal(await page.evaluate(() => {try {window.TripPlanner.getTrips();return false;}catch{return true;}}),true);
  assert.equal(await page.evaluate(() => {try {window.TripPlanner.replaceTrips([]);return false;}catch{return true;}}),true);
  assert.equal(await page.locator('#activity-list').innerText(), '');
  assert.equal(await page.locator('.bottom-nav').isVisible(),false);
  assert.equal(await page.locator('#activity-editor').evaluate(element=>element.open),false);
}
async function navigate(page,view) {
  await page.locator(`[data-nav="${view}"]`).click();
  await page.locator(`#view-${view}`).waitFor({state:'visible'});
}
async function openEditor(page) {
  if (!await page.locator('#activity-editor').isVisible()) await page.locator('[data-nav="add"]').click();
  await page.locator('#activity-editor').waitFor({state:'visible'});
}
async function closeEditor(page) {
  if (await page.locator('#activity-editor').isVisible()) await page.locator('[data-close-editor]').click();
}
async function openDetails(card) {
  const details=card.locator('details.activity-details');
  if (await details.count() && !await details.evaluate(element=>element.open)) await details.locator('summary').click();
}
async function signOut(page) {
  await closeEditor(page);
  await navigate(page,'sync');
  await page.locator('#sign-out').click();
}
module.exports={browser,assert,URL_BASE,SCOPE,USER_ID,googleUser,accessToken,authHash,publicConfig,configRoute,mockBackend,login,ensureLocked,navigate,openEditor,closeEditor,openDetails,signOut};
