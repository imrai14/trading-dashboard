// Unit tests for the pure helpers exported from SwingTracker.js. These
// guard the ledger math the dashboard depends on — leg cleaning, weighted
// averages, age calculations, capital resolution. computeMetrics has its
// own dedicated suite (swingMetrics.test.js).
import {
  cleanLegs,
  summarizeLegs,
  daysBetween,
  tradeAge,
  resolveCapital,
  aggregateClosed,
  sortTrades,
  filterTrades,
  exitQty,
  openQty,
  realizedPnl,
  validateTradeDates,
  assessRisk,
  RISK_THRESHOLDS,
  RISK_MULTIPLIERS,
  equityCurve,
} from "./swingMath";

describe("cleanLegs", () => {
  test("returns empty array for null/undefined/empty input", () => {
    expect(cleanLegs(null)).toEqual([]);
    expect(cleanLegs(undefined)).toEqual([]);
    expect(cleanLegs([])).toEqual([]);
  });

  test("coerces numeric strings to numbers", () => {
    expect(
      cleanLegs([{ price: "100.5", qty: "50", date: "2025-01-01" }]),
    ).toEqual([{ price: 100.5, qty: 50, date: "2025-01-01" }]);
  });

  test("filters out legs with zero or negative price", () => {
    const out = cleanLegs([
      { price: 100, qty: 10, date: "" },
      { price: 0, qty: 10, date: "" },
      { price: -5, qty: 10, date: "" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe(100);
  });

  test("filters out legs with zero or negative qty", () => {
    const out = cleanLegs([
      { price: 100, qty: 10, date: "" },
      { price: 100, qty: 0, date: "" },
      { price: 100, qty: -10, date: "" },
    ]);
    expect(out).toHaveLength(1);
  });

  test("drops legs with non-numeric price/qty (parseFloat → NaN → 0)", () => {
    const out = cleanLegs([
      { price: "abc", qty: 10 },
      { price: 100, qty: "xyz" },
    ]);
    expect(out).toEqual([]);
  });

  test("preserves missing date as empty string", () => {
    const out = cleanLegs([{ price: 100, qty: 10 }]);
    expect(out[0].date).toBe("");
  });
});

describe("summarizeLegs", () => {
  test("returns zeros for empty input", () => {
    expect(summarizeLegs([])).toEqual({
      totalQty: 0,
      avg: 0,
      lastDate: "",
      count: 0,
    });
  });

  test("computes weighted average across multiple legs", () => {
    // 100@50 + 100@60 → avg 55, qty 200, notional 11000
    const out = summarizeLegs([
      { price: 50, qty: 100, date: "2025-01-01" },
      { price: 60, qty: 100, date: "2025-01-05" },
    ]);
    expect(out.avg).toBe(55);
    expect(out.totalQty).toBe(200);
    expect(out.count).toBe(2);
  });

  test("weighted average is qty-weighted, not arithmetic mean", () => {
    // 10@100 + 90@200 → arithmetic mean would be 150, weighted is 190
    const out = summarizeLegs([
      { price: 100, qty: 10, date: "" },
      { price: 200, qty: 90, date: "" },
    ]);
    expect(out.avg).toBe(190);
  });

  test("lastDate picks the latest leg date", () => {
    const out = summarizeLegs([
      { price: 100, qty: 10, date: "2025-01-15" },
      { price: 100, qty: 10, date: "2025-01-01" },
      { price: 100, qty: 10, date: "2025-01-10" },
    ]);
    expect(out.lastDate).toBe("2025-01-15");
  });

  test("lastDate handles legs with missing dates gracefully", () => {
    const out = summarizeLegs([
      { price: 100, qty: 10, date: "" },
      { price: 100, qty: 10, date: "2025-01-15" },
    ]);
    expect(out.lastDate).toBe("2025-01-15");
  });

  test("ignores invalid legs when computing the summary", () => {
    const out = summarizeLegs([
      { price: 100, qty: 10, date: "2025-01-01" },
      { price: 0, qty: 100, date: "2099-01-01" }, // dropped
    ]);
    expect(out.avg).toBe(100);
    expect(out.totalQty).toBe(10);
    expect(out.lastDate).toBe("2025-01-01");
  });
});

describe("daysBetween", () => {
  test("returns null for missing 'from'", () => {
    expect(daysBetween("", "2025-01-10")).toBeNull();
    expect(daysBetween(null, "2025-01-10")).toBeNull();
  });

  test("computes whole days between two ISO dates", () => {
    expect(daysBetween("2025-01-01", "2025-01-10")).toBe(9);
  });

  test("returns 0 for the same day", () => {
    expect(daysBetween("2025-01-15", "2025-01-15")).toBe(0);
  });

  test("clamps negative spans to 0 (exit before entry would be a data bug)", () => {
    expect(daysBetween("2025-02-01", "2025-01-01")).toBe(0);
  });

  test("uses today when 'to' is null", () => {
    // We can't pin the system clock cheaply, so just assert sign + non-negative.
    const days = daysBetween("2024-01-01", null);
    expect(days).not.toBeNull();
    expect(days).toBeGreaterThanOrEqual(0);
  });

  test("returns null when either date is unparseable", () => {
    expect(daysBetween("not-a-date", "2025-01-10")).toBeNull();
    expect(daysBetween("2025-01-01", "garbage")).toBeNull();
  });
});

describe("tradeAge", () => {
  test("uses today for open trades", () => {
    const age = tradeAge({ status: "Open", date: "2024-01-01" });
    expect(age).toBeGreaterThanOrEqual(0);
  });

  test("uses exitDate for closed trades", () => {
    expect(
      tradeAge({
        status: "Closed",
        date: "2025-01-01",
        exitDate: "2025-01-15",
      }),
    ).toBe(14);
  });

  test("is case-insensitive on status", () => {
    const age = tradeAge({ status: "OPEN", date: "2024-01-01" });
    expect(age).toBeGreaterThanOrEqual(0);
  });

  test("returns null if entry date is missing", () => {
    expect(tradeAge({ status: "Open", date: "" })).toBeNull();
  });
});

describe("resolveCapital", () => {
  test("prefers settings.totalCapital when present", () => {
    expect(
      resolveCapital(
        [{ totalCapital: "999" }],
        { totalCapital: 500000 },
      ),
    ).toBe(500000);
  });

  test("falls back to most recent trade's totalCapital", () => {
    expect(
      resolveCapital(
        [
          { totalCapital: "100000" },
          { totalCapital: "200000" },
          { totalCapital: "" },
        ],
        {},
      ),
    ).toBe(200000); // last non-zero, scanning from the end
  });

  test("scans from the end and skips empty/zero capital", () => {
    expect(
      resolveCapital(
        [
          { totalCapital: "300000" },
          { totalCapital: "" },
          { totalCapital: "0" },
        ],
        {},
      ),
    ).toBe(300000);
  });

  test("returns 0 when nothing usable exists", () => {
    expect(resolveCapital([], {})).toBe(0);
    expect(resolveCapital([{ totalCapital: "" }], {})).toBe(0);
    expect(resolveCapital([{ totalCapital: "abc" }], null)).toBe(0);
  });

  test("treats settings.totalCapital === 0 as missing and falls back", () => {
    expect(
      resolveCapital(
        [{ totalCapital: "100000" }],
        { totalCapital: 0 },
      ),
    ).toBe(100000);
  });

  test("survives null settings", () => {
    expect(resolveCapital([{ totalCapital: "100" }], null)).toBe(100);
  });
});

describe("aggregateClosed", () => {
  test("returns zero stats for empty input", () => {
    expect(aggregateClosed([])).toEqual({ n: 0, winRate: 0, avgR: 0 });
  });

  test("counts only positive-reward trades as wins", () => {
    const out = aggregateClosed([
      { entryPrice: 100, exitPrice: 110, qty: 10, stopLoss: 95 }, // win
      { entryPrice: 100, exitPrice: 90, qty: 10, stopLoss: 95 }, // loss
      { entryPrice: 100, exitPrice: 100, qty: 10, stopLoss: 95 }, // breakeven (not win)
    ]);
    expect(out.n).toBe(3);
    expect(out.winRate).toBeCloseTo(33.33, 1);
  });

  test("computes mean R-multiple", () => {
    // R = reward/risk per trade
    const out = aggregateClosed([
      // risk = (100-95)*10 = 50, reward = (110-100)*10 = 100, R = 2
      { entryPrice: 100, exitPrice: 110, qty: 10, stopLoss: 95 },
      // risk = (200-180)*5 = 100, reward = (220-200)*5 = 100, R = 1
      { entryPrice: 200, exitPrice: 220, qty: 5, stopLoss: 180 },
    ]);
    expect(out.avgR).toBeCloseTo(1.5, 5);
  });

  test("skips trades with zero risk when averaging R", () => {
    const out = aggregateClosed([
      // No SL set — risk would be 0, R undefined, must be skipped
      { entryPrice: 100, exitPrice: 110, qty: 10, stopLoss: 100 },
      // Valid R = 2
      { entryPrice: 100, exitPrice: 110, qty: 10, stopLoss: 95 },
    ]);
    expect(out.avgR).toBeCloseTo(2, 5);
    expect(out.n).toBe(2); // n still counts the trade though
  });

  test("returns avgR=0 when every trade has zero risk", () => {
    const out = aggregateClosed([
      { entryPrice: 100, exitPrice: 120, qty: 10, stopLoss: 100 },
    ]);
    expect(out.avgR).toBe(0);
  });

  test("guards against infinite R from zero-risk trade with positive reward", () => {
    // entryPrice == stopLoss, but reward exists. risk computed as 0,
    // so the contribution must NOT be added; isFinite check catches it.
    const out = aggregateClosed([
      { entryPrice: 100, exitPrice: 110, qty: 10, stopLoss: 100 },
      { entryPrice: 100, exitPrice: 110, qty: 10, stopLoss: 95 }, // R = 2
    ]);
    expect(out.avgR).toBeCloseTo(2, 5);
  });
});

describe("exitQty / openQty", () => {
  test("exitQty returns 0 for trade with no exits array", () => {
    expect(exitQty({ qty: 100 })).toBe(0);
    expect(exitQty({ qty: 100, exits: null })).toBe(0);
    expect(exitQty({ qty: 100, exits: [] })).toBe(0);
  });

  test("exitQty sums leg qty across all exit legs", () => {
    expect(
      exitQty({
        qty: 200,
        exits: [
          { price: 110, qty: 50 },
          { price: 120, qty: 30 },
        ],
      }),
    ).toBe(80);
  });

  test("exitQty coerces numeric strings", () => {
    expect(exitQty({ qty: 100, exits: [{ qty: "40" }, { qty: "10" }] })).toBe(50);
  });

  test("exitQty skips malformed legs without crashing", () => {
    expect(
      exitQty({
        exits: [{ qty: 30 }, null, { qty: "abc" }, { qty: 20 }],
      }),
    ).toBe(50);
  });

  test("exitQty handles null/undefined trade input", () => {
    expect(exitQty(null)).toBe(0);
    expect(exitQty(undefined)).toBe(0);
  });

  test("openQty equals total entry qty when nothing is sold yet", () => {
    expect(openQty({ qty: 180, exits: [] })).toBe(180);
  });

  test("openQty subtracts the exited portion (partial exit)", () => {
    // DALMIA-style: 180 bought, 80 sold → 100 still open.
    expect(
      openQty({ qty: 180, exits: [{ price: 373.6, qty: 80 }] }),
    ).toBe(100);
  });

  test("openQty is 0 for a fully-closed trade (sum of exit qty = entry qty)", () => {
    expect(
      openQty({
        qty: 200,
        exits: [
          { price: 110, qty: 100 },
          { price: 120, qty: 100 },
        ],
      }),
    ).toBe(0);
  });

  test("openQty clamps to 0 if exits accidentally exceed entry qty (data error)", () => {
    expect(
      openQty({ qty: 100, exits: [{ price: 50, qty: 150 }] }),
    ).toBe(0);
  });

  test("openQty handles legacy single-leg-synth exit (whole position sold)", () => {
    // After normalizeTrade, legacy closed rows look like exits=[{qty: legacyQty}]
    // so openQty falls out to 0 — the synthesized leg matches entry total.
    expect(
      openQty({ qty: 50, exits: [{ price: 110, qty: 50 }] }),
    ).toBe(0);
  });

  test("openQty handles null/undefined trade gracefully", () => {
    expect(openQty(null)).toBe(0);
    expect(openQty(undefined)).toBe(0);
  });
});

describe("sortTrades", () => {
  const trades = [
    { symbol: "RELIANCE", entryPrice: 1200, qty: 10 },
    { symbol: "tcs",      entryPrice: 3500, qty: 5 },
    { symbol: "INFY",     entryPrice: 1500, qty: 20 },
  ];

  test("returns a copy of the input when key/dir is missing", () => {
    const out = sortTrades(trades, "", "");
    expect(out).toEqual(trades);
    expect(out).not.toBe(trades); // shallow copy, not same ref
  });

  test("returns a copy when only key is given but no direction", () => {
    expect(sortTrades(trades, "symbol", "")).toEqual(trades);
  });

  test("returns a copy when only direction is given but no key", () => {
    expect(sortTrades(trades, "", "asc")).toEqual(trades);
  });

  test("sorts strings ascending case-insensitively", () => {
    const out = sortTrades(trades, "symbol", "asc");
    expect(out.map((t) => t.symbol)).toEqual(["INFY", "RELIANCE", "tcs"]);
  });

  test("sorts strings descending case-insensitively", () => {
    const out = sortTrades(trades, "symbol", "desc");
    expect(out.map((t) => t.symbol)).toEqual(["tcs", "RELIANCE", "INFY"]);
  });

  test("sorts numeric fields ascending", () => {
    const out = sortTrades(trades, "entryPrice", "asc");
    expect(out.map((t) => t.entryPrice)).toEqual([1200, 1500, 3500]);
  });

  test("sorts numeric fields descending", () => {
    const out = sortTrades(trades, "entryPrice", "desc");
    expect(out.map((t) => t.entryPrice)).toEqual([3500, 1500, 1200]);
  });

  test("does not mutate the input array", () => {
    const original = [...trades];
    sortTrades(trades, "symbol", "asc");
    expect(trades).toEqual(original);
  });

  test("missing values sort to the end (ascending)", () => {
    const out = sortTrades(
      [{ qty: 10 }, { qty: null }, { qty: 5 }, { qty: undefined }, { qty: "" }],
      "qty",
      "asc",
    );
    expect(out.map((t) => t.qty)).toEqual([5, 10, null, undefined, ""]);
  });

  test("missing values sort to the end (descending)", () => {
    const out = sortTrades(
      [{ qty: 10 }, { qty: null }, { qty: 5 }],
      "qty",
      "desc",
    );
    expect(out.map((t) => t.qty)).toEqual([10, 5, null]);
  });

  test("non-finite numbers (NaN / Infinity) are treated as missing", () => {
    const out = sortTrades(
      [{ pnl: 100 }, { pnl: NaN }, { pnl: -50 }, { pnl: Infinity }],
      "pnl",
      "asc",
    );
    expect(out.map((t) => t.pnl)).toEqual([-50, 100, NaN, Infinity]);
  });

  test("empty input returns empty array", () => {
    expect(sortTrades([], "symbol", "asc")).toEqual([]);
  });

  test("non-array input is treated as empty", () => {
    expect(sortTrades(null, "symbol", "asc")).toEqual([]);
    expect(sortTrades(undefined, "symbol", "asc")).toEqual([]);
  });

  test("rows with null trade entry are skipped safely", () => {
    // Don't crash if the trade list has a null/undefined slot.
    const out = sortTrades([{ symbol: "B" }, null, { symbol: "A" }], "symbol", "asc");
    expect(out[0].symbol).toBe("A");
    expect(out[1].symbol).toBe("B");
  });
});

describe("filterTrades", () => {
  const trades = [
    {
      symbol: "RELIANCE",
      marketCondition: "Trending",
      strategy: "Breakout",
      mistakes: "FOMO,Late Entry",
    },
    {
      symbol: "TCS",
      marketCondition: "Sideways",
      strategy: "Reversal",
      mistakes: "",
    },
    {
      symbol: "INFY",
      marketCondition: "Trending",
      strategy: "VWAP",
      mistakes: "No SL",
    },
  ];

  test("returns a copy of input when filters is null/empty", () => {
    expect(filterTrades(trades, null)).toEqual(trades);
    expect(filterTrades(trades, {})).toEqual(trades);
    expect(filterTrades(trades, { symbol: "" })).toEqual(trades);
  });

  test("symbol filter is case-insensitive substring match", () => {
    expect(filterTrades(trades, { symbol: "rel" }).map((t) => t.symbol)).toEqual([
      "RELIANCE",
    ]);
    expect(filterTrades(trades, { symbol: "I" }).map((t) => t.symbol)).toEqual([
      "RELIANCE",
      "INFY",
    ]);
  });

  test("marketCondition filter is exact match", () => {
    expect(
      filterTrades(trades, { marketCondition: "Trending" }).map((t) => t.symbol),
    ).toEqual(["RELIANCE", "INFY"]);
  });

  test("strategy filter is exact match", () => {
    expect(filterTrades(trades, { strategy: "VWAP" }).map((t) => t.symbol)).toEqual([
      "INFY",
    ]);
  });

  test("mistake filter matches any token in the comma-separated list", () => {
    expect(filterTrades(trades, { mistake: "FOMO" }).map((t) => t.symbol)).toEqual([
      "RELIANCE",
    ]);
    expect(filterTrades(trades, { mistake: "No SL" }).map((t) => t.symbol)).toEqual([
      "INFY",
    ]);
  });

  test("multiple criteria are AND-combined", () => {
    expect(
      filterTrades(trades, {
        marketCondition: "Trending",
        strategy: "Breakout",
      }).map((t) => t.symbol),
    ).toEqual(["RELIANCE"]);
  });

  test("empty trades list returns empty list", () => {
    expect(filterTrades([], { symbol: "X" })).toEqual([]);
  });

  test("non-array input is treated as empty list", () => {
    expect(filterTrades(null, { symbol: "X" })).toEqual([]);
  });

  test("does not mutate the input array", () => {
    const snapshot = JSON.parse(JSON.stringify(trades));
    filterTrades(trades, { symbol: "rel", strategy: "Breakout" });
    expect(trades).toEqual(snapshot);
  });

  test("trims whitespace around symbol query", () => {
    expect(filterTrades(trades, { symbol: "  TCS  " }).map((t) => t.symbol)).toEqual([
      "TCS",
    ]);
  });

  test("symbol filter returns empty when no match", () => {
    expect(filterTrades(trades, { symbol: "XXX" })).toEqual([]);
  });
});

describe("realizedPnl", () => {
  test("returns 0 for null/undefined trade", () => {
    expect(realizedPnl(null)).toBe(0);
    expect(realizedPnl(undefined)).toBe(0);
  });

  test("returns 0 for an Open trade with no exits booked", () => {
    expect(
      realizedPnl({ status: "Open", entryPrice: 100, qty: 50, exits: [] }),
    ).toBe(0);
  });

  test("leg-aware sum when exit-leg JSON is present (multi-leg full close)", () => {
    // entry avg 55, exits 70×150 + 80×50 → (70-55)*150 + (80-55)*50 = 2250+1250 = 3500
    expect(
      realizedPnl({
        entryPrice: 55,
        qty: 200,
        exits: [
          { price: 70, qty: 150 },
          { price: 80, qty: 50 },
        ],
      }),
    ).toBe(3500);
  });

  test("leg-aware sum when partial exit on still-Open trade", () => {
    // 200 bought @ 100, sold 50 @ 120 → realized 1000 (only the 50 sold count)
    expect(
      realizedPnl({
        status: "Open",
        entryPrice: 100,
        qty: 200,
        exits: [{ price: 120, qty: 50 }],
      }),
    ).toBe(1000);
  });

  test("PARTIAL-MARKED-CLOSED uses leg sum, NOT (exit-entry)*qty", () => {
    // The bug being fixed. entry 50, qty 200, sold only 100 @ 70 then marked Closed.
    // Old (buggy) formula: (70-50)*200 = 4000. Correct: (70-50)*100 = 2000.
    expect(
      realizedPnl({
        status: "Closed",
        entryPrice: 50,
        qty: 200,
        exitPrice: 70,
        exits: [{ price: 70, qty: 100 }],
      }),
    ).toBe(2000);
  });

  test("legacy closed row (no leg JSON) falls back to (exitPrice − entry) × qty", () => {
    expect(
      realizedPnl({
        status: "Closed",
        entryPrice: 100,
        qty: 50,
        exitPrice: 110,
        exits: [],
      }),
    ).toBe(500);
  });

  test("returns 0 when neither leg JSON nor a positive legacy exitPrice exists", () => {
    expect(
      realizedPnl({ status: "Closed", entryPrice: 100, qty: 50, exits: [] }),
    ).toBe(0);
  });

  test("supports negative realized P&L (booked loss)", () => {
    expect(
      realizedPnl({
        entryPrice: 100,
        qty: 50,
        exits: [{ price: 80, qty: 50 }],
      }),
    ).toBe(-1000);
  });

  test("coerces numeric strings in legs", () => {
    expect(
      realizedPnl({
        entryPrice: 100,
        qty: 10,
        exits: [{ price: "110", qty: "10" }],
      }),
    ).toBe(100);
  });

  test("skips malformed legs without crashing", () => {
    // null leg + non-numeric values are tolerated.
    expect(
      realizedPnl({
        entryPrice: 100,
        qty: 30,
        exits: [
          { price: 110, qty: 10 }, // +100
          null,
          { price: "abc", qty: 10 }, // 0 (non-numeric)
          { price: 120, qty: 10 }, // +200
        ],
      }),
    ).toBe(300);
  });
});

describe("aggregateClosed — leg-aware reward", () => {
  // Targets the Bug #3 fix: avgR / wins use leg-aware booked P&L instead
  // of the over-counting (exitPrice − entry) × qty flat formula.

  test("partial-marked-Closed trade: avgR uses leg sum / risk(entryQty), not flat", () => {
    // Entry 100 × 200 (risk = 5*200 = 1000). Sold only 100 @ 110.
    // Reward (correct) = (110-100)*100 = 1000. R = 1000/1000 = 1.
    // Old (buggy) would compute reward (110-100)*200 = 2000 → R = 2.
    const out = aggregateClosed([
      {
        entryPrice: 100,
        qty: 200,
        stopLoss: 95,
        exitPrice: 110,
        exits: [{ price: 110, qty: 100 }],
      },
    ]);
    expect(out.avgR).toBeCloseTo(1, 5);
  });

  test("partial-marked-Closed loss: counted as loss, not win", () => {
    // 200 bought, sold only 100 @ 95. Realized = (95-100)*100 = -500 (loss).
    // Old buggy: (95-100)*200 = -1000 → still a loss but value wrong.
    const out = aggregateClosed([
      {
        entryPrice: 100,
        qty: 200,
        stopLoss: 95,
        exitPrice: 95,
        exits: [{ price: 95, qty: 100 }],
      },
    ]);
    expect(out.n).toBe(1);
    expect(out.winRate).toBe(0);
  });

  test("multi-leg fully-closed trade: leg sum equals (exit-entry) × qty", () => {
    // entry 50, qty 100, exits sum to 100, weighted-avg exit = 65 → reward 1500
    // risk = (50-45)*100 = 500 → R = 3
    const out = aggregateClosed([
      {
        entryPrice: 50,
        qty: 100,
        stopLoss: 45,
        exits: [
          { price: 60, qty: 50 }, // +500
          { price: 70, qty: 50 }, // +1000
        ],
      },
    ]);
    expect(out.n).toBe(1);
    expect(out.winRate).toBe(100);
    expect(out.avgR).toBeCloseTo(3, 5);
  });

  test("non-array input returns the zero stats shape", () => {
    expect(aggregateClosed(null)).toEqual({ n: 0, winRate: 0, avgR: 0 });
    expect(aggregateClosed(undefined)).toEqual({ n: 0, winRate: 0, avgR: 0 });
  });
});

describe("validateTradeDates", () => {
  // Tests pin "today" so they're deterministic regardless of when run.
  const today = "2025-06-15";

  test("returns null for an empty form", () => {
    expect(validateTradeDates({}, { today })).toBeNull();
    expect(validateTradeDates(null, { today })).toBeNull();
  });

  test("returns null when all leg dates are valid", () => {
    expect(
      validateTradeDates(
        {
          entries: [{ price: 100, qty: 10, date: "2025-06-10" }],
          exits: [{ price: 110, qty: 10, date: "2025-06-12" }],
        },
        { today },
      ),
    ).toBeNull();
  });

  test("flags a future entry leg date", () => {
    const err = validateTradeDates(
      {
        entries: [{ price: 100, qty: 10, date: "2025-12-31" }],
        exits: [],
      },
      { today },
    );
    expect(err).toMatch(/future/i);
    expect(err).toContain("2025-12-31");
  });

  test("flags a future exit leg date", () => {
    const err = validateTradeDates(
      {
        entries: [{ price: 100, qty: 10, date: "2025-06-01" }],
        exits: [{ price: 110, qty: 10, date: "2025-12-31" }],
      },
      { today },
    );
    expect(err).toMatch(/future/i);
  });

  test("flags an exit date earlier than the earliest entry date", () => {
    const err = validateTradeDates(
      {
        entries: [
          { price: 100, qty: 10, date: "2025-06-01" },
          { price: 105, qty: 10, date: "2025-06-05" },
        ],
        exits: [{ price: 110, qty: 10, date: "2025-05-20" }],
      },
      { today },
    );
    expect(err).toMatch(/earlier/i);
    expect(err).toContain("2025-05-20");
    expect(err).toContain("2025-06-01");
  });

  test("ignores legs with empty date fields", () => {
    expect(
      validateTradeDates(
        {
          entries: [{ price: 100, qty: 10, date: "" }],
          exits: [{ price: 110, qty: 10, date: "" }],
        },
        { today },
      ),
    ).toBeNull();
  });

  test("allows same-day exit (sold the day you bought)", () => {
    expect(
      validateTradeDates(
        {
          entries: [{ price: 100, qty: 10, date: "2025-06-10" }],
          exits: [{ price: 110, qty: 10, date: "2025-06-10" }],
        },
        { today },
      ),
    ).toBeNull();
  });

  test("allows today's date (boundary case)", () => {
    expect(
      validateTradeDates(
        {
          entries: [{ price: 100, qty: 10, date: today }],
          exits: [],
        },
        { today },
      ),
    ).toBeNull();
  });

  test("ignores null legs without crashing", () => {
    expect(
      validateTradeDates(
        {
          entries: [null, { price: 100, qty: 10, date: "2025-06-10" }],
          exits: [null],
        },
        { today },
      ),
    ).toBeNull();
  });

  test("uses real clock when no override provided (smoke test)", () => {
    // Just confirm the default-today path doesn't crash. Pick a date in the
    // past so it must validate as OK regardless of when the test runs.
    expect(
      validateTradeDates({
        entries: [{ price: 100, qty: 10, date: "2020-01-01" }],
        exits: [],
      }),
    ).toBeNull();
  });
});

describe("assessRisk — fallback thresholds (no per-trade target set)", () => {
  const cap = 1_000_000;
  const noTarget = { totalCapital: cap, riskPerTradePct: 0 };

  test("returns ok+null when capital is missing or zero", () => {
    expect(assessRisk(null, noTarget)).toMatchObject({
      level: "ok",
      message: null,
    });
    expect(
      assessRisk({ latestCapital: 0, avgRiskPct: 99 }, noTarget),
    ).toMatchObject({ level: "ok", message: null });
    expect(assessRisk({ avgRiskPct: 99 }, noTarget)).toMatchObject({
      level: "ok",
      message: null,
    });
  });

  test("returns ok+null when avgRiskPct is below the warn threshold", () => {
    const out = assessRisk(
      {
        latestCapital: cap,
        avgRiskPct: RISK_THRESHOLDS.warn - 0.01,
        openRisk: 19000,
        open: [{}, {}],
      },
      noTarget,
    );
    expect(out.level).toBe("ok");
    expect(out.message).toBeNull();
  });

  test("returns warn at the fallback warn threshold (2%)", () => {
    const out = assessRisk(
      {
        latestCapital: cap,
        avgRiskPct: RISK_THRESHOLDS.warn,
        openRisk: 20000,
        open: [{}, {}],
      },
      noTarget,
    );
    expect(out.level).toBe("warn");
    expect(out.message).toMatch(/comfort threshold/i);
    expect(out.message).toContain("2.00%");
    expect(out.warnAt).toBe(RISK_THRESHOLDS.warn);
    expect(out.dangerAt).toBe(RISK_THRESHOLDS.danger);
  });

  test("returns danger at the fallback danger threshold (5%)", () => {
    const out = assessRisk(
      {
        latestCapital: cap,
        avgRiskPct: RISK_THRESHOLDS.danger,
        openRisk: 50000,
        open: [{}, {}, {}],
      },
      noTarget,
    );
    expect(out.level).toBe("danger");
    expect(out.message).toMatch(/danger line/i);
    expect(out.message).toMatch(/trim/i);
    expect(out.message).toContain("3 trades");
  });

  test("singular 'trade' when openCount === 1", () => {
    const out = assessRisk(
      {
        latestCapital: cap,
        avgRiskPct: 12.5,
        openRisk: 125000,
        open: [{}],
      },
      noTarget,
    );
    expect(out.message).toContain("1 trade");
    expect(out.message).not.toContain("1 trades");
  });

  test("rounds INR figure for readability", () => {
    const out = assessRisk(
      {
        latestCapital: cap,
        avgRiskPct: 2.5,
        openRisk: 25437.86,
        open: [{}],
      },
      noTarget,
    );
    expect(out.message).toContain("25,438");
  });

  test("undefined settings argument behaves like no-target fallback", () => {
    // Backwards-compat: callers that haven't been updated yet still work.
    const out = assessRisk({
      latestCapital: cap,
      avgRiskPct: 3.0,
      openRisk: 30000,
      open: [{}],
    });
    expect(out.warnAt).toBe(RISK_THRESHOLDS.warn);
    expect(out.dangerAt).toBe(RISK_THRESHOLDS.danger);
    expect(out.level).toBe("warn");
  });
});

describe("assessRisk — target-scaled thresholds (Risk % set in Settings)", () => {
  const cap = 1_000_000;

  test("with target=1%, warn fires at 3% and danger at 6%", () => {
    const settings = { totalCapital: cap, riskPerTradePct: 1 };
    // Below warn
    expect(
      assessRisk(
        { latestCapital: cap, avgRiskPct: 2.99, openRisk: 29900, open: [{}] },
        settings,
      ).level,
    ).toBe("ok");
    // At warn (3%)
    expect(
      assessRisk(
        { latestCapital: cap, avgRiskPct: 3, openRisk: 30000, open: [{}] },
        settings,
      ).level,
    ).toBe("warn");
    // Between warn and danger
    expect(
      assessRisk(
        { latestCapital: cap, avgRiskPct: 4.5, openRisk: 45000, open: [{}] },
        settings,
      ).level,
    ).toBe("warn");
    // At danger (6%)
    expect(
      assessRisk(
        { latestCapital: cap, avgRiskPct: 6, openRisk: 60000, open: [{}] },
        settings,
      ).level,
    ).toBe("danger");
  });

  test("with target=2%, warn fires at 6% and danger at 12%", () => {
    const settings = { totalCapital: cap, riskPerTradePct: 2 };
    expect(
      assessRisk(
        { latestCapital: cap, avgRiskPct: 5.99, openRisk: 59900, open: [{}] },
        settings,
      ).level,
    ).toBe("ok");
    expect(
      assessRisk(
        { latestCapital: cap, avgRiskPct: 6, openRisk: 60000, open: [{}] },
        settings,
      ).level,
    ).toBe("warn");
    expect(
      assessRisk(
        { latestCapital: cap, avgRiskPct: 12, openRisk: 120000, open: [{}] },
        settings,
      ).level,
    ).toBe("danger");
  });

  test("returned warnAt / dangerAt reflect the scaled values", () => {
    const out = assessRisk(
      { latestCapital: cap, avgRiskPct: 0, openRisk: 0, open: [] },
      { totalCapital: cap, riskPerTradePct: 1.5 },
    );
    expect(out.warnAt).toBe(1.5 * RISK_MULTIPLIERS.warn);
    expect(out.dangerAt).toBe(1.5 * RISK_MULTIPLIERS.danger);
    expect(out.target).toBe(1.5);
  });

  test("warn message references the per-trade target as the source", () => {
    const out = assessRisk(
      {
        latestCapital: cap,
        avgRiskPct: 4,
        openRisk: 40000,
        open: [{}, {}],
      },
      { totalCapital: cap, riskPerTradePct: 1 },
    );
    expect(out.level).toBe("warn");
    expect(out.message).toMatch(/3× your 1% per-trade target/i);
  });

  test("danger message references the per-trade target as the source", () => {
    const out = assessRisk(
      {
        latestCapital: cap,
        avgRiskPct: 7,
        openRisk: 70000,
        open: [{}, {}, {}],
      },
      { totalCapital: cap, riskPerTradePct: 1 },
    );
    expect(out.level).toBe("danger");
    expect(out.message).toMatch(/6× your 1% per-trade target/i);
    expect(out.message).toMatch(/trim/i);
  });

  test("zero / negative / non-numeric target falls back to hardcoded thresholds", () => {
    const m = {
      latestCapital: cap,
      avgRiskPct: 3,
      openRisk: 30000,
      open: [{}],
    };
    // 0 → fallback (3% > 2% warn-fallback → warn)
    expect(
      assessRisk(m, { riskPerTradePct: 0 }).warnAt,
    ).toBe(RISK_THRESHOLDS.warn);
    expect(
      assessRisk(m, { riskPerTradePct: -1 }).warnAt,
    ).toBe(RISK_THRESHOLDS.warn);
    expect(
      assessRisk(m, { riskPerTradePct: "abc" }).warnAt,
    ).toBe(RISK_THRESHOLDS.warn);
  });
});

describe("equityCurve", () => {
  test("returns empty array for empty input", () => {
    expect(equityCurve([])).toEqual([]);
    expect(equityCurve(null)).toEqual([]);
    expect(equityCurve(undefined)).toEqual([]);
  });

  test("returns empty array when nothing has been exited yet", () => {
    expect(
      equityCurve([
        { entryPrice: 100, qty: 10, status: "Open", exits: [] },
      ]),
    ).toEqual([]);
  });

  test("buckets exit legs by their leg date", () => {
    const out = equityCurve([
      {
        entryPrice: 100,
        qty: 100,
        exits: [
          { price: 110, qty: 50, date: "2025-01-10" }, // +500
          { price: 120, qty: 50, date: "2025-01-15" }, // +1000
        ],
      },
    ]);
    expect(out).toEqual([
      { date: "2025-01-10", daily: 500, cumulative: 500 },
      { date: "2025-01-15", daily: 1000, cumulative: 1500 },
    ]);
  });

  test("sums multiple legs that share the same date into one bucket", () => {
    const out = equityCurve([
      {
        entryPrice: 100,
        qty: 100,
        exits: [
          { price: 110, qty: 50, date: "2025-01-10" }, // +500
          { price: 105, qty: 50, date: "2025-01-10" }, // +250
        ],
      },
    ]);
    expect(out).toEqual([{ date: "2025-01-10", daily: 750, cumulative: 750 }]);
  });

  test("sorts dates chronologically regardless of input order", () => {
    const out = equityCurve([
      {
        entryPrice: 100,
        qty: 100,
        exits: [{ price: 120, qty: 50, date: "2025-03-01" }], // +1000
      },
      {
        entryPrice: 50,
        qty: 100,
        exits: [{ price: 60, qty: 50, date: "2025-01-01" }], // +500
      },
      {
        entryPrice: 200,
        qty: 50,
        exits: [{ price: 190, qty: 50, date: "2025-02-01" }], // -500
      },
    ]);
    expect(out.map((d) => d.date)).toEqual([
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
    ]);
    expect(out.map((d) => d.cumulative)).toEqual([500, 0, 1000]);
  });

  test("falls back to trade.exitDate, then trade.date, when leg date is missing", () => {
    const out = equityCurve([
      {
        entryPrice: 100,
        qty: 50,
        date: "2025-01-01",
        exitDate: "2025-02-01",
        exits: [{ price: 110, qty: 50, date: "" }], // uses exitDate
      },
    ]);
    expect(out).toEqual([{ date: "2025-02-01", daily: 500, cumulative: 500 }]);
  });

  test("legacy closed row (no leg JSON) attributes P&L to exitDate", () => {
    const out = equityCurve([
      {
        status: "Closed",
        entryPrice: 100,
        qty: 50,
        exitPrice: 90,
        exitDate: "2025-01-15",
        exits: [],
      },
    ]);
    expect(out).toEqual([
      { date: "2025-01-15", daily: -500, cumulative: -500 },
    ]);
  });

  test("legacy Open row with no exit data is silently skipped (no NaN)", () => {
    expect(
      equityCurve([
        {
          status: "Open",
          entryPrice: 100,
          qty: 50,
          exitPrice: 0,
          exits: [],
        },
      ]),
    ).toEqual([]);
  });

  test("partial exit on still-Open trade contributes only the booked portion", () => {
    const out = equityCurve([
      {
        status: "Open",
        entryPrice: 100,
        qty: 200,
        exits: [{ price: 120, qty: 50, date: "2025-02-15" }], // +1000
      },
    ]);
    expect(out).toEqual([
      { date: "2025-02-15", daily: 1000, cumulative: 1000 },
    ]);
  });

  test("cumulative sum can swing negative then back positive", () => {
    const out = equityCurve([
      {
        entryPrice: 100,
        qty: 100,
        exits: [{ price: 80, qty: 100, date: "2025-01-05" }], // -2000
      },
      {
        entryPrice: 50,
        qty: 100,
        exits: [{ price: 80, qty: 100, date: "2025-01-10" }], // +3000
      },
    ]);
    expect(out.map((d) => d.cumulative)).toEqual([-2000, 1000]);
  });

  test("skips malformed legs and null trades without crashing", () => {
    const out = equityCurve([
      null,
      {
        entryPrice: 100,
        qty: 30,
        exits: [
          null,
          { price: 110, qty: 10, date: "2025-01-01" }, // +100
          { price: "abc", qty: 10, date: "2025-01-01" }, // skipped
          { price: 0, qty: 10, date: "2025-01-01" }, // skipped (price 0)
        ],
      },
    ]);
    expect(out).toEqual([{ date: "2025-01-01", daily: 100, cumulative: 100 }]);
  });

  test("never includes LTP — purely realized P&L", () => {
    // Open trade with LTP set but no exits → must NOT appear on the curve.
    expect(
      equityCurve([
        { status: "Open", entryPrice: 100, qty: 50, ltp: 200, exits: [] },
      ]),
    ).toEqual([]);
  });
});
