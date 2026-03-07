import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { RadialBarChart, RadialBar, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, ReferenceLine } from "recharts";

// ─── Palette ────────────────────────────────────────────────
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
  purple: "#a855f7",
  text: "#dde2f0",
  sub: "#7880a0",
  muted: "#3a4060",
};

// ─── CSV Parser ──────────────────────────────────────────────
function parseDhanCSV(text) {
  const lines = text.split(/\r?\n/);
  let headerIdx = lines.findIndex(l => l.includes("Scrip Name"));
  if (headerIdx === -1) return null;

  const trades = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("Net P&L") || line.startsWith("NOTE")) continue;
    const row = line.match(/(".*?"|[^,]+)(?=,|$)/g)?.map(v => v.replace(/^"|"$/g, "").replace(/,/g, ""));
    if (!row || row.length < 10) continue;
    try {
      const pnl = parseFloat(row[8]);
      const pnlPct = parseFloat(row[9]);
      if (isNaN(pnl)) continue;
      trades.push({
        name: row[0],
        buyQty: parseFloat(row[1]),
        avgBuy: parseFloat(row[2]),
        buyVal: parseFloat(row[3]),
        sellQty: parseFloat(row[4]),
        avgSell: parseFloat(row[5]),
        sellVal: parseFloat(row[6]),
        pnl,
        pnlPct,
      });
    } catch {}
  }

  // Extract summary
  const summaryLine = lines.find(l => l.startsWith("Net P&L"));
  let netPnl = 0, brokerage = 0, grossPnl = 0, totalCharges = 0;
  if (summaryLine) {
    const parts = summaryLine.split(",");
    netPnl = parseFloat(parts[1]) || 0;
    brokerage = parseFloat(parts[3]) || 0;
    grossPnl = parseFloat(parts[5]) || 0;
    totalCharges = parseFloat(parts[7]) || 0;
  }

  // Date range from header
  const headerLine = lines[0] || "";
  const dateMatch = headerLine.match(/From (.+?) to (.+)/);
  const dateRange = dateMatch ? `${dateMatch[1]} – ${dateMatch[2]}` : "Period";

  return { trades, netPnl, brokerage, grossPnl, totalCharges, dateRange };
}

function computeMetrics(data) {
  const { trades, netPnl, brokerage, grossPnl, totalCharges } = data;
  const winners = trades.filter(t => t.pnl > 0);
  const losers = trades.filter(t => t.pnl < 0);
  const totalProfit = winners.reduce((s, t) => s + t.pnl, 0);
  const totalLoss = losers.reduce((s, t) => s + t.pnl, 0);
  const winRate = (winners.length / trades.length) * 100;
  const avgWin = totalProfit / (winners.length || 1);
  const avgLoss = Math.abs(totalLoss) / (losers.length || 1);
  const rrRatio = avgWin / (avgLoss || 1);
  const profitFactor = Math.abs(totalProfit / (totalLoss || 1));
  const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss;
  const totalCapital = trades.reduce((s, t) => s + t.buyVal, 0);
  const chargesPct = (totalCharges / Math.abs(netPnl || 1)) * 100;
  const breakevenWinRate = (avgLoss / (avgWin + avgLoss)) * 100;

  // Distribution
  const buckets = [
    { label: "< −5%", min: -Infinity, max: -5, count: 0, color: C.red },
    { label: "−5 to −3%", min: -5, max: -3, count: 0, color: "#d03050" },
    { label: "−3 to 0%", min: -3, max: 0, count: 0, color: "#803848" },
    { label: "0 to 3%", min: 0, max: 3, count: 0, color: "#286050" },
    { label: "3 to 5%", min: 3, max: 5, count: 0, color: "#00a070" },
    { label: "> 5%", min: 5, max: Infinity, count: 0, color: C.green },
  ];
  trades.forEach(t => {
    const b = buckets.find(b => t.pnlPct >= b.min && t.pnlPct < b.max);
    if (b) b.count++;
  });

  // Cumulative PnL
  const sorted = [...trades].sort((a, b) => a.pnlPct - b.pnlPct); // approx order
  let cum = 0;
  const cumPnl = trades.map((t, i) => { cum += t.pnl; return { trade: i + 1, pnl: +cum.toFixed(0) }; });

  // Top performers
  const topWinners = [...winners].sort((a, b) => b.pnl - a.pnl).slice(0, 5);
  const topLosers = [...losers].sort((a, b) => a.pnl - b.pnl).slice(0, 5);

  return {
    trades, netPnl, brokerage, grossPnl, totalCharges,
    winners, losers, winRate, avgWin, avgLoss, rrRatio,
    profitFactor, expectancy, totalCapital, chargesPct,
    breakevenWinRate, buckets, cumPnl, topWinners, topLosers,
    totalProfit, totalLoss,
  };
}

// ─── Sub Components ─────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const fmtNum = (n) => n.toFixed(2);

function StatCard({ label, value, sub, color = C.text, accent = false, delay = 0 }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: "20px 22px", position: "relative", overflow: "hidden",
      animation: `fadeUp 0.5s ease both`, animationDelay: `${delay}ms`,
    }}>
      {accent && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "10px 10px 0 0" }} />}
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "2px", color: C.sub, textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: "-0.5px", fontFamily: "'Clash Display', 'Roboto', sans-serif" }}>{value}</div>
      {sub && <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, marginTop: 36 }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "3px", color: C.sub, textTransform: "uppercase", whiteSpace: "nowrap" }}>{children}</div>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

function InsightCard({ badge, badgeColor, title, body, num, delay = 0 }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: "22px 24px", position: "relative", overflow: "hidden",
      animation: `fadeUp 0.5s ease both`, animationDelay: `${delay}ms`,
    }}>
      <div style={{
        position: "absolute", right: -6, top: -10,
        fontSize: 72, fontWeight: 900, color: "rgba(255,255,255,0.03)",
        fontFamily: "sans-serif", pointerEvents: "none", userSelect: "none",
      }}>{num}</div>
      <div style={{
        display: "inline-block", fontFamily: "'DM Mono', monospace", fontSize: 9,
        letterSpacing: "2px", padding: "3px 9px", borderRadius: 3, marginBottom: 12,
        background: `${badgeColor}18`, color: badgeColor, border: `1px solid ${badgeColor}40`,
        textTransform: "uppercase",
      }}>{badge}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: C.text }}>{title}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.75, color: C.sub }} dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}

// ─── Upload Screen ───────────────────────────────────────────
function UploadScreen({ onData }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const handle = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = (e) => {
      const parsed = parseDhanCSV(e.target.result);
      if (parsed && parsed.trades.length > 0) onData(parsed);
      else alert("Could not parse file. Please upload a valid Dhan P&L CSV.");
    };
    r.readAsText(file);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, fontFamily: "'Roboto', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Roboto:wght@400;500;700;900&display=swap');
        @keyframes fadeUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:0.4;} 50%{opacity:1;} }
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.bg}; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${C.bg}; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      <div style={{ maxWidth: 520, width: "100%", animation: "fadeUp 0.6s ease both" }}>
        {/* Logo mark */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 48 }}>
          <div style={{ width: 36, height: 36, background: C.accentDim, border: `1px solid ${C.accent}40`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 18 }}>◈</span>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.text, letterSpacing: "-0.3px" }}>TradeScope</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.sub, letterSpacing: "1px" }}>SWING ANALYTICS</div>
          </div>
        </div>

        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "2px", color: C.accent, marginBottom: 14, textTransform: "uppercase" }}>Upload Your Trade Log</div>
        <h1 style={{ fontSize: 38, fontWeight: 800, color: C.text, letterSpacing: "-1px", lineHeight: 1.15, marginBottom: 16 }}>
          Turn your trades into<br /><span style={{ color: C.accent }}>actionable insights</span>
        </h1>
        <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.7, marginBottom: 40 }}>
          Upload your Dhan P&L CSV export. Your data stays in your browser — nothing is uploaded to any server. Drop a new file anytime to refresh.
        </p>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0]); }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? C.accent : C.border}`,
            borderRadius: 12, padding: "48px 32px", textAlign: "center",
            cursor: "pointer", transition: "all 0.2s",
            background: dragging ? C.accentDim : C.card,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 14 }}>{dragging ? "📂" : "📊"}</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: C.text, marginBottom: 8 }}>
            {dragging ? "Drop it!" : "Drop your Dhan P&L CSV here"}
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: C.sub }}>or click to browse files</div>
          <input ref={inputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handle(e.target.files[0])} />
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 20, justifyContent: "center" }}>
          {["✓ Instant analysis", "✓ 15+ metrics", "✓ 100% private"].map(s => (
            <div key={s} style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.muted }}>{s}</div>
          ))}
        </div>

        {/* How to export */}
        <div style={{ marginTop: 40, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "18px 22px" }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "2px", color: C.accent, marginBottom: 12, textTransform: "uppercase" }}>How to export from Dhan</div>
          {["Open Dhan app or website", "Go to Reports → P&L Statement", "Set your date range", "Click Export → Download CSV", "Drop the file above"].map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: C.accentDim, border: `1px solid ${C.accent}40`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.accent }}>{i + 1}</span>
              </div>
              <div style={{ fontSize: 13, color: C.sub, paddingTop: 2 }}>{s}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────
function Dashboard({ rawData, onReset }) {
  const m = useMemo(() => computeMetrics(rawData), [rawData]);
  const inputRef = useRef();

  const handleNewFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = (e) => {
      const parsed = parseDhanCSV(e.target.result);
      if (parsed && parsed.trades.length > 0) onReset(parsed);
    };
    r.readAsText(file);
  };

  const winRatePieData = [
    { name: "Win", value: m.winners.length },
    { name: "Loss", value: m.losers.length },
  ];

  const insights = [
    {
      badge: m.winRate < 35 ? "🔴 Critical" : "🟡 Monitor",
      badgeColor: m.winRate < 35 ? C.red : C.accent,
      title: `Win Rate ${fmtNum(m.winRate)}% — Need ${fmtNum(m.breakevenWinRate)}% to Break Even`,
      body: `With your R:R of <strong>${fmtNum(m.rrRatio)}x</strong>, you need at least <strong>${fmtNum(m.breakevenWinRate)}%</strong> win rate to be profitable. You're ${m.winRate < m.breakevenWinRate ? `<strong style="color:${C.red}">${fmtNum(m.breakevenWinRate - m.winRate)}% short</strong>` : `<strong style="color:${C.green}">above breakeven ✓</strong>`}. Focus on adding 1–2 confirmation filters (volume surge + EMA alignment) before every entry.`,
      num: "01",
    },
    {
      badge: "🔴 Critical",
      badgeColor: C.red,
      title: "Losses Not Being Cut Early Enough",
      body: `${m.losers.filter(t => t.pnlPct < -3).length} of your ${m.losers.length} losing trades fell below −3%. This signals missing or late stop losses. Set a <strong>hard stop at −2%</strong> on every trade at entry. Never move a stop loss wider. This single rule can cut your total losses by 30–40%.`,
      num: "02",
    },
    {
      badge: m.rrRatio > 1.5 ? "🟢 Strength" : "🟡 Improve",
      badgeColor: m.rrRatio > 1.5 ? C.green : C.accent,
      title: `R:R of ${fmtNum(m.rrRatio)}x — Let Winners Run Longer`,
      body: `Your avg win is <strong>${fmt(m.avgWin)}</strong> vs avg loss of <strong>${fmt(m.avgLoss)}</strong>. ${m.rrRatio > 1.5 ? "Good structure! But" : "This needs improvement."} Many winning trades are being exited too early. Use a <strong>trailing stop</strong> — once +4%, trail 2% below. Let multibaggers like your top winners breathe.`,
      num: "03",
    },
    {
      badge: m.chargesPct > 30 ? "🟡 Warning" : "✅ Okay",
      badgeColor: m.chargesPct > 30 ? C.accent : C.green,
      title: `Charges Eating ${fmtNum(m.chargesPct)}% of Your Net Loss`,
      body: `You paid <strong>${fmt(m.totalCharges)}</strong> in brokerage + STT + exchange fees across ${m.trades.length} trades. That's ~<strong>${fmt(m.totalCharges / m.trades.length)}/trade</strong>. Reduce trade frequency — aim for 4–5 high-conviction trades/month instead of ${(m.trades.length / 11).toFixed(0)}/month.`,
      num: "04",
    },
    {
      badge: m.expectancy < 0 ? "🔴 Negative Edge" : "🟢 Positive Edge",
      badgeColor: m.expectancy < 0 ? C.red : C.green,
      title: `Expectancy: ${fmt(m.expectancy)} Per Trade`,
      body: `Every trade you take is statistically expected to ${m.expectancy < 0 ? `<strong style="color:${C.red}">lose ${fmt(Math.abs(m.expectancy))}</strong>` : `<strong style="color:${C.green}">gain ${fmt(m.expectancy)}</strong>`}. Breakeven formula: Win% = Loss ÷ (Win + Loss) = ${fmtNum(m.breakevenWinRate)}%. Your actual: ${fmtNum(m.winRate)}%. The math must work before scaling capital.`,
      num: "05",
    },
    {
      badge: m.profitFactor > 1 ? "🟢 Good" : "🔴 Below 1",
      badgeColor: m.profitFactor > 1 ? C.green : C.red,
      title: `Profit Factor: ${fmtNum(m.profitFactor)} (Need > 1.5)`,
      body: `Profit factor = Total Profits ÷ Total Losses = <strong>${fmt(m.totalProfit)} ÷ ${fmt(Math.abs(m.totalLoss))}</strong>. A PF of 1.5+ means the system is robust. Below 1 means the system is losing. Target: Improve win rate OR widen winners — both improve profit factor significantly.`,
      num: "06",
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Roboto', sans-serif", color: C.text, padding: "40px 24px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Roboto:wght@400;600;700;800&display=swap');
        @keyframes fadeUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${C.bg}; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .ig { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 800px) { .grid2,.grid3,.grid4,.ig { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 500px) { .grid2,.grid3,.grid4,.ig { grid-template-columns: 1fr; } }
        .trade-row:hover { background: #161a28 !important; }
        .upload-btn:hover { background: ${C.accentDim} !important; border-color: ${C.accent} !important; }
      `}</style>

      <div style={{ maxWidth: 1120, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 40, flexWrap: "wrap", gap: 20, animation: "fadeUp 0.4s ease both" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 32, height: 32, background: C.accentDim, border: `1px solid ${C.accent}50`, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>◈</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "2px", color: C.accent }}>TRADESCOPE · SWING ANALYTICS</div>
            </div>
            <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, letterSpacing: "-1px", lineHeight: 1.1 }}>
              Your Trading <span style={{ color: C.accent }}>Dashboard</span>
            </h1>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: C.sub, marginTop: 8 }}>
              {rawData.dateRange} · {m.trades.length} trades · {fmt(m.totalCapital)} deployed
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{
              fontFamily: "'DM Mono', monospace", fontSize: 11,
              padding: "8px 14px", borderRadius: 6,
              background: m.netPnl >= 0 ? C.greenDim : C.redDim,
              border: `1px solid ${m.netPnl >= 0 ? C.green : C.red}40`,
              color: m.netPnl >= 0 ? C.green : C.red,
              fontWeight: 500,
            }}>
              NET {m.netPnl >= 0 ? "+" : ""}{fmt(m.netPnl)}
            </div>
            <button
              className="upload-btn"
              onClick={() => inputRef.current?.click()}
              style={{
                fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: "1px",
                padding: "8px 16px", borderRadius: 6, cursor: "pointer",
                background: C.card, border: `1px solid ${C.border}`, color: C.sub,
                transition: "all 0.2s",
              }}>
              ↑ New File
            </button>
            <input ref={inputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handleNewFile(e.target.files[0])} />
          </div>
        </div>

        {/* Top Stats */}
        <div className="grid4">
          <StatCard label="Net P&L" value={fmt(m.netPnl)} sub="after all charges" color={m.netPnl >= 0 ? C.green : C.red} accent delay={50} />
          <StatCard label="Win Rate" value={`${fmtNum(m.winRate)}%`} sub={`${m.winners.length}W / ${m.losers.length}L of ${m.trades.length}`} color={m.winRate >= m.breakevenWinRate ? C.green : C.red} accent delay={100} />
          <StatCard label="Profit Factor" value={fmtNum(m.profitFactor)} sub="need > 1.5 to be robust" color={m.profitFactor >= 1.5 ? C.green : m.profitFactor >= 1 ? C.accent : C.red} accent delay={150} />
          <StatCard label="Expectancy" value={fmt(m.expectancy)} sub="expected P&L per trade" color={m.expectancy >= 0 ? C.green : C.red} accent delay={200} />
        </div>

        {/* Second row stats */}
        <div className="grid4" style={{ marginTop: 12 }}>
          <StatCard label="Avg Win" value={fmt(m.avgWin)} color={C.green} delay={250} />
          <StatCard label="Avg Loss" value={`−${fmt(m.avgLoss)}`} color={C.red} delay={280} />
          <StatCard label="Risk : Reward" value={`1 : ${fmtNum(m.rrRatio)}`} color={C.blue} delay={310} />
          <StatCard label="Total Charges" value={fmt(m.totalCharges)} sub={`${fmtNum(m.chargesPct)}% of net loss`} color={C.accent} delay={340} />
        </div>

        {/* Charts Row */}
        <SectionTitle>Visual Analytics</SectionTitle>
        <div className="grid2" style={{ marginBottom: 20 }}>

          {/* Win/Loss Pie */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 24, animation: "fadeUp 0.5s ease both", animationDelay: "200ms" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "2px", color: C.sub, textTransform: "uppercase", marginBottom: 20 }}>Win / Loss Split</div>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={winRatePieData} cx="50%" cy="50%" innerRadius={42} outerRadius={62} paddingAngle={3} dataKey="value" startAngle={90} endAngle={-270}>
                    <Cell fill={C.green} />
                    <Cell fill={C.red} />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {[
                  { label: "Winners", val: m.winners.length, color: C.green, amt: fmt(m.totalProfit) },
                  { label: "Losers", val: m.losers.length, color: C.red, amt: `−${fmt(Math.abs(m.totalLoss))}` },
                ].map(r => (
                  <div key={r.label} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: r.color }} />
                        <span style={{ fontSize: 13, color: C.sub }}>{r.label}: {r.val}</span>
                      </div>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: r.color }}>{r.amt}</span>
                    </div>
                    <div style={{ height: 5, background: C.border, borderRadius: 3 }}>
                      <div style={{ width: `${(r.val / m.trades.length) * 100}%`, height: "100%", background: r.color, borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 16, padding: "10px 14px", background: "#0a0c14", borderRadius: 6, fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.sub }}>
                  Breakeven win rate: <span style={{ color: C.accent }}>{fmtNum(m.breakevenWinRate)}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Return Distribution */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 24, animation: "fadeUp 0.5s ease both", animationDelay: "250ms" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "2px", color: C.sub, textTransform: "uppercase", marginBottom: 20 }}>Return % Distribution</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={m.buckets} barSize={28}>
                <XAxis dataKey="label" tick={{ fontFamily: "'DM Mono', monospace", fontSize: 9, fill: C.sub }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontFamily: "'DM Mono', monospace", fontSize: 10, fill: C.sub }} axisLine={false} tickLine={false} width={24} />
                <Tooltip
                  contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: "'DM Mono', monospace", fontSize: 12 }}
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  formatter={(v) => [v + " trades", "Count"]}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {m.buckets.map((b, i) => <Cell key={i} fill={b.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cumulative PnL Chart */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 24, marginBottom: 20, animation: "fadeUp 0.5s ease both", animationDelay: "300ms" }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "2px", color: C.sub, textTransform: "uppercase", marginBottom: 20 }}>Cumulative P&L Curve (Gross)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={m.cumPnl}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="trade" tick={{ fontFamily: "'DM Mono', monospace", fontSize: 10, fill: C.sub }} axisLine={false} tickLine={false} label={{ value: "Trade #", position: "insideBottomRight", offset: -8, fill: C.muted, fontSize: 10 }} />
              <YAxis tick={{ fontFamily: "'DM Mono', monospace", fontSize: 10, fill: C.sub }} axisLine={false} tickLine={false} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} width={45} />
              <ReferenceLine y={0} stroke={C.muted} strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: "'DM Mono', monospace", fontSize: 12 }}
                cursor={{ stroke: C.accent, strokeWidth: 1 }}
                formatter={(v) => [fmt(v), "Cumulative P&L"]}
                labelFormatter={l => `Trade #${l}`}
              />
              <Line type="monotone" dataKey="pnl" stroke={m.netPnl >= 0 ? C.green : C.red} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Top Trades */}
        <SectionTitle>Notable Trades</SectionTitle>
        <div className="grid2" style={{ marginBottom: 20 }}>
          {[{ title: "🏆 Top 5 Winners", trades: m.topWinners, sign: 1 }, { title: "💔 Top 5 Losers", trades: m.topLosers, sign: -1 }].map(({ title, trades, sign }) => (
            <div key={title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 22 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "2px", color: C.sub, textTransform: "uppercase", marginBottom: 16 }}>{title}</div>
              {trades.map((t, i) => (
                <div key={i} className="trade-row" style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 12px", borderRadius: 6, marginBottom: 5,
                  background: "#0d1020", borderLeft: `3px solid ${sign > 0 ? C.green : C.red}`,
                  transition: "background 0.15s",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: sign > 0 ? C.green : C.red, fontWeight: 500 }}>
                      {sign > 0 ? "+" : ""}{fmt(t.pnl)}
                    </div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.muted }}>
                      {t.pnlPct > 0 ? "+" : ""}{fmtNum(t.pnlPct)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* P&L Breakdown */}
        <SectionTitle>P&L & Cost Breakdown</SectionTitle>
        <div className="grid3" style={{ marginBottom: 20 }}>
          {[
            {
              title: "P&L Summary", rows: [
                ["Gross P&L", fmt(m.grossPnl), m.grossPnl >= 0 ? C.green : C.red],
                ["Brokerage", `−${fmt(m.brokerage)}`, C.red],
                ["Other Charges", `−${fmt(m.totalCharges - m.brokerage)}`, C.red],
                ["Total Charges", `−${fmt(m.totalCharges)}`, C.accent],
                ["Net P&L", fmt(m.netPnl), m.netPnl >= 0 ? C.green : C.red],
              ]
            },
            {
              title: "Trade Statistics", rows: [
                ["Total Trades", m.trades.length, C.text],
                ["Winners", m.winners.length, C.green],
                ["Losers", m.losers.length, C.red],
                ["Avg Win", fmt(m.avgWin), C.green],
                ["Avg Loss", `−${fmt(m.avgLoss)}`, C.red],
              ]
            },
            {
              title: "Edge Metrics", rows: [
                ["Win Rate", `${fmtNum(m.winRate)}%`, m.winRate >= m.breakevenWinRate ? C.green : C.red],
                ["Breakeven Win%", `${fmtNum(m.breakevenWinRate)}%`, C.accent],
                ["R:R Ratio", `1 : ${fmtNum(m.rrRatio)}`, C.blue],
                ["Profit Factor", fmtNum(m.profitFactor), m.profitFactor >= 1.5 ? C.green : m.profitFactor >= 1 ? C.accent : C.red],
                ["Expectancy", fmt(m.expectancy), m.expectancy >= 0 ? C.green : C.red],
              ]
            }
          ].map(({ title, rows }) => (
            <div key={title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 22 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: "2px", color: C.sub, textTransform: "uppercase", marginBottom: 18 }}>{title}</div>
              {rows.map(([label, val, color]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 13, color: C.sub }}>{label}</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color, fontWeight: 500 }}>{val}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Insights */}
        <SectionTitle>Improvement Areas</SectionTitle>
        <div className="ig" style={{ marginBottom: 20 }}>
          {insights.map((ins, i) => <InsightCard key={i} {...ins} delay={i * 60} />)}
        </div>

        {/* 30-Day Action Plan */}
        <SectionTitle>30-Day Action Plan</SectionTitle>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 28, marginBottom: 48, animation: "fadeUp 0.5s ease both" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {[
              { color: C.accent, label: "WEEK 1–2 · RULES", items: ["Define 3-condition entry checklist", "Set hard stop at −2% always", "Journal every trade with reason", "Max 5 open positions at a time"] },
              { color: C.blue, label: "WEEK 2–3 · EXECUTION", items: ["Add trailing stop at +4% (trail 2%)", "Only trade in Nifty uptrend", "Wait for sector RS strength", "Enter only on volume confirmation"] },
              { color: C.green, label: "WEEK 3–4 · REVIEW", items: ["Weekly P&L review every Sunday", "Track win rate — target 40%+", "Identify which sector setups work", "Cut underperforming stock types"] },
            ].map(({ color, label, items }) => (
              <div key={label}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: "2px", color, marginBottom: 14, textTransform: "uppercase" }}>{label}</div>
                {items.map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, marginTop: 6, flexShrink: 0 }} />
                    <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>{item}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div style={{ textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.muted, paddingBottom: 20 }}>
          TradeScope · Data stays in your browser · Drop a new CSV anytime to refresh
        </div>
      </div>
    </div>
  );
}

// ─── App Root ────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState(null);
  if (!data) return <UploadScreen onData={setData} />;
  return <Dashboard rawData={data} onReset={setData} />;
}
