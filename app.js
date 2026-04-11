/* 夜勤手当計算アプリ (CSV専用)
 *
 * 入力: 訪問介護シフト CSV (Shift-JIS, 10列)
 *   ヘルパー名, 日付, 曜日, 利用者, 業務種別, サービス内容, 開始時間, 終了時間, 提供時間（分）, 備考
 *
 * 計算ルール:
 *   - 夜勤時間帯: 22:00 〜 翌8:00
 *   - 単価: 500円 / 30分ブロック
 *   - 30分未満は切り上げ: 1-30分 → 500円、31-60分 → 1000円 ...
 *     (row_raw = ceil(row_night_min / 30) * 500)
 *   - シフト上限: 5,000円
 *   - シフト: 同一従業員 && 前行終了時刻 == 次行開始時刻 (±1分)
 *   - 上限超過時は先頭行から順に充当 (FIFO)
 *
 * 年月: ファイル名から自動抽出（取れない場合は手入力）
 */

'use strict';

// ========== 計算ロジック ==========

/** 指定区間 [start, end] と 22:00-翌8:00 の重なり分数を返す */
function nightMinutes(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  if (end <= start) return 0;

  let total = 0;
  let cursor = new Date(start);

  while (cursor < end) {
    const dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);
    const chunkEnd = end < nextDay ? end : nextDay;

    const earlyEnd = new Date(dayStart); earlyEnd.setHours(8);
    const lateStart = new Date(dayStart); lateStart.setHours(22);

    total += overlapMinutes(cursor, chunkEnd, dayStart, earlyEnd);
    total += overlapMinutes(cursor, chunkEnd, lateStart, nextDay);

    cursor = chunkEnd;
  }
  return total;
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart.getTime(), bStart.getTime());
  const e = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, Math.round((e - s) / 60000));
}

/** 分数 → 手当額 (30分未満は切り上げ): ceil(min / 30) * 500 */
function rawAllowanceFromMinutes(min) {
  if (min <= 0) return 0;
  return Math.ceil(min / 30) * 500;
}

/** 行を同一シフトにグルーピング (同一従業員 && 前行終了==次行開始 ±1分) */
function groupShifts(rows) {
  const sorted = [...rows].sort((a, b) => {
    if (a.employeeId !== b.employeeId) {
      return String(a.employeeId).localeCompare(String(b.employeeId));
    }
    return a.start - b.start;
  });

  const shifts = [];
  let current = null;
  const TOLERANCE_MS = 60 * 1000;

  for (const row of sorted) {
    if (current &&
        current.employeeId === row.employeeId &&
        Math.abs(current.rows[current.rows.length - 1].end - row.start) <= TOLERANCE_MS) {
      current.rows.push(row);
    } else {
      current = { employeeId: row.employeeId, rows: [row] };
      shifts.push(current);
    }
  }
  return shifts;
}

/** シフト単位で手当を計算し、上限5000円を適用してFIFO配分 */
function applyAllowance(shifts, { capPerShift = 5000 } = {}) {
  for (const shift of shifts) {
    let rawTotal = 0;
    for (const row of shift.rows) {
      row.nightMin = nightMinutes(row.start, row.end);
      row.rawAllowance = rawAllowanceFromMinutes(row.nightMin);
      rawTotal += row.rawAllowance;
    }
    shift.rawTotal = rawTotal;
    shift.finalTotal = Math.min(rawTotal, capPerShift);

    if (rawTotal <= capPerShift) {
      for (const row of shift.rows) row.finalAllowance = row.rawAllowance;
    } else {
      let remaining = capPerShift;
      for (const row of shift.rows) {
        row.finalAllowance = Math.min(row.rawAllowance, remaining);
        remaining -= row.finalAllowance;
      }
    }
  }
  return shifts;
}

// ========== CSV パース ==========

/** 簡易CSVパーサー (ダブルクォート / CRLF / 内側カンマ対応) */
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

/** Shift-JIS / UTF-8 自動判定デコード */
function decodeCSV(arrayBuffer) {
  // BOM判定
  const u8 = new Uint8Array(arrayBuffer);
  if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(arrayBuffer);
  }
  // まず Shift-JIS で試す (このアプリは Shift-JIS がメインのため)
  try {
    const text = new TextDecoder('shift_jis', { fatal: false }).decode(arrayBuffer);
    // 「ヘルパー」「日付」などが含まれていれば Shift-JIS 成功とみなす
    if (text.includes('ヘルパー') || text.includes('日付') || text.includes('開始時間')) {
      return text;
    }
  } catch (e) { /* fallthrough */ }
  // フォールバック: UTF-8
  return new TextDecoder('utf-8').decode(arrayBuffer);
}

// ========== 時刻・日付構築 ==========

/** "HH:MM" を {h, m} にパース。"24:00" → {h:24, m:0} */
function parseTime(str) {
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { h: parseInt(m[1], 10), mi: parseInt(m[2], 10) };
}

/** 年月日時刻からDate生成。h=24はY月D+1日の00:00として扱う */
function makeDateTime(year, month, day, h, mi) {
  if (h === 24 && mi === 0) {
    return new Date(year, month - 1, day + 1, 0, 0);
  }
  return new Date(year, month - 1, day, h, mi);
}

/** ファイル名から年月を抽出 */
function extractYearMonth(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  let m;

  // 令和N年MM月 / 令和N年M月
  m = base.match(/令和(\d+)年(\d{1,2})月/);
  if (m) return { year: 2018 + parseInt(m[1], 10), month: parseInt(m[2], 10) };

  // 平成N年MM月
  m = base.match(/平成(\d+)年(\d{1,2})月/);
  if (m) return { year: 1988 + parseInt(m[1], 10), month: parseInt(m[2], 10) };

  // R8-04, R8_4, R8.4, R8年4月
  m = base.match(/[Rr](\d+)[\-_.年](\d{1,2})/);
  if (m) return { year: 2018 + parseInt(m[1], 10), month: parseInt(m[2], 10) };

  // H31-12
  m = base.match(/[Hh](\d+)[\-_.年](\d{1,2})/);
  if (m) return { year: 1988 + parseInt(m[1], 10), month: parseInt(m[2], 10) };

  // 2026年4月 / 2026-04 / 2026_04 / 2026.4 / 2026/4
  m = base.match(/(20\d{2})[年\-_./](\d{1,2})/);
  if (m) return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };

  // 202604 (連続6桁)
  m = base.match(/(20\d{2})(\d{2})/);
  if (m) {
    const mo = parseInt(m[2], 10);
    if (mo >= 1 && mo <= 12) return { year: parseInt(m[1], 10), month: mo };
  }

  return null;
}

// ========== DOM & 状態 ==========

let currentCsvRows = null;       // パース済み全行 (raw)
let currentFileName = null;
let currentResultShifts = null;  // 計算後
let currentResultRows = null;    // detail 出力用: 全行(not only night)に手当を付与したデータ

const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
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
      <div>選択中: <strong>${escapeHtml(file.name)}</strong> (${(file.size / 1024).toFixed(1)} KB)</div>
      <div>読み込み行数: ${currentCsvRows.length}行 (ヘッダー含む)</div>
    `;

    // 年月抽出
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

    // ヘッダー行から列インデックスを特定
    const header = currentCsvRows[0].map(s => String(s).trim());
    const col = {
      employee: findCol(header, ['ヘルパー', '従業員', '氏名', '名前']),
      day:      findCol(header, ['日付', '日', 'date']),
      start:    findCol(header, ['開始時間', '開始', '出勤', 'start']),
      end:      findCol(header, ['終了時間', '終了', '退勤', 'end']),
    };
    const missing = Object.entries(col).filter(([, v]) => v < 0).map(([k]) => k);
    if (missing.length > 0) {
      summaryDiv.innerHTML = `<div class="error">ヘッダーから必要な列が見つかりません: ${missing.join(', ')}<br>検出ヘッダー: ${header.join(' / ')}</div>`;
      return;
    }

    const rows = [];
    const errors = [];
    const annotatedRows = []; // detail 出力用に全行を保持

    for (let i = 1; i < currentCsvRows.length; i++) {
      const r = currentCsvRows[i];
      if (!r || r.length === 0 || r.every(c => !c || String(c).trim() === '')) {
        annotatedRows.push({ originalIndex: i, raw: r || [], allowance: null });
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
        errors.push(`${i + 1}行目: パース不可 (${emp || '-'}, 日=${dayStr}, ${startStr}~${endStr})`);
        annotatedRows.push({ originalIndex: i, raw: r, allowance: null });
        continue;
      }

      const start = makeDateTime(year, month, day, startT.h, startT.mi);
      let end = makeDateTime(year, month, day, endT.h, endT.mi);
      // 「24:00」以外の逆転（例: 22:00-01:00 のような表記が来た場合）は翌日とみなす
      if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000);

      const rowObj = {
        originalIndex: i,
        raw: r,
        employeeId: emp,
        start,
        end,
      };
      rows.push(rowObj);
      annotatedRows.push(rowObj);
    }

    if (rows.length === 0) {
      summaryDiv.innerHTML = `<div class="error">有効な勤怠行が見つかりませんでした。</div>`;
      return;
    }

    const shifts = applyAllowance(groupShifts(rows));

    // 行へ手当を書き戻し
    const allowanceByIndex = new Map();
    for (const shift of shifts) {
      for (const r of shift.rows) allowanceByIndex.set(r.originalIndex, r.finalAllowance);
    }
    for (const ar of annotatedRows) {
      ar.allowance = allowanceByIndex.has(ar.originalIndex) ? allowanceByIndex.get(ar.originalIndex) : 0;
    }

    currentResultShifts = shifts;
    currentResultRows = annotatedRows;
    renderSummary(shifts, errors, year, month);
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

function renderSummary(shifts, errors, year, month) {
  const fmt = n => '¥' + n.toLocaleString('ja-JP');
  const fmtDate = d => {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${mi}`;
  };

  const perEmp = new Map();
  let grandTotal = 0;
  for (const shift of shifts) {
    const cur = perEmp.get(shift.employeeId) || { total: 0, shifts: 0 };
    cur.total += shift.finalTotal;
    cur.shifts += 1;
    perEmp.set(shift.employeeId, cur);
    grandTotal += shift.finalTotal;
  }

  let html = '';
  if (errors.length > 0) {
    const errList = errors.slice(0, 10).map(e => `<li>${escapeHtml(e)}</li>`).join('');
    const more = errors.length > 10 ? `<li>...他${errors.length - 10}件</li>` : '';
    html += `<div class="error"><strong>警告 (${errors.length}件):</strong><ul>${errList}${more}</ul></div>`;
  }

  html += `<div class="summary-box">
    <strong>対象年月:</strong> ${year}年${month}月
    <strong>総合計:</strong> ${fmt(grandTotal)}
    <strong>シフト数:</strong> ${shifts.length}
    <strong>従業員数:</strong> ${perEmp.size}
  </div>`;

  html += `<h3>従業員別合計</h3><table><thead><tr><th>ヘルパー名</th><th>シフト数</th><th>合計</th></tr></thead><tbody>`;
  const sorted = [...perEmp.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [emp, v] of sorted) {
    html += `<tr><td>${escapeHtml(emp)}</td><td class="num">${v.shifts}</td><td class="num">${fmt(v.total)}</td></tr>`;
  }
  html += `</tbody></table>`;

  html += `<h3>シフト明細 (先頭30件)</h3><table><thead><tr><th>ヘルパー</th><th>開始</th><th>終了</th><th>行数</th><th>素点</th><th>配分後</th></tr></thead><tbody>`;
  for (const shift of shifts.slice(0, 30)) {
    const first = shift.rows[0];
    const last = shift.rows[shift.rows.length - 1];
    html += `<tr><td>${escapeHtml(shift.employeeId)}</td><td>${fmtDate(first.start)}</td><td>${fmtDate(last.end)}</td><td class="num">${shift.rows.length}</td><td class="num">${fmt(shift.rawTotal)}</td><td class="num">${fmt(shift.finalTotal)}</td></tr>`;
  }
  html += `</tbody></table>`;
  if (shifts.length > 30) html += `<p class="muted">...他 ${shifts.length - 30} 件</p>`;

  summaryDiv.innerHTML = html;
}

// ========== CSV 出力 ==========

function downloadCSV(mode) {
  if (!currentResultShifts) return;
  const base = (currentFileName || 'result.csv').replace(/\.csv$/i, '');
  let csvText;
  let outName;

  if (mode === 'summary') {
    const rows = [['ヘルパー名', 'シフト数', '夜勤手当（円）']];
    const perEmp = new Map();
    for (const shift of currentResultShifts) {
      const cur = perEmp.get(shift.employeeId) || { total: 0, shifts: 0 };
      cur.total += shift.finalTotal;
      cur.shifts += 1;
      perEmp.set(shift.employeeId, cur);
    }
    const sorted = [...perEmp.entries()].sort((a, b) => b[1].total - a[1].total);
    let grandTotal = 0;
    for (const [emp, v] of sorted) {
      rows.push([emp, String(v.shifts), String(v.total)]);
      grandTotal += v.total;
    }
    rows.push(['合計', '', String(grandTotal)]);
    csvText = toCSVText(rows);
    outName = `${base}_夜勤手当_集計.csv`;
  } else if (mode === 'detail') {
    // 元CSV + 末尾「夜勤手当」列
    const header = [...currentCsvRows[0], '夜勤手当'];
    const rows = [header];
    for (const ar of currentResultRows) {
      const raw = [...(ar.raw || [])];
      // 元CSVと列数が合わないケースをパディング
      while (raw.length < currentCsvRows[0].length) raw.push('');
      raw.push(ar.allowance != null ? String(ar.allowance) : '');
      rows.push(raw);
    }
    csvText = toCSVText(rows);
    outName = `${base}_夜勤手当_明細.csv`;
  } else {
    return;
  }

  // UTF-8 BOM を付けてExcelで正しく開けるようにする
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
  const cases = [];

  function mkDate(s) { return new Date(s.replace(/\//g, '-')); }
  function rowOf(emp, startStr, endStr, idx = 0) {
    return { originalIndex: idx, employeeId: emp, start: mkDate(startStr), end: mkDate(endStr) };
  }

  // T1: 仕様書例 (2行分割・上限超過・FIFO)
  // Row1: 20:00-24:00 night=120min → ceil(120/30)*500 = 2000
  // Row2: 00:00-07:00 night=420min → ceil(420/30)*500 = 7000
  // raw=9000 → cap 5000; FIFO: 2000, 3000
  cases.push({
    name: 'T1: 20:00-翌7:00 (2行分割・上限超過)',
    rows: [
      rowOf('A', '2026-04-10T20:00', '2026-04-11T00:00', 0),
      rowOf('A', '2026-04-11T00:00', '2026-04-11T07:00', 1),
    ],
    expect: { perRow: [2000, 3000], shiftTotal: 5000 },
  });

  // T2: 5h (22:00-03:00) → night=300min → ceil(300/30)*500 = 5000
  cases.push({
    name: 'T2: 夜勤帯のみ5h (上限ちょうど)',
    rows: [rowOf('B', '2026-04-10T22:00', '2026-04-11T03:00', 0)],
    expect: { perRow: [5000], shiftTotal: 5000 },
  });

  // T3: 3h (22:00-01:00) → night=180min → ceil(180/30)*500 = 3000
  cases.push({
    name: 'T3: 夜勤帯3h',
    rows: [rowOf('C', '2026-04-10T22:00', '2026-04-11T01:00', 0)],
    expect: { perRow: [3000], shiftTotal: 3000 },
  });

  // T4: 夜勤帯ゼロ
  cases.push({
    name: 'T4: 夜勤帯ゼロ',
    rows: [rowOf('D', '2026-04-10T09:00', '2026-04-10T17:00', 0)],
    expect: { perRow: [0], shiftTotal: 0 },
  });

  // T5: 切り上げテスト: 10分 → 500, 40分 → 1000, 70分 → 1500
  // 22:00-22:10 (10min) → 500
  cases.push({
    name: 'T5: 切り上げ 10分 → 500円',
    rows: [rowOf('E1', '2026-04-10T22:00', '2026-04-10T22:10', 0)],
    expect: { perRow: [500], shiftTotal: 500 },
  });
  // 22:00-22:40 (40min) → ceil(40/30)=2 → 1000
  cases.push({
    name: 'T6: 切り上げ 40分 → 1000円',
    rows: [rowOf('E2', '2026-04-10T22:00', '2026-04-10T22:40', 0)],
    expect: { perRow: [1000], shiftTotal: 1000 },
  });
  // 22:00-23:10 (70min) → ceil(70/30)=3 → 1500
  cases.push({
    name: 'T7: 切り上げ 70分 → 1500円',
    rows: [rowOf('E3', '2026-04-10T22:00', '2026-04-10T23:10', 0)],
    expect: { perRow: [1500], shiftTotal: 1500 },
  });

  // T8: 夜勤帯30分ピッタリ → 500円
  cases.push({
    name: 'T8: 30分ちょうど → 500円',
    rows: [rowOf('F', '2026-04-10T22:00', '2026-04-10T22:30', 0)],
    expect: { perRow: [500], shiftTotal: 500 },
  });

  // T9: 3行にまたがるシフト (合計上限)
  // 20:00-23:00 → night 60min (22-23) → 1000
  // 23:00-00:00 → night 60min → 1000
  // 00:00-07:00 → night 420min → 7000
  // raw = 9000 → cap 5000; FIFO: 1000, 1000, 3000
  cases.push({
    name: 'T9: 3行シフト (FIFO)',
    rows: [
      rowOf('G', '2026-04-10T20:00', '2026-04-10T23:00', 0),
      rowOf('G', '2026-04-10T23:00', '2026-04-11T00:00', 1),
      rowOf('G', '2026-04-11T00:00', '2026-04-11T07:00', 2),
    ],
    expect: { perRow: [1000, 1000, 3000], shiftTotal: 5000 },
  });

  // T10: 非連続シフト (個別に上限) - 2シフト
  cases.push({
    name: 'T10: 非連続 (個別上限)',
    rows: [
      rowOf('H', '2026-04-10T22:00', '2026-04-11T08:00', 0), // 600min → 10000 → 5000
      rowOf('H', '2026-04-15T22:00', '2026-04-16T08:00', 1), // 同上
    ],
    expect: { perRow: [5000, 5000], shiftTotal: null },
  });

  let passCount = 0;
  let html = '<table class="test-table"><thead><tr><th>#</th><th>ケース</th><th>期待(行別)</th><th>実測(行別)</th><th>結果</th></tr></thead><tbody>';
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const shifts = applyAllowance(groupShifts(c.rows));
    const actualPerRow = [];
    for (const s of shifts) for (const r of s.rows) actualPerRow.push(r.finalAllowance);
    const rowsMatch = JSON.stringify(actualPerRow) === JSON.stringify(c.expect.perRow);
    let shiftMatch = true;
    if (c.expect.shiftTotal != null) {
      shiftMatch = shifts.length === 1 && shifts[0].finalTotal === c.expect.shiftTotal;
    }
    const pass = rowsMatch && shiftMatch;
    if (pass) passCount++;
    html += `<tr class="${pass ? 'pass' : 'fail'}"><td>${i + 1}</td><td>${escapeHtml(c.name)}</td><td>${JSON.stringify(c.expect.perRow)}</td><td>${JSON.stringify(actualPerRow)}</td><td>${pass ? 'PASS' : 'FAIL'}</td></tr>`;
  }
  html += '</tbody></table>';
  html = `<p><strong>${passCount}/${cases.length} passed</strong></p>` + html;
  testResults.innerHTML = html;
}
