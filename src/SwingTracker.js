import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  APPS_SCRIPT_CODE,
  SHEET_HEADERS,
  MISTAKE_OPTIONS,
  MARKET_CONDITIONS,
  STRATEGY_OPTIONS,
} from "./appsScriptCode";
import {
  loadConfig,
  saveConfig,
  clearConfig,
  fetchAll,
  addTrade as apiAddTrade,
  updateTrade as apiUpdateTrade,
  deleteTrade as apiDeleteTrade,
  saveSettings as apiSaveSettings,
  normalizeTrade,
  normalizeSettings,
} from "./googleSheets";
import {
  cleanLegs,
  summarizeLegs,
  tradeAge,
  computeMetrics,
  aggregateClosed,
  sortTrades,
  filterTrades,
  exitQty,
  openQty,
  realizedPnl,
  validateTradeDates,
  assessRisk,
  equityCurve,
} from "./swingMath";
import { C, fmtINR, fmtPct, SectionTitle } from "./ui";
import TradesTable from "./TradesTable";

// Re-export for any external consumers (test files, future imports).
export {
  cleanLegs,
  summarizeLegs,
  tradeAge,
  computeMetrics,
  aggregateClosed,
  sortTrades,
  filterTrades,
  exitQty,
  openQty,
  realizedPnl,
  validateTradeDates,
  assessRisk,
  equityCurve,
};

const MAX_LEGS = 3;

function StatCard({ label, value, sub, color = C.text }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "20px 22px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: color,
          borderRadius: "10px 10px 0 0",
        }}
      />
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          letterSpacing: "2px",
          color: C.sub,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          color,
          letterSpacing: "-0.5px",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: C.muted,
            marginTop: 5,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

const fieldStyle = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "9px 12px",
  color: C.text,
  fontSize: 13,
  fontFamily: "'DM Mono', monospace",
  outline: "none",
  width: "100%",
};

const labelStyle = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 10,
  letterSpacing: "1.5px",
  color: C.sub,
  textTransform: "uppercase",
  marginBottom: 6,
  display: "block",
};

// Compact icon-only button for table actions. Keeps a 28x28 hit target so
// it stays tap-friendly on mobile while saving width vs. text labels.
function SetupScreen({ onSave }) {
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);

  const canSave = url.trim().startsWith("https://") && secret.trim().length > 0;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert("Copy failed. Select the code manually and copy with Ctrl/Cmd+C.");
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <SectionTitle>Step 1 · Create your Google Sheet</SectionTitle>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "20px 24px",
          color: C.sub,
          fontSize: 13.5,
          lineHeight: 1.75,
        }}
      >
        <div style={{ marginBottom: 10 }}>
          Create a new Google Sheet called <strong style={{ color: C.text }}>SwingTrades</strong>.
          Paste these column headers into row 1 (the script will auto-create the sheet if you skip this):
        </div>
        <div style={{ marginBottom: 14, fontSize: 12.5, color: C.muted }}>
          ↳ The <strong style={{ color: C.accent }}>LTP</strong> column is auto-filled by{" "}
          <code style={{ color: C.accent }}>GOOGLEFINANCE</code> — you never type a price. The
          script writes the formula for you on every new trade.
        </div>
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 12,
            color: C.accent,
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "10px 14px",
          }}
        >
          {SHEET_HEADERS.join(" · ")}
        </div>
      </div>

      <SectionTitle>Step 2 · Paste this Apps Script into the sheet</SectionTitle>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "20px 24px",
        }}
      >
        <ol
          style={{
            color: C.sub,
            fontSize: 13.5,
            lineHeight: 1.9,
            paddingLeft: 22,
            marginBottom: 14,
          }}
        >
          <li>
            In the sheet: <strong style={{ color: C.text }}>Extensions → Apps Script</strong>
          </li>
          <li>Delete anything in the editor, paste the code below</li>
          <li>
            Change the <code style={{ color: C.accent }}>SECRET</code> value to a password you'll
            remember
          </li>
          <li>
            Click <strong style={{ color: C.text }}>Save</strong>, then{" "}
            <strong style={{ color: C.text }}>Deploy → New deployment</strong>
          </li>
          <li>
            Type: <strong style={{ color: C.text }}>Web app</strong>, Execute as:{" "}
            <strong style={{ color: C.text }}>Me</strong>, Who has access:{" "}
            <strong style={{ color: C.text }}>Anyone</strong>
          </li>
          <li>
            Click <strong style={{ color: C.text }}>Deploy</strong>, authorize, copy the{" "}
            <strong style={{ color: C.text }}>/exec</strong> URL
          </li>
        </ol>

        <div style={{ position: "relative" }}>
          <button
            onClick={copyCode}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              padding: "6px 12px",
              borderRadius: 5,
              border: `1px solid ${C.accent}60`,
              background: C.accentDim,
              color: C.accent,
              cursor: "pointer",
              zIndex: 1,
            }}
          >
            {copied ? "✓ copied" : "copy code"}
          </button>
          <pre
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "16px 18px",
              fontFamily: "'DM Mono', monospace",
              fontSize: 11.5,
              color: C.text,
              overflow: "auto",
              maxHeight: 380,
              margin: 0,
              whiteSpace: "pre",
            }}
          >
            {APPS_SCRIPT_CODE}
          </pre>
        </div>
      </div>

      <SectionTitle>Step 3 · Paste URL & password here</SectionTitle>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "22px 24px",
        }}
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <label style={labelStyle}>Apps Script URL (/exec)</label>
            <input
              style={fieldStyle}
              placeholder="https://script.google.com/macros/s/.../exec"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Password (same as SECRET in the script)</label>
            <input
              style={fieldStyle}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
          <button
            disabled={!canSave}
            onClick={() => onSave({ url: url.trim(), secret: secret.trim() })}
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 12,
              letterSpacing: "2px",
              padding: "12px 20px",
              borderRadius: 6,
              border: `1px solid ${canSave ? C.accent : C.border}`,
              background: canSave ? C.accentDim : C.surface,
              color: canSave ? C.accent : C.muted,
              cursor: canSave ? "pointer" : "not-allowed",
              textTransform: "uppercase",
            }}
          >
            Connect Sheet
          </button>
        </div>
      </div>
    </div>
  );
}

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  symbol: "",
  stopLoss: "",
  status: "Open",
  notes: "",
  marketCondition: "",
  strategy: "",
  chartLink: "",
  mistakes: "", // stored as CSV of mistake labels
  // Leg arrays — each { price, qty, date } as strings.
  entries: [
    { price: "", qty: "", date: new Date().toISOString().slice(0, 10) },
  ],
  exits: [],
};

function Field({ k, label, type = "text", placeholder = "", value, onChange, uppercase = false }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        style={uppercase ? { ...fieldStyle, textTransform: "uppercase" } : fieldStyle}
        type={type}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) =>
          onChange(k, uppercase ? e.target.value.toUpperCase() : e.target.value)
        }
      />
    </div>
  );
}

function LegEditor({
  kind,
  label,
  legs,
  onChange,
  onAdd,
  onRemove,
  summary,
  summaryLabel,
  suggestedQty,
  riskPct,
  onApplySuggestedQty,
}) {
  const canAdd = legs.length < MAX_LEGS;
  return (
    <div
      style={{
        marginBottom: 14,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "12px 14px",
        background: C.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            letterSpacing: "2px",
            color: C.sub,
            textTransform: "uppercase",
          }}
        >
          {label} ({legs.length}/{MAX_LEGS})
        </div>
        {summary && summary.totalQty > 0 && (
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: C.text,
            }}
          >
            {summaryLabel}:{" "}
            <span style={{ color: C.accent }}>
              ₹{summary.avg.toFixed(2)}
            </span>{" "}
            · Qty:{" "}
            <span style={{ color: C.accent }}>{summary.totalQty}</span>
          </div>
        )}
      </div>
      {legs.length === 0 && (
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: C.muted,
            padding: "6px 0 10px",
          }}
        >
          No {label.toLowerCase()} yet.
        </div>
      )}
      {legs.map((leg, idx) => (
        <div key={idx} className="leg-row">
          <div>
            {idx === 0 && <label style={labelStyle}>Price</label>}
            <input
              style={fieldStyle}
              type="number"
              step="0.01"
              value={leg.price}
              onChange={(e) => onChange(kind, idx, "price", e.target.value)}
            />
          </div>
          <div>
            {idx === 0 && <label style={labelStyle}>Qty</label>}
            <input
              style={fieldStyle}
              type="number"
              value={leg.qty}
              onChange={(e) => onChange(kind, idx, "qty", e.target.value)}
            />
          </div>
          <div className="leg-date">
            {idx === 0 && <label style={labelStyle}>Date</label>}
            <input
              style={fieldStyle}
              type="date"
              value={leg.date}
              onChange={(e) => onChange(kind, idx, "date", e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => onRemove(kind, idx)}
            title="Remove this leg"
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 14,
              width: 36,
              height: 36,
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.muted,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      ))}
      {/* Suggestion chip — rendered OUTSIDE the leg-row grid so it never
          shifts the input alignment when it appears or disappears. */}
      {suggestedQty > 0 &&
        Number(legs[0]?.qty) !== suggestedQty &&
        onApplySuggestedQty && (
          <button
            type="button"
            onClick={() => onApplySuggestedQty(0)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 10,
              marginRight: 10,
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.5px",
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${C.accent}40`,
              background: C.accentDim,
              color: C.accent,
              cursor: "pointer",
            }}
          >
            use {suggestedQty} ({riskPct}% risk)
          </button>
        )}
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => onAdd(kind)}
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          letterSpacing: "1px",
          padding: "6px 12px",
          borderRadius: 4,
          border: `1px solid ${canAdd ? C.accent + "60" : C.border}`,
          background: canAdd ? C.accentDim : "transparent",
          color: canAdd ? C.accent : C.muted,
          cursor: canAdd ? "pointer" : "not-allowed",
        }}
      >
        + add {kind === "entries" ? "entry" : "exit"} leg
      </button>
    </div>
  );
}

function TradeForm({ initial, onSubmit, onCancel, settings }) {
  const [form, setForm] = useState(() => {
    const base = { ...emptyForm, ...(initial || {}) };
    const toFormLegs = (arr) =>
      (arr || []).map((l) => ({
        price: l.price ? String(l.price) : "",
        qty: l.qty ? String(l.qty) : "",
        date: l.date || "",
      }));
    const e = toFormLegs(initial?.entries);
    const x = toFormLegs(initial?.exits);
    base.entries = e.length > 0 ? e : emptyForm.entries;
    base.exits = x;
    return base;
  });
  const [saving, setSaving] = useState(false);

  const set = useCallback((k, v) => setForm((f) => ({ ...f, [k]: v })), []);

  // Leg editing helpers.
  const setLeg = (kind, idx, field, value) => {
    setForm((f) => {
      const next = [...(f[kind] || [])];
      next[idx] = { ...next[idx], [field]: value };
      return { ...f, [kind]: next };
    });
  };
  const addLeg = (kind) => {
    setForm((f) => {
      const list = f[kind] || [];
      if (list.length >= MAX_LEGS) return f;
      const today = new Date().toISOString().slice(0, 10);
      return {
        ...f,
        [kind]: [...list, { price: "", qty: "", date: today }],
      };
    });
  };
  const removeLeg = (kind, idx) => {
    setForm((f) => {
      const list = f[kind] || [];
      return { ...f, [kind]: list.filter((_, i) => i !== idx) };
    });
  };

  // Live summary over current legs.
  const entrySummary = summarizeLegs(form.entries);
  const exitSummary = summarizeLegs(form.exits);
  const sl = parseFloat(form.stopLoss) || 0;
  const capital = settings?.totalCapital || 0;
  const riskPct = settings?.riskPerTradePct || 0;
  // Reference price for the qty suggestion: weighted-avg if any qty entered,
  // otherwise just the first leg's price. This way the chip shows up the
  // moment the user types a price — they don't have to enter a qty first
  // (the whole point of the suggestion is to *propose* the qty).
  const firstLegPrice = parseFloat(form.entries[0]?.price) || 0;
  const refPrice = entrySummary.avg > 0 ? entrySummary.avg : firstLegPrice;
  const perShareRisk = refPrice - sl;
  const suggestedQty =
    capital > 0 && riskPct > 0 && perShareRisk > 0
      ? Math.max(1, Math.floor((capital * (riskPct / 100)) / perShareRisk))
      : 0;

  const realized =
    exitSummary.totalQty > 0
      ? (exitSummary.avg - entrySummary.avg) * exitSummary.totalQty
      : 0;
  const openQty = Math.max(0, entrySummary.totalQty - exitSummary.totalQty);

  // Mistakes are stored as a CSV string in the sheet but edited as a set.
  const selectedMistakes = (form.mistakes || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const toggleMistake = (m) => {
    const next = selectedMistakes.includes(m)
      ? selectedMistakes.filter((x) => x !== m)
      : [...selectedMistakes, m];
    set("mistakes", next.join(", "));
  };

  const submit = async () => {
    if (!form.symbol || !form.stopLoss) {
      alert("Symbol and Stop Loss are required.");
      return;
    }
    if (entrySummary.totalQty <= 0) {
      alert("Add at least one entry leg with price and qty.");
      return;
    }
    if (exitSummary.totalQty > entrySummary.totalQty) {
      alert("Total exit qty can't exceed total entry qty.");
      return;
    }
    // Date sanity: no future dates, no exit dated before any entry.
    const dateError = validateTradeDates(form);
    if (dateError) {
      alert(dateError);
      return;
    }
    if (
      form.status?.toLowerCase() === "closed" &&
      exitSummary.totalQty !== entrySummary.totalQty
    ) {
      if (
        !window.confirm(
          `Closed trade but exit qty (${exitSummary.totalQty}) ≠ entry qty (${entrySummary.totalQty}). Save anyway?`,
        )
      )
        return;
    }
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "22px 24px",
      }}
    >
      <div className="form-grid">
        <Field k="symbol" label="Symbol" placeholder="e.g. RELIANCE" value={form.symbol} onChange={set} uppercase />
        <Field k="stopLoss" label="Stop Loss" type="number" value={form.stopLoss} onChange={set} />
        <div>
          <label style={labelStyle}>Status</label>
          <select
            style={fieldStyle}
            value={form.status}
            onChange={(e) => set("status", e.target.value)}
          >
            <option value="Open">Open</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Market Condition</label>
          <select
            style={fieldStyle}
            value={form.marketCondition || ""}
            onChange={(e) => set("marketCondition", e.target.value)}
          >
            <option value="">—</option>
            {MARKET_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Strategy</label>
          <select
            style={fieldStyle}
            value={form.strategy || ""}
            onChange={(e) => set("strategy", e.target.value)}
          >
            <option value="">—</option>
            {STRATEGY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Field
          k="chartLink"
          label="Chart Link"
          type="url"
          placeholder="https://…"
          value={form.chartLink}
          onChange={set}
        />
      </div>

      <LegEditor
        kind="entries"
        label="Entries"
        legs={form.entries}
        onChange={setLeg}
        onAdd={addLeg}
        onRemove={removeLeg}
        summary={entrySummary}
        summaryLabel="Avg Entry"
        suggestedQty={suggestedQty}
        riskPct={riskPct}
        onApplySuggestedQty={(idx) =>
          setLeg("entries", idx, "qty", String(suggestedQty))
        }
      />

      <LegEditor
        kind="exits"
        label="Exits"
        legs={form.exits}
        onChange={setLeg}
        onAdd={addLeg}
        onRemove={removeLeg}
        summary={exitSummary}
        summaryLabel="Avg Exit"
      />

      {/* Live P&L preview — only once both sides have data. */}
      {(entrySummary.totalQty > 0 || exitSummary.totalQty > 0) && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            margin: "14px 0",
            padding: "12px 14px",
            borderRadius: 8,
            background: C.surface,
            border: `1px solid ${C.border}`,
            fontFamily: "'DM Mono', monospace",
            fontSize: 12,
          }}
        >
          <span style={{ color: C.sub }}>
            Qty: <span style={{ color: C.text }}>{entrySummary.totalQty}</span>
            {exitSummary.totalQty > 0 && (
              <>
                {" "}
                · Exited:{" "}
                <span style={{ color: C.text }}>{exitSummary.totalQty}</span>
                {openQty > 0 && (
                  <>
                    {" "}
                    · Open: <span style={{ color: C.text }}>{openQty}</span>
                  </>
                )}
              </>
            )}
          </span>
          {exitSummary.totalQty > 0 && (
            <span style={{ color: C.sub }}>
              Realized P&L:{" "}
              <span style={{ color: realized >= 0 ? C.green : C.red }}>
                {realized >= 0 ? "+" : ""}
                {fmtINR(realized)}
              </span>
            </span>
          )}
          {entrySummary.totalQty > 0 && sl > 0 && (
            <span style={{ color: C.sub }}>
              Risk @ SL:{" "}
              <span style={{ color: C.accent }}>
                {fmtINR(
                  Math.max(
                    0,
                    (entrySummary.avg - sl) * entrySummary.totalQty,
                  ),
                )}
              </span>
            </span>
          )}
        </div>
      )}
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Mistakes</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {MISTAKE_OPTIONS.map((m) => {
            const on = selectedMistakes.includes(m);
            return (
              <button
                type="button"
                key={m}
                onClick={() => toggleMistake(m)}
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  letterSpacing: "1px",
                  padding: "7px 12px",
                  borderRadius: 999,
                  border: `1px solid ${on ? C.red : C.border}`,
                  background: on ? C.redDim : "transparent",
                  color: on ? C.red : C.sub,
                  cursor: "pointer",
                }}
              >
                {on ? "✓ " : ""}
                {m}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Notes</label>
        <input
          style={fieldStyle}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          disabled={saving}
          onClick={submit}
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            letterSpacing: "2px",
            padding: "10px 18px",
            borderRadius: 6,
            border: `1px solid ${C.accent}`,
            background: C.accentDim,
            color: C.accent,
            cursor: saving ? "wait" : "pointer",
            textTransform: "uppercase",
          }}
        >
          {saving ? "Saving…" : initial ? "Update" : "Save Trade"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              letterSpacing: "2px",
              padding: "10px 18px",
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.sub,
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}


// `aggregateClosed` is imported from ./swingMath at the top of this file.

function BreakdownTable({ title, rows }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ flex: 1, minWidth: 280 }}>
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          letterSpacing: "2px",
          color: C.sub,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12.5,
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
              <th style={{ padding: "10px 14px", textAlign: "left" }}>Label</th>
              <th style={{ padding: "10px 14px", textAlign: "right" }}>N</th>
              <th style={{ padding: "10px 14px", textAlign: "right" }}>Win %</th>
              <th style={{ padding: "10px 14px", textAlign: "right" }}>Avg R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: "10px 14px", color: C.text }}>{r.label}</td>
                <td
                  style={{
                    padding: "10px 14px",
                    textAlign: "right",
                    fontFamily: "'DM Mono', monospace",
                    color: C.sub,
                  }}
                >
                  {r.n}
                </td>
                <td
                  style={{
                    padding: "10px 14px",
                    textAlign: "right",
                    fontFamily: "'DM Mono', monospace",
                    color: r.winRate >= 50 ? C.green : C.red,
                  }}
                >
                  {r.winRate.toFixed(0)}%
                </td>
                <td
                  style={{
                    padding: "10px 14px",
                    textAlign: "right",
                    fontFamily: "'DM Mono', monospace",
                    color: r.avgR >= 1 ? C.green : r.avgR >= 0 ? C.accent : C.red,
                  }}
                >
                  {r.avgR.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Realized-only equity curve. Uses booked P&L (your entered exit prices)
// — never LTP — so the line tracks actual cash movements regardless of
// GOOGLEFINANCE drift.
function EquityCurveChart({ trades }) {
  const data = useMemo(() => equityCurve(trades || []), [trades]);

  if (data.length === 0) return null;

  const last = data[data.length - 1];
  const lineColor = last.cumulative >= 0 ? C.green : C.red;

  return (
    <div style={{ marginBottom: 28 }}>
      <SectionTitle>Equity Curve · Realized P&L Over Time</SectionTitle>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "20px 22px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: "2px",
              color: C.sub,
              textTransform: "uppercase",
            }}
          >
            Booked P&L by exit date · cumulative line
          </div>
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 12,
              color: lineColor,
            }}
            title="Total realized P&L to date — matches the Realized P&L tile."
          >
            {(last.cumulative >= 0 ? "+" : "") + fmtINR(last.cumulative)}
            <span style={{ color: C.muted, marginLeft: 8 }}>
              · {data.length} {data.length === 1 ? "day" : "days"}
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                fill: C.sub,
              }}
              axisLine={false}
              tickLine={false}
              minTickGap={20}
            />
            <YAxis
              tick={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                fill: C.sub,
              }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => {
                const abs = Math.abs(v);
                if (abs >= 1e7) return `${(v / 1e7).toFixed(1)}cr`;
                if (abs >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
                if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
                return String(v);
              }}
              width={50}
            />
            <ReferenceLine y={0} stroke={C.muted} strokeDasharray="4 4" />
            <Tooltip
              contentStyle={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
              }}
              cursor={{ stroke: C.accent, strokeWidth: 1 }}
              formatter={(value, name) => [
                (value >= 0 ? "+" : "") + fmtINR(value),
                name === "daily" ? "Daily" : "Cumulative",
              ]}
              labelFormatter={(l) => l}
            />
            <Bar dataKey="daily" radius={[2, 2, 0, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.daily >= 0 ? C.green : C.red}
                  fillOpacity={0.45}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PerformanceBreakdown({ closed }) {
  if (closed.length === 0) return null;

  const byMarket = MARKET_CONDITIONS.map((mc) => {
    const subset = closed.filter((t) => t.marketCondition === mc);
    return { label: mc, ...aggregateClosed(subset) };
  }).filter((r) => r.n > 0);

  const byMistake = MISTAKE_OPTIONS.map((mk) => {
    const subset = closed.filter((t) =>
      (t.mistakes || "")
        .split(",")
        .map((s) => s.trim())
        .includes(mk),
    );
    return { label: mk, ...aggregateClosed(subset) };
  }).filter((r) => r.n > 0);

  // "Clean" trades = closed with no mistake tag.
  const clean = closed.filter((t) => !(t.mistakes || "").trim());
  if (clean.length > 0) {
    byMistake.unshift({ label: "— no mistakes —", ...aggregateClosed(clean) });
  }

  if (byMarket.length === 0 && byMistake.length === 0) return null;

  return (
    <>
      <SectionTitle>Performance Breakdown</SectionTitle>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <BreakdownTable title="By Market Condition" rows={byMarket} />
        <BreakdownTable title="By Mistake" rows={byMistake} />
      </div>
    </>
  );
}

export default function SwingTracker() {
  const [config, setConfig] = useState(loadConfig);
  const [trades, setTrades] = useState([]);
  const [settings, setSettingsState] = useState({ totalCapital: 0, riskPerTradePct: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [capitalDraft, setCapitalDraft] = useState("");
  const [riskPctDraft, setRiskPctDraft] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const hasConfig = !!(config.url && config.secret);

  // Central spot to apply a server response ({trades, settings}) to our state.
  const applyResponse = useCallback(({ trades: rawTrades, settings: rawSettings }) => {
    setTrades(rawTrades.map(normalizeTrade));
    const s = normalizeSettings(rawSettings || {});
    setSettingsState(s);
    setCapitalDraft(s.totalCapital ? String(s.totalCapital) : "");
    setRiskPctDraft(s.riskPerTradePct ? String(s.riskPerTradePct) : "");
  }, []);

  const refresh = useCallback(async () => {
    if (!hasConfig) return;
    setLoading(true);
    setErr(null);
    try {
      const resp = await fetchAll(config);
      applyResponse(resp);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [config, hasConfig, applyResponse]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const m = useMemo(() => computeMetrics(trades, settings), [trades, settings]);

  const handleSave = async (form) => {
    const entryLegs = cleanLegs(form.entries);
    const exitLegs = cleanLegs(form.exits);
    const entrySummary = summarizeLegs(entryLegs);
    const exitSummary = summarizeLegs(exitLegs);
    // Date == earliest entry leg, so Open P&L / age use the first buy.
    const firstEntryDate =
      entryLegs.reduce(
        (acc, l) => (l.date && (!acc || l.date < acc) ? l.date : acc),
        "",
      ) || form.date || new Date().toISOString().slice(0, 10);

    const trade = {
      date: firstEntryDate,
      symbol: form.symbol,
      stopLoss: parseFloat(form.stopLoss) || 0,
      status: form.status,
      notes: form.notes || "",
      marketCondition: form.marketCondition || "",
      strategy: form.strategy || "",
      chartLink: form.chartLink || "",
      mistakes: form.mistakes || "",
      // Derived summary fields (kept in the legacy columns for readability).
      entryPrice: Number(entrySummary.avg.toFixed(2)),
      qty: entrySummary.totalQty,
      exitPrice: Number(exitSummary.avg.toFixed(2)),
      exitDate: exitSummary.lastDate,
      // Canonical leg data.
      entries: entryLegs.length ? JSON.stringify(entryLegs) : "",
      exits: exitLegs.length ? JSON.stringify(exitLegs) : "",
      // LTP is auto-computed by GOOGLEFINANCE in the sheet — we don't send it.
    };
    if (editing) {
      const resp = await apiUpdateTrade(config, editing._row, trade);
      applyResponse(resp);
      setEditing(null);
      setFormOpen(false);
    } else {
      const resp = await apiAddTrade(config, trade);
      applyResponse(resp);
      setFormOpen(false);
    }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete trade: ${t.symbol}?`)) return;
    try {
      const resp = await apiDeleteTrade(config, t._row);
      applyResponse(resp);
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  const handleEdit = (t) => {
    setEditing(t);
    setFormOpen(true);
  };

  const handleCapitalSave = async () => {
    const value = parseFloat(capitalDraft) || 0;
    if (value === (settings.totalCapital || 0)) return;
    setSavingSettings(true);
    try {
      const resp = await apiSaveSettings(config, { totalCapital: value });
      applyResponse(resp);
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRiskPctSave = async () => {
    const value = parseFloat(riskPctDraft) || 0;
    if (value === (settings.riskPerTradePct || 0)) return;
    setSavingSettings(true);
    try {
      const resp = await apiSaveSettings(config, { riskPerTradePct: value });
      applyResponse(resp);
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  // Pre-populate the form with an exit leg at LTP for the unfilled qty.
  const handleQuickClose = (t) => {
    const today = new Date().toISOString().slice(0, 10);
    const entrySummary = summarizeLegs(t.entries || []);
    const exitSummary = summarizeLegs(t.exits || []);
    const remainingQty = Math.max(
      0,
      entrySummary.totalQty - exitSummary.totalQty,
    );
    const newExitLeg = {
      price: t.ltp ? String(t.ltp) : "",
      qty: remainingQty > 0 ? String(remainingQty) : "",
      date: today,
    };
    const existingExits = (t.exits || []).map((l) => ({
      price: String(l.price),
      qty: String(l.qty),
      date: l.date,
    }));
    setEditing({
      ...t,
      status: "Closed",
      exits: [...existingExits, newExitLeg].slice(0, MAX_LEGS),
    });
    setFormOpen(true);
  };

  const disconnect = () => {
    if (!window.confirm("Disconnect your sheet? Your data in Google Sheets stays untouched.")) return;
    clearConfig();
    setConfig({ url: "", secret: "" });
    setTrades([]);
    setSettingsState({ totalCapital: 0, riskPerTradePct: 0 });
    setCapitalDraft("");
    setRiskPctDraft("");
  };

  return (
    <div
      className="ts-page"
      style={{
        minHeight: "100vh",
        background: C.bg,
        fontFamily: "'Roboto', sans-serif",
        color: C.text,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Roboto:wght@400;600;700;800&display=swap');
        @keyframes fadeUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        * { box-sizing: border-box; }
        html, body { color-scheme: dark; }
        ::-webkit-scrollbar { width: 6px; height: 6px; } ::-webkit-scrollbar-track { background: ${C.bg}; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }

        /* Safari-safe select: kill native chrome, add custom caret, ensure dark popup.
           !important is needed because inline fieldStyle sets the 'background' shorthand,
           which would otherwise wipe background-image. */
        select {
          -webkit-appearance: none;
          -moz-appearance: none;
          appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path fill='%237a829b' d='M6 8L0 0h12z'/></svg>") !important;
          background-repeat: no-repeat !important;
          background-position: right 12px center !important;
          background-size: 10px 7px !important;
          padding-right: 32px !important;
          line-height: 1.2;
          color-scheme: dark;
          cursor: pointer;
        }
        select::-ms-expand { display: none; }
        select option { background: ${C.surface}; color: ${C.text}; }
        /* Match input vs select height across browsers (Safari adds extra px otherwise) */
        input, select, textarea { font: inherit; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }

        .stat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
        @media (max-width: 1100px) { .stat-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 800px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 500px) { .stat-grid { grid-template-columns: 1fr; } }

        .form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 16px; }
        @media (max-width: 700px) { .form-grid { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 480px) { .form-grid { grid-template-columns: 1fr; } }

        .leg-row { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 10px; align-items: end; margin-bottom: 10px; }
        @media (max-width: 600px) {
          .leg-row { grid-template-columns: 1fr 1fr auto; }
          .leg-row > .leg-date { grid-column: 1 / -1; }
        }

        .ts-page { padding: 40px 24px; }
        @media (max-width: 600px) { .ts-page { padding: 20px 14px; } }
      `}</style>

      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 24,
            flexWrap: "wrap",
            gap: 20,
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: C.accentDim,
                  border: `1px solid ${C.accent}50`,
                  borderRadius: 7,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                }}
              >
                ◈
              </div>
              <div
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  letterSpacing: "2px",
                  color: C.accent,
                }}
              >
                TRADESCOPE · SWING TRACKER
              </div>
            </div>
            <h1
              style={{
                fontSize: "clamp(28px, 4vw, 40px)",
                fontWeight: 800,
                letterSpacing: "-1px",
                lineHeight: 1.1,
              }}
            >
              Swing <span style={{ color: C.accent }}>Trades</span>
            </h1>
            <div
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
                color: C.sub,
                marginTop: 8,
              }}
            >
              Stocks · Live from Google Sheets
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Link
              to="/"
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                letterSpacing: "1px",
                padding: "8px 14px",
                borderRadius: 6,
                background: C.card,
                border: `1px solid ${C.border}`,
                color: C.sub,
                textDecoration: "none",
              }}
            >
              ← P&L Dashboard
            </Link>
            {hasConfig && (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 4px 4px 12px",
                    borderRadius: 6,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 10,
                      letterSpacing: "1.5px",
                      color: C.sub,
                      textTransform: "uppercase",
                    }}
                  >
                    Capital ₹
                  </span>
                  <input
                    type="number"
                    value={capitalDraft}
                    placeholder="0"
                    onChange={(e) => setCapitalDraft(e.target.value)}
                    onBlur={handleCapitalSave}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    disabled={savingSettings}
                    style={{
                      width: 100,
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 12,
                      padding: "6px 8px",
                      borderRadius: 4,
                      border: `1px solid ${C.border}`,
                      background: C.surface,
                      color: C.accent,
                      outline: "none",
                      textAlign: "right",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 4px 4px 12px",
                    borderRadius: 6,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                  }}
                  title="Risk per trade as a % of total capital. Used to suggest qty when adding a trade."
                >
                  <span
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 10,
                      letterSpacing: "1.5px",
                      color: C.sub,
                      textTransform: "uppercase",
                    }}
                  >
                    Risk %
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={riskPctDraft}
                    placeholder="1"
                    onChange={(e) => setRiskPctDraft(e.target.value)}
                    onBlur={handleRiskPctSave}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    disabled={savingSettings}
                    style={{
                      width: 60,
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 12,
                      padding: "6px 8px",
                      borderRadius: 4,
                      border: `1px solid ${C.border}`,
                      background: C.surface,
                      color: C.accent,
                      outline: "none",
                      textAlign: "right",
                    }}
                  />
                </div>
                <button
                  onClick={refresh}
                  disabled={loading}
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    letterSpacing: "1px",
                    padding: "8px 14px",
                    borderRadius: 6,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    color: C.sub,
                    cursor: loading ? "wait" : "pointer",
                  }}
                >
                  {loading ? "Loading…" : "↻ Refresh"}
                </button>
                <button
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(!formOpen);
                  }}
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    letterSpacing: "1px",
                    padding: "8px 14px",
                    borderRadius: 6,
                    background: C.accentDim,
                    border: `1px solid ${C.accent}`,
                    color: C.accent,
                    cursor: "pointer",
                  }}
                >
                  {formOpen ? "× Close" : "+ Add Trade"}
                </button>
                <button
                  onClick={disconnect}
                  title="Disconnect sheet"
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    letterSpacing: "1px",
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "transparent",
                    border: `1px solid ${C.border}`,
                    color: C.muted,
                    cursor: "pointer",
                  }}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>

        {!hasConfig ? (
          <SetupScreen
            onSave={(cfg) => {
              saveConfig(cfg);
              setConfig(cfg);
            }}
          />
        ) : (
          <>
            {err && (
              <div
                style={{
                  background: C.redDim,
                  border: `1px solid ${C.red}40`,
                  color: C.red,
                  padding: "10px 14px",
                  borderRadius: 6,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 12,
                  marginBottom: 16,
                }}
              >
                {err}
              </div>
            )}

            {(() => {
              // Risk-on-open warning banner. When the user has set a
              // per-trade risk target via Settings, banner thresholds
              // scale to multiples of that target (3× / 6×); otherwise
              // they fall back to the hardcoded 2% / 5% defaults.
              const r = assessRisk(m, settings);
              if (r.level === "ok") return null;
              const isDanger = r.level === "danger";
              return (
                <div
                  role="alert"
                  style={{
                    background: isDanger ? `${C.red}15` : `${C.accent}15`,
                    border: `1px solid ${isDanger ? C.red : C.accent}60`,
                    color: isDanger ? C.red : C.accent,
                    borderRadius: 10,
                    padding: "12px 16px",
                    marginBottom: 16,
                    fontSize: 13,
                    lineHeight: 1.45,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                  }}
                >
                  <span
                    style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}
                    aria-hidden="true"
                  >
                    {isDanger ? "⛔" : "⚠️"}
                  </span>
                  <span>{r.message}</span>
                </div>
              );
            })()}

            <div className="stat-grid">
              <StatCard
                label="Open P&L"
                value={fmtINR(m.openPnl)}
                sub={`${m.open.length} open · live via GOOGLEFINANCE`}
                color={m.openPnl >= 0 ? C.green : C.red}
              />
              <StatCard
                label="Risk on Open"
                value={fmtINR(m.openRisk)}
                sub={
                  settings.riskPerTradePct > 0
                    ? `${fmtPct(m.avgRiskPct)} of capital · target ${fmtPct(settings.riskPerTradePct)}`
                    : `${fmtPct(m.avgRiskPct)} of capital`
                }
                color={C.accent}
              />
              <StatCard
                label="Capital Deployed"
                value={fmtPct(m.capitalDeployedPct)}
                sub={`${fmtINR(m.capitalDeployed)} of ${fmtINR(m.latestCapital)}`}
                color={C.blue}
              />
              <StatCard
                label="R-Multiple (Closed)"
                value={m.avgR.toFixed(2)}
                sub={`${m.closed.length} closed`}
                color={m.avgR >= 1 ? C.green : m.avgR >= 0 ? C.accent : C.red}
              />
              <StatCard
                label="Realized P&L"
                value={
                  (m.realizedPnl >= 0 ? "+" : "") + fmtINR(m.realizedPnl)
                }
                sub={
                  m.closed.length > 0
                    ? `${m.wins}/${m.closed.length} wins · ${m.winRate.toFixed(0)}% win rate`
                    : m.realizedPnl !== 0
                      ? "from partial exits"
                      : "no exits booked"
                }
                color={
                  m.realizedPnl > 0
                    ? C.green
                    : m.realizedPnl < 0
                      ? C.red
                      : C.text
                }
              />
            </div>

            {formOpen && (
              <>
                <SectionTitle>{editing ? "Edit Trade" : "New Trade"}</SectionTitle>
                <TradeForm
                  initial={editing}
                  settings={settings}
                  onSubmit={handleSave}
                  onCancel={() => {
                    setEditing(null);
                    setFormOpen(false);
                  }}
                />
              </>
            )}

            <EquityCurveChart trades={trades} />
            <TradesTable
              title="Open Positions"
              trades={m.open}
              capital={m.latestCapital}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onQuickClose={handleQuickClose}
            />
            <PerformanceBreakdown closed={m.closed} />
            <TradesTable
              title="Closed Trades"
              trades={m.closedSorted}
              capital={m.latestCapital}
              onEdit={handleEdit}
              onDelete={handleDelete}
              paginate
              pageSize={10}
            />
          </>
        )}

        <div
          style={{
            textAlign: "center",
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: C.muted,
            paddingTop: 40,
            paddingBottom: 20,
          }}
        >
          TradeScope · Data lives in your Google Sheet
        </div>
      </div>
    </div>
  );
}
