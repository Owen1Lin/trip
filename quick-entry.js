/* Local, deterministic parsing: only explicit dates/times are used. */
(() => {
  'use strict';
  const DATES = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
  const digits = { 零:0, 〇:0, 一:1, 二:2, 兩:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
  const datePattern = () => /(?<!\d)(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[/.](\d{1,2})|(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?)(?!\d)/g;
  const numeral = '[零〇一二兩三四五六七八九十\\d]{1,3}';
  const timePattern = () => new RegExp(`(?:(上午|早上|下午|晚上|中午|凌晨)\\s*)?(?:(?<![\\d:])(\\d{1,2}):(\\d{2})(?!\\d|:)|(${numeral})[點時](?:(半)|(${numeral})分?)?(?=$|[\\s,，;；\\-~～–—]|到|至)|(?<![\\p{L}\\d])(\\d{4})(?![\\p{L}\\d]))`, 'gu');
  function number(value) {
    if (/^\d+$/.test(value)) return Number(value);
    if (value === '十') return 10;
    if (value.includes('十')) {
      const [tens, units] = value.split('十');
      return (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0);
    }
    return digits[value];
  }
  function normalizeSchedule(source) {
    // Require two-digit hours for short ranges: "7-11" can be a shop name.
    return source.replace(/(?<![\d:./])(\d{2})(?::(\d{2}))?\s*[-–—~～到至]\s*(\d{2})(?::(\d{2}))?(?![\d:./])/gu,
      (_,start,startMinute,end,endMinute)=>`${start}:${startMinute || '00'}–${end}:${endMinute || '00'}`)
      .replace(/(?<!\d)(\d{4})\s*[-–—~～到至]\s*(\d{4})(?!\d)/gu, '$1–$2 ');
  }
  function parse(input, { date = DATES[0] } = {}) {
    const errors = [], pending = [];
    if (typeof input !== 'string') input = '';
    let source = input.normalize('NFKC').replace(/两/g, '兩').trim();
    if (source.length > 1000) errors.push('輸入過長，請將補充內容留待建立後填寫。');
    if (!DATES.includes(date)) { errors.push('請選擇這次旅行的日期。'); date = ''; }
    const dates = datePattern();
    const foundDates = [...source.matchAll(dates)];
    if (foundDates.length > 1) errors.push('一次請填一個日期；多日行程請分開新增。');
    if (foundDates.length) {
      const m = foundDates[0];
      const year = Number(m[1] || m[6] || 2026), month = Number(m[2] || m[4] || m[7]), day = Number(m[3] || m[5] || m[8]);
      const explicit = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      date = DATES.includes(explicit) ? explicit : '';
      if (!date) errors.push('日期須在 2026/10/21 至 10/25，請修改輸入。');
      source = source.replace(dates, ' ');
    } else if (/(?:\d{1,4}\s*[/年]\s*\d|\d+月|\d{4}[-.]\d{1,2}(?!\d))/.test(source)) {
      errors.push('日期格式不完整，請用 10/25 或 2026-10-25。');
    }
    source = normalizeSchedule(source);
    const times = timePattern();
    const foundTimes = [...source.matchAll(times)];
    if (foundTimes.length > 2) errors.push('一次請填一組開始與結束時間。');
    let qualifier = '', startTime = '', endTime = '';
    const values = foundTimes.map((m, index) => {
      const ownQualifier = m[1] || '';
      if (ownQualifier) qualifier = ownQualifier;
      const h = m[7] ? Number(m[7].slice(0,-2)) : number(m[2] || m[4]);
      const minute = m[7] ? Number(m[7].slice(-2)) : m[5] ? 30 : m[3] ? Number(m[3]) : m[6] ? number(m[6]) : 0;
      let hour = h;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        errors.push('時間不正確，請用 00:00 至 23:59。'); return '';
      }
      if (qualifier) {
        if (hour > 12) { errors.push('上午／下午的時間請用 0 至 12 點。'); return ''; }
        if (hour === 12 && ['上午','早上','晚上'].includes(qualifier)) {
          errors.push('12 點的時段不明確，請寫 00:00 或 12:00，並核對日期。'); return '';
        }
        if (['下午','晚上','中午'].includes(qualifier) && hour < 12) hour += 12;
        if (['上午','早上','凌晨'].includes(qualifier) && hour === 12) hour = 0;
      }
      if (index === 1) {
        const previous = foundTimes[0];
        const between = source.slice(previous.index + previous[0].length, m.index);
        if (!/^\s*[-–—~～至到]\s*$/.test(between)) errors.push('兩個時間請用「06:00–07:00」連接，避免誤判。');
      }
      return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
    });
    [startTime = '', endTime = ''] = values;
    if (startTime && endTime && endTime <= startTime) errors.push('結束時間須晚於開始時間；跨日活動請分開填寫。');
    let remaining = source.replace(times, ' ');
    if (foundTimes.length === 2) {
      const [first, second] = foundTimes;
      const between = source.slice(first.index + first[0].length, second.index);
      if (/^\s*[-–—~～至到]\s*$/.test(between)) remaining = source.slice(0, first.index) + ' ' + source.slice(second.index + second[0].length);
    }
    const place = remaining.replace(/^\s*[-–—~～、,，;；|｜]+|[-–—~～、,，;；|｜]+\s*$/g, '').replace(/\s+/g,' ').trim();
    if (/\d\s*[:：]|[:：]\s*\d|\b\d{3,}\b|(?:上午|下午|早上|晚上|凌晨|中午)\s*\d/.test(place)) errors.push('有無法辨識的時間，請用 0600 或 06:00。');
    if (!place) errors.push('請填寫行程名稱。');
    if (place.length > 150) errors.push('行程名稱最多 150 字，其他內容可建立後補充。');
    if (!startTime) pending.push('開始時間待確認');
    if (!endTime) pending.push('結束時間待確認');
    return { place, date, startTime, endTime, errors:[...new Set(errors)], pending };
  }
  function parseBatch(input, {date = DATES[0]} = {}) {
    const entries = [], errors = [];
    const source = typeof input === 'string' ? input.normalize('NFKC').replace(/两/g,'兩').trim() : '';
    if (source.length > 10000) return {entries,errors:['一次最多輸入 10000 字，請分批新增。']};
    let inheritedDate = date, hasExplicitDate = false;
    for (const row of source.split(/[\n;]+/).map(value=>value.trim()).filter(Boolean)) {
      const dates = [...row.matchAll(datePattern())];
      if (dates.length > 1 && row.slice(0, dates[0].index).trim()) {
        errors.push('同一行有多筆日期時，請把日期放在各筆開頭，或改為一筆一行。');
        continue;
      }
      const chunks = dates.length > 1 ? dates.map((m,index)=>row.slice(m.index,dates[index+1]?.index ?? row.length).trim()) : [row];
      for (const chunk of chunks) {
        const explicit = [...chunk.matchAll(datePattern())][0];
        if (explicit) {
          const dated = parse(`日期核對 ${explicit[0]}`,{date:DATES[0]});
          inheritedDate = dated.date; hasExplicitDate = true;
          if (dated.errors.length) errors.push(...dated.errors);
        }
        const body = normalizeSchedule(chunk.replace(datePattern(), ' ')).trim();
        if (!body) continue; // A date on its own is a header for following rows.
        const tokens = [...body.matchAll(timePattern())];
        const groups = [];
        for (let index=0;index<tokens.length;index++) {
          const first = tokens[index];
          let end = first.index + first[0].length;
          const next = tokens[index+1];
          if (next && /^\s*[-–—~～至到]\s*$/.test(body.slice(end,next.index))) {
            end = next.index + next[0].length; index++;
          }
          groups.push({start:first.index,end,qualifier:first[1] || ''});
        }
        if (groups.length > 1 && body.slice(0,groups[0].start).trim()) {
          errors.push('同一行多個時段請用「時間 名稱」依序填寫，或改為一筆一行。'); continue;
        }
        if (groups.length > 1 && groups.some(group=>group.qualifier) && groups.some(group=>!group.qualifier)) {
          errors.push('同一行多筆行程請各自寫明上午／下午，或統一使用 24 小時格式。'); continue;
        }
        const parts = groups.length > 1 ? groups.map((g,index)=>body.slice(g.start,groups[index+1]?.start ?? body.length).trim()) : [body];
        for (const part of parts) {
          const entry = parse(part,{date:inheritedDate});
          entry.dateSource = explicit ? 'explicit' : hasExplicitDate ? 'previous' : 'selected';
          if (!explicit) entry.pending.push(hasExplicitDate ? '日期沿用前一筆' : '日期採目前選取日期');
          entries.push(entry);
          if (entries.length > 100) return {entries:[],errors:['一次最多新增 100 筆，請分批輸入。']};
        }
      }
    }
    if (!entries.length && !errors.length) errors.push('請填寫至少一筆行程名稱。');
    return {entries,errors:[...new Set(errors)]};
  }
  const api = Object.freeze({ parse, parseBatch });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.TripQuickEntry = api;
})();
