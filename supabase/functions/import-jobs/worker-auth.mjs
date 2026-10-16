const ISSUER='https://token.actions.githubusercontent.com';
const JWKS_URL=`${ISSUER}/.well-known/jwks`;
const AUDIENCE='https://lezobidxashxirzijveb.supabase.co/functions/v1/import-jobs';
export class WorkerAuthError extends Error {
  constructor(code){super('Worker identity rejected');this.name='WorkerAuthError';this.code=code;}
}
function deny(code){throw new WorkerAuthError(code);}
function decode(segment){if(!/^[A-Za-z0-9_-]+$/.test(segment))deny('OIDC_FORMAT');try{const binary=atob(segment.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(binary,c=>c.charCodeAt(0));}catch{deny('OIDC_FORMAT');}}
/** Verify GitHub OIDC using fixed issuer/JWKS, exact repository, ref and workflow. */
/** @param {string} token @param {{fetcher?: typeof fetch, now?: number, jwks?: object}} dependencies */
export async function verifyWorkerToken(token,{fetcher=fetch,now=Date.now(),jwks}={}){
  if(typeof token!=='string'||token.length>16000)deny('OIDC_FORMAT');
  const parts=token.split('.');if(parts.length!==3)deny('OIDC_FORMAT');
  let header,claims;
  try{header=JSON.parse(new TextDecoder().decode(decode(parts[0])));claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));}catch{deny('OIDC_FORMAT');}
  if(!header||!claims||typeof header!=='object'||typeof claims!=='object')deny('OIDC_FORMAT');
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.jku||header.jwk||header.x5u||header.crit)deny('OIDC_HEADER');
  const expected={iss:ISSUER,aud:AUDIENCE,repository:'Owen1Lin/trip',repository_owner:'Owen1Lin',ref:'refs/heads/main',workflow_ref:'Owen1Lin/trip/.github/workflows/import-worker.yml@refs/heads/main',sub:'repo:Owen1Lin/trip:ref:refs/heads/main'};
  for(const [key,value] of Object.entries(expected))if(claims[key]!==value)deny(`OIDC_CLAIM_${key.toUpperCase()}`);
  if(!['schedule','workflow_dispatch','push'].includes(claims.event_name))deny('OIDC_CLAIM_EVENT_NAME');
  const seconds=now/1000;
  if(typeof claims.exp!=='number'||typeof claims.nbf!=='number'||typeof claims.iat!=='number')deny('OIDC_TIME_FORMAT');
  if(claims.exp<=seconds)deny('OIDC_EXPIRED');
  if(claims.exp>seconds+900)deny('OIDC_EXPIRY_BOUND');
  if(claims.nbf>seconds+30||claims.iat>seconds+30)deny('OIDC_NOT_YET_VALID');
  if(claims.iat<seconds-900)deny('OIDC_ISSUED_TOO_OLD');
  let keys=jwks;
  if(!keys){
    let response;
    try{response=await fetcher(JWKS_URL,{redirect:'error',signal:AbortSignal.timeout(8000)});}catch{deny('OIDC_JWKS_FETCH');}
    if(!response.ok)deny(`OIDC_JWKS_HTTP_${response.status}`);
    let raw;try{raw=await response.text();}catch{deny('OIDC_JWKS_READ');}
    if(raw.length>50000)deny('OIDC_JWKS_SIZE');
    try{keys=JSON.parse(raw);}catch{deny('OIDC_JWKS_FORMAT');}
  }
  const candidates=Array.isArray(keys?.keys)?keys.keys.filter(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.alg||key.alg==='RS256')&&(!key.use||key.use==='sig')):[];
  if(candidates.length!==1)deny('OIDC_SIGNING_KEY');
  let key;
  try{key=await crypto.subtle.importKey('jwk',candidates[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);}catch{deny('OIDC_KEY_IMPORT');}
  let valid=false;
  try{valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));}catch{deny('OIDC_SIGNATURE_FORMAT');}
  if(!valid)deny('OIDC_SIGNATURE');return claims;
}
