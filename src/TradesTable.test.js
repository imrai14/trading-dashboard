// Component tests for TradesTable. Drives the rendered table just like a
// user would: type into the symbol filter, pick a strategy from the
// dropdown, click a header to sort. Asserts the right rows survive.
//
// Possible thanks to the file extraction (#22) — TradesTable.js no longer
// imports anything from SwingTracker.js, so it loads cleanly under CRA's
// Jest without the react-router-dom v7 ESM blocker.

import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import TradesTable from "./TradesTable";

// Test trade factory — mirrors the shape produced by normalizeTrade so the
// component sees the same fields it would in production.
const trade = (over = {}) => ({
  _row: 0,
  date: "2025-01-15",
  symbol: "REL",
  status: "Open",
  entryPrice: 1000,
  qty: 50,
  stopLoss: 950,
  exitPrice: 0,
  exitDate: "",
  ltp: 1100,
  notes: "",
  marketCondition: "",
  strategy: "",
  chartLink: "",
  mistakes: "",
  entries: [{ price: 1000, qty: 50, date: "2025-01-15" }],
  exits: [],
  ...over,
});

const SAMPLE_TRADES = [
  trade({
    _row: 1,
    symbol: "RELIANCE",
    entryPrice: 1200,
    qty: 100,
    stopLoss: 1180,
    ltp: 1250,
    marketCondition: "Trending",
    strategy: "Breakout",
  }),
  trade({
    _row: 2,
    symbol: "TCS",
    entryPrice: 3500,
    qty: 10,
    stopLoss: 3400,
    ltp: 3550,
    marketCondition: "Sideways",
    strategy: "Reversal",
    mistakes: "FOMO",
  }),
  trade({
    _row: 3,
    symbol: "INFY",
    entryPrice: 1500,
    qty: 20,
    stopLoss: 1450,
    ltp: 1490,
    marketCondition: "Trending",
    strategy: "VWAP",
  }),
];

const renderTable = (props = {}) =>
  render(
    <TradesTable
      title="Open Positions"
      trades={SAMPLE_TRADES}
      capital={1_000_000}
      onEdit={() => {}}
      onDelete={() => {}}
      onQuickClose={() => {}}
      {...props}
    />,
  );

// Helpers — assertions are easier to read when keyed off symbol text.
// The symbol is rendered as a bare text node directly inside the first
// <td>, with the invested-amount + date as sibling <div>s. Reading
// firstChild.nodeValue gets just the ticker without the rest.
const symbolsInOrder = () =>
  screen
    .getAllByRole("row")
    .slice(1) // drop the header row
    .map((row) => {
      const firstTd = row.querySelector("td");
      const firstChild = firstTd && firstTd.firstChild;
      const text =
        (firstChild && (firstChild.nodeValue ?? firstChild.textContent)) || "";
      return text.trim();
    });

describe("TradesTable — render", () => {
  test("renders the title and one row per trade", () => {
    renderTable();
    expect(screen.getByText("Open Positions")).toBeInTheDocument();
    expect(symbolsInOrder()).toEqual(["RELIANCE", "TCS", "INFY"]);
  });

  test("shows the empty-state when no trades supplied", () => {
    renderTable({ trades: [] });
    expect(screen.getByText(/no trades yet/i)).toBeInTheDocument();
  });

  test("shows trade-count summary when no filter is applied", () => {
    renderTable();
    expect(screen.getByText("3 trades")).toBeInTheDocument();
  });

  test("renders one chip per attribute (market condition + strategy)", () => {
    renderTable();
    // Filter to spans only — `getAllByText("Trending")` would also match
    // the dropdown <option>s sharing the same label.
    const trendingChips = screen
      .getAllByText("Trending")
      .filter((el) => el.tagName === "SPAN");
    expect(trendingChips).toHaveLength(2); // RELIANCE + INFY
    expect(
      screen
        .getAllByText("Breakout")
        .filter((el) => el.tagName === "SPAN"),
    ).toHaveLength(1);
    expect(
      screen
        .getAllByText("VWAP")
        .filter((el) => el.tagName === "SPAN"),
    ).toHaveLength(1);
  });
});

describe("TradesTable — sort", () => {
  test("clicking the Symbol header sorts ascending then descending then clears", () => {
    renderTable();

    // Default order = caller order.
    expect(symbolsInOrder()).toEqual(["RELIANCE", "TCS", "INFY"]);

    // First click → ascending alphabetical.
    fireEvent.click(screen.getByText(/^Symbol/));
    expect(symbolsInOrder()).toEqual(["INFY", "RELIANCE", "TCS"]);

    // Second click → descending.
    fireEvent.click(screen.getByText(/^Symbol/));
    expect(symbolsInOrder()).toEqual(["TCS", "RELIANCE", "INFY"]);

    // Third click → cleared, restores caller order.
    fireEvent.click(screen.getByText(/^Symbol/));
    expect(symbolsInOrder()).toEqual(["RELIANCE", "TCS", "INFY"]);
  });

  test("clicking Entry sorts numerically", () => {
    renderTable();
    fireEvent.click(screen.getByText("Entry"));
    // Asc: 1200 (RELIANCE), 1500 (INFY), 3500 (TCS)
    expect(symbolsInOrder()).toEqual(["RELIANCE", "INFY", "TCS"]);
  });

  test("active sort header gains the up/down arrow", () => {
    renderTable();
    fireEvent.click(screen.getByText(/^Symbol/));
    expect(screen.getByText(/Symbol\s*▲/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Symbol/));
    expect(screen.getByText(/Symbol\s*▼/)).toBeInTheDocument();
  });
});

describe("TradesTable — filter", () => {
  test("typing into the Symbol filter narrows the table to substring matches", () => {
    renderTable();
    const input = screen.getByPlaceholderText(/filter by symbol/i);
    fireEvent.change(input, { target: { value: "I" } });
    // Substring "I" matches RELIANCE and INFY (case-insensitive).
    expect(symbolsInOrder()).toEqual(["RELIANCE", "INFY"]);
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  test("symbol filter is case-insensitive", () => {
    renderTable();
    fireEvent.change(screen.getByPlaceholderText(/filter by symbol/i), {
      target: { value: "tcs" },
    });
    expect(symbolsInOrder()).toEqual(["TCS"]);
  });

  test("Market Condition dropdown filters to exact match", () => {
    renderTable();
    const select = screen.getByDisplayValue("All Market");
    fireEvent.change(select, { target: { value: "Trending" } });
    expect(symbolsInOrder()).toEqual(["RELIANCE", "INFY"]);
  });

  test("Strategy dropdown filters to exact match", () => {
    renderTable();
    fireEvent.change(screen.getByDisplayValue("All Strategies"), {
      target: { value: "VWAP" },
    });
    expect(symbolsInOrder()).toEqual(["INFY"]);
  });

  test("Mistakes dropdown matches any token in the comma-separated list", () => {
    renderTable();
    fireEvent.change(screen.getByDisplayValue("All Mistakes"), {
      target: { value: "FOMO" },
    });
    expect(symbolsInOrder()).toEqual(["TCS"]);
  });

  test("filters are AND-combined", () => {
    renderTable();
    fireEvent.change(screen.getByDisplayValue("All Market"), {
      target: { value: "Trending" },
    });
    fireEvent.change(screen.getByDisplayValue("All Strategies"), {
      target: { value: "Breakout" },
    });
    expect(symbolsInOrder()).toEqual(["RELIANCE"]);
  });

  test("Clear button resets every filter and only appears when any is active", () => {
    renderTable();
    expect(screen.queryByText(/clear/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/filter by symbol/i), {
      target: { value: "rel" },
    });
    const clearBtn = screen.getByText(/clear/i);
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(symbolsInOrder()).toEqual(["RELIANCE", "TCS", "INFY"]);
    expect(screen.queryByText(/clear/i)).not.toBeInTheDocument();
  });

  test("zero-result state shows 'No trades match' inside the table body", () => {
    renderTable();
    fireEvent.change(screen.getByPlaceholderText(/filter by symbol/i), {
      target: { value: "ZZZ_NO_MATCH" },
    });
    expect(
      screen.getByText(/no trades match the current filters/i),
    ).toBeInTheDocument();
  });
});

describe("TradesTable — partial-exit Qty cell", () => {
  test("partial-exit Open trade shows live open qty + 'sold' subtitle", () => {
    renderTable({
      trades: [
        trade({
          _row: 9,
          symbol: "DALMIA",
          entryPrice: 380,
          qty: 180,
          exits: [{ price: 370, qty: 80, date: "2025-01-20" }],
        }),
      ],
    });
    // Live qty = 100 (180 − 80) shown in primary cell.
    const dalmiaRow = screen.getByText("DALMIA").closest("tr");
    expect(within(dalmiaRow).getByText("100")).toBeInTheDocument();
    // Subtitle shows the sold portion explicitly.
    expect(within(dalmiaRow).getByText(/80 of 180 sold/i)).toBeInTheDocument();
  });

  test("untouched Open trade has no 'sold' subtitle", () => {
    renderTable();
    const relRow = screen.getByText("RELIANCE").closest("tr");
    expect(within(relRow).queryByText(/sold/i)).not.toBeInTheDocument();
  });
});

describe("TradesTable — actions", () => {
  test("Edit button calls onEdit with the trade", () => {
    const onEdit = jest.fn();
    renderTable({ onEdit });
    const editButtons = screen.getAllByTitle(/edit/i);
    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0].symbol).toBe("RELIANCE");
  });
});
