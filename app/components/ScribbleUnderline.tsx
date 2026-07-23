import type { CSSProperties } from "react";

export function ScribbleUnderline({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 300 30"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      className={className}
      style={style}
    >
      <path d="M6 18 C 80 6, 180 26, 294 12" />
    </svg>
  );
}
