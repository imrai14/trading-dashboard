// Unit tests for googleSheets.js — focused on the pure normalization
// functions. Network functions (fetchAll, addTrade, …) are thin wrappers
// over fetch() and aren't worth a brittle mock; the value is in proving
// that arbitrary, messy sheet rows get coerced into the trade shape the
// rest of the app expects.
import {
  normalizeTrade,
  normalizeSettings,
  loadConfig,
  saveConfig,
  clearConfig,
} from "./googleSheets";

describe("normalizeTrade", () => {
  // ---------- Required-field shape ----------
  test("returns the canonical trade shape for a minimal row", () => {
    const t = normalizeTrade({
      _row: 5,
      Symbol: "RELIANCE",
      Status: "Open",
    });
    expect(t).toMatchObject({
      _row: 5,
      symbol: "RELIANCE",
      status: "Open",
      entryPrice: 0,
      qty: 0,
      stopLoss: 0,
      target: 0,
      exitPrice: 0,
      exitDate: "",
      ltp: 0,
      notes: "",
      marketCondition: "",
      chartLink: "",
      mistakes: "",
      entries: [],
      exits: [],
    });
  });

  // ---------- Number coercion ----------
  test("coerces numeric strings", () => {
    const t = normalizeTrade({
      Symbol: "TCS",
      "Entry Price": "3500.5",
      Qty: "10",
      "Stop Loss": "3400",
      LTP: "3550",
    });
    expect(t.entryPrice).toBe(3500.5);
    expect(t.qty).toBe(10);
    expect(t.stopLoss).toBe(3400);
    expect(t.ltp).toBe(3550);
  });

  test("treats empty / null / undefined numerics as 0", () => {
    const t = normalizeTrade({
      Symbol: "X",
      "Entry Price": "",
      Qty: null,
      "Stop Loss": undefined,
      LTP: "",
    });
    expect(t.entryPrice).toBe(0);
    expect(t.qty).toBe(0);
    expect(t.stopLoss).toBe(0);
    expect(t.ltp).toBe(0);
  });

  test("treats non-numeric garbage as 0", () => {
    const t = normalizeTrade({ Symbol: "X", "Entry Price": "abc", Qty: "NaN" });
    expect(t.entryPrice).toBe(0);
    expect(t.qty).toBe(0);
  });

  test("accepts native numbers without re-parsing", () => {
    const t = normalizeTrade({ Symbol: "X", "Entry Price": 100, Qty: 50 });
    expect(t.entryPrice).toBe(100);
    expect(t.qty).toBe(50);
  });

  // ---------- Date coercion ----------
  test("passes through ISO yyyy-mm-dd dates", () => {
    const t = normalizeTrade({ Symbol: "X", Date: "2025-01-15" });
    expect(t.date).toBe("2025-01-15");
  });

  test("trims off the time component of an ISO datetime", () => {
    const t = normalizeTrade({ Symbol: "X", Date: "2025-01-15T10:30:00.000Z" });
    expect(t.date).toBe("2025-01-15");
  });

  test("converts a Date object to yyyy-mm-dd", () => {
    const t = normalizeTrade({ Symbol: "X", Date: new Date("2025-03-20") });
    expect(t.date).toBe("2025-03-20");
  });

  test("returns empty string when date is missing", () => {
    const t = normalizeTrade({ Symbol: "X" });
    expect(t.date).toBe("");
  });

  test("keeps unrecognized date strings verbatim", () => {
    const t = normalizeTrade({ Symbol: "X", Date: "not-a-date" });
    expect(t.date).toBe("not-a-date");
  });

  // ---------- String fallback ----------
  test("string fields fall back to empty string when missing", () => {
    const t = normalizeTrade({ _row: 1 });
    expect(t.symbol).toBe("");
    expect(t.status).toBe("Open");
    expect(t.notes).toBe("");
    expect(t.marketCondition).toBe("");
    expect(t.chartLink).toBe("");
    expect(t.mistakes).toBe("");
  });

  test("coerces non-string symbols to string", () => {
    const t = normalizeTrade({ Symbol: 12345 });
    expect(t.symbol).toBe("12345");
  });

  // ---------- Multi-leg parsing ----------
  test("parses Entries/Exits JSON arrays", () => {
    const t = normalizeTrade({
      Symbol: "X",
      Entries: JSON.stringify([
        { price: 100, qty: 50, date: "2025-01-01" },
        { price: 110, qty: 50, date: "2025-01-05" },
      ]),
      Exits: JSON.stringify([{ price: 130, qty: 100, date: "2025-02-01" }]),
    });
    expect(t.entries).toHaveLength(2);
    expect(t.exits).toHaveLength(1);
    expect(t.entries[0]).toEqual({
      price: 100,
      qty: 50,
      date: "2025-01-01",
    });
  });

  test("accepts already-parsed leg arrays (when sheet returns JSON)", () => {
    const t = normalizeTrade({
      Symbol: "X",
      Entries: [{ price: 100, qty: 50, date: "2025-01-01" }],
    });
    expect(t.entries).toEqual([
      { price: 100, qty: 50, date: "2025-01-01" },
    ]);
  });

  test("filters out invalid legs (zero / missing price or qty)", () => {
    const t = normalizeTrade({
      Symbol: "X",
      Entries: JSON.stringify([
        { price: 100, qty: 50, date: "2025-01-01" }, // valid
        { price: 0, qty: 50, date: "2025-01-02" }, // zero price → drop
        { price: 110, qty: 0, date: "2025-01-03" }, // zero qty → drop
        { price: "abc", qty: "abc", date: "2025-01-04" }, // garbage → drop
      ]),
    });
    expect(t.entries).toHaveLength(1);
    expect(t.entries[0].price).toBe(100);
  });

  test("returns empty array when leg JSON is malformed", () => {
    const t = normalizeTrade({ Symbol: "X", Entries: "{not json" });
    expect(t.entries).toEqual([]);
  });

  test("returns empty array when leg JSON is not an array", () => {
    const t = normalizeTrade({ Symbol: "X", Entries: '{"oops":"object"}' });
    expect(t.entries).toEqual([]);
  });

  // ---------- Legacy fallback (no leg JSON) ----------
  test("synthesizes a single entry leg from legacy flat columns", () => {
    const t = normalizeTrade({
      Symbol: "X",
      Date: "2025-01-15",
      "Entry Price": "100",
      Qty: "50",
    });
    expect(t.entries).toEqual([
      { price: 100, qty: 50, date: "2025-01-15" },
    ]);
  });

  test("synthesizes a single exit leg from legacy flat columns", () => {
    const t = normalizeTrade({
      Symbol: "X",
      Date: "2025-01-15",
      "Entry Price": "100",
      Qty: "50",
      "Exit Price": "120",
      "Exit Date": "2025-02-01",
    });
    expect(t.exits).toEqual([
      { price: 120, qty: 50, date: "2025-02-01" },
    ]);
  });

  test("does NOT synthesize legs when no flat data either", () => {
    const t = normalizeTrade({ Symbol: "X" });
    expect(t.entries).toEqual([]);
    expect(t.exits).toEqual([]);
  });

  test("does NOT synthesize entry leg when entry price is 0", () => {
    const t = normalizeTrade({
      Symbol: "X",
      "Entry Price": "0",
      Qty: "50",
    });
    expect(t.entries).toEqual([]);
  });

  test("preserves leg JSON over legacy columns when both are present", () => {
    const t = normalizeTrade({
      Symbol: "X",
      "Entry Price": "999",
      Qty: "999",
      Entries: JSON.stringify([{ price: 100, qty: 50, date: "2025-01-01" }]),
    });
    expect(t.entries).toHaveLength(1);
    expect(t.entries[0].price).toBe(100); // not 999
  });
});

describe("normalizeSettings", () => {
  test("returns zeros for empty settings object", () => {
    expect(normalizeSettings({})).toEqual({
      totalCapital: 0,
      riskPerTradePct: 0,
    });
  });

  test("coerces string values", () => {
    expect(
      normalizeSettings({ totalCapital: "500000", riskPerTradePct: "1.5" }),
    ).toEqual({ totalCapital: 500000, riskPerTradePct: 1.5 });
  });

  test("treats missing fields as 0", () => {
    expect(normalizeSettings({ totalCapital: 100000 })).toEqual({
      totalCapital: 100000,
      riskPerTradePct: 0,
    });
  });

  test("guards against NaN", () => {
    expect(
      normalizeSettings({ totalCapital: "abc", riskPerTradePct: "xyz" }),
    ).toEqual({ totalCapital: 0, riskPerTradePct: 0 });
  });
});

describe("config persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("loadConfig returns empty config when nothing stored", () => {
    expect(loadConfig()).toEqual({ url: "", secret: "" });
  });

  test("saveConfig + loadConfig round-trips", () => {
    saveConfig({ url: "https://x", secret: "s3cr3t" });
    expect(loadConfig()).toEqual({ url: "https://x", secret: "s3cr3t" });
  });

  test("clearConfig removes the entry", () => {
    saveConfig({ url: "https://x", secret: "y" });
    clearConfig();
    expect(loadConfig()).toEqual({ url: "", secret: "" });
  });

  test("loadConfig recovers from corrupted JSON", () => {
    localStorage.setItem("tradescope:swing:config:v1", "{not json");
    expect(loadConfig()).toEqual({ url: "", secret: "" });
  });
});
