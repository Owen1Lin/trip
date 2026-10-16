// Deploy only import functions; never reset authentication, member lists or trips.
import {readFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF || 'lezobidxashxirzijveb';
if(!/^[a-z0-9]{20}$/.test(project) || !process.env.SUPABASE_ACCESS_TOKEN)throw new Error('Configure the existing project and management credential securely.');
const shared=['supabase/functions/link-import/core.mjs','supabase/functions/link-import/rich-core.mjs','supabase/functions/link-import/secure-fetch.ts'];
const requested=process.argv.slice(2),names=requested.length?requested:['link-import','import-jobs'];
if(names.some(name=>!['link-import','import-jobs'].includes(name)))throw new Error('Only the two import functions may be deployed.');
for(const name of names){
 const entry=`supabase/functions/${name}/index.ts`,form=new FormData();
 form.append('metadata',JSON.stringify({name,entrypoint_path:entry,verify_jwt:false}));
 const files=[entry,...shared,...(name==='import-jobs'?['supabase/functions/import-jobs/worker-auth.mjs']:[])];
 for(const file of new Set(files))form.append('file',new Blob([await readFile(new URL('../'+file,import.meta.url))],{type:'application/javascript'}),file);
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/functions/deploy?slug=${name}`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},body:form,signal:AbortSignal.timeout(60000)});
 const body=await response.json().catch(()=>null);console.log(JSON.stringify({function:name,status:response.status,state:body?.status,version:body?.version}));
 if(!response.ok)throw new Error(`${name} deployment failed; existing data was not changed.`);
}
