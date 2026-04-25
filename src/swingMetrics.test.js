// Unit tests for computeMetrics — the central aggregation function powering
// the dashboard tiles. We seed synthetic trade arrays and assert that every
// derived metric (open P&L, capital deployed, risk on open, R-multiple,
// realized P&L, win rate) matches by hand-rolled math.
//
// Edge cases under test:
// - empty / no-trade portfolio
// - status casing variants (Open / OPEN / closed)
// - trades without LTP (open P&L should treat as 0, not NaN)
// - multi-leg full close (entries match exits)
// - multi-leg partial close marked Closed (qty mismatch — old bug)
// - partial exit on a still-open trade (must contribute to realized P&L)
// - legacy closed row with no leg JSON (fallback path)
// - mix of open/closed/legacy
// - stopLoss above entry (negative risk → must clamp to 0 in openRisk)
// - zero-risk trade (entry == SL) excluded from R average
// - sort order of closedSorted (newest first, by exit date then entry date)
// - capitalDeployedPct / avgRiskPct guard against zero-capital divide
import { computeMetrics } from "./swingMath";

const settings = { totalCapital: 1_000_000, riskPerTradePct: 1 };

// Convenience builders so tests read like trade ledgers, not blobs.
const open = (over = {}) => ({
  status: "Open",
  date: "2025-01-01",
  symbol: "X",
  entryPrice: 100,
  qty: 100,
  stopLoss: 95,
  exitPrice: 0,
  exitDate: "",
  ltp: 105,
  entries: [],
  exits: [],
  ...over,
});
const closed = (over = {}) => ({
  status: "Closed",
  date: "2025-01-01",
  symbol: "X",
  entryPrice: 100,
  qty: 100,
  stopLoss: 95,
  exitPrice: 110,
  exitDate: "2025-02-01",
  ltp: 0,
  entries: [],
  exits: [],
  ...over,
});

describe("computeMetrics — empty input", () => {
  test("zero trades returns zeros with empty arrays", () => {
    const m = computeMetrics([], settings);
    expect(m.open).toEqual([]);
    expect(m.closed).toEqual([]);
    expect(m.closedSorted).toEqual([]);
    expect(m.openPnl).toBe(0);
    expect(m.capitalDeployed).toBe(0);
    expect(m.capitalDeployedPct).toBe(0);
    expect(m.openRisk).toBe(0);
    expect(m.avgRiskPct).toBe(0);
    expect(m.avgR).toBe(0);
    expect(m.realizedPnl).toBe(0);
    expect(m.wins).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.grossProfit).toBe(0);
    expect(m.grossLoss).toBe(0);
    expect(m.latestCapital).toBe(1_000_000);
  });

  test("zero capital → percentage metrics safely default to 0 (no NaN)", () => {
    const m = computeMetrics(
      [open({ entryPrice: 100, qty: 100 })],
      { totalCapital: 0 },
    );
    expect(m.capitalDeployedPct).toBe(0);
    expect(m.avgRiskPct).toBe(0);
  });
});

describe("computeMetrics — status filtering", () => {
  test("filters open vs closed by case-insensitive status string", () => {
    const m = computeMetrics(
      [
        open({ status: "Open" }),
        open({ status: "OPEN" }),
        closed({ status: "Closed" }),
        closed({ status: "closed" }),
      ],
      settings,
    );
    expect(m.open).toHaveLength(2);
    expect(m.closed).toHaveLength(2);
  });

  test("ignores trades with unknown status (e.g. Cancelled)", () => {
    const m = computeMetrics(
      [
        open(),
        { ...open(), status: "Cancelled" },
        { ...open(), status: "" },
      ],
      settings,
    );
    expect(m.open).toHaveLength(1);
    expect(m.closed).toHaveLength(0);
  });
});

describe("computeMetrics — open P&L", () => {
  test("uses LTP × qty when LTP is present", () => {
    const m = computeMetrics(
      [open({ entryPrice: 100, qty: 100, ltp: 110 })],
      settings,
    );
    expect(m.openPnl).toBe(1000); // (110-100)*100
  });

  test("treats missing LTP as 0 contribution (no NaN propagation)", () => {
    const m = computeMetrics(
      [open({ entryPrice: 100, qty: 100, ltp: 0 })],
      settings,
    );
    expect(m.openPnl).toBe(0);
  });

  test("supports negative open P&L (loss on running position)", () => {
    const m = computeMetrics(
      [open({ entryPrice: 100, qty: 100, ltp: 90 })],
      settings,
    );
    expect(m.openPnl).toBe(-1000);
  });

  test("excludes closed trades from open P&L", () => {
    const m = computeMetrics(
      [open({ ltp: 110 }), closed({ ltp: 999 })],
      settings,
    );
    expect(m.openPnl).toBe(1000); // closed.ltp ignored
  });
});

describe("computeMetrics — capital deployed", () => {
  test("sums entryPrice × qty across open trades", () => {
    const m = computeMetrics(
      [
        open({ entryPrice: 100, qty: 50 }), // 5000
        open({ entryPrice: 200, qty: 20 }), // 4000
      ],
      settings,
    );
    expect(m.capitalDeployed).toBe(9000);
    expect(m.capitalDeployedPct).toBeCloseTo(0.9, 5);
  });

  test("excludes closed trades", () => {
    const m = computeMetrics(
      [open({ entryPrice: 100, qty: 50 }), closed({ entryPrice: 999, qty: 999 })],
      settings,
    );
    expect(m.capitalDeployed).toBe(5000);
  });
});

describe("computeMetrics — risk on open", () => {
  test("sums (entry - SL) × qty across open trades", () => {
    const m = computeMetrics(
      [
        open({ entryPrice: 100, qty: 50, stopLoss: 95 }), // risk 250
        open({ entryPrice: 200, qty: 10, stopLoss: 190 }), // risk 100
      ],
      settings,
    );
    expect(m.openRisk).toBe(350);
    expect(m.avgRiskPct).toBeCloseTo(0.035, 5);
  });

  test("clamps negative risk to 0 when SL is above entry (data error)", () => {
    const m = computeMetrics(
      [open({ entryPrice: 100, qty: 50, stopLoss: 110 })],
      settings,
    );
    expect(m.openRisk).toBe(0);
  });

  test("excludes closed trades", () => {
    const m = computeMetrics(
      [closed({ entryPrice: 100, qty: 50, stopLoss: 80 })],
      settings,
    );
    expect(m.openRisk).toBe(0);
  });
});

describe("computeMetrics — R-multiple (closed)", () => {
  test("averages R across closed trades", () => {
    const m = computeMetrics(
      [
        // risk = 5*10 = 50, reward = 10*10 = 100, R = 2
        closed({ entryPrice: 100, exitPrice: 110, qty: 10, stopLoss: 95 }),
        // risk = 20*5 = 100, reward = 20*5 = 100, R = 1
        closed({ entryPrice: 200, exitPrice: 220, qty: 5, stopLoss: 180 }),
      ],
      settings,
    );
    expect(m.avgR).toBeCloseTo(1.5, 5);
  });

  test("skips trades with zero risk (entry == SL)", () => {
    const m = computeMetrics(
      [
        closed({ entryPrice: 100, exitPrice: 110, qty: 10, stopLoss: 100 }), // skipped
        closed({ entryPrice: 100, exitPrice: 110, qty: 10, stopLoss: 95 }), // R=2
      ],
      settings,
    );
    expect(m.avgR).toBeCloseTo(2, 5);
  });

  test("avgR is 0 when no closed trades", () => {
    const m = computeMetrics([open()], settings);
    expect(m.avgR).toBe(0);
  });

  test("supports negative R (loss exceeded planned risk)", () => {
    const m = computeMetrics(
      [
        // risk = 5*10 = 50, reward = -20*10 = -200, R = -4
        closed({ entryPrice: 100, exitPrice: 80, qty: 10, stopLoss: 95 }),
      ],
      settings,
    );
    expect(m.avgR).toBeCloseTo(-4, 5);
  });
});

describe("computeMetrics — realized P&L (the booked-cash tile)", () => {
  test("zero when nothing has been exited", () => {
    const m = computeMetrics([open({ exits: [] })], settings);
    expect(m.realizedPnl).toBe(0);
  });

  test("multi-leg full close: equals sum of leg-level (exit-entry)*qty", () => {
    // Entry weighted avg: (50*100 + 60*100)/200 = 55
    // Exit legs: 150@70 + 50@80
    // Realized: (70-55)*150 + (80-55)*50 = 2250 + 1250 = 3500
    const m = computeMetrics(
      [
        closed({
          entryPrice: 55,
          qty: 200,
          exitPrice: 72.5,
          exits: [
            { price: 70, qty: 150 },
            { price: 80, qty: 50 },
          ],
        }),
      ],
      settings,
    );
    expect(m.realizedPnl).toBe(3500);
  });

  test("partial close marked Closed: uses exit-leg qty, not stored entry qty", () => {
    // Entry 200 shares @ 50, sold only 100 @ 70 but marked Closed.
    // Buggy old formula: (70-50)*200 = 4000. Correct: (70-50)*100 = 2000.
    const m = computeMetrics(
      [
        closed({
          entryPrice: 50,
          qty: 200,
          exitPrice: 70,
          exits: [{ price: 70, qty: 100 }],
        }),
      ],
      settings,
    );
    expect(m.realizedPnl).toBe(2000);
  });

  test("partial exit on still-Open trade contributes to realized P&L", () => {
    // The reported bug — partial exits while leaving status Open were
    // invisible. Must show booked profit even though trade is still Open.
    const m = computeMetrics(
      [
        open({
          entryPrice: 100,
          qty: 200,
          exits: [{ price: 120, qty: 50 }], // sold 50 of 200
        }),
      ],
      settings,
    );
    expect(m.realizedPnl).toBe(1000); // (120-100)*50
    expect(m.wins).toBe(0); // open trade not counted in win-rate
    expect(m.winRate).toBe(0);
  });

  test("multi-leg partial exit at different prices on open trade", () => {
    const m = computeMetrics(
      [
        open({
          entryPrice: 100,
          qty: 300,
          exits: [
            { price: 110, qty: 50 }, // +500
            { price: 120, qty: 50 }, // +1000
          ],
        }),
      ],
      settings,
    );
    expect(m.realizedPnl).toBe(1500);
  });

  test("legacy closed row (no exits[]) uses flat (exit-entry)*qty", () => {
    const m = computeMetrics(
      [
        closed({
          entryPrice: 100,
          qty: 50,
          exitPrice: 110,
          exits: [], // legacy — no leg JSON
        }),
      ],
      settings,
    );
    expect(m.realizedPnl).toBe(500);
  });

  test("legacy open row with no exits booked is silently 0 (no NaN)", () => {
    const m = computeMetrics(
      [open({ exits: [], exitPrice: 0 })],
      settings,
    );
    expect(m.realizedPnl).toBe(0);
  });

  test("mix of fully closed multi-leg + open with partial exit", () => {
    const m = computeMetrics(
      [
        closed({
          entryPrice: 50,
          qty: 100,
          exits: [{ price: 70, qty: 100 }],
        }), // +2000 win
        open({
          entryPrice: 200,
          qty: 100,
          exits: [{ price: 220, qty: 30 }],
        }), // +600 partial
      ],
      settings,
    );
    expect(m.realizedPnl).toBe(2600);
    expect(m.wins).toBe(1);
    expect(m.closed).toHaveLength(1);
  });

  test("supports net realized loss (negative value)", () => {
    const m = computeMetrics(
      [
        closed({
          entryPrice: 100,
          qty: 100,
          exits: [{ price: 80, qty: 100 }],
        }),
      ],
      settings,
    );
    expect(m.realizedPnl).toBe(-2000);
    expect(m.grossLoss).toBe(-2000);
    expect(m.grossProfit).toBe(0);
  });
});

describe("computeMetrics — wins / win rate / gross P&L", () => {
  test("counts only closed trades with positive P&L as wins", () => {
    const m = computeMetrics(
      [
        closed({
          entryPrice: 100,
          qty: 10,
          exits: [{ price: 110, qty: 10 }],
        }), // +100 win
        closed({
          entryPrice: 100,
          qty: 10,
          exits: [{ price: 90, qty: 10 }],
        }), // -100 loss
        closed({
          entryPrice: 100,
          qty: 10,
          exits: [{ price: 100, qty: 10 }],
        }), // 0 (breakeven, not a win)
      ],
      settings,
    );
    expect(m.wins).toBe(1);
    expect(m.winRate).toBeCloseTo(33.33, 1);
    expect(m.grossProfit).toBe(100);
    expect(m.grossLoss).toBe(-100);
  });

  test("does NOT count partial exits on open trades toward win-rate", () => {
    const m = computeMetrics(
      [
        open({
          entryPrice: 100,
          qty: 100,
          exits: [{ price: 200, qty: 50 }],
        }), // booked +5000 but trade still open
      ],
      settings,
    );
    expect(m.wins).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.realizedPnl).toBe(5000); // realized still reflects it
  });

  test("100% win rate when every closed trade is a winner", () => {
    const m = computeMetrics(
      [
        closed({
          entryPrice: 100,
          qty: 10,
          exits: [{ price: 110, qty: 10 }],
        }),
        closed({
          entryPrice: 100,
          qty: 10,
          exits: [{ price: 105, qty: 10 }],
        }),
      ],
      settings,
    );
    expect(m.winRate).toBe(100);
  });
});

describe("computeMetrics — closedSorted ordering", () => {
  test("sorts newest-first by exitDate", () => {
    const m = computeMetrics(
      [
        closed({ symbol: "OLD", exitDate: "2025-01-10" }),
        closed({ symbol: "NEW", exitDate: "2025-03-15" }),
        closed({ symbol: "MID", exitDate: "2025-02-20" }),
      ],
      settings,
    );
    expect(m.closedSorted.map((t) => t.symbol)).toEqual(["NEW", "MID", "OLD"]);
  });

  test("falls back to entry date when exitDate missing", () => {
    const m = computeMetrics(
      [
        closed({ symbol: "OLD", date: "2025-01-01", exitDate: "" }),
        closed({ symbol: "NEW", date: "2025-03-01", exitDate: "" }),
      ],
      settings,
    );
    expect(m.closedSorted[0].symbol).toBe("NEW");
  });

  test("does not mutate the original closed array", () => {
    const trades = [
      closed({ symbol: "OLD", exitDate: "2025-01-10" }),
      closed({ symbol: "NEW", exitDate: "2025-03-15" }),
    ];
    const m = computeMetrics(trades, settings);
    expect(trades[0].symbol).toBe("OLD"); // input untouched
    expect(m.closedSorted[0].symbol).toBe("NEW");
  });
});

describe("computeMetrics — latestCapital resolution", () => {
  test("uses settings.totalCapital when provided", () => {
    const m = computeMetrics([open()], { totalCapital: 750_000 });
    expect(m.latestCapital).toBe(750_000);
  });

  test("falls back to per-trade totalCapital when settings missing", () => {
    const m = computeMetrics(
      [{ ...open(), totalCapital: "250000" }],
      {},
    );
    expect(m.latestCapital).toBe(250_000);
  });

  test("falls back to 0 if neither has capital", () => {
    const m = computeMetrics([open()], {});
    expect(m.latestCapital).toBe(0);
    expect(m.capitalDeployedPct).toBe(0);
    expect(m.avgRiskPct).toBe(0);
  });
});

describe("computeMetrics — combined realistic scenario", () => {
  test("portfolio with 2 open + 2 closed across multi-leg states", () => {
    const m = computeMetrics(
      [
        // Open with partial exit booked
        open({
          symbol: "AAA",
          entryPrice: 100,
          qty: 100,
          stopLoss: 95,
          ltp: 110,
          exits: [{ price: 115, qty: 30 }], // realized +450
        }),
        // Open, no exits, just a runner
        open({
          symbol: "BBB",
          entryPrice: 200,
          qty: 50,
          stopLoss: 190,
          ltp: 205,
        }),
        // Closed multi-leg winner
        closed({
          symbol: "CCC",
          entryPrice: 50,
          qty: 100,
          stopLoss: 45,
          exits: [
            { price: 60, qty: 50 }, // +500
            { price: 70, qty: 50 }, // +1000
          ],
          exitDate: "2025-02-01",
        }),
        // Closed legacy loser (no exits[])
        closed({
          symbol: "DDD",
          entryPrice: 100,
          qty: 20,
          stopLoss: 95,
          exitPrice: 90,
          exits: [],
          exitDate: "2025-02-15",
        }),
      ],
      settings,
    );

    // Open P&L: AAA (110-100)*100 = 1000 + BBB (205-200)*50 = 250 → 1250
    expect(m.openPnl).toBe(1250);
    // Capital deployed: AAA 10000 + BBB 10000 = 20000
    expect(m.capitalDeployed).toBe(20000);
    // Risk on open: AAA (100-95)*100 = 500 + BBB (200-190)*50 = 500 → 1000
    expect(m.openRisk).toBe(1000);
    // Realized P&L: AAA partial +450 + CCC +1500 + DDD -200 = 1750
    expect(m.realizedPnl).toBe(1750);
    // Win-rate: 1 win (CCC) out of 2 closed = 50%
    expect(m.wins).toBe(1);
    expect(m.winRate).toBe(50);
    expect(m.grossProfit).toBe(1500);
    expect(m.grossLoss).toBe(-200);
    // closedSorted newest first
    expect(m.closedSorted[0].symbol).toBe("DDD"); // 2025-02-15
    expect(m.closedSorted[1].symbol).toBe("CCC"); // 2025-02-01
  });
});
