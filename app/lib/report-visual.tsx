import type { ReactNode } from "react";

export type TreatmentType = "soft-structure" | "modern-tailoring" | "colour-direction";
export type TreatmentVariant = "featured" | "card";

export function reportVisual(
  treatment: TreatmentType | undefined,
  variant: TreatmentVariant
): ReactNode {
  if (!treatment) return null;

  // ── Soft Structure ─────────────────────────────────────────────────────────
  // Two barely-there fabric-plane washes, one short fold crease. No lines.
  if (treatment === "soft-structure") {
    return variant === "featured" ? (
      <svg
        viewBox="0 0 600 520"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      >
        <rect width="600" height="520" fill="#ebe5da" />
        {/* Fabric plane 1 — large tonal area, upper portion */}
        <path
          d="M 0 0 C 80 0 240 12 400 8 C 500 4 570 0 600 0 L 600 310 C 560 348 475 368 375 375 C 265 382 158 356 88 318 C 32 288 0 250 0 208 Z"
          fill="#d4cabb" opacity="0.18"
        />
        {/* Fabric plane 2 — softer secondary layer */}
        <path
          d="M 0 0 C 58 18 178 28 300 22 C 400 16 510 6 600 0 L 600 185 C 554 212 466 228 360 232 C 248 236 142 218 72 192 C 26 174 0 148 0 118 Z"
          fill="#c5bcab" opacity="0.10"
        />
        {/* Single fold crease — short, barely-there */}
        <path
          d="M 148 295 C 167 306, 194 303, 218 292"
          fill="none" stroke="#a89f92" strokeWidth="0.65" strokeLinecap="round" opacity="0.36"
        />
      </svg>
    ) : (
      <svg
        viewBox="0 0 400 220"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      >
        <rect width="400" height="220" fill="#ebe5da" />
        {/* Fabric plane 1 */}
        <path
          d="M 0 0 C 55 0 160 8 268 5 C 338 3 385 0 400 0 L 400 135 C 372 152 315 162 248 165 C 176 168 106 153 56 132 C 20 118 0 98 0 76 Z"
          fill="#d4cabb" opacity="0.18"
        />
        {/* Fabric plane 2 */}
        <path
          d="M 0 0 C 40 10 118 18 198 14 C 270 10 344 4 400 0 L 400 80 C 368 92 308 100 236 102 C 162 104 94 90 46 75 C 16 64 0 52 0 40 Z"
          fill="#c5bcab" opacity="0.10"
        />
        {/* Single fold crease */}
        <path
          d="M 85 124 C 98 131, 116 129, 132 121"
          fill="none" stroke="#a89f92" strokeWidth="0.55" strokeLinecap="round" opacity="0.32"
        />
      </svg>
    );
  }

  // ── Modern Tailoring ────────────────────────────────────────────────────────
  // Fine needle, warm espresso, off-centre upper-right. Short thread trail + stitch marks.
  // Needle length ≈130px featured / 56px card. Rotated 22°. No large sweeping thread arc.
  if (treatment === "modern-tailoring") {
    return variant === "featured" ? (
      <svg
        viewBox="0 0 600 520"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      >
        <rect width="600" height="520" fill="#e6e0d4" />
        {/* Needle — fine, warm espresso, off-centre upper-right, 22° rotation */}
        <g transform="rotate(22, 388, 188)">
          <path
            d="M 388 122 C 389.0 138, 389.6 156, 389.6 176 C 389.6 196, 389.0 218, 388.4 252 L 387.6 252 C 387.0 218, 386.4 196, 386.4 176 C 386.4 156, 387.0 138, 388 122 Z"
            fill="#7a6050"
          />
          <ellipse cx="388" cy="240" rx="0.7" ry="2.0" fill="#e6e0d4" />
        </g>
        {/* Delicate thread trail from needle eye — rotated eye lands ≈ (369, 236) */}
        <path
          d="M 369 236 C 358 252, 344 264, 330 259"
          fill="none" stroke="#9a8878" strokeWidth="0.7" strokeLinecap="round" opacity="0.44"
        />
        {/* Three tiny stitch marks near thread end */}
        <line x1="307" y1="268" x2="316" y2="257" stroke="#9a8878" strokeWidth="0.6" strokeLinecap="round" opacity="0.28" />
        <line x1="319" y1="277" x2="328" y2="266" stroke="#9a8878" strokeWidth="0.6" strokeLinecap="round" opacity="0.22" />
        <line x1="295" y1="260" x2="304" y2="249" stroke="#9a8878" strokeWidth="0.6" strokeLinecap="round" opacity="0.18" />
      </svg>
    ) : (
      <svg
        viewBox="0 0 400 200"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      >
        <rect width="400" height="200" fill="#e6e0d4" />
        {/* Needle — card scale, right-of-centre, 22° rotation */}
        <g transform="rotate(22, 262, 82)">
          <path
            d="M 262 52 C 262.8 60, 263.2 68, 263.2 78 C 263.2 88, 262.8 97, 262.4 108 L 261.6 108 C 261.2 97, 260.8 88, 260.8 78 C 260.8 68, 261.2 60, 262 52 Z"
            fill="#7a6050"
          />
          <ellipse cx="262" cy="103" rx="0.6" ry="1.7" fill="#e6e0d4" />
        </g>
        {/* Thread trail — rotated eye lands ≈ (254, 102) */}
        <path
          d="M 254 102 C 246 113, 237 119, 227 116"
          fill="none" stroke="#9a8878" strokeWidth="0.6" strokeLinecap="round" opacity="0.42"
        />
        {/* Three tiny stitch marks */}
        <line x1="209" y1="122" x2="216" y2="113" stroke="#9a8878" strokeWidth="0.55" strokeLinecap="round" opacity="0.26" />
        <line x1="218" y1="128" x2="225" y2="119" stroke="#9a8878" strokeWidth="0.55" strokeLinecap="round" opacity="0.20" />
        <line x1="200" y1="116" x2="207" y2="107" stroke="#9a8878" strokeWidth="0.55" strokeLinecap="round" opacity="0.16" />
      </svg>
    );
  }

  // ── Colour Direction ────────────────────────────────────────────────────────
  // Original five-swatch vertical palette composition, restored exactly.
  if (treatment === "colour-direction") {
    return variant === "featured" ? (
      <svg
        viewBox="0 0 600 520"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      >
        <rect x="0"   y="0" width="120" height="520" fill="#f2ede7" />
        <rect x="120" y="0" width="120" height="520" fill="#d4c8b4" />
        <rect x="240" y="0" width="120" height="520" fill="#3e2a1c" />
        <rect x="360" y="0" width="120" height="520" fill="#8a9aaa" />
        <rect x="480" y="0" width="120" height="520" fill="#a85060" />
      </svg>
    ) : (
      <svg
        viewBox="0 0 400 220"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      >
        <rect x="0"   y="0" width="80" height="220" fill="#f2ede7" />
        <rect x="80"  y="0" width="80" height="220" fill="#d4c8b4" />
        <rect x="160" y="0" width="80" height="220" fill="#3e2a1c" />
        <rect x="240" y="0" width="80" height="220" fill="#8a9aaa" />
        <rect x="320" y="0" width="80" height="220" fill="#a85060" />
      </svg>
    );
  }

  return null;
}
