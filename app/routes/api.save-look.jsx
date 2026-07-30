// DEPRECATED — Batch 1 (2026-07-29)
// This route referenced non-existent SavedLook schema fields (resultText, productsUsed,
// wardrobeItemsUsed) and crashed at runtime with a Prisma P2009 unknown-field error.
// The canonical Saved Look write path is style-me/result.tsx (intent=save).
// Clients that call this endpoint should migrate to that path.
export async function action() {
  return Response.json(
    { error: "deprecated", message: "Use the style-me result save action." },
    { status: 410 },
  );
}
