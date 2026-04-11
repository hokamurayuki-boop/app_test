/* 夜勤手当計算アプリ
 * ルール:
 *   夜勤時間帯: 22:00 〜 翌8:00
 *   単価: 1,000円/時間（夜勤帯に重なる分のみ）
 *   上限: 1シフト 5,000円
 *   シフト境界: 同一従業員かつ「前行終了時刻 == 次行開始時刻」(±1分許容)
 *   上限配分: 先頭行から順に充当 (FIFO)
 */

'use strict';

// ========== 計算ロジック (純粋関数、テスト可能) ==========

/**
 * 指定区間 [start, end] が 夜勤時間帯 (22:00-翌8:00) と重なる分数を返す。
 * @param {Date} start
 * @param {Date} end
 * @returns {number} minutes
 */
function nightMinutes(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  if (end <= start) return 0;

  let total = 0;
  let cursor = new Date(start);

  // 各カレンダー日ごとに区切って夜間帯 [00:00-08:00] と [22:00-24:00] との重なりを合算
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

/**
 * 行を同一シフトにグルーピングする。
 * @param {Array} rows - {employeeId, start(Date), end(Date), rowIndex} を持つ配列
 * @returns {Array} shifts - [{employeeId, rows:[...]}]
 */
function groupShifts(rows) {
  const sorted = [...rows].sort((a, b) => {
    if (a.employeeId !== b.employeeId) return String(a.employeeId).localeCompare(String(b.employeeId));
    return a.start - b.start;
  });

  const shifts = [];
  let current = null;
  const TOLERANCE_MS = 60 * 1000; // 1分以内のズレは同一シフトとみなす

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

/**
 * シフト単位で夜勤手当を計算し、上限5000円を適用してFIFO配分する。
 * 各行に nightMin / rawAllowance / finalAllowance を付与する。
 */
function applyAllowance(shifts, { unitPerHour = 1000, capPerShift = 5000 } = {}) {
  for (const shift of shifts) {
    let rawTotal = 0;
    for (const row of shift.rows) {
      row.nightMin = nightMinutes(row.start, row.end);
      row.rawAllowance = Math.round(row.nightMin * unitPerHour / 60);
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

// ========== Excel 入出力 ==========

let currentWorkbook = null;
let currentFileName = null;
let currentResultRows = null; // 計算後の行データ (ダウンロード用)

const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const configSection = document.getElementById('configSection');
const sheetSelect = document.getElementById('sheetSelect');
const headerRowInput = document.getElementById('headerRow');
const colEmployee = document.getElementById('colEmployee');
const colStart = document.getElementById('colStart');
const colEnd = document.getElementById('colEnd');
const outputColNameInput = document.getElementById('outputColName');
const runBtn = document.getElementById('runBtn');
const resultSection = document.getElementById('resultSection');
const summaryDiv = document.getElementById('summary');
const downloadBtn = document.getElementById('downloadBtn');
const testBtn = document.getElementById('testBtn');
const testResults = document.getElementById('testResults');

fileInput.addEventListener('change', handleFile);
sheetSelect.addEventListener('change', updateColumnOptions);
headerRowInput.addEventListener('change', updateColumnOptions);
runBtn.addEventListener('click', runCalculation);
downloadBtn.addEventListener('click', downloadResult);
testBtn.addEventListener('click', runTests);

async function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  currentFileName = file.name;
  fileInfo.textContent = `選択中: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

  const buf = await file.arrayBuffer();
  currentWorkbook = XLSX.read(buf, { type: 'array', cellDates: true });

  sheetSelect.innerHTML = '';
  for (const name of currentWorkbook.SheetNames) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sheetSelect.appendChild(opt);
  }
  configSection.hidden = false;
  resultSection.hidden = true;
  updateColumnOptions();
}

function updateColumnOptions() {
  if (!currentWorkbook) return;
  const sheetName = sheetSelect.value;
  const sheet = currentWorkbook.Sheets[sheetName];
  if (!sheet) return;

  const headerRow = Math.max(1, parseInt(headerRowInput.value, 10) || 1);
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  const headers = (aoa[headerRow - 1] || []).map((h, i) => ({
    index: i,
    label: h != null && String(h).trim() !== '' ? String(h) : `列${XLSX.utils.encode_col(i)}`
  }));

  function fill(select, defaultKeywords) {
    select.innerHTML = '';
    for (const h of headers) {
      const opt = document.createElement('option');
      opt.value = h.index;
      opt.textContent = `${XLSX.utils.encode_col(h.index)}: ${h.label}`;
      select.appendChild(opt);
    }
    // デフォルト候補
    const match = headers.find(h => defaultKeywords.some(k => h.label.includes(k)));
    if (match) select.value = match.index;
  }

  fill(colEmployee, ['従業員', '社員', '氏名', '名前', 'ID']);
  fill(colStart, ['開始', '出勤', 'start', 'Start', 'from']);
  fill(colEnd, ['終了', '退勤', 'end', 'End', 'to']);
}

/**
 * Excel セル値を Date に変換。
 * - Date オブジェクト → そのまま
 * - 数値 (Excel シリアル値) → 変換
 * - 文字列 → Date.parse 経由で変換
 */
function parseDateCell(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    // Excel シリアル値
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return new Date(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, Math.floor(d.S || 0));
  }
  if (typeof v === 'string') {
    const s = v.trim().replace(/\//g, '-');
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function runCalculation() {
  try {
    summaryDiv.innerHTML = '';
    const sheetName = sheetSelect.value;
    const sheet = currentWorkbook.Sheets[sheetName];
    const headerRow = Math.max(1, parseInt(headerRowInput.value, 10) || 1);

    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const dataStartRow = headerRow; // 0-indexed in aoa, which means Excel row (headerRow + 1)
    const empCol = parseInt(colEmployee.value, 10);
    const startCol = parseInt(colStart.value, 10);
    const endCol = parseInt(colEnd.value, 10);

    const rows = [];
    const errors = [];
    for (let i = dataStartRow; i < aoa.length; i++) {
      const row = aoa[i];
      if (!row) continue;
      const emp = row[empCol];
      const start = parseDateCell(row[startCol]);
      const end = parseDateCell(row[endCol]);
      if (emp == null || String(emp).trim() === '') continue;
      if (!start || !end) {
        errors.push(`Excel ${i + 1}行目: 日時が解釈できません`);
        continue;
      }
      rows.push({
        rowIndex: i, // 0-indexed in aoa
        excelRow: i + 1,
        employeeId: String(emp).trim(),
        start,
        end,
      });
    }

    if (rows.length === 0) {
      summaryDiv.innerHTML = `<div class="error">有効な行が見つかりませんでした。列指定とヘッダー行番号を確認してください。</div>`;
      return;
    }

    const shifts = applyAllowance(groupShifts(rows));

    // シートに出力列を追加
    const outputName = outputColNameInput.value.trim() || '夜勤手当';
    const outCol = findOrCreateOutputColumn(sheet, headerRow, outputName);

    // 行ごとの手当をマップ化
    const allowanceByRow = new Map();
    for (const shift of shifts) {
      for (const r of shift.rows) allowanceByRow.set(r.rowIndex, r.finalAllowance);
    }

    for (const [rowIndex, amount] of allowanceByRow) {
      const cellAddr = XLSX.utils.encode_cell({ r: rowIndex, c: outCol });
      sheet[cellAddr] = { t: 'n', v: amount };
    }
    // シート範囲を更新
    const ref = sheet['!ref'];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      if (outCol > range.e.c) range.e.c = outCol;
      sheet['!ref'] = XLSX.utils.encode_range(range);
    }

    currentResultRows = { shifts, errors };
    renderSummary(shifts, errors);
    resultSection.hidden = false;
  } catch (err) {
    console.error(err);
    summaryDiv.innerHTML = `<div class="error">エラー: ${err.message}</div>`;
  }
}

function findOrCreateOutputColumn(sheet, headerRow, name) {
  const ref = sheet['!ref'] || 'A1';
  const range = XLSX.utils.decode_range(ref);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRow - 1, c });
    const cell = sheet[addr];
    if (cell && String(cell.v).trim() === name) return c;
  }
  // 新規列を作成
  const newCol = range.e.c + 1;
  const headerAddr = XLSX.utils.encode_cell({ r: headerRow - 1, c: newCol });
  sheet[headerAddr] = { t: 's', v: name };
  return newCol;
}

function renderSummary(shifts, errors) {
  const fmt = n => n.toLocaleString('ja-JP') + '円';
  const fmtDate = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${mi}`;
  };

  const perEmp = new Map();
  let grandTotal = 0;
  for (const shift of shifts) {
    perEmp.set(shift.employeeId, (perEmp.get(shift.employeeId) || 0) + shift.finalTotal);
    grandTotal += shift.finalTotal;
  }

  let html = '';
  if (errors.length > 0) {
    html += `<div class="error"><strong>警告:</strong><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul></div>`;
  }

  html += `<div class="summary-box"><strong>総合計:</strong> ${fmt(grandTotal)} / シフト数: ${shifts.length}</div>`;

  html += `<h3>従業員別合計</h3><table><thead><tr><th>従業員</th><th>合計</th></tr></thead><tbody>`;
  for (const [emp, total] of [...perEmp.entries()].sort()) {
    html += `<tr><td>${emp}</td><td class="num">${fmt(total)}</td></tr>`;
  }
  html += `</tbody></table>`;

  html += `<h3>シフト明細 (先頭20件)</h3><table><thead><tr><th>従業員</th><th>開始</th><th>終了</th><th>行数</th><th>素点</th><th>配分後</th></tr></thead><tbody>`;
  for (const shift of shifts.slice(0, 20)) {
    const first = shift.rows[0];
    const last = shift.rows[shift.rows.length - 1];
    html += `<tr><td>${shift.employeeId}</td><td>${fmtDate(first.start)}</td><td>${fmtDate(last.end)}</td><td class="num">${shift.rows.length}</td><td class="num">${fmt(shift.rawTotal)}</td><td class="num">${fmt(shift.finalTotal)}</td></tr>`;
  }
  html += `</tbody></table>`;
  if (shifts.length > 20) html += `<p class="muted">...他 ${shifts.length - 20} 件</p>`;

  summaryDiv.innerHTML = html;
}

function downloadResult() {
  if (!currentWorkbook) return;
  const base = (currentFileName || 'result.xlsx').replace(/\.xlsx?$/i, '');
  const outName = `${base}_夜勤手当.xlsx`;
  XLSX.writeFile(currentWorkbook, outName);
}

// ========== テスト ==========

function runTests() {
  const cases = [];

  function mkDate(s) { return new Date(s.replace(/\//g, '-')); }
  function rowOf(emp, startStr, endStr, idx = 0) {
    return { rowIndex: idx, employeeId: emp, start: mkDate(startStr), end: mkDate(endStr) };
  }

  // T1: 仕様書の例 (20:00-翌8:00) - 2行分割
  cases.push({
    name: 'T1: 仕様書例(2行分割・上限超過・FIFO)',
    rows: [
      rowOf('A', '2026-04-10T20:00', '2026-04-11T00:00', 0),
      rowOf('A', '2026-04-11T00:00', '2026-04-11T08:00', 1),
    ],
    expect: { shiftTotal: 5000, perRow: [2000, 3000] },
  });

  // T2: 夜勤帯のみ5h (22:00-03:00) → 5000円(上限ちょうど)
  cases.push({
    name: 'T2: 夜勤帯のみ5h',
    rows: [rowOf('B', '2026-04-10T22:00', '2026-04-11T03:00', 0)],
    expect: { shiftTotal: 5000, perRow: [5000] },
  });

  // T3: 夜勤帯3h (22:00-01:00) → 3000円
  cases.push({
    name: 'T3: 夜勤帯3h',
    rows: [rowOf('C', '2026-04-10T22:00', '2026-04-11T01:00', 0)],
    expect: { shiftTotal: 3000, perRow: [3000] },
  });

  // T4: 夜勤帯ゼロ (09:00-17:00) → 0円
  cases.push({
    name: 'T4: 夜勤帯ゼロ',
    rows: [rowOf('D', '2026-04-10T09:00', '2026-04-10T17:00', 0)],
    expect: { shiftTotal: 0, perRow: [0] },
  });

  // T5: 3行にまたがるシフト (合計5000、FIFO)
  cases.push({
    name: 'T5: 3行にまたがるシフト',
    rows: [
      rowOf('E', '2026-04-10T20:00', '2026-04-10T23:00', 0), // 1h night
      rowOf('E', '2026-04-10T23:00', '2026-04-11T00:00', 1), // 1h night
      rowOf('E', '2026-04-11T00:00', '2026-04-11T08:00', 2), // 8h night
    ],
    expect: { shiftTotal: 5000, perRow: [1000, 1000, 3000] },
  });

  // T6: 同一従業員の別日シフト(非連続) - 個別に上限適用
  cases.push({
    name: 'T6: 非連続シフト（個別上限）',
    rows: [
      rowOf('F', '2026-04-10T22:00', '2026-04-11T08:00', 0), // 10h → 10000 cap 5000
      rowOf('F', '2026-04-15T22:00', '2026-04-16T08:00', 1), // 10h → 10000 cap 5000
    ],
    expect: { shiftTotal: null, perRow: [5000, 5000] }, // 2シフト各5000
  });

  // T7: 4/11 00:00-08:00 単独 → 8h * 1000 = 8000 → cap 5000
  cases.push({
    name: 'T7: 早朝8h単独（上限適用）',
    rows: [rowOf('G', '2026-04-11T00:00', '2026-04-11T08:00', 0)],
    expect: { shiftTotal: 5000, perRow: [5000] },
  });

  let passCount = 0;
  let html = '<table class="test-table"><thead><tr><th>#</th><th>ケース</th><th>期待値</th><th>実測値</th><th>結果</th></tr></thead><tbody>';
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const shifts = applyAllowance(groupShifts(c.rows));
    const actualPerRow = [];
    for (const s of shifts) for (const r of s.rows) actualPerRow.push(r.finalAllowance);
    const expectedPerRow = c.expect.perRow;
    const rowsMatch = JSON.stringify(actualPerRow) === JSON.stringify(expectedPerRow);

    let shiftMatch = true;
    if (c.expect.shiftTotal != null) {
      shiftMatch = shifts.length === 1 && shifts[0].finalTotal === c.expect.shiftTotal;
    }
    const pass = rowsMatch && shiftMatch;
    if (pass) passCount++;
    html += `<tr class="${pass ? 'pass' : 'fail'}"><td>${i + 1}</td><td>${c.name}</td><td>${JSON.stringify(expectedPerRow)}</td><td>${JSON.stringify(actualPerRow)}</td><td>${pass ? 'PASS' : 'FAIL'}</td></tr>`;
  }
  html += '</tbody></table>';
  html = `<p><strong>${passCount}/${cases.length} passed</strong></p>` + html;
  testResults.innerHTML = html;
}
