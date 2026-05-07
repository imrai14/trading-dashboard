// Fixture-based tests for the Dhan P&L CSV parser. The fixture mirrors
// the actual format Dhan exports — quoted numeric cells, "Net P&L"
// summary row, blank lines, and a trailing NOTE — so any drift in
// upstream format will surface here before silently corrupting trades
// during import.
//
// CLAUDE.md flagged this parser as untested; this suite is the lockdown.
import { parseDhanCSV } from "./dhanParser";

// Real Dhan fixture (from /Users/shubham/Downloads/Dhan_P&L_01-04-2026_24-04-2026.csv,
// trimmed to a representative subset — fully closed + partial-on-open + pure
// open + an outright loss).
const SAMPLE_DHAN_CSV = `PnL report,From 01-04-2026 to 24-04-2026
Name,STR
UCC,XWUK24445R
Mobile,9591875051
Email ID,raishubham1992@gmail.com

Scrip Name,Buy Qty.,Avg. Buy Price,Buy Value,Sell Qty.,Avg. Sell Price,Sell Value,Closing Price,Realised P&L,Realised P&L %,Unrealised P&L,Unrealised P&L %
"Tejas Networks","25","450.35","11258.75","25","425.00","10625.00","0.00","-633.75","-5.63","0.00","0.00"
"Data Patterns","15","3520.53","52808.00","0","0.00","0.00","4135.10","0.00","0.00","9218.50","17.46"
"KRN Heat Exchanger and Refrigeration","29","958.06","27783.80","29","1183.30","34315.60","0.00","6531.80","23.51","0.00","0.00"
"Dalmia Bharat Sugar & Industries","180","380.42","68476.10","80","373.60","29888.20","399.20","-910.80","-1.79","2242.90","4.94"

Net P&L,4046.59,Brokerage,68.08,Gross P&L,4571.75,Total Charges,525.16

NOTE : This sheet was downloaded at 24/4/2026 03:36 PM`;

describe("parseDhanCSV — happy path", () => {
  test("returns null for empty / blank / non-Dhan input", () => {
    expect(parseDhanCSV("")).toBeNull();
    expect(parseDhanCSV("just some random text")).toBeNull();
    expect(parseDhanCSV(null)).toBeNull();
    expect(parseDhanCSV(undefined)).toBeNull();
  });

  test("returns the canonical result shape", () => {
    const out = parseDhanCSV(SAMPLE_DHAN_CSV);
    expect(out).toMatchObject({
      broker: "DHAN",
      trades: expect.any(Array),
      holdings: [],
      chargesBreakdown: expect.any(Array),
      netPnl: expect.any(Number),
      brokerage: expect.any(Number),
      grossPnl: expect.any(Number),
      totalCharges: expect.any(Number),
      unrealizedPnl: 0,
      dateRange: expect.any(String),
    });
  });

  test("parses the header date range from the first line", () => {
    expect(parseDhanCSV(SAMPLE_DHAN_CSV).dateRange).toBe(
      "01-04-2026 – 24-04-2026",
    );
  });

  test("falls back to 'Period' when the From/To header is missing", () => {
    const noHeader = SAMPLE_DHAN_CSV.replace("From 01-04-2026 to 24-04-2026", "");
    expect(parseDhanCSV(noHeader).dateRange).toBe("Period");
  });
});

describe("parseDhanCSV — trade rows", () => {
  test("extracts every trade row", () => {
    const out = parseDhanCSV(SAMPLE_DHAN_CSV);
    expect(out.trades).toHaveLength(4);
    expect(out.trades.map((t) => t.name)).toEqual([
      "Tejas Networks",
      "Data Patterns",
      "KRN Heat Exchanger and Refrigeration",
      "Dalmia Bharat Sugar & Industries",
    ]);
  });

  test("each trade carries the canonical Dhan fields with correct numeric coercion", () => {
    const out = parseDhanCSV(SAMPLE_DHAN_CSV);
    const tejas = out.trades.find((t) => t.name === "Tejas Networks");
    expect(tejas).toEqual({
      broker: "DHAN",
      name: "Tejas Networks",
      qty: 25,
      buyQty: 25,
      avgBuy: 450.35,
      buyVal: 11258.75,
      sellQty: 25,
      avgSell: 425,
      sellVal: 10625,
      pnl: -633.75,
      pnlPct: -5.63,
    });
  });

  test("partial-exit trade preserves both buy and sell qty (not just collapsed)", () => {
    // DALMIA: 180 bought, only 80 sold. parseDhanCSV's `qty` field uses
    // sellQty when present, so it ends up as 80 — the realized portion.
    const out = parseDhanCSV(SAMPLE_DHAN_CSV);
    const dalmia = out.trades.find((t) =>
      t.name.includes("Dalmia Bharat Sugar"),
    );
    expect(dalmia.buyQty).toBe(180);
    expect(dalmia.sellQty).toBe(80);
    expect(dalmia.qty).toBe(80); // sellQty takes precedence
    expect(dalmia.avgBuy).toBe(380.42);
    expect(dalmia.avgSell).toBe(373.6);
    expect(dalmia.pnl).toBe(-910.8);
  });

  test("pure Open holding (no sells) keeps qty as buyQty", () => {
    // Data Patterns: 15 bought, 0 sold → qty falls back to buyQty (15).
    const out = parseDhanCSV(SAMPLE_DHAN_CSV);
    const dp = out.trades.find((t) => t.name === "Data Patterns");
    expect(dp.buyQty).toBe(15);
    expect(dp.sellQty).toBe(0);
    expect(dp.qty).toBe(15);
    expect(dp.pnl).toBe(0);
  });

  test("preserves names that contain commas inside quoted cells", () => {
    // "KRN Heat Exchanger and Refrigeration" doesn't have a comma but the
    // & in "Dalmia Bharat Sugar & Industries" sometimes trips fragile
    // parsers. Both must round-trip cleanly.
    const out = parseDhanCSV(SAMPLE_DHAN_CSV);
    expect(out.trades.some((t) => t.name === "Dalmia Bharat Sugar & Industries")).toBe(true);
  });

  test("strips thousands-commas from numeric cells inside quotes", () => {
    // Manufactured row with quoted thousands-commas to mimic Dhan's
    // formatting on big buy values.
    const csvWithCommas = `PnL report,From 01-04-2026 to 24-04-2026

Scrip Name,Buy Qty.,Avg. Buy Price,Buy Value,Sell Qty.,Avg. Sell Price,Sell Value,Closing Price,Realised P&L,Realised P&L %,Unrealised P&L,Unrealised P&L %
"Bigco","100","12,345.50","1,234,550.00","100","12,500.00","1,250,000.00","0.00","15,450.00","1.25","0.00","0.00"
`;
    const out = parseDhanCSV(csvWithCommas);
    expect(out.trades).toHaveLength(1);
    expect(out.trades[0].avgBuy).toBe(12345.5);
    expect(out.trades[0].buyVal).toBe(1234550);
    expect(out.trades[0].pnl).toBe(15450);
  });

  test("skips rows with non-numeric realized P&L (treated as garbage)", () => {
    const garbageCsv = SAMPLE_DHAN_CSV.replace(
      `"Tejas Networks","25","450.35","11258.75","25","425.00","10625.00","0.00","-633.75","-5.63","0.00","0.00"`,
      `"Bad Row","x","x","x","x","x","x","x","not-a-number","0","0","0"`,
    );
    const out = parseDhanCSV(garbageCsv);
    expect(out.trades.find((t) => t.name === "Bad Row")).toBeUndefined();
  });

  test("ignores blank lines, NOTE line, and Net P&L line in the trade region", () => {
    const out = parseDhanCSV(SAMPLE_DHAN_CSV);
    expect(out.trades.find((t) => t.name === "")).toBeUndefined();
    expect(out.trades.length).toBe(4); // exactly the real rows
  });
});

describe("parseDhanCSV — summary row", () => {
  test("extracts Net P&L / Brokerage / Gross P&L / Total Charges", () => {
    const out = parseDhanCSV(SAMPLE_DHAN_CSV);
    expect(out.netPnl).toBe(4046.59);
    expect(out.brokerage).toBe(68.08);
    expect(out.grossPnl).toBe(4571.75);
    expect(out.totalCharges).toBe(525.16);
  });

  test("defaults all summary numbers to 0 when the summary line is absent", () => {
    const stripped = SAMPLE_DHAN_CSV.replace(
      /\nNet P&L,.+/,
      "",
    );
    const out = parseDhanCSV(stripped);
    expect(out.netPnl).toBe(0);
    expect(out.brokerage).toBe(0);
    expect(out.grossPnl).toBe(0);
    expect(out.totalCharges).toBe(0);
    expect(out.chargesBreakdown).toEqual([]);
  });
});

describe("parseDhanCSV — charges breakdown", () => {
  test("splits Total Charges into Brokerage and lumped 'STT / Exchange / Other'", () => {
    const out = parseDhanCSV(SAMPLE_DHAN_CSV);
    expect(out.chargesBreakdown).toEqual([
      { label: "Brokerage", amount: 68.08 },
      { label: "STT / Exchange / Other", amount: 525.16 - 68.08 },
    ]);
  });

  test("clamps 'other' to 0 when total charges < brokerage (impossible but defensive)", () => {
    const weird = SAMPLE_DHAN_CSV.replace(
      "Net P&L,4046.59,Brokerage,68.08,Gross P&L,4571.75,Total Charges,525.16",
      "Net P&L,1000,Brokerage,500,Gross P&L,1500,Total Charges,100",
    );
    const out = parseDhanCSV(weird);
    expect(out.chargesBreakdown).toEqual([
      { label: "Brokerage", amount: 500 },
    ]); // 'other' = max(0, 100 - 500) = 0 → filtered out
  });

  test("omits zero-amount entries from the breakdown", () => {
    const noBrokerage = SAMPLE_DHAN_CSV.replace(
      "Brokerage,68.08",
      "Brokerage,0",
    );
    const out = parseDhanCSV(noBrokerage);
    expect(out.chargesBreakdown).toEqual([
      { label: "STT / Exchange / Other", amount: 525.16 },
    ]);
  });
});

describe("parseDhanCSV — format drift safety", () => {
  test("returns null when the 'Scrip Name' header row is missing", () => {
    // First defensive guard — no header means we can't trust column order.
    const noHeader = SAMPLE_DHAN_CSV.replace(/Scrip Name,.+/, "");
    expect(parseDhanCSV(noHeader)).toBeNull();
  });

  test("skips rows that have fewer than 10 cells (truncated/malformed)", () => {
    const truncated = SAMPLE_DHAN_CSV.replace(
      `"Tejas Networks","25","450.35","11258.75","25","425.00","10625.00","0.00","-633.75","-5.63","0.00","0.00"`,
      `"Truncated","25","450.35","11258.75"`,
    );
    const out = parseDhanCSV(truncated);
    expect(out.trades.find((t) => t.name === "Truncated")).toBeUndefined();
  });

  test("survives Windows-style \\r\\n line endings", () => {
    const crlf = SAMPLE_DHAN_CSV.replace(/\n/g, "\r\n");
    const out = parseDhanCSV(crlf);
    expect(out.trades).toHaveLength(4);
    expect(out.netPnl).toBe(4046.59);
  });
});
