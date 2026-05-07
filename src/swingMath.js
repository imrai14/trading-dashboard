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

// Total qty across exit legs (or 0 if none / malformed).
// normalizeTrade synthesizes a single leg from legacy flat columns so a
// fully-closed legacy row already has exits[0].qty == entryQty here.
export function exitQty(t) {
  if (!t) return 0;
  const legs = Array.isArray(t.exits) ? t.exits : [];
  return legs.reduce((s, l) => s + (Number(l && l.qty) || 0), 0);
}

// Open (still-held) qty = entry total qty − exited qty, clamped ≥ 0.
// Used by every "open exposure" calculation: open P&L, capital deployed,
// risk on open, and the live Qty column for partial-exit Open trades.
// For fully-closed trades this returns 0 (everything is sold).
export function openQty(t) {
  if (!t) return 0;
  const entryQ = Number(t.qty) || 0;
  return Math.max(0, entryQ - exitQty(t));
}

// Booked P&L on a trade — leg-aware sum when exit-leg JSON exists, else
// the legacy `(exitPrice − entry) × qty` formula for old rows that pre-date
// leg JSON. Returns 0 when neither path can produce a number (e.g. an Open
// trade with no exits booked yet).
//
// Used by:
//   - computeMetrics realized-P&L loop
//   - computeMetrics R-multiples (reward numerator)
//   - aggregateClosed (per-symbol breakdown reward + win count)
//   - TradesTable Closed-row P&L
//
// IMPORTANT: For partial-closed trades marked "Closed" with exits.qty <
// entries.qty, leg-aware sum is what makes this CORRECT — the legacy
// flat formula would multiply by entry total and over-count.
export function realizedPnl(t) {
  if (!t) return 0;
  const legs = Array.isArray(t.exits) ? t.exits : [];
  const entry = Number(t.entryPrice) || 0;
  if (legs.length > 0) {
    // Match cleanLegs' contract: skip null legs and any leg whose price
    // or qty isn't a positive finite number. Without this guard, a leg
    // with `price: "abc"` would coerce to 0 and silently subtract the
    // full entry cost from realized P&L.
    return legs.reduce((s, l) => {
      if (!l) return s;
      const p = Number(l.price);
      const q = Number(l.qty);
      if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) {
        return s;
      }
      return s + (p - entry) * q;
    }, 0);
  }
  const exitP = Number(t.exitPrice) || 0;
  const qty = Number(t.qty) || 0;
  if (exitP > 0 && qty > 0) {
    return (exitP - entry) * qty;
  }
  return 0;
}

// Validate trade-form leg dates. Returns null when valid, else a short
// human-readable error string. Pure function so it's unit-testable.
//
// Rules enforced:
//   1. No leg date may be later than today (future trades aren't real).
//   2. No exit leg date may be earlier than the earliest entry leg date
//      (you can't sell what you haven't bought).
//
// `options.today` lets tests pin the clock; defaults to today's ISO date.
export function validateTradeDates(form, options = {}) {
  if (!form) return null;
  const today =
    options.today || new Date().toISOString().slice(0, 10);
  const entryLegs = (form.entries || []).filter((l) => l && l.date);
  const exitLegs = (form.exits || []).filter((l) => l && l.date);

  for (const l of entryLegs) {
    if (l.date > today) {
      return `Entry leg date can't be in the future: ${l.date}`;
    }
  }
  for (const l of exitLegs) {
    if (l.date > today) {
      return `Exit leg date can't be in the future: ${l.date}`;
    }
  }
  if (entryLegs.length > 0 && exitLegs.length > 0) {
    const earliestEntry = entryLegs.reduce(
      (acc, l) => (l.date < acc ? l.date : acc),
      entryLegs[0].date,
    );
    for (const l of exitLegs) {
      if (l.date < earliestEntry) {
        return `Exit leg date (${l.date}) is earlier than the earliest entry date (${earliestEntry}).`;
      }
    }
  }
  return null;
}

// Equity curve: realized P&L bucketed by date, plus a running cumulative
// total. Returns an array sorted chronologically:
//   [{ date: "YYYY-MM-DD", daily: number, cumulative: number }, ...]
//
// Per-leg attribution: each exit leg contributes (legPrice − entryAvg) ×
// legQty on the leg's `date`. For legs missing a date we fall back to the
// trade's `exitDate`, then to the trade's entry `date`. Legacy closed
// rows (no leg JSON, but exitPrice > 0) contribute (exitPrice − entry) ×
// qty on the trade's exitDate.
//
// LTP / unrealized values are deliberately NOT included — this is your
// BOOKED-cash curve, the same number that shows up in the Realized P&L
// tile, but spread across time.
export function equityCurve(trades) {
  const list = Array.isArray(trades) ? trades : [];
  const byDate = new Map(); // date → daily P&L

  const add = (date, amount) => {
    if (!date || !Number.isFinite(amount) || amount === 0) return;
    byDate.set(date, (byDate.get(date) || 0) + amount);
  };

  for (const t of list) {
    if (!t) continue;
    const entry = Number(t.entryPrice) || 0;
    const legs = Array.isArray(t.exits) ? t.exits : [];
    if (legs.length > 0) {
      for (const l of legs) {
        if (!l) continue;
        const p = Number(l.price);
        const q = Number(l.qty);
        if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) {
          continue;
        }
        const legDate = l.date || t.exitDate || t.date || "";
        add(legDate, (p - entry) * q);
      }
    } else if (
      String(t.status || "").toLowerCase() === "closed" &&
      Number(t.exitPrice) > 0 &&
      Number(t.qty) > 0
    ) {
      const exitP = Number(t.exitPrice);
      const qty = Number(t.qty);
      add(t.exitDate || t.date || "", (exitP - entry) * qty);
    }
  }

  const sorted = [...byDate.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  let running = 0;
  return sorted.map(([date, daily]) => {
    running += daily;
    return { date, daily, cumulative: running };
  });
}

// Fallback thresholds used when the user hasn't set a per-trade risk
// target yet. Percent-of-capital. Conservative defaults for swing
// trading — tune at the source if your style differs.
export const RISK_THRESHOLDS = { warn: 2, danger: 5 };

// When the user HAS set a per-trade risk target via Settings, the banner
// scales its thresholds to multiples of that target instead of using the
// hardcoded fallback. So a 1% target warns at 3% and goes red at 6%; a
// 2% target warns at 6% and goes red at 12%. The math is:
//   warn-at = target × RISK_MULTIPLIERS.warn
//   danger-at = target × RISK_MULTIPLIERS.danger
export const RISK_MULTIPLIERS = { warn: 3, danger: 6 };

// Inspect a `computeMetrics` result and decide whether a risk-warning
// banner should be shown above the dashboard tiles. Returns:
//   { level: "ok"    , message: null   } — no banner
//   { level: "warn"  , message: string } — amber banner
//   { level: "danger", message: string } — red banner
//
// `settings.riskPerTradePct` (when > 0) is used as the per-trade target.
// Threshold computation is exposed via the returned `warnAt`/`dangerAt`
// fields so callers can also display the active limits.
//
// Pure function — unit-testable without dragging in React. Returns "ok"
// silently when capital is missing/zero so a user who hasn't set capital
// yet doesn't see noise.
export function assessRisk(metrics, settings) {
  const target = Number(settings && settings.riskPerTradePct) || 0;
  const warnAt =
    target > 0 ? target * RISK_MULTIPLIERS.warn : RISK_THRESHOLDS.warn;
  const dangerAt =
    target > 0 ? target * RISK_MULTIPLIERS.danger : RISK_THRESHOLDS.danger;

  if (!metrics || !metrics.latestCapital || metrics.latestCapital <= 0) {
    return { level: "ok", message: null, warnAt, dangerAt, target };
  }
  const pct = Number(metrics.avgRiskPct) || 0;
  const openRisk = Number(metrics.openRisk) || 0;
  const openCount = Array.isArray(metrics.open) ? metrics.open.length : 0;
  const fmtPct = pct.toFixed(2);
  const inrRisk = `₹${Math.round(openRisk).toLocaleString("en-IN")}`;
  const tradeWord = openCount === 1 ? "trade" : "trades";

  // Tail copy that explains where the threshold came from — makes the
  // banner self-documenting when the user starts wondering why it fired.
  const sourceSuffix =
    target > 0
      ? ` (${RISK_MULTIPLIERS.danger}× your ${target}% per-trade target).`
      : ` danger line.`;
  const warnSuffix =
    target > 0
      ? ` (${RISK_MULTIPLIERS.warn}× your ${target}% per-trade target).`
      : ` comfort threshold.`;

  if (pct >= dangerAt) {
    return {
      level: "danger",
      message:
        `Risk on open positions is ${fmtPct}% of capital (${inrRisk} across ${openCount} ${tradeWord}) ` +
        `— above the ${dangerAt}%${sourceSuffix} Consider trimming size.`,
      warnAt,
      dangerAt,
      target,
    };
  }
  if (pct >= warnAt) {
    return {
      level: "warn",
      message:
        `Risk on open positions is ${fmtPct}% of capital (${inrRisk} across ${openCount} ${tradeWord}) ` +
        `— above the ${warnAt}%${warnSuffix}`,
      warnAt,
      dangerAt,
      target,
    };
  }
  return { level: "ok", message: null, warnAt, dangerAt, target };
}

// The big aggregation. Returns every metric the dashboard tiles need.
export function computeMetrics(trades, settings) {
  const open = trades.filter((t) => t.status?.toLowerCase() === "open");
  const closed = trades.filter((t) => t.status?.toLowerCase() === "closed");

  // Open-side aggregations all use the STILL-OPEN qty (entry total − exited).
  // The exited portion has already been booked into Realized P&L; if we
  // multiplied by t.qty here we'd double-count partial exits in the tiles.
  const openPnl = open.reduce(
    (s, t) => s + (t.ltp ? (t.ltp - t.entryPrice) * openQty(t) : 0),
    0,
  );
  const capitalDeployed = open.reduce(
    (s, t) => s + t.entryPrice * openQty(t),
    0,
  );
  const latestCapital = resolveCapital(trades, settings);
  const capitalDeployedPct = latestCapital
    ? (capitalDeployed / latestCapital) * 100
    : 0;

  const openRisk = open.reduce(
    (s, t) => s + Math.max(0, (t.entryPrice - t.stopLoss) * openQty(t)),
    0,
  );
  const avgRiskPct = latestCapital ? (openRisk / latestCapital) * 100 : 0;

  // R-multiple per closed trade. Risk denominator uses entry total qty
  // (the position size you committed to when you accepted the SL); reward
  // numerator is leg-aware booked P&L so partial-marked-Closed trades
  // can't fake an inflated R by multiplying by entry qty they never sold.
  const rMultiples = closed
    .map((t) => {
      const risk = (t.entryPrice - t.stopLoss) * (Number(t.qty) || 0);
      const reward = realizedPnl(t);
      if (!risk) return null;
      return reward / risk;
    })
    .filter((v) => v !== null && Number.isFinite(v));

  const avgR =
    rMultiples.length > 0
      ? rMultiples.reduce((s, v) => s + v, 0) / rMultiples.length
      : 0;

  // Realized P&L: profit/loss BOOKED, i.e. cash actually taken off the table.
  // Counts every exit leg across ALL trades (open + closed) — partial exits
  // on a still-open position are real money in your pocket and must show up.
  // Win-rate is computed over fully-closed trades only — a partially exited
  // open trade hasn't resolved yet, so it doesn't count as a win/loss.
  let realized = 0;
  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const t of trades) {
    realized += realizedPnl(t);
  }
  for (const t of closed) {
    // Win/loss attribution is per closed trade — same leg-aware rule.
    const pnl = realizedPnl(t);
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
    realizedPnl: realized,
    winRate,
    wins,
    grossProfit,
    grossLoss,
  };
}

// Tri-state sort: when key or dir is falsy, returns a copy of the input
// untouched (so callers can fall back to whatever order the caller-supplied
// trades came in — e.g. closedSorted by exit date).
// Strings compare case-insensitively via localeCompare. Missing values
// (null / undefined / "" / non-finite numbers) sort to the end regardless
// of direction so the user can still see them but they don't pollute the
// "best/worst" view.
export function sortTrades(trades, key, dir) {
  const list = Array.isArray(trades) ? trades : [];
  if (!key || !dir) return list.slice();
  const mult = dir === "desc" ? -1 : 1;
  const isMissing = (v) =>
    v == null ||
    v === "" ||
    (typeof v === "number" && !Number.isFinite(v));
  return list.slice().sort((a, b) => {
    const av = a == null ? undefined : a[key];
    const bv = b == null ? undefined : b[key];
    const am = isMissing(av);
    const bm = isMissing(bv);
    if (am && bm) return 0;
    if (am) return 1;
    if (bm) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * mult;
    }
    return (
      String(av)
        .toLowerCase()
        .localeCompare(String(bv).toLowerCase()) * mult
    );
  });
}

// Filter trades by a set of optional criteria.
// - symbol: case-insensitive substring (matches anywhere in the ticker)
// - marketCondition / strategy: exact-string match (drop-down equality)
// - mistake: exact match against ANY entry in the comma-separated mistakes list
// Empty/falsy values for any criterion skip that filter; an empty filters
// object returns the input list (shallow-copied) unchanged.
export function filterTrades(trades, filters) {
  const list = Array.isArray(trades) ? trades : [];
  if (!filters) return list.slice();
  const symbolNeedle = String(filters.symbol || "").trim().toLowerCase();
  const marketCondition = String(filters.marketCondition || "").trim();
  const strategy = String(filters.strategy || "").trim();
  const mistakeNeedle = String(filters.mistake || "").trim();
  if (!symbolNeedle && !marketCondition && !strategy && !mistakeNeedle) {
    return list.slice();
  }
  return list.filter((t) => {
    if (!t) return false;
    if (
      symbolNeedle &&
      !String(t.symbol || "").toLowerCase().includes(symbolNeedle)
    ) {
      return false;
    }
    if (marketCondition && t.marketCondition !== marketCondition) return false;
    if (strategy && t.strategy !== strategy) return false;
    if (mistakeNeedle) {
      const tokens = String(t.mistakes || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!tokens.includes(mistakeNeedle)) return false;
    }
    return true;
  });
}

// Compute count / win-rate / avg-R over an array of closed trades.
// Used by the per-symbol breakdown tables.
//
// Reward is leg-aware via realizedPnl(): for a fully-closed multi-leg
// trade this matches (exitPrice − entry) × qty, but for a partial-closed
// trade marked Closed (exits.qty < entries.qty) it correctly uses the
// summed leg P&L instead of the over-counting flat formula.
//
// Risk denominator stays on entry total qty — the position size you
// committed to when you accepted the stop loss.
export function aggregateClosed(trades) {
  const list = Array.isArray(trades) ? trades : [];
  const n = list.length;
  if (n === 0) return { n: 0, winRate: 0, avgR: 0 };
  let wins = 0;
  let rSum = 0;
  let rCount = 0;
  for (const t of list) {
    const risk = (Number(t.entryPrice) - Number(t.stopLoss)) * (Number(t.qty) || 0);
    const reward = realizedPnl(t);
    if (reward > 0) wins++;
    if (risk > 0 && Number.isFinite(reward / risk)) {
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
