// 一鍵匯出 Excel：POST {token, month} -> 下載真正的 .xlsx（管理員限定）。
// 不依賴任何套件：手寫最小 xlsx（zip 無壓縮 + inline 字串）。
import { ensureSchema, getConfig, verifyAdmin } from './config.js';
import { readCaps } from './caps.js';

const enc = new TextEncoder();

// ---------- zip（stored 無壓縮） ----------
function crc32(bytes) {
  let t = crc32.table;
  if (!t) {
    t = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  // files: [[檔名, Uint8Array], ...]
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0, true);
    lh.setUint16(8, 0, true); // method: stored
    lh.setUint16(10, 0, true);
    lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nb.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nb.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push([new Uint8Array(ch.buffer), nb]);
    offset += 30 + nb.length + data.length;
  }
  const cdStart = offset;
  let cdLen = 0;
  const cdChunks = [];
  for (const [head, nb] of central) { cdChunks.push(head, nb); cdLen += 46 + nb.length; }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, cdLen, true);
  end.setUint32(16, cdStart, true);
  end.setUint16(20, 0, true);
  const out = new Uint8Array(offset + cdLen + 22);
  let p = 0;
  for (const c of [...chunks, ...cdChunks, new Uint8Array(end.buffer)]) { out.set(c, p); p += c.length; }
  return out;
}

// ---------- sheet xml ----------
function escXml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function colName(i) {
  let s = '';
  i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function sheetXml(rows) {
  let s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  for (let r = 0; r < rows.length; r++) {
    s += '<row r="' + (r + 1) + '">';
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const ref = colName(c) + (r + 1);
      const v = row[c];
      if (typeof v === 'number') s += '<c r="' + ref + '"><v>' + v + '</v></c>';
      else s += '<c r="' + ref + '" t="inlineStr"><is><t>' + escXml(v) + '</t></is></c>';
    }
    s += '</row>';
  }
  return s + '</sheetData></worksheet>';
}

// sheets: [{name, rows: [[字串|數字, ...], ...]}] -> Uint8Array（.xlsx）
export function buildXlsx(sheets) {
  const files = [];
  files.push(['[Content_Types].xml', enc.encode(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
    '</Types>')]);
  files.push(['_rels/.rels', enc.encode(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>')]);
  files.push(['xl/workbook.xml', enc.encode(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    sheets.map((sh, i) => '<sheet name="' + escXml(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
    '</sheets></workbook>')]);
  files.push(['xl/_rels/workbook.xml.rels', enc.encode(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
    '</Relationships>')]);
  sheets.forEach((sh, i) => files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', enc.encode(sheetXml(sh.rows))]));
  return zipStore(files);
}

const WD = ['日', '一', '二', '三', '四', '五', '六'];

function dDiff(a, b) {
  const da = new Date(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db = new Date(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((db - da) / 86400000);
}
function gapDays(leaves, start, end) {
  const ds = leaves.filter(d => d >= start && d <= end).sort();
  if (!ds.length) return dDiff(start, end);
  let g = dDiff(start, ds[0]);
  for (let i = 0; i < ds.length - 1; i++) g = Math.max(g, dDiff(ds[i], ds[i + 1]) - 1);
  return Math.max(g, dDiff(ds[ds.length - 1], end));
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return Response.json({ error: 'db_not_bound' }, { status: 500 });
  await ensureSchema(env);
  let body = {};
  try { body = await request.json(); } catch {}
  const month = String(body.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'bad month' }, { status: 400 });
  if (!(await verifyAdmin(env, body.token))) return Response.json({ error: 'forbidden' }, { status: 403 });

  const cfg = await getConfig(env);
  const rows = await env.DB.prepare('SELECT name, leave_dates FROM submissions WHERE month = ?').bind(month).all();
  const per = {};
  for (const s of (rows.results || [])) {
    let lv = [];
    try { lv = JSON.parse(s.leave_dates || '[]'); } catch {}
    per[s.name] = lv.filter(d => typeof d === 'string').sort();
  }

  const last = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
  const mFirst = month + '-01', mLast = month + '-' + String(last).padStart(2, '0');
  let pStart = mFirst, pEnd = mLast;
  if (cfg.openFrom && cfg.openFrom > mFirst && cfg.openFrom <= mLast) pStart = cfg.openFrom;
  if (cfg.openTo && cfg.openTo >= mFirst) pEnd = cfg.openTo; // 含跨月尾巴
  if (pEnd < pStart) { pStart = mFirst; pEnd = mLast; }

  const md = ds => parseInt(ds.slice(5, 7), 10) + '/' + parseInt(ds.slice(8, 10), 10);

  // 表1：每人明細
  const s1 = [['姓名', '休假日期', '共幾天', '最長未休(天)']];
  for (const n of cfg.staff) {
    const lv = per[n] || [];
    const inP = lv.filter(d => d >= pStart && d <= pEnd);
    s1.push([n, inP.map(md).join('、'), inP.length, gapDays(lv, pStart, pEnd)]);
  }

  // 表2：每日統計（含跨月尾巴）；人數上限取單日自訂，否則用預設
  const capsM = await readCaps(env, month);
  const capsNext = pEnd.slice(0, 7) > month ? await readCaps(env, pEnd.slice(0, 7)) : {};
  const capFor = ds => {
    const c = ds.startsWith(month) ? capsM[ds] : capsNext[ds];
    return (c != null ? c : cfg.maxLeave);
  };
  const dayRow = ds => {
    const names = Object.keys(per).filter(n => per[n].includes(ds)).sort();
    const cnt = names.filter(n => !cfg.exempt.includes(n)).length;
    const cap = capFor(ds);
    const dt = new Date(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10));
    return [md(ds), '週' + WD[dt.getDay()], cnt + '/' + cap, cnt >= cap ? '滿' : '', names.join('、')];
  };
  const s2 = [['日期', '星期', '休假人數', '額滿', '休假名單']];
  for (let d = 1; d <= last; d++) s2.push(dayRow(month + '-' + String(d).padStart(2, '0')));
  if (pEnd > mLast) {
    const cur = new Date(+mLast.slice(0, 4), +mLast.slice(5, 7) - 1, +mLast.slice(8, 10));
    const endD = new Date(+pEnd.slice(0, 4), +pEnd.slice(5, 7) - 1, +pEnd.slice(8, 10));
    cur.setDate(cur.getDate() + 1);
    while (cur <= endD) {
      s2.push(dayRow(cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0')));
      cur.setDate(cur.getDate() + 1);
    }
  }

  const xlsx = buildXlsx([
    { name: '每人明細', rows: s1 },
    { name: '每日統計', rows: s2 }
  ]);
  const fname = '排假-' + month + '.xlsx';
  return new Response(xlsx, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(fname)
    }
  });
}
