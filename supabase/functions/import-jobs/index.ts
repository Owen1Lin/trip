import {verifyWorkerToken,WorkerAuthError} from './worker-auth.mjs';
import {validateRichUrl} from '../link-import/rich-core.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_FIELDS='id,source_url,model,status,phase,error,attempts,created_at,updated_at';
const origins=new Set((Deno.env.get('LINK_IMPORT_ORIGINS')||'https://owen1lin.github.io,http://localhost:3000,http://127.0.0.1:3000').split(',').map(v=>v.trim()));
async function boundedJson(response:Response|Request,limit=210000){if(!response.body)throw Error('Missing body');const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder();try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw Error('Body limit exceeded');text+=decoder.decode(part.value,{stream:true});}}finally{await reader.cancel();}return JSON.parse(text+decoder.decode());}
Deno.serve(async(req)=>{
 const origin=req.headers.get('Origin'),headers={'Content-Type':'application/json','Vary':'Origin',...(origin&&origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const send=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return send(403,{error:'來源網站不在允許名單。'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return send(405,{error:'僅支援 POST。'});
 const supabase=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');if(!supabase||!anon)return send(503,{error:'任務服務未設定。'});
 const authorization=req.headers.get('Authorization')||'',token=authorization.replace(/^Bearer /,'');if(!/^Bearer \S+$/.test(authorization))return send(401,{error:'請先登入。'});
 let input;try{input=await boundedJson(req);}catch{return send(400,{error:'任務資料格式錯誤或過大。'});}
 const rpc=async(name:string,body:unknown,key:string,auth:string)=>{const response=await fetch(`${supabase}/rest/v1/rpc/${name}`,{method:'POST',redirect:'error',headers:{apikey:key,Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('任務操作未成功；請確認服務可用、任務狀態與重試上限。');return await boundedJson(response);};
 if(['claim','complete','heartbeat','progress'].includes(input?.action)){
   try{await verifyWorkerToken(token);}catch(error){return send(403,{error:'背景工作身分驗證失敗。',code:error instanceof WorkerAuthError?error.code:'OIDC_UNEXPECTED'});}
   const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!service)return send(503,{error:'背景任務服務未設定。'});
   try{
    if(input.action==='heartbeat')return send(200,{ok:await rpc('trip_import_heartbeat',{},service,`Bearer ${service}`)});
    if(input.action==='claim')return send(200,{job:await rpc('trip_import_claim',{},service,`Bearer ${service}`)});
    if(!UUID.test(input.jobId)||!UUID.test(input.leaseToken))return send(400,{error:'任務識別錯誤。'});
    if(input.action==='progress'){if(!['extracting','captions','transcription','frame_ocr'].includes(input.phase))return send(400,{error:'任務進度不正確。'});const ok=await rpc('trip_import_progress',{p_id:input.jobId,p_lease:input.leaseToken,p_phase:input.phase},service,`Bearer ${service}`);return send(ok?200:409,{ok});}
    let result=input.result??null,error=typeof input.error==='string'&&input.error.trim()?input.error.slice(0,1000):null;
    if(!error){if(!result||typeof result.text!=='string'||!result.text.trim()||result.text.length>12000||!['video_caption','video_transcript','webpage','social'].includes(result.type))return send(400,{error:'來源結果格式錯誤。'});result={...result,url:validateRichUrl(result.url).url,title:typeof result.title==='string'?result.title.slice(0,300):''};}
    const ok=await rpc('trip_import_complete',{p_id:input.jobId,p_lease:input.leaseToken,p_result:result,p_error:error},service,`Bearer ${service}`);return send(ok?200:409,{ok,error:ok?undefined:'租約已到期或任務已被捨棄。'});
   }catch{return send(422,{error:'背景任務操作失敗，請檢查任務格式、租約與服務設定。'});}
 }
 try{
  const member=await fetch(`${supabase}/rest/v1/rpc/is_private_trip_member`,{method:'POST',redirect:'error',headers:{apikey:anon,Authorization:authorization,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
  if(member.status===401||member.status===403)return send(403,{error:'登入憑證失效或此帳號不是授權的 Google 成員。'});
  if(!member.ok)return send(503,{error:'暫時無法核實成員身份。'});
  if(await boundedJson(member)!==true)return send(403,{error:'此帳號不是授權的 Google 成員。'});
 }catch{return send(503,{error:'暫時無法核實成員身份。'});}
 try{
  if(input.action==='enqueue'){const url=validateRichUrl(input.url).url;if(!['metadata','qwen','llama'].includes(input.model)||typeof input.idempotencyKey!=='string'||!/^[\w-]{8,120}$/.test(input.idempotencyKey))return send(400,{error:'任務輸入格式錯誤。'});return send(200,{job:await rpc('trip_import_enqueue',{p_url:url,p_model:input.model,p_key:input.idempotencyKey,p_options:{includeFrames:input.options?.includeFrames===true}},anon,authorization)});}
  if(['get','retry','delete'].includes(input.action)&&!UUID.test(input.jobId))return send(400,{error:'任務識別錯誤。'});
  if(input.action==='retry')return send(200,{job:await rpc('trip_import_retry',{p_id:input.jobId},anon,authorization)});
  if(input.action==='delete')return send(200,{ok:await rpc('trip_import_delete',{p_id:input.jobId},anon,authorization)});
  if(['list','get'].includes(input.action)){await rpc('trip_import_expire_own',{},anon,authorization);const query=new URLSearchParams({select:PUBLIC_FIELDS,order:'created_at.desc',limit:'30'});if(input.action==='get')query.set('id',`eq.${input.jobId}`);const response=await fetch(`${supabase}/rest/v1/trip_import_jobs?${query}`,{headers:{apikey:anon,Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('任務讀取失敗。');const jobs=await boundedJson(response);return send(200,input.action==='get'?{job:jobs[0]||null}:{jobs});}
  return send(400,{error:'任務操作不正確。'});
 }catch{return send(422,{error:'任務操作未成功：背景服務可能未就緒、已達 2 筆處理中／10 分鐘 5 筆上限，或任務已無法重試。原始輸入仍保留。'});}
});
