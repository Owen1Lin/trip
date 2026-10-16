const ISSUER='https://token.actions.githubusercontent.com';
const JWKS_URL=`${ISSUER}/.well-known/jwks`;
const AUDIENCE='https://lezobidxashxirzijveb.supabase.co/functions/v1/import-jobs';
function decode(segment){if(!/^[A-Za-z0-9_-]+$/.test(segment))throw Error('Invalid OIDC token');const binary=atob(segment.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(binary,c=>c.charCodeAt(0));}
/** Verify GitHub OIDC using fixed issuer/JWKS, exact repository, ref and workflow. */
/** @param {string} token @param {{fetcher?: typeof fetch, now?: number, jwks?: object}} dependencies */
export async function verifyWorkerToken(token,{fetcher=fetch,now=Date.now(),jwks}={}){
  if(typeof token!=='string'||token.length>16000)throw Error('Invalid worker token');
  const parts=token.split('.');if(parts.length!==3)throw Error('Invalid worker token');
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.jku||header.jwk||header.x5u||header.crit)throw Error('Unsupported worker token');
  const seconds=now/1000;
  if(claims.iss!==ISSUER||claims.aud!==AUDIENCE||claims.repository!=='Owen1Lin/trip'||claims.repository_owner!=='Owen1Lin'||claims.ref!=='refs/heads/main'||claims.workflow_ref!=='Owen1Lin/trip/.github/workflows/import-worker.yml@refs/heads/main'||claims.sub!=='repo:Owen1Lin/trip:ref:refs/heads/main'||!['schedule','workflow_dispatch','push'].includes(claims.event_name)||typeof claims.exp!=='number'||claims.exp<=seconds||claims.exp>seconds+900||typeof claims.nbf!=='number'||claims.nbf>seconds+30||typeof claims.iat!=='number'||claims.iat>seconds+30||claims.iat<seconds-900)throw Error('Worker identity rejected');
  let keys=jwks;
  if(!keys){const response=await fetcher(JWKS_URL,{redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Worker identity keys unavailable');const raw=await response.text();if(raw.length>50000)throw Error('Worker keys too large');keys=JSON.parse(raw);}
  const candidates=Array.isArray(keys?.keys)?keys.keys.filter(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.alg||key.alg==='RS256')&&(!key.use||key.use==='sig')):[];
  if(candidates.length!==1)throw Error('Unknown worker signing key');
  const key=await crypto.subtle.importKey('jwk',candidates[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if(!valid)throw Error('Worker signature rejected');return claims;
}
