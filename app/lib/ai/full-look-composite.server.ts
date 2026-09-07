// app/lib/ai/full-look-composite.server.ts
// Composites multiple product images side-by-side for full-look Try-On Max QA.
// Each product is scaled to fit its cell, preserving aspect ratio.
// Returns a PNG base64 data URL suitable for FASHN's product_image field.
//
// Staging-only utility — not called from any production path.

import { createCanvas, loadImage } from "canvas";
import type { OutfitItemType } from "@prisma/client";

// ── Canvas constants ──────────────────────────────────────────────────────────

const CELL_W = 350; // px per product column
const CELL_H = 480; // px per product row
const GAP = 20; // px between cells and at all borders
const BG = "#FAFAFA"; // neutral near-white background

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompositeSlot {
  imageUrl: string;
  label: string;
  itemType: OutfitItemType;
}

// ── Composite image ───────────────────────────────────────────────────────────

export async function buildCompositeProductImage(
  slots: CompositeSlot[],
): Promise<string> {
  if (slots.length === 0) throw new Error("At least one slot is required for composite");

  const totalWidth = slots.length * CELL_W + (slots.length + 1) * GAP;
  const totalHeight = CELL_H + 2 * GAP;

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  for (let i = 0; i < slots.length; i++) {
    const cellX = GAP + i * (CELL_W + GAP);
    const cellY = GAP;

    const img = await loadImage(slots[i].imageUrl);

    const scale = Math.min(CELL_W / img.width, CELL_H / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const drawX = cellX + (CELL_W - drawW) / 2;
    const drawY = cellY + (CELL_H - drawH) / 2;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  }

  return canvas.toDataURL("image/png");
}

// ── Prompt builder ────────────────────────────────────────────────────────────

const TYPE_FALLBACK: Record<OutfitItemType, string> = {
  TOP: "top",
  BOTTOM: "bottom",
  DRESS: "dress",
  OUTERWEAR: "jacket",
  SHOES: "shoes",
  BAG: "bag",
  ACCESSORY: "accessory",
  JEWELRY: "jewellery",
};

export function buildFullLookPrompt(slots: CompositeSlot[]): string {
  const descriptions = slots.map(
    (s) => s.label || TYPE_FALLBACK[s.itemType] || "garment",
  );

  let productList: string;
  if (descriptions.length === 1) {
    productList = descriptions[0];
  } else {
    const last = descriptions[descriptions.length - 1];
    productList = descriptions.slice(0, -1).join(", ") + " and " + last;
  }

  return (
    `Transfer the ${productList} onto the model. ` +
    "Preserve each product's colour, silhouette and key details. " +
    "Use each product exactly once."
  );
}
