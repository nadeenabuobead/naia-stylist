// TEMPORARY — public hydration diagnostic. Remove after root cause confirmed.
// Visit /diag on the staging deployment to test React hydration without Shopify auth.
import { useState } from "react";

export default function Diag() {
  const [count, setCount] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  function addLog(msg: string) {
    setLog((prev) => [...prev.slice(-9), msg]);
  }

  return (
    <div
      style={{
        padding: 40,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
        maxWidth: 640,
        background: "#fff",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>nAia Hydration Diagnostic</h1>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 32 }}>
        Public route — no Shopify auth required. Temporary diagnostic only.
      </p>

      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 48, fontWeight: 700, color: "#8b2035", marginBottom: 12 }}>
          {count}
        </div>
        <button
          type="button"
          onClick={() => {
            const next = count + 1;
            console.log("[NAIA-DIAG] button clicked, count →", next);
            setCount(next);
            addLog(`click #${next} at ${new Date().toISOString().slice(11, 23)}`);
          }}
          style={{
            padding: "10px 24px",
            background: "#8b2035",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Increment ({count})
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label htmlFor="txt" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
          Type something (tests input state):
        </label>
        <input
          id="txt"
          type="text"
          placeholder="type here…"
          onChange={(e) => {
            console.log("[NAIA-DIAG] input change:", e.target.value.slice(0, 20));
            addLog(`input: "${e.target.value.slice(0, 20)}"`);
          }}
          style={{ padding: "8px 12px", border: "1px solid #ddd", width: "100%", boxSizing: "border-box" }}
        />
      </div>

      {log.length > 0 && (
        <div
          style={{
            background: "#f5f5f5",
            borderRadius: 4,
            padding: "12px 16px",
            fontSize: 12,
            fontFamily: "monospace",
          }}
        >
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 32, fontSize: 12, color: "#999" }}>
        <div>
          <strong>Counter increments + log appears</strong> → React state and event handlers
          work in this rendering context.
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Nothing happens on click</strong> → React hydration is broken app-wide
          (entry.client.tsx, root layout, or client bundle loading failure).
        </div>
      </div>
    </div>
  );
}
