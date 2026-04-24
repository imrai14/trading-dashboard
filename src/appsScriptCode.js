// Source of truth for the Apps Script the user pastes into their Google Sheet.
// Kept here so the setup screen can show it verbatim with a copy button.

export const SHEET_HEADERS = [
  "Date",
  "Symbol",
  "Entry Price",
  "Stop Loss",
  "Target", // deprecated — kept for backward compat with old rows
  "Qty",
  "Total Capital", // deprecated — moved to Settings sheet
  "Status",
  "Exit Price",
  "Exit Date",
  "Notes",
  "LTP", // column L: live GOOGLEFINANCE formula
  "Market Condition",
  "Chart Link",
  "Mistakes",
];

export const MISTAKE_OPTIONS = ["No SL", "Late Entry", "Early Entry", "FOMO"];
export const MARKET_CONDITIONS = ["Trending", "Sideways", "Downtrend"];

export const APPS_SCRIPT_CODE = `// ─── TradeScope Swing Tracker · Google Apps Script ───
// 1. Change SECRET below to a password you'll remember.
// 2. Save (Ctrl/Cmd+S) → Deploy → New deployment → Type: Web app.
// 3. "Execute as: Me", "Who has access: Anyone". Click Deploy.
// 4. Copy the /exec URL, paste it back in the TradeScope app along with this password.

const SHEET_NAME = 'SwingTrades';
const SETTINGS_SHEET = 'Settings';
const SECRET = 'change-this-to-your-password';

const HEADERS = ${JSON.stringify(SHEET_HEADERS)};

// LTP (column L, index 12) is a live GOOGLEFINANCE formula per row.
const LTP_COL = 12;
function ltpFormulaFor_(rowIdx) {
  return '=IFERROR(GOOGLEFINANCE("NSE:"&B' + rowIdx + ',"price"),"")';
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.secret !== SECRET) return jsonOut({ error: 'unauthorized' });
  return jsonOut({ trades: readAll_(), settings: readSettings_() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut({ error: 'bad json' }); }
  if (body.secret !== SECRET) return jsonOut({ error: 'unauthorized' });

  if (body.action === 'setSettings') {
    const s = body.settings || {};
    Object.keys(s).forEach(function(k) { writeSetting_(k, s[k]); });
    return jsonOut({ ok: true, trades: readAll_(), settings: readSettings_() });
  }

  const sheet = getSheet_();
  const t = body.trade || {};
  // 15 columns — Target (col 5) and Total Capital (col 7) are empty for new trades,
  // LTP (col 12) is written separately as a formula.
  const row = [
    t.date || '',
    t.symbol || '',
    t.entryPrice || '',
    t.stopLoss || '',
    '',                       // Target (deprecated)
    t.qty || '',
    '',                       // Total Capital (deprecated — now in Settings)
    t.status || 'Open',
    t.exitPrice || '',
    t.exitDate || '',
    t.notes || '',
    '',                       // LTP placeholder — overwritten with formula below
    t.marketCondition || '',
    t.chartLink || '',
    t.mistakes || '',
  ];

  if (body.action === 'add') {
    sheet.appendRow(row);
    const rowIdx = sheet.getLastRow();
    sheet.getRange(rowIdx, LTP_COL).setFormula(ltpFormulaFor_(rowIdx));
    return jsonOut({ ok: true, trades: readAll_(), settings: readSettings_() });
  }
  if (body.action === 'update') {
    const rowIdx = Number(body.rowIndex) + 2; // +1 header, +1 for 1-indexed
    // Write cols 1-11 and 13-15; skip col 12 (LTP formula).
    sheet.getRange(rowIdx, 1, 1, 11).setValues([row.slice(0, 11)]);
    sheet.getRange(rowIdx, 13, 1, 3).setValues([row.slice(12, 15)]);
    sheet.getRange(rowIdx, LTP_COL).setFormula(ltpFormulaFor_(rowIdx));
    return jsonOut({ ok: true, trades: readAll_(), settings: readSettings_() });
  }
  if (body.action === 'delete') {
    const rowIdx = Number(body.rowIndex) + 2;
    sheet.deleteRow(rowIdx);
    return jsonOut({ ok: true, trades: readAll_(), settings: readSettings_() });
  }
  return jsonOut({ error: 'unknown action' });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  ensureHeaders_(sheet);
  return sheet;
}

// Make sure row 1 has all required headers in the right columns,
// adding missing ones in place without disturbing adjacent data.
function ensureHeaders_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (let i = 0; i < HEADERS.length; i++) {
    if (current[i] !== HEADERS[i]) {
      sheet.getRange(1, i + 1).setValue(HEADERS[i]);
    }
  }
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

// Self-heal: for any row with a Symbol but no LTP formula, install the formula.
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

// ─── Settings (key/value sheet) ──────────────────────────────
function getSettingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET);
    sheet.appendRow(['Key', 'Value']);
  }
  return sheet;
}

function readSettings_() {
  const sheet = getSettingsSheet_();
  const values = sheet.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < values.length; i++) {
    if (values[i][0]) out[values[i][0]] = values[i][1];
  }
  return out;
}

function writeSetting_(key, value) {
  const sheet = getSettingsSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
