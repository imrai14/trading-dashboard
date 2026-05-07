// Shared UI constants + display formatters. Kept in their own file so
// router-free components (TradesTable.js, dhanParser tests, future
// extractions) can import them without dragging in SwingTracker.js's
// `react-router-dom` import — which CRA's Jest can't transform.

// Dark-palette colors. Reuse these instead of hardcoding hex strings so
// the theme stays consistent and a future light-mode toggle is one swap.
export const C = {
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

export const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);

export const fmtPct = (n) => `${(n || 0).toFixed(2)}%`;

// Plain-number price display, always 2 decimals so legacy 4-decimal-saved
// prices read consistently with the new 2-decimal-saved ones. Returns "—"
// for missing / zero / non-finite values so a blank stop-loss cell reads
// as "no SL set" rather than "0.00".
export const fmtPrice = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  return v.toFixed(2);
};

// Icon button shape — used for the row-level Edit / Delete / Quick-close
// actions and any other 28×28 icon-only control. Pass color, optional
// background, and optional border color (defaults to color@40% alpha).
export const iconBtn = (color, bg = "transparent", borderColor) => ({
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  borderRadius: 6,
  border: `1px solid ${borderColor || color + "40"}`,
  background: bg,
  color,
  cursor: "pointer",
  lineHeight: 0,
});

// Inline SVG icons — use currentColor so they pick up the button's color.
export const IconCheck = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 8.5 6.5 12 13 4.5" />
  </svg>
);

export const IconPencil = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M11.5 2.5l2 2L5 13H3v-2z" />
    <path d="M10.5 3.5l2 2" />
  </svg>
);

export const IconTrash = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2.5 4h11" />
    <path d="M6 4V2.5h4V4" />
    <path d="M3.5 4l1 9.5h7l1-9.5" />
    <path d="M6.5 7v4M9.5 7v4" />
  </svg>
);

export function SectionTitle({ children }) {
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
