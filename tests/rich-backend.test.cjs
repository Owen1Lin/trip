// No real model/network calls: hostile transport bytes and fabricated evidence.
const assert=require('node:assert/strict');
(async()=>{
 const {decodeHttpResponse}=await import('../supabase/functions/link-import/secure-fetch.ts');
 const {processRichImport,isPublicAddress}=await import('../supabase/functions/link-import/rich-core.mjs');
 const decode=value=>decodeHttpResponse(new TextEncoder().encode(value));
 assert.equal(new TextDecoder().decode(decode('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK').body),'OK');
 assert.equal(new TextDecoder().decode(decode('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nOK\r\n0\r\n\r\n').body),'OK');
 for(const raw of [
 'HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nOK',
 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\nOK',
 'HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\nXX',
 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 2\r\n\r\nOK',
 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nOK\r\n',
 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nfffffff\r\n',
 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nOK\r\n0\r\n',
 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nOK\r\n0\r\n\r\nEXTRA',
 'HTTP/1.1 200 OK\r\nX: '+'x'.repeat(17000)+'\r\n\r\n'
 ])assert.throws(()=>decode(raw));
 assert.equal(isPublicAddress('2001:4860:4860::8888'),true);assert.equal(isPublicAddress('2001:0010::1'),false);assert.equal(isPublicAddress('192.88.99.1'),false);
 const raw='虛構餐廳甲\n地址：測試路1號';
 const fail=await processRichImport({version:2,text:raw,imageText:'菜單 300日圓',model:'qwen'},{runModel:async()=>{throw Error('no model');}});
 assert.equal(fail.sources[0].text,raw);assert.equal(fail.sources[1].text,'菜單 300日圓');assert.equal(fail.status,'needs_input');assert.ok(fail.warnings.some(w=>w.includes('模型')));assert.deepEqual(fail.items,[]);
 const video=await processRichImport({version:2,url:'https://www.youtube.com/watch?v=FAKE123',model:'metadata'},{fetchPage:async()=>({type:'webpage',text:'Video title',title:'Video title'})});assert.equal(video.sources.length,0);assert.ok(video.warnings.some(w=>w.includes('字幕')));
 const partial=await processRichImport({version:2,url:'https://example.com/article',text:raw,model:'metadata'},{fetchPage:async()=>{throw Error('來源逾時');}});assert.equal(partial.sources[0].text,raw);assert.ok(partial.warnings.includes('來源逾時'));
 const ready=await processRichImport({version:2,text:raw,model:'qwen'},{runModel:async()=>({items:[{scope:{sourceId:'source-1',quote:raw},name:{sourceId:'source-1',value:'虛構餐廳甲',quote:'虛構餐廳甲'},facts:{address:{sourceId:'source-1',value:'測試路1號',quote:'地址：測試路1號'}}}]})});assert.equal(ready.items[0].facts.address.value,'測試路1號');assert.equal(ready.modelUsed,'qwen');assert.equal(ready.items[0].facts.address.date,null);assert.equal(ready.items[0].startTime,undefined);
 const frames=await processRichImport({version:2,url:'https://www.youtube.com/watch?v=FAKE123',model:'qwen'},{fetchPage:async()=>({url:'https://www.youtube.com/watch?v=FAKE123',type:'video_caption',text:'[0:00] 虛構食物介紹',frameTexts:[{seconds:12.5,text:'虛構畫面甲店 菜單300円'},{seconds:-1,text:'invalid time'}]}),runModel:async({sources})=>{assert.equal(sources.length,2);assert.equal(sources[1].type,'image_ocr');assert.equal(sources[1].timestamp,12.5);return {items:[{name:{value:'虛構畫面甲店',quote:'虛構畫面甲店',sourceId:'source-2'},scope:{quote:'虛構畫面甲店 菜單300円',sourceId:'source-2'},facts:{price:{value:'300円',quote:'菜單300円',sourceId:'source-2'}}}]};}});assert.equal(frames.items[0].facts.price.value,'300円');assert.ok(frames.warnings.some(warning=>warning.includes('抽樣')));assert.equal(frames.items[0].startTime,undefined);
 console.log('PASS (synthetic backend): pinned HTTP parser lengths/chunking/compression/limits; original OCR/text survives failures; video metadata rejected as captions; grounded model fields and no inferred schedule.');
})().catch(error=>{console.error(error);process.exitCode=1;});
