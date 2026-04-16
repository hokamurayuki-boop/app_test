/* 夜勤手当計算アプリ (CSV専用)
 *
 * 入力: 訪問介護シフト CSV (Shift-JIS, 10列)
 *   ヘルパー名, 日付, 曜日, 利用者, 業務種別, サービス内容, 開始時間, 終了時間, 提供時間（分）, 備考
 *
 * 計算ルール (夜勤手当テスト/calculate_night_allowance.js をベースに、丸めは切り上げ):
 *   - 1サイクル = 22:00(day D) 〜 08:00(day D+1) の 10 時間帯
 *   - 単価: 500円 / 30分ブロック（30分未満は切り上げ）
 *   - サイクル手当 = min( ceil(サイクル合計夜勤分数 / 30) * 500, 5,000 )
 *   - サイクル候補日は、従業員ごとに「22時以降に終わる行の day」または
 *     「8時前に始まる行の day - 1」の集合として列挙
 *   - 明細行への配分は、同一サイクル内の行を時系列順に並べ、
 *     累積夜勤分数ベースで行別手当を決定する（合計がサイクル手当と一致）
 *
 * 年月: ファイル名から自動抽出（取れない場合は手入力）
 */

'use strict';

// ========== 計算ロジック ==========

/** 2つの [start,end] 区間の重なり分数 */
function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart.getTime(), bStart.getTime());
  const e = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, Math.round((e - s) / 60000));
}

/** サイクル帯 [cycleStart, cycleStart+10h] と行の重なり分数 */
function cycleOverlapMinutes(row, cycleStart) {
  const cycleEnd = new Date(cycleStart.getTime() + 10 * 3600 * 1000);
  return overlapMinutes(row.start, row.end, cycleStart, cycleEnd);
}

/** 行集合からサイクル起点(22:00 Date)を抽出。月跨ぎ・年跨ぎは絶対Dateで自然に処理される */
function collectCycleStarts(rows) {
  const byTime = new Map();
  for (const r of rows) {
    if (r.endMin > 22 * 60) {
      const d = new Date(r.start.getFullYear(), r.start.getMonth(), r.start.getDate(), 22, 0);
      byTime.set(d.getTime(), d);
    }
    if (r.startMin < 8 * 60) {
      const d = new Date(r.start.getFullYear(), r.start.getMonth(), r.start.getDate() - 1, 22, 0);
      byTime.set(d.getTime(), d);
    }
  }
  return [...byTime.values()].sort((a, b) => a.getTime() - b.getTime());
}

/** 1サイクルぶんを計算 (合算 → ceil → cap → FIFO 配分) */
function computeCycle(employeeId, empRows, cycleStart) {
  const contributing = [];
  let totalMin = 0;
  for (const row of empRows) {
    const nm = cycleOverlapMinutes(row, cycleStart);
    if (nm > 0) {
      contributing.push({ row, nightMin: nm, allowance: 0 });
      totalMin += nm;
    }
  }
  const units = Math.ceil(totalMin / 30);
  const allowance = Math.min(units * 500, 5000);

  contributing.sort((a, b) => a.row.start - b.row.start);
  let cumMin = 0;
  let prevCumAllow = 0;
  for (const item of contributing) {
    cumMin += item.nightMin;
    const cumAllow = Math.min(Math.ceil(cumMin / 30) * 500, 5000);
    item.allowance = cumAllow - prevCumAllow;
    prevCumAllow = cumAllow;
  }

  const cycleEnd = new Date(cycleStart.getTime() + 10 * 3600 * 1000);
  return { employeeId, cycleStart, cycleEnd, items: contributing, totalMin, units, allowance };
}

/** 全行 → サイクル配列 (allowance>0 のみ) */
function computeCycles(rows) {
  const byEmp = new Map();
  for (const r of rows) {
    if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, []);
    byEmp.get(r.employeeId).push(r);
  }
  const cycles = [];
  for (const [emp, empRows] of byEmp) {
    const starts = collectCycleStarts(empRows);
    for (const cs of starts) {
      const cyc = computeCycle(emp, empRows, cs);
      if (cyc.allowance > 0) cycles.push(cyc);
    }
  }
  return cycles;
}

// ========== CSV パース ==========

function parseCSV(text) {
  const rows = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const row = [];
    let endOfRow = false;
    while (i < n && !endOfRow) {
      let field = '';
      if (text[i] === '"') {
        i++;
        while (i < n) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; }
            else { i++; break; }
          } else {
            field += text[i]; i++;
          }
        }
      } else {
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i]; i++;
        }
      }
      row.push(field);
      if (i >= n) { endOfRow = true; break; }
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '\r') i++;
      if (text[i] === '\n') { i++; endOfRow = true; break; }
    }
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) rows.push(row);
  }
  return rows;
}

function decodeCSV(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(arrayBuffer);
  }
  try {
    const text = new TextDecoder('shift_jis', { fatal: false }).decode(arrayBuffer);
    if (text.includes('ヘルパー') || text.includes('日付') || text.includes('開始時間')) {
      return text;
    }
  } catch (e) { /* fallthrough */ }
  return new TextDecoder('utf-8').decode(arrayBuffer);
}

// ========== 時刻・日付構築 ==========

function parseTime(str) {
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  return { h: parseInt(m[1], 10), mi: parseInt(m[2], 10) };
}

function makeDateTime(year, month, day, h, mi) {
  if (h === 24 && mi === 0) return new Date(year, month - 1, day + 1, 0, 0);
  return new Date(year, month - 1, day, h, mi);
}

function extractYearMonth(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  let m;
  m = base.match(/令和(\d+)年(\d{1,2})月/);
  if (m) return { year: 2018 + parseInt(m[1], 10), month: parseInt(m[2], 10) };
  m = base.match(/平成(\d+)年(\d{1,2})月/);
  if (m) return { year: 1988 + parseInt(m[1], 10), month: parseInt(m[2], 10) };
  m = base.match(/[Rr](\d+)[\-_.年](\d{1,2})/);
  if (m) return { year: 2018 + parseInt(m[1], 10), month: parseInt(m[2], 10) };
  m = base.match(/[Hh](\d+)[\-_.年](\d{1,2})/);
  if (m) return { year: 1988 + parseInt(m[1], 10), month: parseInt(m[2], 10) };
  m = base.match(/(20\d{2})[年\-_./](\d{1,2})/);
  if (m) return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  m = base.match(/(20\d{2})(\d{2})/);
  if (m) {
    const mo = parseInt(m[2], 10);
    if (mo >= 1 && mo <= 12) return { year: parseInt(m[1], 10), month: mo };
  }
  return null;
}

// ========== DOM & 状態 ==========

let currentCsvRows = null;
let currentFileName = null;
let currentCycles = null;          // 計算後サイクル
let currentAnnotatedRows = null;   // 全行: { originalIndex, raw, allowance }
let prevCsvRows = null;
let prevFileName = null;
let prevYM = null;                 // { year, month } — 前月CSVから抽出

const fileInput = document.getElementById('fileInput');
const prevFileInput = document.getElementById('prevFileInput');
const fileInfo = document.getElementById('fileInfo');
const prevFileInfo = document.getElementById('prevFileInfo');
const configSection = document.getElementById('configSection');
const yearInput = document.getElementById('yearInput');
const monthInput = document.getElementById('monthInput');
const ymSource = document.getElementById('ymSource');
const runBtn = document.getElementById('runBtn');
const resultSection = document.getElementById('resultSection');
const summaryDiv = document.getElementById('summary');
const downloadSummaryBtn = document.getElementById('downloadSummaryBtn');
const downloadDetailBtn = document.getElementById('downloadDetailBtn');
const testBtn = document.getElementById('testBtn');
const testResults = document.getElementById('testResults');

if (fileInput) fileInput.addEventListener('change', handleFile);
if (prevFileInput) prevFileInput.addEventListener('change', handlePrevFile);
if (runBtn) runBtn.addEventListener('click', runCalculation);
if (downloadSummaryBtn) downloadSummaryBtn.addEventListener('click', () => downloadCSV('summary'));
if (downloadDetailBtn) downloadDetailBtn.addEventListener('click', () => downloadCSV('detail'));
if (testBtn) testBtn.addEventListener('click', runTests);

async function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  currentFileName = file.name;

  try {
    const buf = await file.arrayBuffer();
    const text = decodeCSV(buf);
    currentCsvRows = parseCSV(text);

    fileInfo.innerHTML = `
      <div>当月: <strong>${escapeHtml(file.name)}</strong> (${(file.size / 1024).toFixed(1)} KB)</div>
      <div>読み込み行数: ${currentCsvRows.length}行 (ヘッダー含む)</div>
    `;

    const ym = extractYearMonth(file.name);
    if (ym) {
      yearInput.value = ym.year;
      monthInput.value = ym.month;
      ymSource.textContent = `✓ ファイル名から自動抽出: ${ym.year}年${ym.month}月`;
      ymSource.className = 'muted success';
    } else {
      const now = new Date();
      if (!yearInput.value) yearInput.value = now.getFullYear();
      if (!monthInput.value) monthInput.value = now.getMonth() + 1;
      ymSource.textContent = `⚠ ファイル名から年月を抽出できませんでした。手動で入力してください。`;
      ymSource.className = 'muted warning';
    }

    configSection.hidden = false;
    resultSection.hidden = true;
  } catch (err) {
    console.error(err);
    fileInfo.innerHTML = `<div class="error">ファイル読み込みエラー: ${escapeHtml(err.message)}</div>`;
  }
}

async function handlePrevFile(e) {
  const file = e.target.files[0];
  if (!file) {
    prevCsvRows = null;
    prevFileName = null;
    prevYM = null;
    prevFileInfo.innerHTML = '';
    return;
  }
  prevFileName = file.name;

  try {
    const buf = await file.arrayBuffer();
    const text = decodeCSV(buf);
    prevCsvRows = parseCSV(text);
    prevYM = extractYearMonth(file.name);

    const ymLabel = prevYM ? `${prevYM.year}年${prevYM.month}月` : '年月抽出不可（手動入力の当月の前月として扱います）';
    prevFileInfo.innerHTML = `
      <div>前月: <strong>${escapeHtml(file.name)}</strong> (${(file.size / 1024).toFixed(1)} KB) — ${escapeHtml(ymLabel)}</div>
      <div>読み込み行数: ${prevCsvRows.length}行 (ヘッダー含む)</div>
    `;
  } catch (err) {
    console.error(err);
    prevFileInfo.innerHTML = `<div class="error">前月CSV読み込みエラー: ${escapeHtml(err.message)}</div>`;
    prevCsvRows = null;
    prevYM = null;
  }
}

function parseRowsFromCsv(csvRows, year, month, { isPrimary, originPrefix }) {
  const header = csvRows[0].map(s => String(s).trim());
  const col = {
    employee: findCol(header, ['ヘルパー', '従業員', '氏名', '名前']),
    day:      findCol(header, ['日付', '日', 'date']),
    start:    findCol(header, ['開始時間', '開始', '出勤', 'start']),
    end:      findCol(header, ['終了時間', '終了', '退勤', 'end']),
  };
  const missing = Object.entries(col).filter(([, v]) => v < 0).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`${originPrefix}ヘッダーから必要な列が見つかりません: ${missing.join(', ')} (検出: ${header.join(' / ')})`);
  }

  const rows = [];
  const errors = [];
  const annotatedRows = [];

  for (let i = 1; i < csvRows.length; i++) {
    const r = csvRows[i];
    if (!r || r.length === 0 || r.every(c => !c || String(c).trim() === '')) {
      annotatedRows.push({ originalIndex: i, raw: r || [], allowance: null, isPrimary });
      continue;
    }
    const emp = String(r[col.employee] || '').trim();
    const dayStr = String(r[col.day] || '').trim();
    const startStr = String(r[col.start] || '').trim();
    const endStr = String(r[col.end] || '').trim();

    const day = parseInt(dayStr, 10);
    const startT = parseTime(startStr);
    const endT = parseTime(endStr);

    if (!emp || !(day >= 1 && day <= 31) || !startT || !endT) {
      errors.push(`${originPrefix}${i + 1}行目: パース不可 (${emp || '-'}, 日=${dayStr}, ${startStr}~${endStr})`);
      annotatedRows.push({ originalIndex: i, raw: r, allowance: null, isPrimary });
      continue;
    }

    const startMin = startT.h * 60 + startT.mi;
    const endMin = endT.h * 60 + endT.mi;
    const start = makeDateTime(year, month, day, startT.h, startT.mi);
    let end = makeDateTime(year, month, day, endT.h, endT.mi);
    if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000);

    const rowObj = {
      originalIndex: i,
      raw: r,
      employeeId: emp,
      day,
      startMin,
      endMin,
      start,
      end,
      isPrimary,
    };
    rows.push(rowObj);
    annotatedRows.push(rowObj);
  }

  return { rows, errors, annotatedRows };
}

/** 当月年月から前月の {year, month} を算出 */
function previousYearMonth(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function runCalculation() {
  try {
    summaryDiv.innerHTML = '';
    if (!currentCsvRows || currentCsvRows.length < 2) {
      summaryDiv.innerHTML = `<div class="error">CSVが読み込まれていません。</div>`;
      return;
    }
    const year = parseInt(yearInput.value, 10);
    const month = parseInt(monthInput.value, 10);
    if (!(year >= 2000 && year <= 2100) || !(month >= 1 && month <= 12)) {
      summaryDiv.innerHTML = `<div class="error">年月が不正です。</div>`;
      return;
    }

    const primary = parseRowsFromCsv(currentCsvRows, year, month, { isPrimary: true, originPrefix: '' });
    const errors = [...primary.errors];

    let prev = null;
    if (prevCsvRows && prevCsvRows.length >= 2) {
      const expectedPrev = previousYearMonth(year, month);
      const pYear = prevYM ? prevYM.year : expectedPrev.year;
      const pMonth = prevYM ? prevYM.month : expectedPrev.month;
      if (prevYM && (prevYM.year !== expectedPrev.year || prevYM.month !== expectedPrev.month)) {
        errors.push(`前月CSVの年月 (${prevYM.year}年${prevYM.month}月) は当月の直前月 (${expectedPrev.year}年${expectedPrev.month}月) と一致しません。`);
      }
      prev = parseRowsFromCsv(prevCsvRows, pYear, pMonth, { isPrimary: false, originPrefix: '前月CSV ' });
      errors.push(...prev.errors);
    }

    if (primary.rows.length === 0) {
      summaryDiv.innerHTML = `<div class="error">有効な勤怠行が見つかりませんでした。</div>`;
      return;
    }

    const allRows = prev ? primary.rows.concat(prev.rows) : primary.rows;
    const cycles = computeCycles(allRows);

    // 行ごとの手当合計: 当月行のみ集計 (originalIndex が当月と前月で被らないよう分離判定)
    const allowanceByIndex = new Map();
    for (const cyc of cycles) {
      for (const it of cyc.items) {
        if (!it.row.isPrimary) continue;
        const pAll = allowanceByIndex.get(it.row.originalIndex) || 0;
        allowanceByIndex.set(it.row.originalIndex, pAll + it.allowance);
      }
    }
    for (const ar of primary.annotatedRows) {
      if ('employeeId' in ar) {
        ar.allowance = allowanceByIndex.get(ar.originalIndex) || 0;
      }
    }

    currentCycles = cycles;
    currentAnnotatedRows = primary.annotatedRows;
    renderSummary(cycles, errors, year, month);
    resultSection.hidden = false;
  } catch (err) {
    console.error(err);
    summaryDiv.innerHTML = `<div class="error">エラー: ${escapeHtml(err.message)}</div>`;
  }
}

function findCol(header, keywords) {
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (keywords.some(k => h.includes(k))) return i;
  }
  return -1;
}

function renderSummary(cycles, errors, year, month) {
  const fmt = n => '¥' + n.toLocaleString('ja-JP');

  // 当月行を含むサイクルのみ表示・集計対象 (前月行のみのサイクルは当月には関係ない)
  const primaryCycles = [];
  for (const cyc of cycles) {
    let primaryAllow = 0;
    let primaryMin = 0;
    for (const it of cyc.items) {
      if (it.row.isPrimary) {
        primaryAllow += it.allowance;
        primaryMin += it.nightMin;
      }
    }
    if (primaryMin > 0) primaryCycles.push({ cyc, primaryAllow, primaryMin });
  }

  const perEmp = new Map();
  let grandTotal = 0;
  for (const { cyc, primaryAllow } of primaryCycles) {
    const cur = perEmp.get(cyc.employeeId) || { total: 0, cycles: 0 };
    cur.total += primaryAllow;
    cur.cycles += 1;
    perEmp.set(cyc.employeeId, cur);
    grandTotal += primaryAllow;
  }

  let html = '';
  if (errors.length > 0) {
    const errList = errors.slice(0, 10).map(e => `<li>${escapeHtml(e)}</li>`).join('');
    const more = errors.length > 10 ? `<li>...他${errors.length - 10}件</li>` : '';
    html += `<div class="error"><strong>警告 (${errors.length}件):</strong><ul>${errList}${more}</ul></div>`;
  }

  html += `<div class="summary-box">
    <strong>対象年月:</strong> ${year}年${month}月
    <strong>当月合計:</strong> ${fmt(grandTotal)}
    <strong>サイクル数:</strong> ${primaryCycles.length}
    <strong>従業員数:</strong> ${perEmp.size}
  </div>`;

  html += `<h3>従業員別合計</h3><table><thead><tr><th>ヘルパー名</th><th>サイクル数</th><th>合計</th></tr></thead><tbody>`;
  const sorted = [...perEmp.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [emp, v] of sorted) {
    html += `<tr><td>${escapeHtml(emp)}</td><td class="num">${v.cycles}</td><td class="num">${fmt(v.total)}</td></tr>`;
  }
  html += `</tbody></table>`;

  html += `<h3>サイクル明細 (先頭30件)</h3><table><thead><tr><th>ヘルパー</th><th>サイクル日</th><th>夜勤分数</th><th>単位</th><th>当月分</th></tr></thead><tbody>`;
  const cycPreview = [...primaryCycles].sort((a, b) =>
    a.cyc.employeeId.localeCompare(b.cyc.employeeId) ||
    a.cyc.cycleStart.getTime() - b.cyc.cycleStart.getTime()
  ).slice(0, 30);
  for (const { cyc, primaryAllow } of cycPreview) {
    const cs = cyc.cycleStart;
    const ce = cyc.cycleEnd;
    const label = `${cs.getMonth() + 1}/${cs.getDate()} → ${ce.getMonth() + 1}/${ce.getDate()}`;
    const crossMonth = cs.getMonth() !== ce.getMonth() || cs.getFullYear() !== ce.getFullYear();
    const allowCell = crossMonth
      ? `${fmt(primaryAllow)} <span class="muted">(合計${fmt(cyc.allowance)})</span>`
      : fmt(cyc.allowance);
    html += `<tr><td>${escapeHtml(cyc.employeeId)}</td><td>${label}</td><td class="num">${cyc.totalMin}分</td><td class="num">${cyc.units}</td><td class="num">${allowCell}</td></tr>`;
  }
  html += `</tbody></table>`;
  if (primaryCycles.length > 30) html += `<p class="muted">...他 ${primaryCycles.length - 30} 件</p>`;

  summaryDiv.innerHTML = html;
}

// ========== CSV 出力 ==========

function downloadCSV(mode) {
  if (!currentCycles) return;
  const base = (currentFileName || 'result.csv').replace(/\.csv$/i, '');
  let csvText;
  let outName;

  if (mode === 'summary') {
    const rows = [['ヘルパー名', 'サイクル数', '夜勤手当（円）']];
    const perEmp = new Map();
    for (const cyc of currentCycles) {
      let primaryAllow = 0;
      let primaryMin = 0;
      for (const it of cyc.items) {
        if (it.row.isPrimary) {
          primaryAllow += it.allowance;
          primaryMin += it.nightMin;
        }
      }
      if (primaryMin === 0) continue; // 前月内完結サイクルは当月集計から除外
      const cur = perEmp.get(cyc.employeeId) || { total: 0, cycles: 0 };
      cur.total += primaryAllow;
      cur.cycles += 1;
      perEmp.set(cyc.employeeId, cur);
    }
    const sorted = [...perEmp.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let grandTotal = 0;
    for (const [emp, v] of sorted) {
      rows.push([emp, String(v.cycles), String(v.total)]);
      grandTotal += v.total;
    }
    rows.push(['合計', '', String(grandTotal)]);
    csvText = toCSVText(rows);
    outName = `${base}_夜勤手当_集計.csv`;
  } else if (mode === 'detail') {
    const header = [...currentCsvRows[0], '夜勤手当'];
    const rows = [header];
    for (const ar of currentAnnotatedRows) {
      const raw = [...(ar.raw || [])];
      while (raw.length < currentCsvRows[0].length) raw.push('');
      raw.push(ar.allowance != null ? String(ar.allowance) : '');
      rows.push(raw);
    }
    csvText = toCSVText(rows);
    outName = `${base}_夜勤手当_明細.csv`;
  } else {
    return;
  }

  const bom = '\uFEFF';
  const blob = new Blob([bom + csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = outName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCSVText(rows) {
  return rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ========== テスト ==========

function runTests() {
  // テストはCSV→行構造を疑似的に作って computeCycles を呼ぶ
  function makeRow(emp, day, startStr, endStr, year = 2026, month = 4, idx = 0) {
    const sT = parseTime(startStr);
    const eT = parseTime(endStr);
    const startMin = sT.h * 60 + sT.mi;
    const endMin = eT.h * 60 + eT.mi;
    const start = makeDateTime(year, month, day, sT.h, sT.mi);
    let end = makeDateTime(year, month, day, eT.h, eT.mi);
    if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000);
    return {
      originalIndex: idx,
      employeeId: emp,
      day,
      startMin,
      endMin,
      start,
      end,
      isPrimary: true,
    };
  }

  const cases = [];

  // T1: 20:00-翌7:00 (2行分割)
  // cycle day=10: 22-24 (120min) + 0-7 (420min) = 540min → floor(540/30)=18 → 9000 → cap 5000
  // FIFO: cum=120→2000, cum=540→5000 → 行別 [2000, 3000]
  cases.push({
    name: 'T1: 20:00-翌7:00 (2行分割・上限超過)',
    rows: [
      makeRow('A', 10, '20:00', '24:00', 2026, 4, 0),
      makeRow('A', 11, '00:00', '7:00', 2026, 4, 1),
    ],
    expect: { perRow: [2000, 3000], cycleAllowance: 5000, cycleCount: 1 },
  });

  // T2: 22:00-翌3:00 (2行分割) 夜勤300分 → floor(300/30)*500 = 5000 (上限ちょうど)
  cases.push({
    name: 'T2: 夜勤帯のみ5h (上限ちょうど)',
    rows: [
      makeRow('B', 10, '22:00', '24:00', 2026, 4, 0),
      makeRow('B', 11, '00:00', '3:00', 2026, 4, 1),
    ],
    expect: { perRow: [2000, 3000], cycleAllowance: 5000, cycleCount: 1 },
  });

  // T3: 22:00-翌1:00 (180min) → floor(180/30)*500=3000
  cases.push({
    name: 'T3: 夜勤帯3h',
    rows: [
      makeRow('C', 10, '22:00', '24:00', 2026, 4, 0),
      makeRow('C', 11, '00:00', '1:00', 2026, 4, 1),
    ],
    expect: { perRow: [2000, 1000], cycleAllowance: 3000, cycleCount: 1 },
  });

  // T4: 夜勤帯ゼロ
  cases.push({
    name: 'T4: 夜勤帯ゼロ (09:00-17:00)',
    rows: [makeRow('D', 10, '9:00', '17:00', 2026, 4, 0)],
    expect: { perRow: [], cycleAllowance: 0, cycleCount: 0 },
  });

  // T5: 切り上げ 10分 → ceil(10/30)=1 → 500円
  cases.push({
    name: 'T5: 切り上げ 10分 → 500円',
    rows: [makeRow('E1', 10, '22:00', '22:10', 2026, 4, 0)],
    expect: { perRow: [500], cycleAllowance: 500, cycleCount: 1 },
  });

  // T6: 40分 → ceil(40/30)=2 → 1000円
  cases.push({
    name: 'T6: 切り上げ 40分 → 1000円',
    rows: [makeRow('E2', 10, '22:00', '22:40', 2026, 4, 0)],
    expect: { perRow: [1000], cycleAllowance: 1000, cycleCount: 1 },
  });

  // T7: 70分 → ceil(70/30)=3 → 1500円
  cases.push({
    name: 'T7: 切り上げ 70分 → 1500円',
    rows: [makeRow('E3', 10, '22:00', '23:10', 2026, 4, 0)],
    expect: { perRow: [1500], cycleAllowance: 1500, cycleCount: 1 },
  });

  // T8: 30分ちょうど → ceil(30/30)=1 → 500円
  cases.push({
    name: 'T8: 30分ちょうど → 500円',
    rows: [makeRow('F', 10, '22:00', '22:30', 2026, 4, 0)],
    expect: { perRow: [500], cycleAllowance: 500, cycleCount: 1 },
  });

  // T9: 3行シフト
  // Row1 20-23 (night 60min), Row2 23-24 (60min), Row3 0-7 (420min)
  // cum: 60→1000, 120→2000, 540→5000 (cap)
  // 配分: 1000, 1000, 3000
  cases.push({
    name: 'T9: 3行サイクル (FIFO 累積配分)',
    rows: [
      makeRow('G', 10, '20:00', '23:00', 2026, 4, 0),
      makeRow('G', 10, '23:00', '24:00', 2026, 4, 1),
      makeRow('G', 11, '00:00', '7:00', 2026, 4, 2),
    ],
    expect: { perRow: [1000, 1000, 3000], cycleAllowance: 5000, cycleCount: 1 },
  });

  // T10: 非連続 2サイクル (4/10, 4/15)
  cases.push({
    name: 'T10: 非連続 (個別上限・2サイクル)',
    rows: [
      makeRow('H', 10, '22:00', '24:00', 2026, 4, 0),
      makeRow('H', 11, '00:00', '8:00', 2026, 4, 1),
      makeRow('H', 15, '22:00', '24:00', 2026, 4, 2),
      makeRow('H', 16, '00:00', '8:00', 2026, 4, 3),
    ],
    expect: { perRow: [2000, 3000, 2000, 3000], cycleAllowance: null, cycleCount: 2 },
  });

  // T11: 月跨ぎサイクル 4/30 22-24 + 5/1 0-8 → 2000/3000 (cap 5000)
  cases.push({
    name: 'T11: 月跨ぎ 前月末2h+当月1日8h → 2000/3000',
    rows: [
      makeRow('I', 30, '22:00', '24:00', 2026, 4, 0),
      makeRow('I', 1, '00:00', '8:00', 2026, 5, 1),
    ],
    expect: { perRow: [2000, 3000], cycleAllowance: 5000, cycleCount: 1 },
  });

  // T12: 月跨ぎ 4/30 23-24 (1h) + 5/1 0-8 → 合計9h → ceil(540/30)=18 → cap 5000 → 1000/4000
  cases.push({
    name: 'T12: 月跨ぎ 前月末1h+当月1日8h → 1000/4000',
    rows: [
      makeRow('J', 30, '23:00', '24:00', 2026, 4, 0),
      makeRow('J', 1, '00:00', '8:00', 2026, 5, 1),
    ],
    expect: { perRow: [1000, 4000], cycleAllowance: 5000, cycleCount: 1 },
  });

  // T13: 年跨ぎ 2026/12/31 22-24 + 2027/1/1 0-8 → 2000/3000
  cases.push({
    name: 'T13: 年跨ぎ 12/31 22-24 + 1/1 0-8 → 2000/3000',
    rows: [
      makeRow('K', 31, '22:00', '24:00', 2026, 12, 0),
      makeRow('K', 1, '00:00', '8:00', 2027, 1, 1),
    ],
    expect: { perRow: [2000, 3000], cycleAllowance: 5000, cycleCount: 1 },
  });

  // T14: 月跨ぎ 前月末22-23 (1h) + 当月1日3-8 (5h) = 360分 → cap5000 → 1000/4000
  cases.push({
    name: 'T14: 月跨ぎ 22-23 + 3-8 → 1000/4000',
    rows: [
      makeRow('L', 30, '22:00', '23:00', 2026, 4, 0),
      makeRow('L', 1, '3:00', '8:00', 2026, 5, 1),
    ],
    expect: { perRow: [1000, 4000], cycleAllowance: 5000, cycleCount: 1 },
  });

  // T15: 月跨ぎ 前月末23-24 (1h) + 当月1日0-2 (2h) = 180分 → 3000 → 1000/2000
  cases.push({
    name: 'T15: 月跨ぎ 23-24 + 0-2 → 1000/2000',
    rows: [
      makeRow('M', 30, '23:00', '24:00', 2026, 4, 0),
      makeRow('M', 1, '0:00', '2:00', 2026, 5, 1),
    ],
    expect: { perRow: [1000, 2000], cycleAllowance: 3000, cycleCount: 1 },
  });

  let passCount = 0;
  let html = '<table class="test-table"><thead><tr><th>#</th><th>ケース</th><th>期待(行別)</th><th>実測(行別)</th><th>結果</th></tr></thead><tbody>';
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const cycles = computeCycles(c.rows);

    // 行別手当を originalIndex 順に集計
    const byIdx = new Map();
    for (const cyc of cycles) {
      for (const it of cyc.items) {
        byIdx.set(it.row.originalIndex, (byIdx.get(it.row.originalIndex) || 0) + it.allowance);
      }
    }
    const actualPerRow = [];
    for (const r of c.rows) {
      if (byIdx.has(r.originalIndex)) actualPerRow.push(byIdx.get(r.originalIndex));
    }

    const rowsMatch = JSON.stringify(actualPerRow) === JSON.stringify(c.expect.perRow);
    let cycleMatch = cycles.length === c.expect.cycleCount;
    if (c.expect.cycleAllowance != null && cycles.length === 1) {
      cycleMatch = cycleMatch && cycles[0].allowance === c.expect.cycleAllowance;
    }
    const pass = rowsMatch && cycleMatch;
    if (pass) passCount++;
    html += `<tr class="${pass ? 'pass' : 'fail'}"><td>${i + 1}</td><td>${escapeHtml(c.name)}</td><td>${JSON.stringify(c.expect.perRow)}</td><td>${JSON.stringify(actualPerRow)}</td><td>${pass ? 'PASS' : 'FAIL'}</td></tr>`;
  }
  html += '</tbody></table>';
  html = `<p><strong>${passCount}/${cases.length} passed</strong></p>` + html;
  testResults.innerHTML = html;
}
