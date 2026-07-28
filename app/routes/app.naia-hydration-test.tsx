// app/routes/app.naia-hydration-test.tsx
// TEMPORARY diagnostic route — remove after root cause confirmed.
//
// Visit /app/naia-hydration-test inside Shopify Admin.
//
// Interpretation:
//   Button increments → React hydration is working for basic staff routes.
//                       Problem is specific to app.designer-intelligence.jsx or its data/imports.
//   Button does NOT respond → Problem is app-wide: entry.client.tsx, App Bridge,
//                             CSP, build split, or a root-level hydration failure.

import { useState } from "react";
import { requireStaffAccess } from "../lib/staff-auth.server";

export async function loader({ request }: { request: Request }) {
  await requireStaffAccess(request);
  return { ok: true, ts: Date.now() };
}

export default function NaiaHydrationTest() {
  const [count, setCount] = useState(0);

  return (
    <div
      style={{
        padding: 40,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
        maxWidth: 640,
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 8, color: "#221516" }}>
        nAia Hydration Diagnostic
      </h1>
      <p style={{ fontSize: 13, color: "#5c5350", marginBottom: 24 }}>
        Temporary route — remove after diagnosis is complete.
      </p>

      <div
        style={{
          padding: "20px 24px",
          background: "#fff",
          border: "1px solid #e2d8d0",
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 13, color: "#7a6f6a", marginBottom: 12 }}>
          Counter (click to test React state):
        </div>
        <div
          style={{ fontSize: 36, fontWeight: 700, color: "#8b2035", marginBottom: 16 }}
        >
          {count}
        </div>
        <button
          type="button"
          onClick={() => {
            console.log("[NAIA-TEST] button onClick fired, count was", count);
            setCount((c) => c + 1);
          }}
          style={{
            padding: "10px 24px",
            background: "#8b2035",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.5px",
          }}
        >
          Increment ({count})
        </button>
      </div>

      <div
        style={{
          fontSize: 12,
          color: "#7a6f6a",
          borderTop: "1px solid #e2d8d0",
          paddingTop: 16,
        }}
      >
        <strong>If the counter increments:</strong> React hydration works for basic routes.
        The problem is inside <code>app.designer-intelligence.jsx</code> — check its imports,
        component render, or loader data shape.
        <br />
        <br />
        <strong>If the counter does NOT increment:</strong> Problem is app-wide — check
        <code>entry.client.tsx</code> console markers, App Bridge conflicts, CSP blocking,
        or a root layout hydration failure.
        <br />
        <br />
        <strong>Route:</strong> <code>/app/naia-hydration-test</code>
      </div>
    </div>
  );
}
