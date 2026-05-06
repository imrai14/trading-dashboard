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
