# TradeScope

> A self-hosted swing-trading journal & P&L dashboard. React on the front, Google Sheets on the back. No database, no server bill, no broker API integration to babysit — just the spreadsheet you'd already keep, with a UI that does the math.

[![CI](https://github.com/imrai14/trading-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/imrai14/trading-dashboard/actions/workflows/ci.yml)
![tests](https://img.shields.io/badge/tests-227%20passing-00d68f)
![react](https://img.shields.io/badge/react-19.2-4488ff)
![license](https://img.shields.io/badge/license-MIT-e8b84b)

---

## What it is

TradeScope is a two-pane web app for Indian retail swing traders who keep their trade ledger in a Google Sheet but want real dashboard math on top of it:

| Route | What it does |
|---|---|
| **`/`** P&L Dashboard | Drop in a broker P&L export (Dhan CSV or Zerodha XLSX) → see charges-aware net P&L, top winners/losers, per-month buckets, cumulative curve |
| **`/swing`** Swing Tracker | A live trade journal: add multi-leg entries & exits, track open positions with GOOGLEFINANCE LTPs, compute realized/unrealized P&L, win-rate, R-multiple, equity curve, per-strategy breakdown |

Everything is **client-side React** — your data stays in **your** Google Sheet. The "backend" is a tiny Google Apps Script web app you paste into the sheet's script editor; it acts as a thin REST layer for read/write.

---

## Why it exists

Most swing traders end up with one of:

1. **A messy Google Sheet** — accurate ledger, zero analytics, formulas break the moment you partial-exit.
2. **A broker app dashboard** — pretty charts, but locked to one broker and recomputed on the broker's terms (FIFO, charges, etc.).
3. **A SaaS journal (TraderSync, Edgewonk)** — works, costs $20-30/month, requires uploading every position to a third party.

TradeScope sits in the middle: your data, your sheet, your math. **It is not a broker integration**, it does not place trades, it does not store credentials remotely.

---

## Features

### Dashboard (`/`) — broker P&L import

- **Drop-in support** for Dhan (CSV) and Zerodha (XLSX) P&L exports — file-format auto-detection.
- **Multi-broker merge** — drop both files, get combined net P&L.
- **Charges breakdown** — brokerage vs STT/Exchange/Other, both shown side-by-side with gross & net.
- **Top winners / losers** — top 5 each with absolute and % return.
- **Cumulative P&L line + monthly bars** — Recharts visualizations.
- **No data leaves the browser** — files are parsed in-memory; nothing is uploaded.

### Swing Tracker (`/swing`) — live journal

- **Multi-leg trades** — up to 3 entry legs and 3 exit legs per trade with distinct prices/qty/dates.
- **Live LTP via GOOGLEFINANCE** — your sheet pulls quotes; the app reads them.
- **Five-tile dashboard** — Open P&L, Risk on Open, Capital Deployed, Realized P&L, Win Rate.
- **Equity curve** — daily booked-P&L bars + cumulative line, sourced purely from your entered exit prices (never LTP-driven).
- **Risk-on-open warning banner** — amber/red banner when aggregate open risk crosses thresholds; thresholds scale to your per-trade risk target.
- **Per-symbol & per-strategy breakdown** — win-rate and avg R-multiple grouped by Market Condition / Strategy / Mistake tags.
- **Sortable + filterable tables** — click any header to sort (asc/desc/clear). Filter bar with symbol search + 3 dropdown facets (Market Condition, Strategy, Mistakes).
- **Quick-close action** — pre-fills exit leg with LTP for the still-open qty; you confirm/edit.
- **Position-size suggestion** — given capital + per-trade risk %, the form proposes qty live as you type entry & SL.
- **Form-side validation** — symbol/SL required, entry leg required, exits ≤ entries, no future dates, no exit-before-entry.
- **Partial-exit handling done right** — the most carefully tested invariant. A trade with `exits.qty < entries.qty` is treated correctly everywhere: realized P&L counts only what was sold, open-side metrics use only what's still held.

---

## Architecture in one diagram

```
                ┌──────────────── BROWSER ────────────────┐
                │                                          │
   ┌─ UI ─┐     │   ┌──────────────────────────────────┐   │
   │      │     │   │ App.js · SwingTracker.js         │   │
   │ User │◄────┼──►│ TradesTable.js · charts          │   │
   │      │     │   └────────┬─────────────────────────┘   │
   └──────┘     │            │ pure helpers                │
                │            ▼                             │
                │   ┌──────────────────────────────────┐   │
                │   │ swingMath.js · dhanParser.js     │   │
                │   │ googleSheets.js (API client)     │   │
                │   └────────┬─────────────────────────┘   │
                │            │ POST text/plain (no preflight)
                └────────────┼────────────────────────────┘
                             │
                             ▼
                ┌──────── GOOGLE CLOUD ────────┐
                │  Apps Script web app          │
                │  (doGet / doPost)             │
                │           │                   │
                │           ▼                   │
                │  Google Sheet                 │
                │  ├─ SwingTrades (rows)        │
                │  ├─ Settings   (key/value)    │
                │  └─ LTP column = GOOGLEFINANCE│
                └───────────────────────────────┘
```

Full mermaid diagrams + detailed data flows live in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

**Why text/plain on POST?** Apps Script web apps can't return custom CORS headers. Sending `application/json` would trigger a preflight `OPTIONS` request that Apps Script doesn't handle. `text/plain` skips preflight; the Apps Script backend `JSON.parse`s the body itself.

---

## Quick start

### Prerequisites

- **Node.js 20.x** (LTS) — works on 18+ but 20 matches CI.
- A **Google account** for hosting the sheet + Apps Script.
- (Optional) A broker P&L export file if you want to use the import dashboard.

### Run locally

```bash
git clone https://github.com/imrai14/trading-dashboard.git
cd trading-dashboard
npm install                          # also installs husky pre-commit hook
npm start                            # → http://localhost:3000
```

That's it for the dashboard import view (`/`) — drop a Dhan CSV or Zerodha XLSX onto the page.

### Run tests

```bash
npm test                             # interactive watch mode
npm test -- --watchAll=false         # CI-style single run
```

Current state: **5 suites, 227 tests, all green**.

### Production build

```bash
npm run build                        # → ./build/, deploy to any static host
```

### Deploy

The `build/` folder is a static SPA. Drop it on:
- **Vercel** — `vercel --prod` from the project root
- **GitHub Pages** — copy `build/` to a `gh-pages` branch
- **Netlify** — drag-drop the folder
- **S3 / Cloudflare Pages / your shared host** — same idea

The app makes no calls during build; all backend wiring is runtime via the URL+secret you configure in the Setup screen.

---

## Setting up the Swing Tracker (`/swing`)

This is the only one-time setup. The `/` dashboard works without it.

### 1. Create the Google Sheet

1. Open [sheets.google.com](https://sheets.google.com) → **Blank**.
2. Rename it (e.g. `TradeScope Ledger`).
3. The app will auto-create the `SwingTrades` and `Settings` tabs the first time it writes — no manual schema needed.

### 2. Paste the Apps Script

1. Sheet → **Extensions → Apps Script**.
2. Delete the default `function myFunction()` stub.
3. Paste the script TradeScope shows on its setup screen (or copy from [`src/appsScriptCode.js`](./src/appsScriptCode.js) — the `APPS_SCRIPT_CODE` constant).
4. Replace the line `const SECRET = 'change-this-to-your-password'` with a password of your own.
5. Save (`Ctrl/Cmd+S`).

### 3. Deploy as a web app

1. Click **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**. (Required — even though access is already gated by your secret, Apps Script needs this for unauthenticated `fetch` to work.)
5. Click **Deploy** → copy the `/exec` URL.

### 4. Wire up TradeScope

1. Visit `http://localhost:3000/swing`.
2. Paste the `/exec` URL and the password you set.
3. Save. The app will write the schema headers and start fetching.

### 5. (Optional) Set capital and risk %

In the top settings bar:
- **Capital** — total ₹ trading bankroll. Drives the "% of capital" subtitles.
- **Risk per Trade %** — sizing target (e.g. `1` = 1% of capital per trade). Drives the position-size suggestion and the warning-banner thresholds (warn at 3× target, danger at 6× target).

### Updating the Apps Script after pulling new code

If `src/appsScriptCode.js` changes (e.g. a new column was added), you'll need to:
1. Open the sheet's Apps Script editor.
2. Replace the existing script body with the new one.
3. **Deploy → Manage deployments → Edit the active deployment → New version → Deploy.**

The next page load will auto-add any missing column headers via `ensureHeaders_`.

---

## Project structure

```
trading-dashboard/
├── .github/workflows/ci.yml    # GitHub Actions: tests + build on push & PR
├── .husky/pre-commit           # Local pre-commit hook running tests
├── public/                     # CRA static assets
├── src/
│   ├── App.js                  # / route — broker P&L dashboard, brand shell
│   ├── SwingTracker.js         # /swing route — live journal UI
│   ├── TradesTable.js          # Sortable, filterable trades table (extracted)
│   ├── ui.js                   # Shared palette, formatters, SectionTitle, icons
│   ├── swingMath.js            # ALL pure logic — math, sort, filter, validators
│   ├── googleSheets.js         # Apps Script API client + normalizeTrade
│   ├── dhanParser.js           # Dhan P&L CSV parser (pure)
│   ├── appsScriptCode.js       # The .gs script as a string + SHEET_HEADERS, options
│   ├── *.test.js               # 5 Jest suites — see below
│   ├── setupTests.js           # @testing-library/jest-dom matchers
│   └── index.js                # CRA entry point
├── ARCHITECTURE.md             # Mermaid diagrams + data flow details
├── CLAUDE.md                   # Conventions, invariants, AI-agent instructions
├── README.md                   # ← you are here
└── package.json
```

**Hard rule:** all pure logic (math, normalization, aggregation, parsing) lives in `swingMath.js`, `googleSheets.js`, or `dhanParser.js`. Never inline math inside React components — it can't be unit-tested without dragging in `react-router-dom@7` (which CRA's Jest can't transform). See [`CLAUDE.md`](./CLAUDE.md) for full conventions.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React 19 (CRA / `react-scripts` 5) | Fastest path to a static SPA; no SSR needed |
| Routing | `react-router-dom` 7 | Two routes, that's it |
| Charts | `recharts` 3.8 | Composable React-first charts; matches the dark theme |
| Spreadsheet parsing | `xlsx` 0.18 | Reads Zerodha's `.xlsx` exports |
| Backend | Google Apps Script + Google Sheets | Zero infra cost, owned by user |
| Live prices | `=GOOGLEFINANCE("NSE:XYZ","price")` | Sheet-side; rate-limited but free |
| Testing | Jest + `@testing-library/react` 16 + jsdom | CRA's default; pure-function tests + component tests for `TradesTable` |
| CI | GitHub Actions | Free for public repos; 2,000 min/month free for private |
| Hooks | husky 9 | Pre-commit gate runs tests in 1.7s |

---

## Testing

| Suite | Coverage |
|---|---|
| `swingHelpers.test.js` | 139 tests — leg math, weighted averages, sort, filter, openQty/exitQty, realizedPnl, validateTradeDates, equityCurve, assessRisk |
| `swingMetrics.test.js` | 38 tests — `computeMetrics` end-to-end across empty/legacy/multi-leg/partial-exit cases |
| `googleSheets.test.js` | 32 tests — `normalizeTrade` shape coercion + config persistence |
| `dhanParser.test.js` | 20 tests — fixture-based Dhan CSV parsing, charges, format-drift safety |
| `TradesTable.test.js` | 18 tests — render, sort cycle, all 4 filters, partial-exit Qty cell, action callbacks |
| **Total** | **5 suites · 227 tests** |

### Testing philosophy

1. **Pure functions only**, in dedicated modules, with dependency-free imports. The trade math is locked down by tests independent of the UI.
2. **Component tests where possible** — `TradesTable.test.js` exercises the full sort+filter UI via `@testing-library/react`. The component was deliberately extracted into a router-free file so Jest can load it without choking on `react-router-dom`'s ESM exports.
3. **Edge cases > happy paths.** Every helper has tests for: empty input, malformed input, partial-state (open with partial exit), legacy rows (no leg JSON), divide-by-zero, NaN propagation.
4. **CLAUDE.md table is the contract.** When you change a function, the test file you must update is documented per-function. Drift is treated as a bug, not a TODO.

### Running

```bash
npm test                         # interactive watch
npm test -- --watchAll=false     # CI mode, single run, exits non-zero on failure
```

---

## Continuous integration

### Pre-commit hook (local, fast)

`.husky/pre-commit` runs the full test suite (~1.7s) on every `git commit`. Failing tests block the commit. Bypass with `git commit --no-verify` for genuine WIP commits.

### GitHub Actions (remote, thorough)

`.github/workflows/ci.yml` runs on every push to `main` and every PR. Steps:

1. Checkout
2. Set up Node 20 with `~/.npm` cache
3. `npm ci` (lockfile-strict install)
4. `CI=true npm test -- --watchAll=false` — same command as the hook
5. `CI=true npm run build` — production webpack build catches issues Jest can't (missing imports, JSX errors that don't transform, broken bundling)

A red X on a PR's status check tells you something failed; the run logs show exactly which test or build error. With branch protection enabled (Settings → Branches), the merge button stays disabled until CI is green.

**Cost:** free for public repos (unlimited minutes). Private repos get 2,000 free Linux minutes/month — your typical usage is 30-300 min/month, well under.

---

## Importing trades

### From Dhan (CSV)

1. Dhan app → **P&L → Download P&L** for your desired date range.
2. Drop the CSV onto the `/` Dashboard.
3. The parser handles: quoted numeric cells, embedded commas in numbers, `Net P&L` summary row, blank lines, trailing `NOTE`. Format drift is locked down by `dhanParser.test.js`.

### From Zerodha (XLSX)

1. Console.zerodha.com → **Reports → P&L → Download Excel.**
2. Drop the XLSX onto the `/` Dashboard.
3. The parser is permissive about column ordering — finds the `Symbol`/`ISIN` header row dynamically.

### Bulk-paste into the Swing Tracker sheet

For migrating historical positions, you can paste rows directly into the `SwingTrades` tab. Format: tab-separated, 18 columns matching `SHEET_HEADERS` in [`src/appsScriptCode.js`](./src/appsScriptCode.js). The `Entries` and `Exits` columns must be JSON-stringified arrays of `{price, qty, date}`.

---

## Conventions & contributing

If you're working on this codebase (yourself or via an AI assistant), please read [`CLAUDE.md`](./CLAUDE.md) first. The high-leverage points:

- All pure logic in `swingMath.js` / `googleSheets.js` / `dhanParser.js` — never inline math in components.
- Don't change `entryPrice` / `qty` independently of `entries[]` legs.
- Realized P&L is leg-aware via `realizedPnl(t)` — single source of truth, used by 4 call sites.
- The `Open P&L` / `Risk on Open` / `Capital Deployed` tiles use **`openQty`** (entry total minus exited), never `t.qty`, for partial-exit correctness.
- `LTP` is read-only and only ever drives unrealized P&L. Never relied on for booked numbers.

When adding a new metric or trade field, the per-step checklists in [`ARCHITECTURE.md`](./ARCHITECTURE.md) (sections "Adding a new metric" and "Adding a new field") cover the path.

---

## What's NOT covered (yet)

| Gap | Why |
|---|---|
| End-to-end tests (Playwright) | Would have caught the Safari `<select>` bug; not blocking |
| MSW for `SwingTracker` integration tests | Needs solving CRA's `react-router-dom@7` ESM resolution |
| Apps Script backend tests | Needs a clasp-based harness against a staging sheet |
| Dividend tracking | Single-leg model doesn't accommodate corporate actions |
| Mobile-first layout below 700px | Current min-width is 880; ok on tablet, cramped on phone |
| Brokerage / charges field on individual trades | Currently only aggregate via the import flow |

---

## License

[MIT](./LICENSE) — do whatever you want, no warranty, etc.

If a `LICENSE` file isn't checked in yet, treat the code as "all rights reserved by the author until added." (Send a PR adding the MIT license file if you'd like to use it commercially.)

---

## Disclaimer

**This software does not give financial advice.** It is a journaling and visualization tool. The numbers it shows depend entirely on what you (and GOOGLEFINANCE) feed it. The author is not a registered investment advisor. Past P&L is not predictive of future P&L. Trade at your own risk. If anything in the math surprises you, check the corresponding test in `src/swingHelpers.test.js` or `src/swingMetrics.test.js` — every formula is documented and locked down there.

---

## Acknowledgements

- **GOOGLEFINANCE** — the unsung hero making free real-time(ish) NSE quotes possible
- **recharts** — for charts that don't fight the React grain
- **Apps Script** — for being a free, durable, embarrassingly simple backend layer
- **CRA** — for letting this project exist without a custom build setup

---

**Companion docs:** [`CLAUDE.md`](./CLAUDE.md) (conventions & invariants) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) (mermaid diagrams & flows)
