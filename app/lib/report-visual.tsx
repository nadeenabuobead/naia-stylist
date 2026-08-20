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
  // Two overlapping fabric panels: deep charcoal pinstripe + warm stone.
  // Angled fold edge on stone panel. Welt mark. Dominant linen negative space.
  if (treatment === "modern-tailoring") {
    return variant === "featured" ? (
      <svg
        viewBox="0 0 600 520"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      >
        <defs>
          <clipPath id="mt-f-cp">
            <path d="M 288 520 L 600 520 L 600 0 L 309 0 Z" />
          </clipPath>
        </defs>
        <rect width="600" height="520" fill="#ece6db" />
        {/* Charcoal pinstripe panel — right side */}
        <path d="M 288 520 L 600 520 L 600 0 L 309 0 Z" fill="#24201b" />
        {/* Pinstripes clipped to charcoal panel */}
        <g clipPath="url(#mt-f-cp)">
          {[327,341,355,369,383,397,411,425,439,453,467,481,495,509,523,537,551,565,579].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="520" stroke="#d9d2c7" strokeWidth="0.44" opacity="0.20" />
          ))}
        </g>
        {/* Warm stone panel — overlapping charcoal, open bottom */}
        <path d="M 82 449 L 330 444 L 345 0 L 82 0 Z" fill="#d4c8b4" />
        {/* Fold edge — right edge of stone panel */}
        <line x1="345" y1="0" x2="330" y2="444" stroke="#beb3a2" strokeWidth="0.56" strokeLinecap="round" opacity="0.42" />
        {/* Welt detail */}
        <line x1="132" y1="354" x2="183" y2="354" stroke="#beb3a2" strokeWidth="0.46" strokeLinecap="round" opacity="0.28" />
      </svg>
    ) : (
      <svg
        viewBox="0 0 400 220"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden="true"
      >
        <defs>
          <clipPath id="mt-c-cp">
            <path d="M 192 220 L 400 220 L 400 0 L 206 0 Z" />
          </clipPath>
        </defs>
        <rect width="400" height="220" fill="#ece6db" />
        {/* Charcoal pinstripe panel — right side */}
        <path d="M 192 220 L 400 220 L 400 0 L 206 0 Z" fill="#24201b" />
        {/* Pinstripes clipped to charcoal panel */}
        <g clipPath="url(#mt-c-cp)">
          {[218,227,236,245,254,263,272,281,290,299,308,317,326,335,344,353,362,371,380,389].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="220" stroke="#d9d2c7" strokeWidth="0.44" opacity="0.20" />
          ))}
        </g>
        {/* Warm stone panel — overlapping charcoal, open bottom */}
        <path d="M 55 190 L 220 188 L 230 0 L 55 0 Z" fill="#d4c8b4" />
        {/* Fold edge — right edge of stone panel */}
        <line x1="230" y1="0" x2="220" y2="188" stroke="#beb3a2" strokeWidth="0.56" strokeLinecap="round" opacity="0.42" />
        {/* Welt detail */}
        <line x1="88" y1="150" x2="122" y2="150" stroke="#beb3a2" strokeWidth="0.46" strokeLinecap="round" opacity="0.28" />
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
