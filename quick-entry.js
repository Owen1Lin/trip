/* Deterministic local parsing for the fixed trip; unresolved input always stays in raw. */
(() => {
  'use strict';
  const DATES = ['2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25'];
  const datePattern = () => /(?<!\d)(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[/.](\d{1,2})|(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?)(?!\d)/g;
  const normalize = text => String(text || '').normalize('NFKC').replace(/两/g,'兩').replace(/[–—−~～]/g,'-');
  const numeral = '[零〇一二兩三四五六七八九十\\d]{1,3}';
  const qualifier = '(?:上午|早上|下午|晚上|中午|凌晨|AM|PM|A\\.M\\.|P\\.M\\.)';
  const atom = `(?:${qualifier}\\s*)?(?:\\d{1,2}:\\d{1,2}|\\d{4}|${numeral}[點時](?:半|${numeral}分?)?|\\d{1,2})(?:\\s*${qualifier})?`;
  const rangePattern = () => new RegExp(`(?<![\\d:])(${atom})\\s*(?:-|到|至)\\s*(翌日|隔日|次日|明天)?\\s*(${atom})(?![\\d:])`,'giu');
  const singlePattern = () => new RegExp(`(?<![\\p{L}\\d:])((?:${qualifier}\\s*)?(?:\\d{1,2}:\\d{1,2}(?!:)|\\d{4}(?!\\d)|${numeral}[點時](?:半|${numeral}分?)?(?=$|[\\s,，;；\\-]|到|至))(?:\\s*${qualifier})?)(?![\\d:])`,'giu');
  function number(text) {
    if (/^\d+$/.test(text)) return Number(text);
    const digits = {零:0,〇:0,一:1,二:2,兩:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
    if (text.includes('十')) { const [a,b] = text.split('十'); return (a ? digits[a] : 1)*10+(b ? digits[b] : 0); }
    return digits[text];
  }
  function readTime(text, inherited = '') {
    const q = text.match(new RegExp(qualifier,'iu'))?.[0] || inherited;
    const value = text.replace(new RegExp(qualifier,'giu'),'').trim();
    let h,m=0;
    if (/^\d{4}$/.test(value)) { h=Number(value.slice(0,2)); m=Number(value.slice(2)); }
    else if (value.includes(':')) [h,m]=value.split(':').map(Number);
    else if (/[點時]/.test(value)) { const [a,b='']=value.split(/[點時]/); h=number(a); m=b==='半'?30:b?number(b.replace(/分$/,'')):0; }
    else h=number(value);
    if (!Number.isInteger(h)||h<0||h>23||!Number.isInteger(m)||m<0||m>59) return {error:'時間不正確，請用 00:00 至 23:59。'};
    if (q) {
      if(h>12) return {error:'上午／下午或 AM／PM 請搭配 1 至 12 點。'};
      if(h===12 && /晚上/.test(q)) return {error:'晚上 12 點有日期歧義，請改用 00:00 或 12:00。'};
      if (/下午|晚上|中午|p\.?m/i.test(q) && h<12) h+=12;
      if (/上午|早上|凌晨|a\.?m/i.test(q) && h===12) h=0;
    }
    return {value:`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,qualifier:q};
  }
  function readDate(match) {
    const y=Number(match[1]||match[6]||2026),m=Number(match[2]||match[4]||match[7]),d=Number(match[3]||match[5]||match[8]);
    const value=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const actual=new Date(Date.UTC(y,m-1,d));
    return {value,valid:actual.getUTCFullYear()===y&&actual.getUTCMonth()===m-1&&actual.getUTCDate()===d,year:y};
  }
  function parse(input,{date=DATES[0]}={}) {
    const raw=typeof input==='string'?input:'';
    const errors=[],pending=[],timeIssues=[];
    const contentLines=raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    let source=normalize(contentLines.shift() || '').trim(),endDayOffset=0,crossDayConfirmed=false,crossDayNeedsConfirmation=false;
    if(source.length>6000) errors.push('每筆輸入最多 6000 字，請分批新增。');
    const foundDates=[...source.matchAll(datePattern())];
    let dateSource='selected', explicitEndDate='';
    if(foundDates.length) {
      const first=readDate(foundDates[0]); date=first.value;dateSource='explicit';
      if(!first.valid) errors.push('日期不合法，請修正月份與日期。');
      if(first.year!==2026) errors.push('明寫年份與本次旅行年份 2026 不同，請確認並修正。');
      if(!DATES.includes(date)) errors.push('開始日期須在 2026/10/21 至 10/25。');
      if(foundDates.length===2) {
        const between=source.slice(foundDates[0].index+foundDates[0][0].length,foundDates[1].index);
        const second=readDate(foundDates[1]);
        if(/[-到至]/.test(between)&&second.valid) {
          const delta=(Date.parse(second.value+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000;
          explicitEndDate=second.value;
          if(delta===0||delta===1) {endDayOffset=delta;crossDayConfirmed=delta===1;}
          else errors.push('結束日期只能是開始當日或翌日。');
        } else errors.push('一筆活動有多個日期，請確認分段與起訖日期。');
      } else if(foundDates.length>2) errors.push('一筆活動有多個日期，請確認分段。');
      source=source.replace(datePattern(),' ');
    } else if(/\d{1,4}\s*(?:[/年]|月)|\d{4}[-.]\d{1,2}(?!\d)|\d{1,2}[/.](?:\D|$)/.test(source)) {
      date='';errors.push('日期格式不完整或不明，請修正日期。');
    } else if(!DATES.includes(date)) errors.push('請選擇這次旅行的日期。');
    let startTime='',endTime='';
    // An explicit end date was removed above, leaving the connecting range intact.
    const ranges=[...source.matchAll(rangePattern())];
    const ambiguous=ranges.filter(m=>/^0?7\s*-\s*11$/i.test(m[0].trim()));
    if(ambiguous.length) pending.push('「7-11」可能是店名，原文保留，請確認時間或名稱。');
    const rangesToUse=ranges.filter(m=>!ambiguous.includes(m));
    const used=[];
    if(rangesToUse.length>1) errors.push('一筆有多組時間，請確認分段。');
    if(rangesToUse.length) {
      const m=rangesToUse[0],a=readTime(m[1]),b=readTime(m[3],a.qualifier);
      if(a.error) {errors.push(a.error);timeIssues.push({field:'startTime',message:a.error,blocking:true,required:true});} if(b.error) {errors.push(b.error);timeIssues.push({field:'endTime',message:b.error,blocking:true,required:true});}
      startTime=a.value||'';endTime=b.value||'';used.push({start:m.index,end:m.index+m[0].length});
      if(m[2]||/翌日|隔日|次日|明天/.test(source)) {endDayOffset=1;crossDayConfirmed=true;}
    }
    const singles=[...source.matchAll(singlePattern())].filter(m=>!used.some(u=>m.index>=u.start&&m.index<u.end)&&!ambiguous.some(a=>m.index>=a.index&&m.index<a.index+a[0].length));
    if(singles.length) {
      if(startTime||singles.length>1) errors.push('兩個時間請用「06:00–07:00」連接，或確認行程分段。');
      if(!rangesToUse.length) {const t=readTime(singles[0][0]);startTime=t.value||'';if(t.error) {errors.push(t.error);timeIssues.push({field:'startTime',message:t.error,blocking:true,required:true});}used.push({start:singles[0].index,end:singles[0].index+singles[0][0].length});}
    }
    if(startTime&&endTime&&endDayOffset===0&&endTime<=startTime) {
      crossDayNeedsConfirmation=endTime<startTime;
      errors.push(endTime===startTime?'開始與結束時間相同，請修正；不會自動視為 24 小時。':'結束早於開始，請確認「結束於翌日」或修正時間。');
    }
    if(explicitEndDate&&endDayOffset===0&&startTime&&endTime&&endTime<startTime) errors.push('明寫當日結束，但結束時間早於開始。');
    let remaining=source;
    for(const u of used.sort((a,b)=>b.start-a.start)) remaining=remaining.slice(0,u.start)+' '+remaining.slice(u.end);
    remaining=remaining.replace(/(?:翌日|隔日|次日|明天)/g,' ');
    const lines=remaining.split('\n').map(line=>line.replace(/^\s*[-、,，;；|｜]+|[-、,，;；|｜]+\s*$/g,'').trim()).filter(Boolean);
    const place=(lines.shift()||contentLines.shift()||'').replace(/\s+/g,' '),notes=[...lines,...contentLines].join('\n');
    if(/\d\s*:|:\s*\d|\b\d{3,}\b|(?:上午|下午|早上|晚上|凌晨|中午)\s*\d|\d{1,2}[點時]/.test(place)) errors.push('有無法辨識或格式錯誤的時間片段，請核對原文並修正。');
    if(!place) errors.push('請填寫行程名稱。');
    if(place.length>150) errors.push('行程名稱最多 150 字，補充內容請放備註。');
    if(notes.length>5000) errors.push('備註最多 5000 字。');
    if(!startTime) pending.push('開始時間待確認');if(!endTime) pending.push('結束時間待確認');
    const issues=[...timeIssues];
    for(const message of [...new Set(errors)]) {
      if(timeIssues.some(issue=>issue.message===message)) continue;
      const field=/年份|日期/.test(message)?'date':/開始與結束|結束早於|當日結束/.test(message)?'endTime':/行程名稱/.test(message)?'place':/備註/.test(message)?'notes':'segment';
      issues.push({field,message,blocking:true});
    }
    return {raw,place,date,startTime,endTime,notes,endDayOffset,crossDayConfirmed,crossDayNeedsConfirmation,explicitEndDate,dateSource,issues,errors:[...new Set(errors)],pending};
  }
  function parseBatch(input,{date=DATES[0]}={}) {
    const raw=typeof input==='string'?input:'',source=normalize(raw).trim(),entries=[],errors=[];
    if(source.length>10000) return {entries,errors:['一次最多輸入 10000 字，請分批新增。']};
    // Find explicit schedule headers without treating an end date as a new activity.
    const chunks=[];
    for(const originalRow of raw.split(/\r?\n|;/).filter(row=>row.trim())) {
      const row=normalize(originalRow),dates=[...row.matchAll(datePattern())];
      const starts=dates.filter((m,i)=>i===0||!/(?:-|到|至)\s*$/.test(row.slice(dates[i-1].index+dates[i-1][0].length,m.index)));
      if(starts.length>1&&row.slice(0,starts[0].index).trim()) errors.push('同一行多筆日期請放在各筆開頭；完整原文已保留。');
      const dateParts=starts.length>1?starts.map((m,i)=>originalRow.slice(i===0?0:m.index,starts[i+1]?.index??row.length)):[originalRow];
      for(const part of dateParts) {
        const normalized=normalize(part),dr=[...normalized.matchAll(datePattern())];
        const schedule=normalized.replace(datePattern(),' '),rs=[...schedule.matchAll(rangePattern())].filter(m=>!/^0?7\s*-\s*11$/.test(m[0].trim()));
        // Same-line ranges remain separate; text preceding several times is ambiguous.
        const ss=rs.length?rs:[...schedule.matchAll(singlePattern())];
        if(ss.length>1&&!dr.length&&schedule.slice(0,ss[0].index).trim()) errors.push('同一行多個時段請用「時間 名稱」依序填寫，或確認分段。');
        if(ss.length>1&&dr.length<=1&&ss.every(m=>!new RegExp(qualifier,'iu').test(m[0]))) {
          const offset=dr[0]?dr[0].index+dr[0][0].length:0;
          const body=normalized.slice(offset),matches=rs.length?[...body.matchAll(rangePattern())].filter(m=>!/^0?7\s*-\s*11$/.test(m[0].trim())):[...body.matchAll(singlePattern())];
          if(matches.length>1&&!body.slice(0,matches[0].index).trim()) {matches.forEach((m,i)=>chunks.push({text:part.slice(i===0?0:offset+m.index,matches[i+1]?offset+matches[i+1].index:part.length),header:true}));continue;}
        }
        const malformedDate=/^\s*(?:\d{1,4}\s*[/.年]\s*(?:$|[^\d])|\d{4}[-.]\d{1,2}(?!\d))/.test(normalized);
        const header=(dr.length>0&&!normalized.slice(0,dr[0].index).trim())||malformedDate||rs.length>0||new RegExp(`^\\s*${singlePattern().source}`,'iu').test(normalized);
        const previous=chunks[chunks.length-1];
        if(!header&&previous?.header) previous.text+='\n'+part;
        else chunks.push({text:part,header});
      }
    }
    // A standalone date header belongs to the following time row; retain both in raw.
    for(let i=0;i<chunks.length-1;i++) {
      const header=normalize(chunks[i].text).trim(),matches=[...header.matchAll(datePattern())];
      const nextDates=[...normalize(chunks[i+1].text.split('\n')[0]).matchAll(datePattern())];
      if(matches.length===1&&header===matches[0][0]&&!nextDates.length) {
        chunks[i+1].originalRaw=(chunks[i].originalRaw||chunks[i].text)+'\n'+(chunks[i+1].originalRaw||chunks[i+1].text);
        chunks[i+1].text=chunks[i].text+' '+chunks[i+1].text;
        chunks.splice(i,1);i--;
      }
    }
    let inheritedDate=date,hasExplicitDate=false;
    for(const chunk of chunks) {
      const explicit=[...normalize(chunk.text).matchAll(datePattern())][0];
      const entry=parse(chunk.text,{date:inheritedDate});
      if(chunk.originalRaw) entry.raw=chunk.originalRaw;
      if(explicit) {inheritedDate=entry.date;hasExplicitDate=true;}
      entry.dateSource=!entry.date?'invalid':explicit?'explicit':hasExplicitDate?'previous':'selected';
      if(!explicit&&entry.date) entry.pending.push(hasExplicitDate?'日期沿用本批前一個明確日期':'日期採目前選取日期');
      entries.push(entry);
      if(entries.length>100) return {entries:[],errors:['一次最多新增 100 筆，請分批輸入。']};
    }
    if(!entries.length&&!errors.length) errors.push('請填寫至少一筆行程名稱。');
    return {entries,errors:[...new Set(errors)]};
  }
  const api=Object.freeze({parse,parseBatch});
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  if(typeof window!=='undefined') window.TripQuickEntry=api;
})();
