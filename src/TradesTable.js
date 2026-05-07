// Sortable + filterable trades table — extracted from SwingTracker.js so
// the component can be unit-tested without dragging in `react-router-dom`
// (CRA's Jest can't transform v7 ESM exports). Pure UI; all the math it
// renders comes from swingMath.js helpers.

import { useEffect, useMemo, useState } from "react";
import {
  tradeAge,
  sortTrades,
  filterTrades,
  exitQty,
  openQty,
  realizedPnl,
} from "./swingMath";
import {
  MISTAKE_OPTIONS,
  MARKET_CONDITIONS,
  STRATEGY_OPTIONS,
} from "./appsScriptCode";
import {
  C,
  fmtINR,
  fmtPct,
  fmtPrice,
  SectionTitle,
  iconBtn,
  IconCheck,
  IconPencil,
  IconTrash,
} from "./ui";

function TradesTable({
  title,
  trades,
  capital,
  onEdit,
  onDelete,
  onQuickClose,
  paginate = false,
  pageSize = 10,
}) {
  const [page, setPage] = useState(0);
  // Sort: tri-state (key + dir). Click cycles asc → desc → cleared.
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState("");
  // Filters: substring for symbol, exact match for the dropdowns.
  const [filters, setFilters] = useState({
    symbol: "",
    marketCondition: "",
    strategy: "",
    mistake: "",
  });

  // Augment each trade with derived fields the table renders / sorts on.
  // Derived sort keys live on `_age`, `_risk`, `_pnl`, `_rMult`, `_qty` so
  // sortTrades (which indexes by property name) can sort on them just like
  // any other column. Computed once per trade so sort doesn't re-do the
  // math per swap.
  //
  // For Open trades the row shows the still-open qty (entry - exited) so a
  // partial exit visibly reduces the position. Risk / P&L / R-mult use the
  // same open qty so the row's metrics reflect what's actually still on the
  // table — the booked-cash portion lives in the Realized P&L tile.
  const enrichedTrades = useMemo(
    () =>
      (trades || []).map((t) => {
        const isOpen = t.status?.toLowerCase() === "open";
        const sold = exitQty(t);
        const liveQty = isOpen ? openQty(t) : Number(t.qty) || 0;
        // Risk shown on the row uses live (still-open) qty for Open trades
        // and total entry qty for Closed (= the position size that was at
        // risk when the SL was set — drives R-mult denominator).
        const risk = Math.max(0, (t.entryPrice - t.stopLoss) * liveQty);
        // P&L is unrealized for Open (LTP-based on still-open qty), and
        // leg-aware booked for Closed via realizedPnl(t) so partial-marked-
        // Closed rows reflect what was actually sold, not entry total qty.
        const pnl = isOpen
          ? t.ltp
            ? (t.ltp - t.entryPrice) * liveQty
            : 0
          : realizedPnl(t);
        const rMult = risk > 0 ? pnl / risk : 0;
        return {
          ...t,
          _qty: liveQty,
          _entryQty: Number(t.qty) || 0,
          _soldQty: sold,
          _age: tradeAge(t),
          _risk: risk,
          _pnl: pnl,
          _rMult: rMult,
        };
      }),
    [trades],
  );

  const filtered = useMemo(
    () => filterTrades(enrichedTrades, filters),
    [enrichedTrades, filters],
  );
  const processed = useMemo(
    () => sortTrades(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  );

  const totalPages = paginate ? Math.max(1, Math.ceil(processed.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages - 1);
  const visible = paginate
    ? processed.slice(safePage * pageSize, safePage * pageSize + pageSize)
    : processed;

  // Reset to page 0 whenever filtering or sorting changes the result set.
  useEffect(() => {
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, sortDir, filters.symbol, filters.marketCondition, filters.strategy, filters.mistake]);

  const handleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      // Third click: clear sort (revert to caller's input order, e.g. closedSorted).
      setSortKey("");
      setSortDir("");
    }
  };
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const clearFilters = () =>
    setFilters({ symbol: "", marketCondition: "", strategy: "", mistake: "" });
  const anyFilterActive = Boolean(
    filters.symbol || filters.marketCondition || filters.strategy || filters.mistake,
  );

  if ((trades || []).length === 0) {
    return (
      <div>
        <SectionTitle>{title}</SectionTitle>
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "32px 24px",
            textAlign: "center",
            color: C.muted,
            fontSize: 13,
          }}
        >
          No trades yet.
        </div>
      </div>
    );
  }

  // Sortable header cell: click cycles asc → desc → cleared.
  const SortTh = ({ label, sortKeyName, align = "left" }) => {
    const active = sortKey === sortKeyName;
    const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return (
      <th
        onClick={() => handleSort(sortKeyName)}
        style={{
          padding: "12px 14px",
          textAlign: align,
          cursor: "pointer",
          userSelect: "none",
          color: active ? C.accent : C.sub,
          whiteSpace: "nowrap",
        }}
        title={
          active
            ? `Sorted ${sortDir}. Click to ${sortDir === "asc" ? "reverse" : "clear"}`
            : "Click to sort"
        }
      >
        {label}
        {arrow}
      </th>
    );
  };

  const filterInputStyle = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    color: C.text,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 12,
    fontFamily: "'DM Mono', monospace",
    outline: "none",
  };

  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {/* Filter bar — Symbol search + dropdowns. Hidden visually when no
            trades exist (handled above) but always rendered when trades > 0
            so the user can find rows even after filtering them all out. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderBottom: `1px solid ${C.border}`,
            background: C.surface,
          }}
        >
          <input
            type="text"
            placeholder="Filter by symbol…"
            value={filters.symbol}
            onChange={(e) => setFilter("symbol", e.target.value)}
            style={{ ...filterInputStyle, minWidth: 140, flex: "0 1 180px" }}
          />
          <select
            value={filters.marketCondition}
            onChange={(e) => setFilter("marketCondition", e.target.value)}
            style={filterInputStyle}
          >
            <option value="">All Market</option>
            {MARKET_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filters.strategy}
            onChange={(e) => setFilter("strategy", e.target.value)}
            style={filterInputStyle}
          >
            <option value="">All Strategies</option>
            {STRATEGY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filters.mistake}
            onChange={(e) => setFilter("mistake", e.target.value)}
            style={filterInputStyle}
          >
            <option value="">All Mistakes</option>
            {MISTAKE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {anyFilterActive && (
            <button
              type="button"
              onClick={clearFilters}
              style={{
                ...filterInputStyle,
                cursor: "pointer",
                color: C.accent,
                borderColor: `${C.accent}60`,
              }}
              title="Clear all filters"
            >
              ✕ Clear
            </button>
          )}
          <div
            style={{
              marginLeft: "auto",
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: C.sub,
              whiteSpace: "nowrap",
            }}
          >
            {processed.length === enrichedTrades.length
              ? `${enrichedTrades.length} ${enrichedTrades.length === 1 ? "trade" : "trades"}`
              : `${processed.length} of ${enrichedTrades.length}`}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              minWidth: 880,
            }}
          >
            <thead>
              <tr
                style={{
                  background: C.surface,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  letterSpacing: "1.5px",
                  color: C.sub,
                  textTransform: "uppercase",
                }}
              >
                <SortTh label="Symbol" sortKeyName="symbol" align="left" />
                <SortTh label="Entry" sortKeyName="entryPrice" align="right" />
                <SortTh label="SL" sortKeyName="stopLoss" align="right" />
                <SortTh label="Qty" sortKeyName="_qty" align="right" />
                <SortTh label="Age" sortKeyName="_age" align="right" />
                <th style={{ padding: "12px 14px", textAlign: "left" }}>Context</th>
                <SortTh label="Risk" sortKeyName="_risk" align="right" />
                <SortTh label="P&L" sortKeyName="_pnl" align="right" />
                <SortTh label="R-mult" sortKeyName="_rMult" align="right" />
                <th style={{ padding: "12px 14px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      padding: "28px 14px",
                      textAlign: "center",
                      color: C.muted,
                      fontSize: 13,
                    }}
                  >
                    No trades match the current filters.
                  </td>
                </tr>
              )}
              {visible.map((t) => {
                // Use the derived fields populated in `enrichedTrades` —
                // for Open trades these correctly reflect openQty (excluding
                // the already-sold portion of partial exits).
                const risk = t._risk;
                const pnl = t._pnl;
                const rMult = t._rMult;
                const riskPct = capital ? (risk / capital) * 100 : 0;
                return (
                  <tr
                    key={t._row}
                    style={{ borderTop: `1px solid ${C.border}` }}
                  >
                    <td
                      style={{
                        padding: "12px 14px",
                        fontWeight: 600,
                        color: C.text,
                        maxWidth: 220,
                      }}
                    >
                      {t.symbol}
                      <div
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 10,
                          fontWeight: 400,
                          color: C.sub,
                          marginTop: 2,
                          whiteSpace: "nowrap",
                        }}
                        title={
                          t._soldQty > 0
                            ? `Currently invested: ${fmtPrice(t.entryPrice)} × ${t._qty}\n` +
                              `Original buy: ${fmtPrice(t.entryPrice)} × ${t._entryQty}`
                            : `Invested: ${fmtPrice(t.entryPrice)} × ${t._qty}`
                        }
                      >
                        {fmtINR(t.entryPrice * t._qty)}
                      </div>
                      <div
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 10,
                          color: C.muted,
                          marginTop: 2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: "100%",
                        }}
                        // Native browser tooltip — full date + notes on hover.
                        title={
                          t.notes
                            ? `${String(t.date).slice(0, 10)} · ${t.notes}`
                            : undefined
                        }
                      >
                        {String(t.date).slice(0, 10)}
                        {t.notes && ` · ${t.notes}`}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        textAlign: "right",
                        fontFamily: "'DM Mono', monospace",
                      }}
                      title={
                        (t.entries || []).length > 1
                          ? (t.entries || [])
                              .map(
                                (l) =>
                                  `${l.price} × ${l.qty}${l.date ? " · " + l.date : ""}`,
                              )
                              .join("\n")
                          : undefined
                      }
                    >
                      {fmtPrice(t.entryPrice)}
                      {(t.entries || []).length > 1 && (
                        <div style={{ fontSize: 10, color: C.sub }}>
                          avg · {t.entries.length} legs
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        textAlign: "right",
                        fontFamily: "'DM Mono', monospace",
                        color: C.red,
                      }}
                    >
                      {fmtPrice(t.stopLoss)}
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        textAlign: "right",
                        fontFamily: "'DM Mono', monospace",
                      }}
                      title={
                        t._soldQty > 0
                          ? `${t._soldQty} of ${t._entryQty} sold · ${t._qty} still open`
                          : undefined
                      }
                    >
                      {t._qty}
                      {t._soldQty > 0 && t._qty > 0 && (
                        // Partial-exit Open trade: show how much was sold so the
                        // original buy size isn't lost from the table view.
                        <div
                          style={{
                            fontSize: 10,
                            color: C.sub,
                            fontWeight: 400,
                            marginTop: 2,
                          }}
                        >
                          {t._soldQty} of {t._entryQty} sold
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        textAlign: "right",
                        fontFamily: "'DM Mono', monospace",
                        color: C.sub,
                      }}
                    >
                      {(() => {
                        const age = tradeAge(t);
                        return age == null ? "—" : `${age}d`;
                      })()}
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                        {t.marketCondition && (
                          <span
                            style={{
                              fontFamily: "'DM Mono', monospace",
                              fontSize: 10,
                              letterSpacing: "0.5px",
                              padding: "3px 8px",
                              borderRadius: 999,
                              background: C.blueDim,
                              color: C.blue,
                              border: `1px solid ${C.blue}40`,
                            }}
                          >
                            {t.marketCondition}
                          </span>
                        )}
                        {t.strategy && (
                          <span
                            style={{
                              fontFamily: "'DM Mono', monospace",
                              fontSize: 10,
                              letterSpacing: "0.5px",
                              padding: "3px 8px",
                              borderRadius: 999,
                              background: C.greenDim,
                              color: C.green,
                              border: `1px solid ${C.green}40`,
                            }}
                          >
                            {t.strategy}
                          </span>
                        )}
                        {(t.mistakes || "")
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .map((mk) => (
                            <span
                              key={mk}
                              style={{
                                fontFamily: "'DM Mono', monospace",
                                fontSize: 10,
                                letterSpacing: "0.5px",
                                padding: "3px 8px",
                                borderRadius: 999,
                                background: C.redDim,
                                color: C.red,
                                border: `1px solid ${C.red}40`,
                              }}
                            >
                              {mk}
                            </span>
                          ))}
                        {t.chartLink && (
                          <a
                            href={t.chartLink}
                            target="_blank"
                            rel="noreferrer noopener"
                            title={t.chartLink}
                            style={{
                              fontFamily: "'DM Mono', monospace",
                              fontSize: 10,
                              letterSpacing: "0.5px",
                              padding: "3px 8px",
                              borderRadius: 999,
                              background: C.accentDim,
                              color: C.accent,
                              border: `1px solid ${C.accent}40`,
                              textDecoration: "none",
                            }}
                          >
                            📈 chart
                          </a>
                        )}
                        {!t.marketCondition &&
                          !t.strategy &&
                          !t.mistakes &&
                          !t.chartLink && (
                            <span style={{ color: C.muted, fontSize: 12 }}>—</span>
                          )}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        textAlign: "right",
                        fontFamily: "'DM Mono', monospace",
                        color: C.accent,
                      }}
                    >
                      {fmtINR(risk)}
                      <div style={{ fontSize: 10, color: C.muted }}>
                        {fmtPct(riskPct)}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        textAlign: "right",
                        fontFamily: "'DM Mono', monospace",
                        color: pnl >= 0 ? C.green : C.red,
                        fontWeight: 500,
                      }}
                    >
                      {pnl ? (pnl >= 0 ? "+" : "") + fmtINR(pnl) : "—"}
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        textAlign: "right",
                        fontFamily: "'DM Mono', monospace",
                        color: rMult >= 0 ? C.green : C.red,
                      }}
                    >
                      {isFinite(rMult) && rMult !== 0 ? rMult.toFixed(2) : "—"}
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        textAlign: "right",
                      }}
                    >
                      <div
                        style={{
                          display: "inline-flex",
                          gap: 6,
                          justifyContent: "flex-end",
                        }}
                      >
                        {onQuickClose &&
                          t.status?.toLowerCase() === "open" && (
                            <button
                              onClick={() => onQuickClose(t)}
                              title={
                                t.ltp
                                  ? `Close @ LTP ${t.ltp}`
                                  : "Close (enter exit price)"
                              }
                              aria-label="Quick close"
                              style={iconBtn(C.green, C.greenDim)}
                            >
                              <IconCheck />
                            </button>
                          )}
                        <button
                          onClick={() => onEdit(t)}
                          title="Edit trade"
                          aria-label="Edit"
                          style={iconBtn(C.sub, "transparent", C.border)}
                        >
                          <IconPencil />
                        </button>
                        <button
                          onClick={() => onDelete(t)}
                          title="Delete trade"
                          aria-label="Delete"
                          style={iconBtn(C.red, "transparent", C.redDim)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {paginate && totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 14px",
              borderTop: `1px solid ${C.border}`,
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: C.sub,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span>
              Showing{" "}
              <span style={{ color: C.text }}>
                {safePage * pageSize + 1}–
                {Math.min(trades.length, safePage * pageSize + pageSize)}
              </span>{" "}
              of <span style={{ color: C.text }}>{trades.length}</span>
            </span>
            <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setPage(0)}
                disabled={safePage === 0}
                title="First page"
                aria-label="First page"
                style={pagerBtn(safePage === 0)}
              >
                «
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                title="Previous page"
                aria-label="Previous page"
                style={pagerBtn(safePage === 0)}
              >
                ‹ Prev
              </button>
              <span style={{ padding: "0 8px" }}>
                Page <span style={{ color: C.text }}>{safePage + 1}</span> /{" "}
                {totalPages}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={safePage >= totalPages - 1}
                title="Next page"
                aria-label="Next page"
                style={pagerBtn(safePage >= totalPages - 1)}
              >
                Next ›
              </button>
              <button
                type="button"
                onClick={() => setPage(totalPages - 1)}
                disabled={safePage >= totalPages - 1}
                title="Last page"
                aria-label="Last page"
                style={pagerBtn(safePage >= totalPages - 1)}
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Pager button style — disabled state goes muted. Helper hoisted so the
// table component re-uses the same shape across all four pager buttons.
const pagerBtn = (disabled) => ({
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  padding: "5px 10px",
  borderRadius: 4,
  border: `1px solid ${C.border}`,
  background: disabled ? "transparent" : C.surface,
  color: disabled ? C.muted : C.sub,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

export default TradesTable;
