import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  APPS_SCRIPT_CODE,
  SHEET_HEADERS,
  MISTAKE_OPTIONS,
  MARKET_CONDITIONS,
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

const C = {
  bg: "#07090f",
  surface: "#0d1018",
  card: "#111520",
  border: "#1c2035",
  accent: "#e8b84b",
  accentDim: "rgba(232,184,75,0.12)",
  red: "#f04060",
  redDim: "rgba(240,64,96,0.12)",
  green: "#00d68f",
  greenDim: "rgba(0,214,143,0.12)",
  blue: "#4488ff",
  blueDim: "rgba(68,136,255,0.12)",
  text: "#dde2f0",
  sub: "#7880a0",
  muted: "#3a4060",
};

const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtPct = (n) => `${(n || 0).toFixed(2)}%`;

// Days between two ISO date strings; second arg null means "today".
function daysBetween(from, to) {
  if (!from) return null;
  const a = new Date(from);
  const b = to ? new Date(to) : new Date();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

export function tradeAge(t) {
  if (t.status?.toLowerCase() === "open") return daysBetween(t.date, null);
  return daysBetween(t.date, t.exitDate);
}

// Total Capital now lives in the Settings sheet. Fall back to the most
// recent per-trade value so users migrating from the old schema still see
// sane metrics until they set a capital value.
function resolveCapital(trades, settings) {
  if (settings?.totalCapital) return settings.totalCapital;
  for (let i = trades.length - 1; i >= 0; i--) {
    const c = parseFloat(trades[i].totalCapital);
    if (c) return c;
  }
  return 0;
}

function computeMetrics(trades, settings) {
  const open = trades.filter((t) => t.status?.toLowerCase() === "open");
  const closed = trades.filter((t) => t.status?.toLowerCase() === "closed");

  const openPnl = open.reduce(
    (s, t) => s + (t.ltp ? (t.ltp - t.entryPrice) * t.qty : 0),
    0,
  );
  const capitalDeployed = open.reduce(
    (s, t) => s + t.entryPrice * t.qty,
    0,
  );
  const latestCapital = resolveCapital(trades, settings);
  const capitalDeployedPct = latestCapital
    ? (capitalDeployed / latestCapital) * 100
    : 0;

  const openRisk = open.reduce(
    (s, t) => s + Math.max(0, (t.entryPrice - t.stopLoss) * t.qty),
    0,
  );
  const avgRiskPct = latestCapital ? (openRisk / latestCapital) * 100 : 0;

  const rMultiples = closed
    .map((t) => {
      const risk = (t.entryPrice - t.stopLoss) * t.qty;
      const reward = (t.exitPrice - t.entryPrice) * t.qty;
      if (!risk) return null;
      return reward / risk;
    })
    .filter((v) => v !== null && isFinite(v));

  const avgR =
    rMultiples.length > 0
      ? rMultiples.reduce((s, v) => s + v, 0) / rMultiples.length
      : 0;

  return {
    open,
    closed,
    openPnl,
    capitalDeployed,
    capitalDeployedPct,
    latestCapital,
    openRisk,
    avgRiskPct,
    avgR,
  };
}

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

function SectionTitle({ children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginBottom: 18,
        marginTop: 36,
      }}
    >
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          letterSpacing: "3px",
          color: C.sub,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </div>
      <div style={{ flex: 1, height: 1, background: C.border }} />
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
  entryPrice: "",
  stopLoss: "",
  qty: "",
  status: "Open",
  exitPrice: "",
  exitDate: "",
  notes: "",
  marketCondition: "",
  chartLink: "",
  mistakes: "", // stored as CSV of mistake labels
};

function Field({ k, label, type = "text", placeholder = "", value, onChange }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        style={fieldStyle}
        type={type}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(k, e.target.value)}
      />
    </div>
  );
}

function TradeForm({ initial, onSubmit, onCancel, settings }) {
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    ...(initial || {}),
  }));
  const [saving, setSaving] = useState(false);

  const set = useCallback((k, v) => setForm((f) => ({ ...f, [k]: v })), []);

  // Auto-qty: (capital × risk%) / (entry − SL). Zero if any input is missing.
  const entry = parseFloat(form.entryPrice) || 0;
  const sl = parseFloat(form.stopLoss) || 0;
  const capital = settings?.totalCapital || 0;
  const riskPct = settings?.riskPerTradePct || 0;
  const perShareRisk = entry - sl;
  const suggestedQty =
    capital > 0 && riskPct > 0 && perShareRisk > 0
      ? Math.max(1, Math.floor((capital * (riskPct / 100)) / perShareRisk))
      : 0;

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
    if (!form.symbol || !form.entryPrice || !form.stopLoss || !form.qty) {
      alert("Symbol, Entry, Stop Loss, and Qty are required.");
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 16,
        }}
      >
        <Field k="date" label="Entry Date" type="date" value={form.date} onChange={set} />
        <Field k="symbol" label="Symbol" placeholder="e.g. RELIANCE" value={form.symbol} onChange={set} />
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
        <Field k="entryPrice" label="Entry Price" type="number" value={form.entryPrice} onChange={set} />
        <Field k="stopLoss" label="Stop Loss" type="number" value={form.stopLoss} onChange={set} />
        <div>
          <label style={labelStyle}>Qty</label>
          <input
            style={fieldStyle}
            type="number"
            value={form.qty ?? ""}
            onChange={(e) => set("qty", e.target.value)}
          />
          {suggestedQty > 0 && Number(form.qty) !== suggestedQty && (
            <button
              type="button"
              onClick={() => set("qty", String(suggestedQty))}
              style={{
                marginTop: 6,
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
              title={`${riskPct}% of ${fmtINR(capital)} ÷ (${entry} − ${sl})`}
            >
              use {suggestedQty} ({riskPct}% risk)
            </button>
          )}
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
        <Field
          k="chartLink"
          label="Chart Link"
          type="url"
          placeholder="https://…"
          value={form.chartLink}
          onChange={set}
        />
        {form.status === "Closed" && (
          <>
            <Field k="exitPrice" label="Exit Price" type="number" value={form.exitPrice} onChange={set} />
            <Field k="exitDate" label="Exit Date" type="date" value={form.exitDate} onChange={set} />
          </>
        )}
      </div>
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

function TradesTable({ title, trades, capital, onEdit, onDelete, onQuickClose }) {
  if (trades.length === 0) {
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
                <th style={{ padding: "12px 14px", textAlign: "left" }}>Symbol</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>Entry</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>SL</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>Qty</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>Age</th>
                <th style={{ padding: "12px 14px", textAlign: "left" }}>Context</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>Risk</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>P&L</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>R-mult</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const risk = Math.max(0, (t.entryPrice - t.stopLoss) * t.qty);
                const riskPct = capital ? (risk / capital) * 100 : 0;
                const isOpen = t.status?.toLowerCase() === "open";
                const pnl = isOpen
                  ? t.ltp
                    ? (t.ltp - t.entryPrice) * t.qty
                    : 0
                  : (t.exitPrice - t.entryPrice) * t.qty;
                const rMult =
                  risk > 0
                    ? (isOpen
                        ? (t.ltp - t.entryPrice) * t.qty
                        : (t.exitPrice - t.entryPrice) * t.qty) / risk
                    : 0;
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
                      }}
                    >
                      {t.symbol}
                      <div
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 10,
                          color: C.muted,
                          marginTop: 2,
                        }}
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
                    >
                      {t.entryPrice}
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        textAlign: "right",
                        fontFamily: "'DM Mono', monospace",
                        color: C.red,
                      }}
                    >
                      {t.stopLoss}
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        textAlign: "right",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      {t.qty}
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
                      {onQuickClose && t.status?.toLowerCase() === "open" && (
                        <button
                          onClick={() => onQuickClose(t)}
                          title={t.ltp ? `Close @ LTP ${t.ltp}` : "Close (enter exit price)"}
                          style={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 10,
                            padding: "5px 9px",
                            borderRadius: 4,
                            border: `1px solid ${C.green}40`,
                            background: C.greenDim,
                            color: C.green,
                            cursor: "pointer",
                            marginRight: 6,
                          }}
                        >
                          close
                        </button>
                      )}
                      <button
                        onClick={() => onEdit(t)}
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 10,
                          padding: "5px 9px",
                          borderRadius: 4,
                          border: `1px solid ${C.border}`,
                          background: "transparent",
                          color: C.sub,
                          cursor: "pointer",
                          marginRight: 6,
                        }}
                      >
                        edit
                      </button>
                      <button
                        onClick={() => onDelete(t)}
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 10,
                          padding: "5px 9px",
                          borderRadius: 4,
                          border: `1px solid ${C.redDim}`,
                          background: "transparent",
                          color: C.red,
                          cursor: "pointer",
                        }}
                      >
                        del
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Compute count / win-rate / avg-R over an array of closed trades.
function aggregateClosed(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0, winRate: 0, avgR: 0 };
  let wins = 0;
  let rSum = 0;
  let rCount = 0;
  for (const t of trades) {
    const risk = (t.entryPrice - t.stopLoss) * t.qty;
    const reward = (t.exitPrice - t.entryPrice) * t.qty;
    if (reward > 0) wins++;
    if (risk > 0 && isFinite(reward / risk)) {
      rSum += reward / risk;
      rCount++;
    }
  }
  return {
    n,
    winRate: (wins / n) * 100,
    avgR: rCount ? rSum / rCount : 0,
  };
}

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
    const trade = {
      ...form,
      entryPrice: parseFloat(form.entryPrice) || 0,
      stopLoss: parseFloat(form.stopLoss) || 0,
      qty: parseFloat(form.qty) || 0,
      exitPrice: parseFloat(form.exitPrice) || 0,
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

  // Pre-populate the form with today's date + LTP so the user just hits Save.
  const handleQuickClose = (t) => {
    setEditing({
      ...t,
      status: "Closed",
      exitPrice: t.ltp || t.exitPrice || "",
      exitDate: new Date().toISOString().slice(0, 10),
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
      style={{
        minHeight: "100vh",
        background: C.bg,
        fontFamily: "'Roboto', sans-serif",
        color: C.text,
        padding: "40px 24px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Roboto:wght@400;600;700;800&display=swap');
        @keyframes fadeUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${C.bg}; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        @media (max-width: 800px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 500px) { .stat-grid { grid-template-columns: 1fr; } }
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
                sub={`${fmtPct(m.avgRiskPct)} of capital`}
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
              trades={m.closed}
              capital={m.latestCapital}
              onEdit={handleEdit}
              onDelete={handleDelete}
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
