import type { ReactNode } from "react";

export type TreatmentType = "soft-structure" | "modern-tailoring" | "colour-direction";
export type TreatmentVariant = "featured" | "card";

export function reportVisual(
  treatment: TreatmentType | undefined,
  variant: TreatmentVariant
): ReactNode {
  if (!treatment) return null;

  // ── Soft Structure ─────────────────────────────────────────────────────────
  // Editorial study of fabric falling into shape — curved fold lines, no fills.
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
        <path
          d="M 0 185 C 120 160, 280 198, 440 170 C 530 152, 580 158, 620 152"
          fill="none" stroke="#b0a090" strokeWidth="1.8" strokeLinecap="round" opacity="0.70"
        />
        <path
          d="M 0 295 C 110 272, 270 308, 420 285 C 510 270, 568 276, 620 268"
          fill="none" stroke="#c4b6a6" strokeWidth="1.2" strokeLinecap="round" opacity="0.55"
        />
        <path
          d="M 190 148 C 200 195, 208 248, 204 305"
          fill="none" stroke="#d2c6b4" strokeWidth="0.9" strokeLinecap="round" opacity="0.48"
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
        <path
          d="M 0 82 C 72 68, 160 88, 260 75 C 330 65, 370 70, 410 65"
          fill="none" stroke="#b0a090" strokeWidth="1.5" strokeLinecap="round" opacity="0.70"
        />
        <path
          d="M 0 138 C 80 120, 185 142, 290 128 C 352 118, 388 124, 410 120"
          fill="none" stroke="#c4b6a6" strokeWidth="1.0" strokeLinecap="round" opacity="0.55"
        />
        <path
          d="M 128 58 C 135 88, 140 120, 137 152"
          fill="none" stroke="#d2c6b4" strokeWidth="0.8" strokeLinecap="round" opacity="0.45"
        />
      </svg>
    );
  }

  // ── Modern Tailoring ────────────────────────────────────────────────────────
  // Needle + thread editorial motif. Fine linework, warm tones, negative space.
  // Needle rotated 12° clockwise. Eye at rotated position ≈ (333, 405) featured,
  // ≈ (281, 178) card.
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
        <g transform="rotate(12, 300, 250)">
          <path
            d="M 300 68 C 303.5 150, 303.5 220, 302.5 380 C 302 405, 301.5 428, 301 430 L 299 430 C 298.5 428, 298 405, 297.5 380 C 296.5 220, 296.5 150, 300 68 Z"
            fill="#2c1e14"
          />
          <ellipse cx="300" cy="408" rx="1.5" ry="5" fill="#e6e0d4" />
        </g>
        <path
          d="M 333 405 C 290 424, 242 414, 202 390 C 165 368, 148 332, 138 296 C 130 264, 146 238, 138 208"
          fill="none" stroke="#9c8c7c" strokeWidth="1.1" strokeLinecap="round" opacity="0.80"
        />
        <line x1="198" y1="238" x2="210" y2="226" stroke="#9c8c7c" strokeWidth="0.8" opacity="0.42" />
        <line x1="218" y1="218" x2="230" y2="206" stroke="#9c8c7c" strokeWidth="0.8" opacity="0.32" />
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
        <g transform="rotate(12, 265, 100)">
          <path
            d="M 265 18 C 268 55, 268 85, 267 155 C 267 170, 266.5 185, 266 190 L 264 190 C 263.5 185, 263 170, 263 155 C 262 85, 262 55, 265 18 Z"
            fill="#2c1e14"
          />
          <ellipse cx="265" cy="178" rx="1.2" ry="4" fill="#e6e0d4" />
        </g>
        <path
          d="M 281 178 C 255 188, 222 178, 192 160 C 164 142, 150 115, 143 90"
          fill="none" stroke="#9c8c7c" strokeWidth="0.9" strokeLinecap="round" opacity="0.78"
        />
        <line x1="150" y1="92" x2="158" y2="84" stroke="#9c8c7c" strokeWidth="0.7" opacity="0.38" />
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
