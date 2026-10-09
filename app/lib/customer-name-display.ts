// app/lib/customer-name-display.ts
//
// Concise family-name display for Settings & Privacy. Shopify's
// Customer Account API returned, for a real staging customer:
//   firstName: "Nadeen", lastName: "W M Abuobead", displayName: "Nadeen W M Abuobead"
// displayName is just firstName + " " + lastName — Shopify does not offer an
// independently "concise" field, so there is no safe shortcut to borrow.
//
// Dropping arbitrary middle words from lastName would risk corrupting a
// genuine multi-word surname. Dropping a bare single-letter word never does —
// no real surname component is one letter, so this targets initials
// specifically rather than "middle words" in general.

export function conciseFamilyName(lastName: string | null): string | null {
  if (!lastName) return null;
  const words = lastName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const kept = words.filter((w) => w.replace(/\.$/, "").length > 1);
  // Never erase the whole surname — if every word happened to be a bare
  // initial, fall back to the original string rather than returning nothing.
  return kept.length > 0 ? kept.join(" ") : lastName;
}
