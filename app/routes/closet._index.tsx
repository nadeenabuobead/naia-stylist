import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import { data, redirect, type LoaderFunctionArgs, type ActionFunctionArgs, type LinksFunction } from "react-router";
import prisma from "../db.server";
import { requireCurrentNaiaCustomer, getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { assessClosetEligibility, CLOSET_ELIGIBILITY_DISPLAY, type ClosetTryOnEligibility } from "~/lib/ai/closet-eligibility";
import { runStageBAssessment } from "~/lib/ai/closet-eligibility.server";
import { emitClosetItemAdded, recordJourneyEventAwaited } from "~/lib/ai/journey-events.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { verifyCloudinaryAsset, deleteCloudinaryAsset, buildPrivateDownloadUrl, getCloudinaryConfig, validatePublicIdOwnership } from "~/lib/cloudinary-admin.server";

// Option B shell: MyNaiaLayout + naiaStyles (NADINE header, My nAia navigation)
export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const CATEGORIES = ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS", "ACCESSORIES", "JEWELRY", "OTHER"];
const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver", "Multicolor"];
const OCCASIONS = ["Casual", "Work", "Dinner", "Party", "Formal", "Date", "Weekend", "Travel"];
const SEASONS = ["Spring", "Summer", "Fall", "Winter", "All Season"];
const PATTERNS = ["Solid", "Stripes", "Floral", "Plaid", "Animal Print", "Geometric", "Abstract", "Other"];

const GENERAL_PHOTO_TIPS = [
  "Photograph one item only",
  "Use a plain, contrasting background",
  "Use bright, even lighting",
  "Keep the image sharp and in focus",
  "Make sure the entire item is visible",
  "Do not crop any important part",
  "Avoid hands, people, clutter or other items covering it",
];

const CATEGORY_PHOTO_TIPS: Record<string, { title: string; tips: string[] }> = {
  TOPS:      { title: "For clothing", tips: ["Lay it flat or hang it straight", "Show the full neckline, sleeves, waist and hem", "Do not fold or bunch the garment"] },
  BOTTOMS:   { title: "For clothing", tips: ["Lay it flat or hang it straight", "Show the full waistband and hem", "Do not fold or bunch the garment"] },
  DRESSES:   { title: "For clothing", tips: ["Hang or lay fully flat", "Show the full neckline, sleeves, waist and hem", "Do not fold or bunch the garment"] },
  OUTERWEAR: { title: "For clothing", tips: ["Lay flat or hang straight", "Show the full collar, sleeves and hem", "Do not fold or bunch the garment"] },
  SHOES:     { title: "For shoes",    tips: ["Show the full pair", "Keep both shoes visible and unobstructed", "Do not photograph while worn", "Use a clear side or three-quarter view"] },
  BAGS:      { title: "For bags",     tips: ["Show the complete bag", "Keep handles and straps fully visible", "Use a front or three-quarter view", "Remove anything covering its shape"] },
};

function eligibilityStatus(elig: ClosetTryOnEligibility | null, hint: string | null) {
  if (!elig) return null;
  const display = CLOSET_ELIGIBILITY_DISPLAY[elig];
  return { label: display.label, hint: hint || display.fallbackHint, isNeeds: elig === "needs-clearer-photo" };
}

// ── Server-side upload validation helpers ─────────────────────────────────────

function extractCloudinaryPublicId(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    // Path: /{cloud}/image/{deliveryType}/[v{version}/]{public_id}.{ext}
    const match = pathname.match(
      /\/image\/(?:private|upload|authenticated)\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// Checks first 12 bytes of a fetched buffer for known image file signatures.
function detectImageFormatFromBytes(header: Uint8Array): string | null {
  if (header.length < 4) return null;
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return "jpeg";
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return "png";
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) return "gif";
  if (
    header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
    header.length >= 12 &&
    header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50
  ) return "webp";
  if (header.length >= 8 && header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) return "heic";
  return null;
}

export function meta() {
  return [{ title: "Digital Wardrobe | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const customer = await prisma.customer.findUnique({
    where: { id: naiaCustomer.id },
    include: { closetItems: { orderBy: { createdAt: "desc" } } },
  });
  if (!customer) return redirect("/auth/shopify/login");
  return data({ items: customer.closetItems });
}

export async function action({ request }: ActionFunctionArgs) {
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) return data({ error: "Not authenticated" }, { status: 401 });
  const customer = await prisma.customer.findUnique({ where: { id: naiaCustomer.id } });
  if (!customer) return data({ error: "Not authenticated" }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add") {
    const name = formData.get("name") as string;
    const category = formData.get("category") as string;
    const imageUrl = formData.get("imageUrl") as string;
    const primaryColor = formData.get("primaryColor") as string;
    const pattern = formData.get("pattern") as string;
    const brand = formData.get("brand") as string;
    const occasions = JSON.parse((formData.get("occasions") as string) || "[]");
    const seasons = JSON.parse((formData.get("seasons") as string) || "[]");
    if (!name || !category || !imageUrl) return data({ error: "Name and category required" }, { status: 400 });

    // ── Server-side upload validation ─────────────────────────────────────────
    // All checks run BEFORE any DB write. Rejected uploads have their Cloudinary
    // asset deleted so orphaned assets do not accumulate in storage.

    // 1. Cloudinary URL hostname — prevents raw-POST bypass with arbitrary URLs.
    const allowedHosts = ["res.cloudinary.com", "res-4.cloudinary.com"];
    let imageUrlHost: string;
    try {
      imageUrlHost = new URL(imageUrl).hostname;
    } catch {
      return data({ error: "Invalid image URL." }, { status: 400 });
    }
    if (!allowedHosts.some(h => imageUrlHost === h || imageUrlHost.endsWith(`.${h}`))) {
      return data({ error: "Image must be uploaded via the app." }, { status: 400 });
    }

    // 2. Extract public_id and validate it belongs to this customer's folder.
    const publicId = extractCloudinaryPublicId(imageUrl);
    if (!publicId) {
      return data({ error: "Invalid image URL format." }, { status: 400 });
    }
    const ownership = validatePublicIdOwnership(publicId, customer.id);
    if (!ownership.ok) {
      return data({ error: ownership.error }, { status: 400 });
    }

    // 3. Verify via Cloudinary Admin API — authoritative format/bytes/dimensions
    //    (never trusted from client-provided form data).
    const verify = await verifyCloudinaryAsset(publicId, "private");
    if (!verify.ok) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: "Image could not be verified. Please upload again." }, { status: 400 });
    }

    const serverFormat = verify.asset.format.toLowerCase();
    const serverBytes  = verify.asset.bytes;
    const serverWidth  = verify.asset.width;
    const serverHeight = verify.asset.height;

    // 4. Format allowlist — derived from Admin API, not client-provided value.
    const ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"]);
    if (!ALLOWED_FORMATS.has(serverFormat)) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `File type "${serverFormat}" is not accepted. Use JPG, PNG, WEBP, or HEIC.` }, { status: 400 });
    }

    // 5. File-size cap — from Admin API, not client-reported bytes.
    const SERVER_MAX_BYTES = 5 * 1024 * 1024;
    if (serverBytes > SERVER_MAX_BYTES) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `Image is too large (${(serverBytes / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.` }, { status: 400 });
    }

    // 6. Dimension bounds — serverWidth / serverHeight from Admin API, not client form data.
    const MIN_DIM = 200;
    const MAX_DIM = 8000;
    if (serverWidth !== null && serverWidth < MIN_DIM) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `Image width (${serverWidth} px) is below the minimum of ${MIN_DIM} px.` }, { status: 400 });
    }
    if (serverHeight !== null && serverHeight < MIN_DIM) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `Image height (${serverHeight} px) is below the minimum of ${MIN_DIM} px.` }, { status: 400 });
    }
    if (serverWidth !== null && serverWidth > MAX_DIM) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `Image width (${serverWidth} px) exceeds the maximum of ${MAX_DIM} px.` }, { status: 400 });
    }
    if (serverHeight !== null && serverHeight > MAX_DIM) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `Image height (${serverHeight} px) exceeds the maximum of ${MAX_DIM} px.` }, { status: 400 });
    }

    // 7. Server-side magic-byte check — fetch the first 12 bytes from Cloudinary
    //    via a signed download URL (Range: bytes=0-11) and verify the file signature.
    //    This confirms the actual stored bytes match a supported image format,
    //    independent of any client-reported format string.
    const cfg = getCloudinaryConfig();
    if (cfg) {
      const downloadUrl = buildPrivateDownloadUrl(cfg, publicId, serverFormat, "private");
      try {
        const byteRes = await fetch(downloadUrl, {
          headers: { Range: "bytes=0-11" },
          signal: AbortSignal.timeout(15000),
        });
        if (byteRes.ok) {
          const buf = await byteRes.arrayBuffer();
          const header = new Uint8Array(buf);
          if (!detectImageFormatFromBytes(header)) {
            await deleteCloudinaryAsset(publicId, "private");
            return data({ error: "File signature does not match a supported image format." }, { status: 400 });
          }
        }
      } catch {
        await deleteCloudinaryAsset(publicId, "private");
        return data({ error: "Image verification timed out. Please try again." }, { status: 400 });
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    const stageA = assessClosetEligibility({
      prismaCategory: category,
      width: serverWidth ?? undefined,
      height: serverHeight ?? undefined,
      format: serverFormat,
      bytes: serverBytes,
    });

    const newItem = await prisma.closetItem.create({
      data: {
        customerId: customer.id, name, category, imageUrl,
        primaryColor: primaryColor || null, pattern: pattern || null, brand: brand || null,
        occasions: occasions.length > 0 ? occasions : null,
        seasons: seasons.length > 0 ? seasons : null,
        tryOnEligibility: stageA.eligible,
        tryOnAssessedAt: new Date(stageA.assessedAt),
        tryOnCustomerHint: stageA.customerHint,
        tryOnInternalNote: stageA.internalNote,
      },
    });

    try {
      await recordJourneyEventAwaited(
        emitClosetItemAdded({ customerId: customer.id, closetItemId: newItem.id, category: newItem.category, tryOnEligibility: newItem.tryOnEligibility ?? null }),
        `closet_item_added:${newItem.id}:v1`,
      );
    } catch { /* event emission never blocks the response */ }

    if (stageA.eligible === "pending-assessment" && imageUrl) {
      await runStageBAssessment(newItem.id, imageUrl, stageA.category, async (id, fields) => {
        await prisma.closetItem.update({ where: { id }, data: fields });
      });
    }

    return data({ success: true });
  }

  if (intent === "delete") {
    const itemId = formData.get("itemId") as string;
    const deleted = await prisma.closetItem.deleteMany({ where: { id: itemId, customerId: customer.id } });
    if (deleted.count === 0) return data({ error: "Item not found" }, { status: 403 });
    return data({ success: true });
  }

  return data({ error: "Unknown intent" }, { status: 400 });
}

// ── cl-* inline design system calibrated for the 880 px content column
//    inside MyNaiaLayout (sidebar 256 px + gap 64 px = 320 px consumed at 1280 px).
//    Lovable Option A reference used standalone cl-wrap = 1120 px inner width.
//    Proportions are scaled accordingly.
//
// Shell-level overrides (mn-page-head, mn-body, mn-page-sections) are scoped to
// this route's injected <style> tag — they only apply while this page is loaded.
const css = `
  /* ── Shell calibration: mn-body--compact handles top offset via naia-design-system.css.
     mn-page-sections gap collapses to zero — cl-* elements own their own spacing. */
  .mn-page-sections{gap:0}
  .mn-page-sections>.mn-back-link{display:block;margin-bottom:1.75rem}

  /* ── Option A cl-* page content — calibrated for 880 px column ── */
  /* Title: clamp(32px,3.5vw,48px) scales correctly in an 880 px column.
     At 1280 px viewport: 3.5vw = 44.8 px → within range. */
  .cl-headline{font-family:var(--ff-display);font-size:clamp(32px,3.5vw,48px);font-weight:900;line-height:1;margin-bottom:10px}
  /* Subtitle */
  .cl-sub{font-family:var(--ff-ui);font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:28px}
  /* Stats — 3-col grid. Padding 20px (was 24px) to tighten card density. */
  .cl-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px}
  .cl-stat{background:var(--bg-50, var(--c-surface));padding:20px;border:1px solid var(--fg-10, var(--c-border))}
  .cl-stat-num{font-family:var(--ff-display);font-size:40px;font-weight:900;color:var(--fg, var(--c-ink))}
  .cl-stat-label{font-family:var(--ff-ui);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted))}
  /* Add a Piece button — full width matching Lovable. Margin-bottom reduced for density. */
  .cl-add-btn{width:100%;padding:16px;background:var(--lipstick, var(--c-burg));color:#FAF6F1;border:none;margin-bottom:28px;cursor:pointer;font-family:var(--ff-ui);font-size:10px;letter-spacing:4px;text-transform:uppercase}
  /* Add to Wardrobe form */
  .cl-form{background:var(--bg-50, var(--c-panel));padding:32px;margin-bottom:28px;border:1px solid var(--fg-10, var(--c-border))}
  .cl-form-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
  .cl-form-title{font-family:var(--ff-display);font-size:24px;font-weight:900;font-style:italic;color:var(--fg, var(--c-ink))}
  .cl-form-cancel{background:none;border:none;cursor:pointer;font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted))}
  .cl-label{font-family:var(--ff-ui);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:10px}
  .cl-input{width:100%;padding:12px;border:1px solid var(--fg-10, var(--c-border));font-size:15px;font-family:var(--ff-ui);background:var(--bg, var(--c-surface));color:var(--fg, var(--c-ink));outline:none;margin-bottom:20px}
  .cl-input:focus{border-color:var(--fg, var(--c-ink))}
  .cl-pills{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px}
  .cl-pill{padding:8px 14px;border:1px solid var(--fg-10, var(--c-border));font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--fg, var(--c-ink));cursor:pointer;background:transparent;transition:all .2s}
  .cl-pill:hover{border-color:var(--fg, var(--c-ink))}
  .cl-pill.on{background:var(--lipstick, var(--c-burg));color:#FAF6F1}
  .cl-upload-box{border:1px dashed var(--fg-10, var(--c-border));padding:32px;text-align:center;cursor:pointer;background:var(--bg, var(--c-surface));margin-bottom:8px;display:block}
  .cl-upload-hint{font-family:var(--ff-body);font-size:15px;font-style:italic;color:var(--fg-60, var(--c-muted))}
  .cl-upload-notice{font-family:var(--ff-ui);font-size:8px;letter-spacing:1px;line-height:1.6;color:var(--fg-60, var(--c-muted));margin-bottom:14px}
  .cl-upload-error{font-family:var(--ff-ui);font-size:9px;letter-spacing:1px;color:var(--lipstick, var(--c-burg));margin-bottom:14px}
  .cl-guide{background:var(--bg, var(--c-surface));border:1px solid var(--fg-10, var(--c-border));padding:16px;margin-bottom:20px}
  .cl-guide-header{font-family:var(--ff-ui);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:10px}
  .cl-guide-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:10px}
  .cl-guide-col-label{font-family:var(--ff-ui);font-size:7px;letter-spacing:1px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:6px}
  .cl-guide-tips{list-style:none;padding:0}
  .cl-guide-tips li{font-family:var(--ff-body);font-size:12px;color:var(--fg, var(--c-ink));padding:2px 0 2px 14px;position:relative}
  .cl-guide-tips li::before{content:"–";position:absolute;left:0;color:var(--fg-60, var(--c-muted))}
  .cl-guide-ex{display:flex;gap:8px;padding:5px 8px;font-size:11px;font-family:var(--ff-body);margin-top:4px}
  .cl-guide-ex.good{background:rgba(76,175,80,.08);border-left:2px solid #4caf50}
  .cl-guide-ex.avoid{background:rgba(107,29,38,.06);border-left:2px solid var(--lipstick, var(--c-burg))}
  .cl-guide-ex-mark{font-weight:700;flex-shrink:0}
  .cl-submit{width:100%;padding:14px;background:var(--lipstick, var(--c-burg));color:#FAF6F1;border:none;font-family:var(--ff-ui);font-size:10px;letter-spacing:4px;text-transform:uppercase;cursor:pointer}
  .cl-submit:disabled{opacity:.3;cursor:not-allowed}
  /* Filter row — constrain search width so the row doesn't sprawl across 880 px */
  .cl-filter-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.75rem;border-top:1px solid var(--fg-12, var(--c-border));padding-top:1.25rem;margin-bottom:20px}
  .cl-filters{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;flex:1;min-width:0}
  .cl-filter{padding:8px 14px;border:1px solid var(--fg-10, var(--c-border));font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--fg, var(--c-ink));cursor:pointer;background:transparent;white-space:nowrap;transition:all .2s;flex-shrink:0}
  .cl-filter.on{background:var(--lipstick, var(--c-burg));color:#FAF6F1}
  .cl-search-label{display:flex;align-items:center;gap:0.5rem;font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));flex-shrink:0}
  /* Search width: 120 px is proportional to the 880 px column */
  .cl-search-input{border-top:none;border-left:none;border-right:none;border-bottom:1px solid var(--fg-25, var(--c-border));background:transparent;padding:0.25rem;font-size:13px;letter-spacing:normal;text-transform:none;color:var(--fg, var(--c-ink));outline:none;font-family:var(--ff-ui);width:120px}
  .cl-count{font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:20px}
  /* Product grid: minmax(200px,1fr) fits 4 cards in 880 px (4×200+3×16=848 px).
     Matches Lovable's minmax(250px,1fr) in its wider 1120 px column (4×250+3×24=1072 px). */
  .cl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
  .cl-card{background:var(--bg-50, var(--c-surface));border:1px solid var(--fg-10, var(--c-border));overflow:hidden;position:relative}
  /* Card image: square aspect ratio matching Lovable */
  .cl-card-img{aspect-ratio:1;background:var(--bg-75, var(--c-muted-bg));display:flex;align-items:center;justify-content:center;overflow:hidden}
  .cl-card-img img{width:100%;height:100%;object-fit:cover}
  .cl-card-body{padding:16px}
  .cl-card-cat{font-family:var(--ff-ui);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:6px}
  .cl-card-name{font-family:var(--ff-display);font-size:16px;font-weight:700;color:var(--fg, var(--c-ink));margin-bottom:4px}
  .cl-card-meta{font-family:var(--ff-ui);font-size:9px;letter-spacing:1px;color:var(--fg-60, var(--c-muted));text-transform:uppercase}
  .cl-card-elig--needs{font-family:var(--ff-ui);font-size:8px;letter-spacing:1px;color:var(--lipstick, var(--c-burg));text-transform:uppercase;margin-top:6px;display:block}
  .cl-card-elig--ok{font-family:var(--ff-ui);font-size:8px;letter-spacing:1px;color:var(--fg-60, var(--c-muted));text-transform:uppercase;margin-top:6px;display:block}
  .cl-delete{position:absolute;top:10px;right:10px;background:rgba(40,21,12,0.8);color:#FAF6F1;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;line-height:1}
  .cl-empty{text-align:center;padding:60px 32px;background:var(--bg-50, var(--c-surface));border:1px solid var(--fg-10, var(--c-border))}
  .cl-empty-icon{font-family:var(--ff-display);font-size:52px;color:var(--fg, var(--c-ink));opacity:.2;margin-bottom:16px}
  .cl-empty-text{font-family:var(--ff-body);font-size:18px;font-style:italic;color:var(--fg-60, var(--c-muted));margin-bottom:28px}
  .cl-cta{margin-top:48px;text-align:center}
  .cl-cta a{display:inline-block;padding:14px 36px;background:var(--fg, var(--c-ink));color:#FAF6F1;text-decoration:none;font-family:var(--ff-ui);font-size:10px;letter-spacing:4px;text-transform:uppercase}
  @media(max-width:1023px){
    .mn-page-sections>.mn-back-link{margin-bottom:1.25rem}
  }
  @media(max-width:640px){
    .cl-stats{grid-template-columns:1fr}
    .cl-stat{display:flex;align-items:center;gap:14px;padding:14px 18px}
    .cl-stat-num{font-size:28px}
    .cl-guide-cols{grid-template-columns:1fr}
    .cl-filter-row{flex-direction:column;align-items:flex-start}
    .cl-search-input{width:100%}
    .cl-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
  }
`;

// ── Component ─────────────────────────────────────────────────────────────────
// Composed implementation:
//   Shell  → Option B (my-naia.closet.tsx): MyNaiaLayout, NADINE header, My nAia navigation
//   Content → Option A (closet._index.tsx): Digital Wardrobe title, stats, Add to Wardrobe
//             form, filters, card grid, Style Me CTA
//   Logic  → existing staging: Cloudinary, eligibility, journey events, delete, validation

export default function Closet() {
  const { items } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [showAddForm, setShowAddForm] = useState(false);
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [query, setQuery] = useState("");

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("TOPS");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newOccasions, setNewOccasions] = useState<string[]>([]);
  const [newSeasons, setNewSeasons] = useState<string[]>([]);
  const [imgMeta, setImgMeta] = useState<{ width?: number; height?: number; format?: string; bytes?: number }>({});

  const filtered = items.filter((item: any) => {
    const matchesCat = activeCategory === "ALL" || item.category === activeCategory;
    const q = query.trim().toLowerCase();
    const matchesSearch = !q ||
      (item.name ?? "").toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      (item.brand ?? "").toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  useEffect(() => {
    if (!showAddForm) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setShowAddForm(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showAddForm]);

  // Known image magic bytes (file signatures). Checked before upload to catch
  // spoofed extensions and files that are not real images.
  const IMAGE_SIGNATURES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
    { mime: "image/jpeg",  bytes: [0xFF, 0xD8, 0xFF] },
    { mime: "image/png",   bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
    { mime: "image/gif",   bytes: [0x47, 0x49, 0x46, 0x38] },
    { mime: "image/webp",  bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },  // RIFF then WEBP at 8
    { mime: "image/heic",  bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },  // ftyp box
    { mime: "image/heif",  bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  ];

  const MIN_DIMENSION = 200;   // px
  const MAX_DIMENSION = 8000;  // px
  const MAX_FILE_BYTES = 5 * 1024 * 1024;

  async function validateImageFile(file: File): Promise<string | null> {
    // 1. MIME type claim (fast check — can be spoofed, magic bytes confirm later)
    if (!file.type.startsWith("image/")) {
      return "Only image files are accepted (JPG, PNG, WEBP, HEIC).";
    }

    // 2. File size
    if (file.size > MAX_FILE_BYTES) {
      return `Image must be smaller than 5 MB. This file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`;
    }
    if (file.size === 0) {
      return "The file appears to be empty.";
    }

    // 3. Magic-byte / file-signature check
    const headerBytes = await file.slice(0, 12).arrayBuffer();
    const header = new Uint8Array(headerBytes);
    const signatureMatch = IMAGE_SIGNATURES.some(({ bytes, offset = 0 }) =>
      bytes.every((b, i) => header[offset + i] === b)
    );
    // WEBP: bytes 8-11 must be "WEBP" (0x57 0x45 0x42 0x50)
    const isWebp = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
                && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
    if (!signatureMatch && !isWebp) {
      return "This file does not appear to be a valid image. Please use a JPG, PNG, WEBP, or HEIC photo.";
    }

    // 4. Decode check + dimension validation (also catches corrupted images)
    const dimensionError = await new Promise<string | null>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const { naturalWidth: w, naturalHeight: h } = img;
        if (w === 0 || h === 0) {
          resolve("The image could not be decoded. Please try a different file.");
        } else if (w < MIN_DIMENSION || h < MIN_DIMENSION) {
          resolve(`Image is too small (${w} × ${h} px). Minimum size is ${MIN_DIMENSION} × ${MIN_DIMENSION} px.`);
        } else if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
          resolve(`Image is too large (${w} × ${h} px). Maximum size is ${MAX_DIMENSION} × ${MAX_DIMENSION} px.`);
        } else {
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve("The image could not be decoded. It may be corrupted or not a supported format.");
      };
      img.src = url;
    });
    if (dimensionError) return dimensionError;

    return null;
  }

  async function uploadToCloudinary(file: File) {
    setUploading(true);
    setUploadError(null);

    // Client-side validation: MIME, size, magic bytes, decode, dimensions
    const validationError = await validateImageFile(file);
    if (validationError) {
      setUploadError(validationError);
      setUploading(false);
      return;
    }

    try {
      const sigRes = await fetch("/api/cloudinary-signature", { credentials: "same-origin" });
      if (!sigRes.ok) {
        const errData = await sigRes.json().catch(() => ({} as any));
        setUploadError((errData as any).error || "Upload service unavailable. Please try again.");
        setUploading(false);
        return;
      }
      const sig = await sigRes.json() as any;

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", sig.apiKey);
      form.append("timestamp", String(sig.timestamp));
      form.append("signature", sig.signature);
      form.append("asset_folder", sig.assetFolder);
      form.append("upload_preset", sig.uploadPreset);
      form.append("allowed_formats", sig.allowedFormats);

      const cloudRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        { method: "POST", body: form }
      );
      if (!cloudRes.ok) {
        const errData = await cloudRes.json().catch(() => ({} as any));
        setUploadError((errData as any).error?.message || "Upload failed. Please try again.");
        setUploading(false);
        return;
      }
      const cloudData = await cloudRes.json() as any;
      setNewImageUrl(cloudData.secure_url);
      setImgMeta({
        width:  cloudData.width  ?? undefined,
        height: cloudData.height ?? undefined,
        format: cloudData.format ?? undefined,
        bytes:  cloudData.bytes  ?? undefined,
      });
    } catch {
      setUploadError("Upload failed. Please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  function toggleOccasion(o: string) {
    setNewOccasions(prev => prev.includes(o) ? prev.filter(x => x !== o) : [...prev, o]);
  }
  function toggleSeason(s: string) {
    setNewSeasons(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  function handleAdd() {
    if (!newName) return;
    fetcher.submit(
      {
        intent: "add", name: newName, category: newCategory, imageUrl: newImageUrl,
        primaryColor: newColor, pattern: newPattern, brand: newBrand,
        occasions: JSON.stringify(newOccasions), seasons: JSON.stringify(newSeasons),
        ...(imgMeta.width  !== undefined && { imageWidth:  String(imgMeta.width)  }),
        ...(imgMeta.height !== undefined && { imageHeight: String(imgMeta.height) }),
        ...(imgMeta.format !== undefined && { imageFormat: imgMeta.format         }),
        ...(imgMeta.bytes  !== undefined && { imageBytes:  String(imgMeta.bytes)  }),
      },
      { method: "post" }
    );
    setNewName(""); setNewImageUrl(""); setNewColor(""); setNewPattern(""); setNewBrand("");
    setNewOccasions([]); setNewSeasons([]); setImgMeta({});
    setShowAddForm(false);
  }

  return (
    // Option B shell: compact variant — NADINE header + sidebar, no MY nAia. masthead
    <MyNaiaLayout compact>
      <style>{css}</style>

      <div className="mn-page-sections">
        {/* Option B navigation: back to My nAia Overview */}
        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Option A page header */}
        <h1 className="cl-headline">Digital Wardrobe</h1>
        <p className="cl-sub">Upload, save, and style your pieces</p>

        {/* Option A: Total Pieces / Categories / Brands */}
        <div className="cl-stats">
          <div className="cl-stat">
            <div className="cl-stat-num">{items.length}</div>
            <div className="cl-stat-label">Total Pieces</div>
          </div>
          <div className="cl-stat">
            <div className="cl-stat-num">{new Set(items.map((i: any) => i.category)).size}</div>
            <div className="cl-stat-label">Categories</div>
          </div>
          <div className="cl-stat">
            <div className="cl-stat-num">{new Set(items.map((i: any) => i.brand).filter(Boolean)).size}</div>
            <div className="cl-stat-label">Brands</div>
          </div>
        </div>

        {/* Option A: + Add a Piece CTA */}
        {!showAddForm && (
          <button type="button" className="cl-add-btn" onClick={() => setShowAddForm(true)}>
            + Add a Piece
          </button>
        )}

        {/* Option A: Add to Wardrobe inline form */}
        {showAddForm && (
          <div className="cl-form">
            <div className="cl-form-header">
              <h3 className="cl-form-title">Add to Wardrobe</h3>
              <button type="button" className="cl-form-cancel" onClick={() => setShowAddForm(false)}>Cancel</button>
            </div>

            {/* Photo guide integrated inside Add to Wardrobe panel */}
            <div className="cl-guide">
              <div className="cl-guide-header">Photo guide</div>
              <div className="cl-guide-cols">
                <div>
                  <div className="cl-guide-col-label">General</div>
                  <ul className="cl-guide-tips">
                    {GENERAL_PHOTO_TIPS.map((tip, i) => <li key={i}>{tip}</li>)}
                  </ul>
                </div>
                {CATEGORY_PHOTO_TIPS[newCategory] && (
                  <div>
                    <div className="cl-guide-col-label">{CATEGORY_PHOTO_TIPS[newCategory].title}</div>
                    <ul className="cl-guide-tips">
                      {CATEGORY_PHOTO_TIPS[newCategory].tips.map((tip, i) => <li key={i}>{tip}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              <div>
                <div className="cl-guide-ex good">
                  <span className="cl-guide-ex-mark">✓</span>
                  <span>Single item · plain background · fully visible · well lit</span>
                </div>
                <div className="cl-guide-ex avoid">
                  <span className="cl-guide-ex-mark">✗</span>
                  <span>Multiple items or cluttered background</span>
                </div>
                <div className="cl-guide-ex avoid">
                  <span className="cl-guide-ex-mark">✗</span>
                  <span>Item cropped, blurry or poorly lit</span>
                </div>
              </div>
            </div>

            <div className="cl-label">Photo</div>
            <label className="cl-upload-box">
              {newImageUrl
                ? <img src={newImageUrl} alt="preview" style={{ maxHeight: "200px", objectFit: "cover" }} />
                : uploading
                  ? <span className="cl-upload-hint">Uploading…</span>
                  : <span className="cl-upload-hint">Click to upload photo</span>
              }
              <input
                type="file"
                accept="image/*"
                onChange={e => e.target.files?.[0] && uploadToCloudinary(e.target.files[0])}
                style={{ display: "none" }}
              />
            </label>
            <p className="cl-upload-notice">
              Upload photos of clothing items only. Do not upload selfies, face photos, mirror photos, body scans, or personal images.
            </p>
            {uploadError && <p className="cl-upload-error">{uploadError}</p>}

            <div className="cl-label">Name *</div>
            <input
              className="cl-input"
              type="text"
              placeholder="e.g. Black silk blazer"
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />

            <div className="cl-label">Category *</div>
            <div className="cl-pills">
              {CATEGORIES.map(c => (
                <button key={c} type="button" onClick={() => setNewCategory(c)} className={`cl-pill${newCategory === c ? " on" : ""}`}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            <div className="cl-label">Color</div>
            <div className="cl-pills">
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setNewColor(c)} className={`cl-pill${newColor === c ? " on" : ""}`}>{c}</button>
              ))}
            </div>

            <div className="cl-label">Pattern</div>
            <div className="cl-pills">
              {PATTERNS.map(p => (
                <button key={p} type="button" onClick={() => setNewPattern(p)} className={`cl-pill${newPattern === p ? " on" : ""}`}>{p}</button>
              ))}
            </div>

            <div className="cl-label">Occasions</div>
            <div className="cl-pills">
              {OCCASIONS.map(o => (
                <button key={o} type="button" onClick={() => toggleOccasion(o)} className={`cl-pill${newOccasions.includes(o) ? " on" : ""}`}>{o}</button>
              ))}
            </div>

            <div className="cl-label">Season</div>
            <div className="cl-pills">
              {SEASONS.map(s => (
                <button key={s} type="button" onClick={() => toggleSeason(s)} className={`cl-pill${newSeasons.includes(s) ? " on" : ""}`}>{s}</button>
              ))}
            </div>

            <div className="cl-label">Brand (optional)</div>
            <input
              className="cl-input"
              type="text"
              placeholder="Brand name"
              value={newBrand}
              onChange={e => setNewBrand(e.target.value)}
            />

            <button
              type="button"
              className="cl-submit"
              onClick={handleAdd}
              disabled={!newName || !newImageUrl || uploading}
            >
              {uploading ? "Uploading…" : "Add to Wardrobe"}
            </button>
          </div>
        )}

        {/* Option A: category filters + Option B: search — combined row */}
        <div className="cl-filter-row">
          <div className="cl-filters">
            {["ALL", ...CATEGORIES].map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`cl-filter${activeCategory === cat ? " on" : ""}`}
              >
                {cat === "ALL" ? "All" : cat.charAt(0) + cat.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <label className="cl-search-label">
            <span>Search</span>
            <input
              type="text"
              className="cl-search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ivory trouser…"
            />
          </label>
        </div>

        {/* Item count */}
        <p className="cl-count">{filtered.length} {filtered.length === 1 ? "piece" : "pieces"}</p>

        {/* Option A: card grid */}
        {filtered.length === 0 ? (
          <div className="cl-empty">
            <div className="cl-empty-icon">◇</div>
            <p className="cl-empty-text">
              {items.length === 0
                ? "No pieces yet. Add your first to get started."
                : "No pieces match this view."}
            </p>
            {items.length === 0 && (
              <button
                type="button"
                className="cl-add-btn"
                style={{ width: "auto", display: "inline-block", marginBottom: 0 }}
                onClick={() => setShowAddForm(true)}
              >
                Add Your First Piece
              </button>
            )}
          </div>
        ) : (
          <div className="cl-grid">
            {filtered.map((item: any) => {
              const elig = eligibilityStatus(item.tryOnEligibility, item.tryOnCustomerHint);
              return (
                <div key={item.id} className="cl-card">
                  <div className="cl-card-img">
                    {item.imageUrl
                      ? <img src={item.imageUrl} alt={item.name} />
                      : <span style={{ fontSize: "64px", opacity: 0.2 }}>◇</span>
                    }
                  </div>
                  <div className="cl-card-body">
                    <div className="cl-card-cat">{item.category}</div>
                    <div className="cl-card-name">{item.name}</div>
                    {(item.primaryColor || item.pattern) && (
                      <div className="cl-card-meta">{[item.primaryColor, item.pattern].filter(Boolean).join(" · ")}</div>
                    )}
                    {item.brand && <div className="cl-card-meta" style={{ marginTop: "4px" }}>{item.brand}</div>}
                    {elig && (
                      <span className={elig.isNeeds ? "cl-card-elig--needs" : "cl-card-elig--ok"}>
                        {elig.label}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="cl-delete"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => fetcher.submit({ intent: "delete", itemId: item.id }, { method: "post" })}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Option A: Style Me CTA → canonical /style-me route */}
        <div className="cl-cta">
          <Link to="/style-me">Style Me →</Link>
        </div>
      </div>
    </MyNaiaLayout>
  );
}
