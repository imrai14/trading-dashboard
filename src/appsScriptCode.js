// Source of truth for the Apps Script the user pastes into their Google Sheet.
// Kept here so the setup screen can show it verbatim with a copy button.

export const SHEET_HEADERS = [
  "Date",
  "Symbol",
  "Entry Price",
  "Stop Loss",
  "Target",
  "Qty",
  "Total Capital",
  "Status",
  "Exit Price",
  "Exit Date",
  "Notes",
  "LTP",
];

export const APPS_SCRIPT_CODE = `// ─── TradeScope Swing Tracker · Google Apps Script ───
// 1. Change SECRET below to a password you'll remember.
// 2. Save (Ctrl/Cmd+S) → Deploy → New deployment → Type: Web app.
// 3. "Execute as: Me", "Who has access: Anyone". Click Deploy.
// 4. Copy the /exec URL, paste it back in the TradeScope app along with this password.

const SHEET_NAME = 'SwingTrades';
const SECRET = 'change-this-to-your-password';

// LTP (column L, index 12) is a live GOOGLEFINANCE formula per row.
// Users never type LTP — the sheet computes it from the Symbol in column B.
const LTP_COL = 12;
function ltpFormulaFor_(rowIdx) {
  return '=IFERROR(GOOGLEFINANCE("NSE:"&B' + rowIdx + ',"price"),"")';
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.secret !== SECRET) return jsonOut({ error: 'unauthorized' });
  return jsonOut({ trades: readAll_() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut({ error: 'bad json' }); }
  if (body.secret !== SECRET) return jsonOut({ error: 'unauthorized' });

  const sheet = getSheet_();
  const t = body.trade || {};
  // 11 user-filled columns — LTP (col 12) is a formula, written separately.
  const row = [
    t.date || '', t.symbol || '', t.entryPrice || '', t.stopLoss || '',
    t.target || '', t.qty || '', t.totalCapital || '', t.status || 'Open',
    t.exitPrice || '', t.exitDate || '', t.notes || '',
  ];

  if (body.action === 'add') {
    sheet.appendRow(row);
    const rowIdx = sheet.getLastRow();
    sheet.getRange(rowIdx, LTP_COL).setFormula(ltpFormulaFor_(rowIdx));
    return jsonOut({ ok: true, trades: readAll_() });
  }
  if (body.action === 'update') {
    const rowIdx = Number(body.rowIndex) + 2; // +1 header, +1 for 1-indexed
    sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
    // (Re)apply the formula in case Symbol changed or formula was wiped.
    sheet.getRange(rowIdx, LTP_COL).setFormula(ltpFormulaFor_(rowIdx));
    return jsonOut({ ok: true, trades: readAll_() });
  }
  if (body.action === 'delete') {
    const rowIdx = Number(body.rowIndex) + 2;
    sheet.deleteRow(rowIdx);
    return jsonOut({ ok: true, trades: readAll_() });
  }
  return jsonOut({ error: 'unknown action' });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(${JSON.stringify(SHEET_HEADERS)});
  }
  return sheet;
}

function readAll_() {
  const sheet = getSheet_();
  ensureLTPFormulas_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(function(row, i) {
    const obj = { _row: i };
    headers.forEach(function(h, j) { obj[h] = row[j]; });
    return obj;
  });
}

// Self-heal: for any row with a Symbol but no LTP formula (e.g. older rows
// added before this feature), install the GOOGLEFINANCE formula.
function ensureLTPFormulas_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const count = lastRow - 1;
  const formulas = sheet.getRange(2, LTP_COL, count, 1).getFormulas();
  const symbols = sheet.getRange(2, 2, count, 1).getValues();
  for (let i = 0; i < count; i++) {
    if (symbols[i][0] && !formulas[i][0]) {
      sheet.getRange(i + 2, LTP_COL).setFormula(ltpFormulaFor_(i + 2));
    }
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
