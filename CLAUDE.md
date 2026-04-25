# TradeScope — AI Agent Context

> **Purpose of this file.** Claude Code and other AI agents auto-load `CLAUDE.md`. It tells future agents what this project is, how it's wired, and the non-obvious rules they must follow when modifying it. Read this first before touching code.

---

## What this project is

A React + Google Sheets swing-trading journal. Two routes:

| Route | File | Purpose |
|---|---|---|
| `/` | `src/App.js` | P&L Dashboard — charts, CSV import (Dhan broker), aggregate stats |
| `/swing` | `src/SwingTracker.js` | Swing Tracker — add/edit/close trades, multi-leg entries & exits, live LTP via GOOGLEFINANCE |

There is **no traditional backend**. A Google Apps Script web app fronts a Google Sheet. The browser POSTs JSON (as `text/plain` to skip CORS preflight). Live prices are pulled in-sheet via the `GOOGLEFINANCE()` formula.

For the architecture diagram and data-flow diagrams, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Repo layout (only the parts that matter)

```
src/
├── index.js                 # CRA entry — mounts <App />
├── App.js                   # Dashboard route + CSV import + brand shell
├── SwingTracker.js          # Swing-trade UI: form, table, tiles, LegEditor
├── swingMath.js             # PURE LOGIC — every metric/aggregation lives here
├── googleSheets.js          # Apps Script client + normalizeTrade/Settings
├── appsScriptCode.js        # Backend code as a string constant (copy-paste setup)
├── googleSheets.test.js     # Jest — sheet-row normalization + config persistence
├── swingHelpers.test.js     # Jest — leg/date/capital helpers
├── swingMetrics.test.js     # Jest — computeMetrics edge cases (THE big suite)
└── setupTests.js            # @testing-library/jest-dom matchers
```

**Hard rule:** all pure logic (math, normalization, aggregation) lives in `swingMath.js` and `googleSheets.js`. Never inline math inside React components — it can't be unit-tested without dragging in `react-router-dom@7` (which CRA's Jest can't transform). See [Testing rules](#testing-rules) below.

---

## The trade data model

A trade row, after `normalizeTrade()`, looks like this:

```js
{
  _row: 5,                // row index in the sheet (for update/delete)
  date: "2025-01-15",     // earliest entry-leg date
  symbol: "RELIANCE",
  status: "Open",         // "Open" | "Closed" (case-insensitive in code)
  entryPrice: 1234.5,     // weighted-avg of entry legs
  qty: 100,               // total entry qty
  stopLoss: 1180,
  exitPrice: 1300,        // weighted-avg of exit legs (0 if not exited)
  exitDate: "2025-02-01", // last exit-leg date
  ltp: 1290,              // live, populated by GOOGLEFINANCE in the sheet
  notes, marketCondition, chartLink, mistakes,
  entries: [{ price, qty, date }, ...],   // canonical multi-leg data
  exits:   [{ price, qty, date }, ...],
}
```

### Invariants you must preserve

1. **`entryPrice` and `qty` are derived from `entries`.** Never set them independently.
2. **`exitPrice` is the weighted-avg of `exits`.** Same.
3. **A "Closed" trade may have `exits.totalQty != entries.totalQty`** (partial close marked Closed). All math must handle this.
4. **Legacy rows have empty `entries`/`exits` arrays** but valid flat columns. `normalizeTrade` synthesizes a single leg from the flat columns; metric code falls back to the flat formula. Never break this fallback path.

---

## Realized P&L — the rule that bit us twice

Realized P&L (the booked-cash tile) must reflect **every exit leg across ALL trades, open and closed**.

- A partial exit on an Open trade *is* booked profit. It must appear.
- For each exit leg: `realized += (legPrice − weightedEntryAvg) × legQty`.
- For legacy closed rows with no `exits[]`: fall back to `(exitPrice − entryPrice) × qty`.
- Open trades with no exits booked → 0 contribution (do **not** propagate NaN).

Win-rate is computed *only* over fully-Closed trades. A partially-exited Open trade hasn't resolved yet; it is not a win or a loss.

This is implemented in `swingMath.js → computeMetrics()` and locked down by `swingMetrics.test.js`. Do not regress.

---

## Testing rules (non-negotiable)

> **Every PR must run `npm test -- --watchAll=false` and end with all tests passing.** No exceptions, no `it.skip`, no `--testPathIgnorePatterns`. If a test is wrong, fix the test in the same PR with a comment explaining why.

### When you change something, you must update tests

| If you change… | You must update / add tests in… |
|---|---|
| Anything in `swingMath.js` | `swingHelpers.test.js` and/or `swingMetrics.test.js` |
| `normalizeTrade` / `normalizeSettings` in `googleSheets.js` | `googleSheets.test.js` |
| The trade shape (new field, renamed field) | `googleSheets.test.js` (round-trip) **and** every metric test that references the field |
| Apps Script backend (`appsScriptCode.js`) | Manually re-deploy and smoke-test against a staging sheet — backend is not unit-tested |
| Add a new aggregation/metric | New `describe` block in `swingMetrics.test.js` covering: empty input, happy path, partial-exit case, legacy-row case |

### Edge cases the tests guard (don't regress these)

- Empty trade list, zero capital, missing LTP (no NaN, no divide-by-zero)
- Status case variants (`Open` / `OPEN` / `closed`)
- Multi-leg full close (entries qty == exits qty)
- Multi-leg partial close marked Closed (qty mismatch)
- Partial exit on still-Open trade
- Legacy rows with no leg JSON (flat-column fallback)
- Stop-loss above entry (clamp risk to 0)
- Zero-risk trade (entry == SL) excluded from R-multiple average
- `closedSorted` does not mutate input

### Why pure logic lives in `swingMath.js`

CRA's Jest can't transform `react-router-dom@7`'s ESM. Importing `SwingTracker.js` in a test crashes the suite. **Therefore: never put math in `SwingTracker.js`. Put it in `swingMath.js` and import.**

If you must add a helper that depends on React (e.g. a custom hook), it stays in the component file — but its testable internals should still factor out into a pure function in `swingMath.js`.

### Run tests

```bash
npm test -- --watchAll=false   # CI-style single run
npm test                       # interactive watch mode
```

Current state: **3 suites, 100 tests, all green.** Keep it that way.

---

## Conventions and gotchas

- **Inline styles via `style={{}}`** — no CSS-in-JS framework. The dark palette is in a `C` constant at the top of each file. Reuse it; don't introduce new colors.
- **Safari `<select>` quirk** — appearance reset + custom SVG caret is set in a global `<style>` block in `SwingTracker.js`. If you touch select styling, test on real Safari (Playwright WebKit is close but not identical).
- **CORS** — every POST uses `Content-Type: text/plain;charset=utf-8` to skip preflight. Do not change this.
- **Symbols are uppercased** in the form via the `uppercase` prop on `<Field>`. Don't undo this.
- **Closed Trades table is paginated** (10/page, newest first). Open Positions is not — usually <10 rows.
- **`MAX_LEGS = 3`** — entry and exit legs are capped at 3 each. UI enforces this.
- **localStorage key** for config: `tradescope:swing:config:v1`. If you change the schema, bump the version suffix.
- **`react-scripts` 5 + React 19** — some npm warnings on install are expected; ignore unless they break the build.

---

## Things AIs commonly get wrong here

1. ❌ Adding a math helper directly inside `SwingTracker.js`. → Put it in `swingMath.js`.
2. ❌ Changing `entryPrice`/`qty` independently of `entries`. → Always derive via `summarizeLegs(entries)`.
3. ❌ Computing realized P&L only over `closed`. → Must include exit legs from Open trades.
4. ❌ Assuming `qty` (stored) = exit qty. → For partial closes they differ.
5. ❌ Removing the legacy-row fallback in `normalizeTrade` or `computeMetrics`. → Old sheets still need to work.
6. ❌ Using arithmetic mean instead of qty-weighted mean for entry/exit price.
7. ❌ Adding `application/json` to POSTs. → Triggers CORS preflight which Apps Script doesn't handle.
8. ❌ Marking the App.test.js (or any test) as skipped to ship a change.

---

## What's NOT covered by automated tests (do these manually)

- Real Safari rendering quirks (Playwright WebKit ≈ Safari, not identical)
- Apps Script quotas / 5xx under load
- Real GOOGLEFINANCE staleness (eventually-consistent)
- Visual aesthetics (font, spacing feel)
- Dhan CSV format drift (`parseDhanCSV` in `App.js` would benefit from a fixture-based test if format changes are common — currently uncovered)

If you add E2E coverage, recommend Playwright (cross-browser, native WebKit). See the conversation in chapter "Test automation tooling discussion" for rationale.

---

## Quick start for a new agent

1. Read this file and `ARCHITECTURE.md`.
2. `npm install && npm test -- --watchAll=false` — confirm green baseline.
3. `npm start` — runs at `http://localhost:3000` (or use the existing preview server).
4. Make changes following the [Testing rules](#testing-rules) above.
5. Re-run `npm test -- --watchAll=false`. **Must be green before you finish.**
6. If you add a new concept (new metric, new entity, new external integration), update `CLAUDE.md` and `ARCHITECTURE.md` so the next agent inherits the context.
