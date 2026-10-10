// app/lib/closet-card-colors.ts
//
// Customer-facing colour display for the Digital Closet card grid only.
// colors[] already stores the customer's selections in picked order, with
// colors[0] equal to primaryColor by construction (closet._index.tsx's
// normalizeColors sets primaryColor = colors[0] on every save). This module
// preserves that order as-is — it does not re-derive or re-rank anything.
// Legacy rows saved before colors[] existed fall back to the single
// primaryColor. Does not affect primaryColor itself or any of its other
// consumers (GI / StyleMe / Trend Edit continue reading item.primaryColor
// exactly as before — nothing here touches storage or that field's meaning).

export function displayColors(item: { colors?: string[] | null; primaryColor?: string | null }): string[] {
  if (item.colors && item.colors.length > 0) return item.colors;
  return item.primaryColor ? [item.primaryColor] : [];
}

// The exact "· "-joined line rendered on the Closet card — colours first (in
// selected order), then pattern.
export function closetCardMetaLine(item: { colors?: string[] | null; primaryColor?: string | null; pattern?: string | null }): string {
  return [...displayColors(item), item.pattern].filter(Boolean).join(" · ");
}
