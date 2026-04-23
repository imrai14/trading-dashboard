import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { APPS_SCRIPT_CODE, SHEET_HEADERS } from "./appsScriptCode";
import {
  loadConfig,
  saveConfig,
  clearConfig,
  fetchTrades,
  addTrade as apiAddTrade,
  updateTrade as apiUpdateTrade,
  deleteTrade as apiDeleteTrade,
  normalizeTrade,
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

function computeMetrics(trades) {
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
  const latestCapital =
    trades.length > 0
      ? trades[trades.length - 1].totalCapital ||
        trades.find((t) => t.totalCapital)?.totalCapital ||
        0
      : 0;
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

  // Planned R:R from still-open trades (target:stoploss relative to entry).
  const plannedRRs = open
    .map((t) => {
      const risk = t.entryPrice - t.stopLoss;
      const reward = t.target - t.entryPrice;
      if (risk <= 0) return null;
      return reward / risk;
    })
    .filter((v) => v !== null && isFinite(v));
  const avgPlannedRR =
    plannedRRs.length > 0
      ? plannedRRs.reduce((s, v) => s + v, 0) / plannedRRs.length
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
    avgPlannedRR,
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
  target: "",
  qty: "",
  totalCapital: "",
  status: "Open",
  exitPrice: "",
  exitDate: "",
  notes: "",
  ltp: "",
};

function TradeForm({ initial, onSubmit, onCancel, lastCapital }) {
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    totalCapital: lastCapital || "",
    ...(initial || {}),
  }));
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

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

  const Field = ({ k, label, type = "text", placeholder = "" }) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        style={fieldStyle}
        type={type}
        placeholder={placeholder}
        value={form[k] ?? ""}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );

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
        <Field k="date" label="Entry Date" type="date" />
        <Field k="symbol" label="Symbol" placeholder="e.g. RELIANCE" />
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
        <Field k="entryPrice" label="Entry Price" type="number" />
        <Field k="stopLoss" label="Stop Loss" type="number" />
        <Field k="target" label="Target" type="number" />
        <Field k="qty" label="Qty" type="number" />
        <Field k="totalCapital" label="Total Capital (₹)" type="number" />
        <Field k="ltp" label="LTP (for Open)" type="number" />
        {form.status === "Closed" && (
          <>
            <Field k="exitPrice" label="Exit Price" type="number" />
            <Field k="exitDate" label="Exit Date" type="date" />
          </>
        )}
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

function TradesTable({ title, trades, capital, onEdit, onDelete }) {
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
                <th style={{ padding: "12px 14px", textAlign: "right" }}>Target</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>Qty</th>
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
                        color: C.green,
                      }}
                    >
                      {t.target || "—"}
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

export default function SwingTracker() {
  const [config, setConfig] = useState(loadConfig);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const hasConfig = !!(config.url && config.secret);

  const refresh = useCallback(async () => {
    if (!hasConfig) return;
    setLoading(true);
    setErr(null);
    try {
      const raw = await fetchTrades(config);
      setTrades(raw.map(normalizeTrade));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [config, hasConfig]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const m = useMemo(() => computeMetrics(trades), [trades]);

  const handleSave = async (form) => {
    const trade = {
      ...form,
      entryPrice: parseFloat(form.entryPrice) || 0,
      stopLoss: parseFloat(form.stopLoss) || 0,
      target: parseFloat(form.target) || 0,
      qty: parseFloat(form.qty) || 0,
      totalCapital: parseFloat(form.totalCapital) || 0,
      exitPrice: parseFloat(form.exitPrice) || 0,
      ltp: parseFloat(form.ltp) || 0,
    };
    if (editing) {
      const next = await apiUpdateTrade(config, editing._row, trade);
      setTrades(next.map(normalizeTrade));
      setEditing(null);
      setFormOpen(false);
    } else {
      const next = await apiAddTrade(config, trade);
      setTrades(next.map(normalizeTrade));
      setFormOpen(false);
    }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete trade: ${t.symbol}?`)) return;
    try {
      const next = await apiDeleteTrade(config, t._row);
      setTrades(next.map(normalizeTrade));
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  const handleEdit = (t) => {
    setEditing(t);
    setFormOpen(true);
  };

  const disconnect = () => {
    if (!window.confirm("Disconnect your sheet? Your data in Google Sheets stays untouched.")) return;
    clearConfig();
    setConfig({ url: "", secret: "" });
    setTrades([]);
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
                sub={`${m.open.length} open · using LTP`}
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
                sub={`${m.closed.length} closed · planned R:R ${m.avgPlannedRR.toFixed(2)}`}
                color={m.avgR >= 1 ? C.green : m.avgR >= 0 ? C.accent : C.red}
              />
            </div>

            {formOpen && (
              <>
                <SectionTitle>{editing ? "Edit Trade" : "New Trade"}</SectionTitle>
                <TradeForm
                  initial={editing}
                  lastCapital={m.latestCapital}
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
            />
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
