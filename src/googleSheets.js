// Thin client for the Apps Script web app that fronts the Google Sheet.
// Apps Script web apps don't support custom CORS headers, so POSTs use
// text/plain to avoid a preflight (Apps Script parses the JSON body itself).

const CONFIG_KEY = "tradescope:swing:config:v1";

export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { url: "", secret: "" };
    return JSON.parse(raw);
  } catch {
    return { url: "", secret: "" };
  }
}

export function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

// Normalize every server response into { trades, settings }.
function unpack(json) {
  if (json.error) throw new Error(json.error);
  return {
    trades: json.trades || [],
    settings: json.settings || {},
  };
}

export async function fetchAll({ url, secret }) {
  if (!url || !secret) throw new Error("Missing Apps Script URL or password");
  const res = await fetch(`${url}?secret=${encodeURIComponent(secret)}`, {
    method: "GET",
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return unpack(await res.json());
}

async function postAction({ url, secret }, action, payload) {
  if (!url || !secret) throw new Error("Missing Apps Script URL or password");
  const res = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret, action, ...payload }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return unpack(await res.json());
}

export function addTrade(config, trade) {
  return postAction(config, "add", { trade });
}

export function updateTrade(config, rowIndex, trade) {
  return postAction(config, "update", { rowIndex, trade });
}

export function deleteTrade(config, rowIndex) {
  return postAction(config, "delete", { rowIndex });
}

export function saveSettings(config, settings) {
  return postAction(config, "setSettings", { settings });
}

// Map a row from the sheet (keyed by header names) into our trade shape.
export function normalizeTrade(raw) {
  const num = (v) => {
    if (v === "" || v == null) return 0;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };
  // Dates may come back as ISO strings (from JSON) or as Date objects when
  // Apps Script's Utilities serializes. Normalize to YYYY-MM-DD.
  const dateStr = (v) => {
    if (!v) return "";
    const s = String(v);
    // Already yyyy-mm-dd?
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return s;
  };

  // Parse a JSON leg array; each leg is {price, qty, date}. Fields are coerced
  // and invalid rows are skipped.
  const parseLegs = (raw) => {
    if (!raw) return [];
    try {
      const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(arr)) return [];
      return arr
        .map((l) => ({
          price: num(l.price),
          qty: num(l.qty),
          date: dateStr(l.date || ""),
        }))
        .filter((l) => l.price > 0 && l.qty > 0);
    } catch {
      return [];
    }
  };

  const legacyEntryPrice = num(raw["Entry Price"]);
  const legacyQty = num(raw["Qty"]);
  const legacyExitPrice = num(raw["Exit Price"]);
  const legacyExitDate = dateStr(raw["Exit Date"]);
  const tradeDate = dateStr(raw["Date"]);

  let entries = parseLegs(raw["Entries"]);
  let exits = parseLegs(raw["Exits"]);

  // Legacy rows (no JSON yet): synthesize one leg from the flat columns.
  if (entries.length === 0 && legacyEntryPrice > 0 && legacyQty > 0) {
    entries = [{ price: legacyEntryPrice, qty: legacyQty, date: tradeDate }];
  }
  if (exits.length === 0 && legacyExitPrice > 0) {
    exits = [
      {
        price: legacyExitPrice,
        // Best-effort qty — match total entry qty so P&L math stays stable.
        qty: legacyQty,
        date: legacyExitDate,
      },
    ];
  }

  return {
    _row: raw._row,
    date: tradeDate,
    symbol: String(raw["Symbol"] ?? ""),
    entryPrice: legacyEntryPrice,
    stopLoss: num(raw["Stop Loss"]),
    target: num(raw["Target"]), // legacy, not shown in UI
    qty: legacyQty,
    status: String(raw["Status"] ?? "Open"),
    exitPrice: legacyExitPrice,
    exitDate: legacyExitDate,
    notes: String(raw["Notes"] ?? ""),
    ltp: num(raw["LTP"]),
    marketCondition: String(raw["Market Condition"] ?? ""),
    chartLink: String(raw["Chart Link"] ?? ""),
    mistakes: String(raw["Mistakes"] ?? ""),
    entries,
    exits,
  };
}

export function normalizeSettings(raw) {
  const num = (v) => {
    if (v === "" || v == null) return 0;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };
  return {
    totalCapital: num(raw.totalCapital),
    riskPerTradePct: num(raw.riskPerTradePct),
  };
}
