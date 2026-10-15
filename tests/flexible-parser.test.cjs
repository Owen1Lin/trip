// Local parser tests use fabricated activities and booking identifiers only.
const assert=require('node:assert/strict');
const {parse,parseBatch}=require('../quick-entry.js');
for(const date of ['10月21日','10/21','10.21','2026-10-21','2026.10.21','１０／２１']) {
 for(const time of ['7-14','07-14','0700-1400','07:00-14:00','7點到14點','7點到下午2點','７：００～１４：００','7 AM-2 PM','上午7點到下午2點']) {
  const e=parse(`${date} ${time} 測試散步`);assert.deepEqual(e.errors,[],`${date} ${time}`);assert.deepEqual([e.date,e.startTime,e.endTime],['2026-10-21','07:00','14:00']);
 }
}
const shop=parse('7-11 買飲料');assert.equal(shop.startTime,'');assert.equal(shop.place,'7-11 買飲料');assert.ok(shop.pending.some(m=>m.includes('店名')));
for(const text of ['10/ 0700 測試','13/21 0700 測試','2027-10-21 0700 測試']) {const e=parse(text);assert.ok(e.errors.length);assert.notEqual(e.date,'2026-10-21');assert.ok(e.issues.some(i=>i.field==='date'));}
for(const text of ['25點 測試','14:70 測試']) assert.ok(parse(text).issues.some(i=>i.required&&i.field==='startTime'));
assert.deepEqual(parse('測試未定時間').errors,[]);
const missing=parseBatch('10/23 0700 測試一\n0800 測試二').entries;assert.deepEqual(missing.map(e=>[e.date,e.dateSource]),[['2026-10-23','explicit'],['2026-10-23','previous']]);
const raw='10/25 2350-0130\n虛構航空AB123\n預定編號:FAKE1234\n集合 10/26';
const flight=parseBatch(raw).entries;assert.equal(flight.length,1);assert.equal(flight[0].raw,raw);assert.equal(flight[0].place,'虛構航空AB123');assert.equal(flight[0].notes,'預定編號:FAKE1234\n集合 10/26');assert.equal(flight[0].crossDayNeedsConfirmation,true);assert.equal(flight[0].endDayOffset,0);
for(const text of ['10/25 23:50-翌日01:30 測試航班','10/25 23:50～10/26 01:30 測試航班']) {const e=parseBatch(text).entries[0];assert.equal(e.date,'2026-10-25');assert.equal(e.endDayOffset,1);assert.equal(e.crossDayConfirmed,true);assert.deepEqual(e.errors,[]);}
assert.ok(parse('10/25 0700-0700 測試').errors.length);
const mixed=parseBatch('10/21 0600-0700早餐 飯店 10.22 08-10 出門');assert.deepEqual(mixed.entries.map(e=>[e.date,e.place]),[['2026-10-21','早餐 飯店'],['2026-10-22','出門']]);
const malformed=parseBatch('10/21 0600 早餐\n10/ 0700 咖啡');assert.equal(malformed.entries.length,2);assert.equal(malformed.entries[1].date,'');assert.equal(malformed.entries[1].dateSource,'invalid');assert.ok(malformed.entries[1].errors.length);
assert.ok(parseBatch('10/21 0700 測試\n10/26 0800 錯誤').entries.some(e=>e.errors.length));
console.log('PASS: flexible local dates/times, explicit errors, ambiguous shop, multiline raw/notes, inherited dates, confirmed cross-day boundaries.');
const datedHeader=parseBatch('10/21\n0700 早餐');assert.equal(datedHeader.entries.length,1);assert.equal(datedHeader.entries[0].place,'早餐');assert.equal(datedHeader.entries[0].startTime,'07:00');assert.equal(datedHeader.entries[0].raw,'10/21\n0700 早餐');assert.deepEqual(datedHeader.entries[0].errors,[]);
const fullWidthBatch=parseBatch('10/21 ０６００ 早餐 ０７００ 咖啡');assert.deepEqual(fullWidthBatch.entries.map(e=>e.raw),['10/21 ０６００ 早餐 ','０７００ 咖啡']);assert.deepEqual(fullWidthBatch.entries.map(e=>e.startTime),['06:00','07:00']);
