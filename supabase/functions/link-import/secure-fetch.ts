// HTTPS HTTP/1.1 transport: DNS is checked, then the socket connects to that IP.
// TLS still verifies the original hostname; arbitrary URLs never use fetch DNS.
import { isPublicAddress, validateRichUrl } from './rich-core.mjs';
const HEADER_LIMIT=16384,BODY_LIMIT=1024*1024,WIRE_LIMIT=BODY_LIMIT*2+HEADER_LIMIT;
export function decodeHttpResponse(wire:Uint8Array) {
  const text=new TextDecoder('latin1').decode(wire),boundary=text.indexOf('\r\n\r\n');
  if(boundary<0||boundary>HEADER_LIMIT)throw new Error('來源 HTTP 標頭不完整或過大。');
  const lines=text.slice(0,boundary).split('\r\n'),statusLine=lines.shift()?.match(/^HTTP\/1\.[01] (\d{3})(?: |$)/);
  if(!statusLine)throw new Error('來源 HTTP 格式不正確。');
  const status=Number(statusLine[1]),headers=new Headers();
  for(const line of lines){const at=line.indexOf(':');if(at<=0||/^[\t ]/.test(line))throw new Error('來源 HTTP 標頭不正確。');const key=line.slice(0,at).toLowerCase(),value=line.slice(at+1).trim();if(['content-length','transfer-encoding','content-encoding'].includes(key)&&headers.has(key))throw new Error('來源 HTTP 長度標頭重複。');headers.append(key,value);}
  if(headers.has('content-encoding')&&!/^identity$/i.test(headers.get('content-encoding')||''))throw new Error('不支援壓縮來源，請貼上原文。');
  let body=wire.subarray(boundary+4);
  const transfer=headers.get('transfer-encoding');
  if(transfer){
    if(transfer.toLowerCase()!=='chunked'||headers.has('content-length'))throw new Error('來源 HTTP 傳輸格式不正確。');
    const chunks:Uint8Array[]=[];let cursor=0,size=0,complete=false;
    while(cursor<body.length){
      let end=cursor;while(end+1<body.length&&!(body[end]===13&&body[end+1]===10))end++;
      if(end+1>=body.length||end-cursor>128)throw new Error('來源分塊標頭不正確。');
      const line=new TextDecoder().decode(body.subarray(cursor,end)),match=line.match(/^([0-9a-f]+)(?:;[^\r\n]*)?$/i);
      if(!match)throw new Error('來源分塊長度不正確。');
      const length=parseInt(match[1],16);cursor=end+2;
      if(!Number.isSafeInteger(length)||length>BODY_LIMIT||size+length>BODY_LIMIT)throw new Error('來源內容過大。');
      if(length===0){
        // Consume trailers and the mandatory empty final line; reject extra bytes.
        while(true){let trailerEnd=cursor;while(trailerEnd+1<body.length&&!(body[trailerEnd]===13&&body[trailerEnd+1]===10))trailerEnd++;if(trailerEnd+1>=body.length)throw new Error('來源分塊結尾不完整。');const trailer=new TextDecoder().decode(body.subarray(cursor,trailerEnd));cursor=trailerEnd+2;if(!trailer){if(cursor!==body.length)throw new Error('來源分塊包含額外資料。');complete=true;break;}if(!/^[!#$%&'*+.^_`|~0-9a-z-]+:[^\r\n]*$/i.test(trailer)||/^(?:content-length|transfer-encoding|host):/i.test(trailer))throw new Error('來源分塊尾標頭不正確。');}
        break;
      }
      if(cursor+length+2>body.length||body[cursor+length]!==13||body[cursor+length+1]!==10)throw new Error('來源分塊內容不完整。');
      chunks.push(body.subarray(cursor,cursor+length));size+=length;cursor+=length+2;
    }
    if(!complete)throw new Error('來源分塊未完成。');
    body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
    headers.delete('transfer-encoding');
  }else if(headers.has('content-length')){
    const value=headers.get('content-length')||'';if(!/^\d+$/.test(value))throw new Error('來源內容長度不正確。');
    const length=Number(value);if(length>BODY_LIMIT)throw new Error('來源內容過大。');if(body.length!==length)throw new Error('來源內容長度不符。');
  }
  if(body.length>BODY_LIMIT)throw new Error('來源內容過大。');
  headers.delete('content-length');
  return {status,headers,body};
}
export async function resolvePublicDns(host:string):Promise<string[]> {
  const results=await Promise.allSettled([Deno.resolveDns(host,'A'),Deno.resolveDns(host,'AAAA')]);
  const addresses=results.flatMap(result=>result.status==='fulfilled'?result.value:[]);
  if(!addresses.length)throw new Error('無法解析公開網址 DNS，未讀取來源；請稍後重試或貼上原文。');
  if(addresses.some(address=>!isPublicAddress(address)))throw new Error('網址解析到非公開網路，已停止擷取。');
  return addresses;
}
export async function pinnedPublicFetch(input:RequestInfo|URL,options:RequestInit={}) {
  const validated=validateRichUrl(input instanceof Request?input.url:String(input),{maxLength:4096}),url=new URL(validated.url);
  let connection:Deno.Conn|null=null,timedOut=false;
  const expire=()=>{timedOut=true;try{(connection as Deno.Conn|null)?.close();}catch{/* Already closed. */}};
  let rejectTimeout:((reason:Error)=>void)|undefined;
  const timeout=new Promise<never>((_,reject)=>{rejectTimeout=reject;});
  const timer=setTimeout(()=>{expire();rejectTimeout?.(new Error('公開來源擷取超過 12 秒。'));},12000);
  const abort=()=>{expire();rejectTimeout?.(new Error('來源擷取已逾時或取消。'));};options.signal?.addEventListener('abort',abort,{once:true});
  const operation=async()=>{
    const addresses=await resolvePublicDns(url.hostname);if(timedOut||options.signal?.aborted)throw new Error('來源擷取已取消。');
    connection=await Deno.connect({hostname:addresses[0],port:443});if(timedOut){connection.close();throw new Error('來源擷取已逾時。');}
    connection=await Deno.startTls(connection as Deno.TcpConn,{hostname:url.hostname,alpnProtocols:['http/1.1']});if(timedOut){connection.close();throw new Error('來源擷取已逾時。');}
    const request=new TextEncoder().encode(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\nAccept: text/html,application/xhtml+xml\r\nAccept-Encoding: identity\r\nUser-Agent: TripEvidenceReader/2.0\r\nConnection: close\r\n\r\n`);
    let sent=0;while(sent<request.length)sent+=await connection.write(request.subarray(sent));
    const chunks:Uint8Array[]=[];let size=0,headerEnd=-1;const buffer=new Uint8Array(16384);
    while(true){const count=await connection.read(buffer);if(count===null)break;size+=count;if(size>WIRE_LIMIT)throw new Error('來源內容過大。');chunks.push(buffer.slice(0,count));
      if(headerEnd<0){const head=new Uint8Array(size);let at=0;for(const chunk of chunks){head.set(chunk,at);at+=chunk.length;}const raw=new TextDecoder('latin1').decode(head);headerEnd=raw.indexOf('\r\n\r\n');if(headerEnd<0&&size>HEADER_LIMIT||headerEnd>HEADER_LIMIT)throw new Error('來源標頭過大。');
        if(headerEnd>=0){const status=raw.match(/^HTTP\/1\.[01] (\d{3})/);if(status&&[301,302,303,307,308].includes(Number(status[1]))){const parsed=decodeHttpResponse(new TextEncoder().encode(raw.slice(0,headerEnd+4).replace(/\r\n(?:content-length|transfer-encoding|content-encoding):[^\r\n]*/gi,'')));return new Response(null,{status:parsed.status,headers:parsed.headers});}}}
    }
    const wire=new Uint8Array(size);let offset=0;for(const chunk of chunks){wire.set(chunk,offset);offset+=chunk.length;}
    const parsed=decodeHttpResponse(wire);return new Response(parsed.body.slice().buffer as ArrayBuffer,{status:parsed.status,headers:parsed.headers});
  };
  try{return await Promise.race([operation(),timeout]);}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);try{(connection as Deno.Conn|null)?.close();}catch{/* Already closed. */}}
}
