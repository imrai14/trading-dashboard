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

export async function fetchTrades({ url, secret }) {
  if (!url || !secret) throw new Error("Missing Apps Script URL or password");
  const res = await fetch(`${url}?secret=${encodeURIComponent(secret)}`, {
    method: "GET",
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.trades || [];
}

export async function fetchQuote({ url, secret }, symbol) {
  if (!url || !secret) throw new Error("Missing Apps Script URL or password");
  if (!symbol) throw new Error("Enter a symbol first");
  const u = `${url}?secret=${encodeURIComponent(secret)}&action=quote&symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(u, { method: "GET", redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  if (typeof json.price !== "number") {
    throw new Error("Apps Script is out of date — redeploy with the latest code to enable CMP fetch.");
  }
  return json;
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
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.trades || [];
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

// Map a row from the sheet (keyed by header names) into our trade shape.
export function normalizeTrade(raw) {
  const num = (v) => {
    if (v === "" || v == null) return 0;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };
  return {
    _row: raw._row,
    date: String(raw["Date"] ?? ""),
    symbol: String(raw["Symbol"] ?? ""),
    entryPrice: num(raw["Entry Price"]),
    stopLoss: num(raw["Stop Loss"]),
    target: num(raw["Target"]),
    qty: num(raw["Qty"]),
    totalCapital: num(raw["Total Capital"]),
    status: String(raw["Status"] ?? "Open"),
    exitPrice: num(raw["Exit Price"]),
    exitDate: String(raw["Exit Date"] ?? ""),
    notes: String(raw["Notes"] ?? ""),
    ltp: num(raw["LTP"]),
  };
}
