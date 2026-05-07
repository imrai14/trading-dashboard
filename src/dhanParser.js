// Dhan P&L CSV parser. Pure function, no React/router/DOM — kept in its
// own file so it can be unit-tested without dragging in App.js's router
// imports (CRA's Jest can't transform `react-router-dom` v7 ESM exports).
//
// Input: the CSV text exactly as Dhan's "Download P&L" exports it.
// Output: { broker, trades, holdings, chargesBreakdown, netPnl,
//           brokerage, grossPnl, totalCharges, unrealizedPnl, dateRange }
// Or `null` if the file doesn't look like a Dhan P&L export.
//
// Dhan format quirks the parser tolerates:
//   - Header lines (Name / UCC / Mobile / Email) before the trade table.
//   - Quoted CSV cells with embedded commas (e.g. "1,234").
//   - Net P&L summary row appears AFTER the trade rows.
//   - Trailing NOTE line and blank lines.

export function parseDhanCSV(text) {
  const lines = String(text || "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.includes("Scrip Name"));
  if (headerIdx === -1) return null;

  const trades = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("Net P&L") || line.startsWith("NOTE")) continue;
    // Dhan wraps every numeric cell in quotes (so commas inside numbers
    // don't break CSV parsing). This regex grabs each quoted-or-unquoted
    // cell, then we strip the surrounding quotes and any thousands-commas
    // that sneaked through.
    const row = line
      .match(/(".*?"|[^,]+)(?=,|$)/g)
      ?.map((v) => v.replace(/^"|"$/g, "").replace(/,/g, ""));
    if (!row || row.length < 10) continue;
    const pnl = parseFloat(row[8]);
    const pnlPct = parseFloat(row[9]);
    if (Number.isNaN(pnl)) continue;
    const buyQty = parseFloat(row[1]);
    const sellQty = parseFloat(row[4]);
    trades.push({
      broker: "DHAN",
      name: row[0],
      qty: sellQty || buyQty || 0,
      buyQty,
      avgBuy: parseFloat(row[2]),
      buyVal: parseFloat(row[3]),
      sellQty,
      avgSell: parseFloat(row[5]),
      sellVal: parseFloat(row[6]),
      pnl,
      pnlPct,
    });
  }

  const summaryLine = lines.find((l) => l.startsWith("Net P&L"));
  let netPnl = 0;
  let brokerage = 0;
  let grossPnl = 0;
  let totalCharges = 0;
  if (summaryLine) {
    const parts = summaryLine.split(",");
    netPnl = parseFloat(parts[1]) || 0;
    brokerage = parseFloat(parts[3]) || 0;
    grossPnl = parseFloat(parts[5]) || 0;
    totalCharges = parseFloat(parts[7]) || 0;
  }

  const headerLine = lines[0] || "";
  const dateMatch = headerLine.match(/From (.+?) to (.+)/);
  const dateRange = dateMatch ? `${dateMatch[1]} – ${dateMatch[2]}` : "Period";

  // Dhan only exposes brokerage + a lumped "other charges" in the summary
  // row, so the breakdown is intentionally coarse.
  const otherCharges = Math.max(0, totalCharges - brokerage);
  const chargesBreakdown = [
    { label: "Brokerage", amount: brokerage },
    { label: "STT / Exchange / Other", amount: otherCharges },
  ].filter((x) => x.amount > 0);

  return {
    broker: "DHAN",
    trades,
    holdings: [],
    chargesBreakdown,
    netPnl,
    brokerage,
    grossPnl,
    totalCharges,
    unrealizedPnl: 0,
    dateRange,
  };
}
