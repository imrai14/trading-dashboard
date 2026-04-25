// Pure utility / aggregation functions used by the SwingTracker dashboard.
// Kept in their own file (no React, no router, no DOM) so they can be unit
// tested without dragging in the entire UI tree. The React component imports
// from here.

// Normalize a leg object coming from the form (strings → numbers).
// Drops legs with zero/negative price or qty.
export function cleanLegs(legs) {
  return (legs || [])
    .map((l) => ({
      price: parseFloat(l.price) || 0,
      qty: parseFloat(l.qty) || 0,
      date: l.date || "",
    }))
    .filter((l) => l.price > 0 && l.qty > 0);
}

// Weighted average price and total qty over a legs array.
export function summarizeLegs(legs) {
  const cleaned = cleanLegs(legs);
  let totalQty = 0;
  let totalNotional = 0;
  for (const l of cleaned) {
    totalQty += l.qty;
    totalNotional += l.price * l.qty;
  }
  const avg = totalQty > 0 ? totalNotional / totalQty : 0;
  const lastDate = cleaned.reduce(
    (acc, l) => (l.date && (!acc || l.date > acc) ? l.date : acc),
    "",
  );
  return { totalQty, avg, lastDate, count: cleaned.length };
}

// Days between two ISO date strings; second arg null means "today".
// Negative spans clamp to 0 (would only happen on bad data).
export function daysBetween(from, to) {
  if (!from) return null;
  const a = new Date(from);
  const b = to ? new Date(to) : new Date();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

// Age of a trade in days. Open → since entry, Closed → entry to exit.
export function tradeAge(t) {
  if (t.status?.toLowerCase() === "open") return daysBetween(t.date, null);
  return daysBetween(t.date, t.exitDate);
}

// Total Capital lives in the Settings sheet. Fall back to the most
// recent per-trade value so users migrating from the old schema still
// see sane metrics until they set a capital value.
export function resolveCapital(trades, settings) {
  if (settings?.totalCapital) return settings.totalCapital;
  for (let i = trades.length - 1; i >= 0; i--) {
    const c = parseFloat(trades[i].totalCapital);
    if (c) return c;
  }
  return 0;
}

// The big aggregation. Returns every metric the dashboard tiles need.
export function computeMetrics(trades, settings) {
  const open = trades.filter((t) => t.status?.toLowerCase() === "open");
  const closed = trades.filter((t) => t.status?.toLowerCase() === "closed");

  const openPnl = open.reduce(
    (s, t) => s + (t.ltp ? (t.ltp - t.entryPrice) * t.qty : 0),
    0,
  );
  const capitalDeployed = open.reduce(
    (s, t) => s + t.entryPrice * t.qty,
    0,
  );
  const latestCapital = resolveCapital(trades, settings);
  const capitalDeployedPct = latestCapital
    ? (capitalDeployed / latestCapital) * 100
    : 0;

  const openRisk = open.reduce(
    (s, t) => s + Math.max(0, (t.entryPrice - t.stopLoss) * t.qty),
    0,
  );
  const avgRiskPct = latestCapital ? (openRisk / latestCapital) * 100 : 0;

  const rMultiples = closed
    .map((t) => {
      const risk = (t.entryPrice - t.stopLoss) * t.qty;
      const reward = (t.exitPrice - t.entryPrice) * t.qty;
      if (!risk) return null;
      return reward / risk;
    })
    .filter((v) => v !== null && isFinite(v));

  const avgR =
    rMultiples.length > 0
      ? rMultiples.reduce((s, v) => s + v, 0) / rMultiples.length
      : 0;

  // Realized P&L: profit/loss BOOKED, i.e. cash actually taken off the table.
  // Counts every exit leg across ALL trades (open + closed) — partial exits
  // on a still-open position are real money in your pocket and must show up.
  // Each leg realizes (legPrice - entryAvg) × legQty. For legacy rows that
  // pre-date leg JSON we fall back to (exit - entry) × qty when status is
  // Closed (open legacy rows have no exit info to count).
  // Win-rate is still computed over fully-closed trades only — a partially
  // exited open trade hasn't resolved yet, so it doesn't count as a win/loss.
  let realizedPnl = 0;
  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const t of trades) {
    const exitLegs = Array.isArray(t.exits) ? t.exits : [];
    let pnl = 0;
    if (exitLegs.length > 0) {
      pnl = exitLegs.reduce(
        (s, l) => s + (l.price - t.entryPrice) * l.qty,
        0,
      );
    } else if (t.status?.toLowerCase() === "closed" && t.exitPrice > 0) {
      // Legacy closed row without leg JSON.
      pnl = (t.exitPrice - t.entryPrice) * t.qty;
    } else {
      continue; // open trade with no exits booked yet
    }
    realizedPnl += pnl;
  }
  for (const t of closed) {
    // Win/loss attribution is per closed trade.
    const exitLegs = Array.isArray(t.exits) ? t.exits : [];
    const pnl =
      exitLegs.length > 0
        ? exitLegs.reduce((s, l) => s + (l.price - t.entryPrice) * l.qty, 0)
        : (t.exitPrice - t.entryPrice) * t.qty;
    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
    } else if (pnl < 0) {
      grossLoss += pnl;
    }
  }
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

  // Closed trades sorted newest-first — by exit date, falling back to entry
  // date. Page 1 of the closed-trades table then shows the most recent.
  const closedSorted = [...closed].sort((a, b) => {
    const aKey = a.exitDate || a.date || "";
    const bKey = b.exitDate || b.date || "";
    return bKey.localeCompare(aKey);
  });

  return {
    open,
    closed,
    closedSorted,
    openPnl,
    capitalDeployed,
    capitalDeployedPct,
    latestCapital,
    openRisk,
    avgRiskPct,
    avgR,
    realizedPnl,
    winRate,
    wins,
    grossProfit,
    grossLoss,
  };
}

// Compute count / win-rate / avg-R over an array of closed trades.
// Used by the per-symbol breakdown tables.
export function aggregateClosed(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0, winRate: 0, avgR: 0 };
  let wins = 0;
  let rSum = 0;
  let rCount = 0;
  for (const t of trades) {
    const risk = (t.entryPrice - t.stopLoss) * t.qty;
    const reward = (t.exitPrice - t.entryPrice) * t.qty;
    if (reward > 0) wins++;
    if (risk > 0 && isFinite(reward / risk)) {
      rSum += reward / risk;
      rCount++;
    }
  }
  return {
    n,
    winRate: (wins / n) * 100,
    avgR: rCount ? rSum / rCount : 0,
  };
}
