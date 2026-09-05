import { createHash } from "node:crypto";
import { data as json } from "react-router";
import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import prisma from "../db.server";
import { extractBuySkipEvidence } from "../lib/ai/taste-extraction.server";
import { writeSourceEvidence } from "../lib/ai/taste-reconcile.server";
import {
  verifyCloudinaryAsset,
  validatePublicIdOwnership,
  buildPrivateDownloadUrl,
  deleteCloudinaryAsset,
  getCloudinaryConfig,
} from "../lib/cloudinary-admin.server";
import { emitBuySkipSubmitted, recordJourneyEventAwaited } from "../lib/ai/journey-events.server";
import { quizQuestions } from "../lib/onboarding/quiz-data";
import { checkEntitlement } from "../lib/plan/entitlement.server";
import { moderateImageContent } from "../lib/image-moderation.server";
import { screenGarmentSuitability } from "../lib/image-suitability.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * GET /api/wishlist — fetch all wishlist items
 */

// ANALYZE ITEM ACTION (for Buy/Skip)

// Human-readable labels for lifestyle tag IDs — prevents raw tokens like
// "work-office" or "dinners-going-out" from appearing in LLM-generated output.
const LIFESTYLE_LABELS = {
  "work-office":              "office / workdays",
  "everyday-casual":          "everyday casual",
  "dinners-going-out":        "dinners out",
  "events-special-occasions": "special occasions and events",
  "family-parenting":         "family life",
  "active-busy-days":         "active days",
};
function labelLifestyle(ids) {
  if (!ids || ids.length === 0) return null;
  return ids.map(id => LIFESTYLE_LABELS[id] ?? id).join(", ");
}

// Maps uploaded-item category (Buy or Skip values) to compatible Closet enum values
const CLOSET_COMPATIBLE_CATEGORIES = {
  "Top":       ["BOTTOMS", "OUTERWEAR"],
  "Bottom":    ["TOPS", "OUTERWEAR"],
  "Dress":     ["OUTERWEAR"],
  "Outerwear": ["TOPS", "BOTTOMS", "DRESSES"],
  "Shoes":     ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"],
  "Bag":       ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"],
  "Accessory": ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"],
  "Jewelry":   ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"],
};

function optionLabel(questionId, optionId) {
  const q = quizQuestions.find(q => q.id === questionId);
  const opt = q?.options?.find(o => o.id === optionId);
  return opt?.label ?? optionId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function hashForIndex(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Magic-byte detection for server-side image format verification.
// Mirrors the implementation in closet._index.tsx — both must stay in sync.
function detectImageFormatFromBytes(header) {
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return "jpeg";
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return "png";
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
      header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) return "webp";
  if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) return "heic";
  return null;
}

// Idempotency policy: create a new analysis attempt per submission.
// Guard: if the same customer submits the same imageUrl within 60 s (double-click /
// network retry), skip the DB write and return the fresh analysis without a duplicate record.
// DB-backed idempotency: 60-second bucket, keyed on customerId+imageUrl.
// The idempotencyKey is stored in the DB with a unique constraint — duplicate
// submissions within the same 60s window hit a P2002 and return the cached result.
const IDEMPOTENCY_WINDOW_SECONDS = 60;

async function analyzeItem(request) {
  // ── 1. Authentication — session only; never from body ─────────────────────
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) {
    return json({ error: "not_authenticated" }, { status: 401 });
  }
  // The shared guest customer (shopifyCustomerId: "guest") is a style-me session placeholder.
  // It must never receive BuyOrSkipAnalysis writes.
  if (naiaCustomer.shopifyCustomerId === "guest") {
    return json({ error: "not_authenticated" }, { status: 401 });
  }

  // ── 1b. Quota guard — behind ENTITLEMENT_ENFORCEMENT flag ────────────────
  // Concurrency note: read-before-write; NOT atomic. Wrap in Serializable
  // transaction before enabling in public production.
  if (process.env.ENTITLEMENT_ENFORCEMENT === "true") {
    const entCheck = await checkEntitlement(naiaCustomer.id, naiaCustomer.plan, "buySkip");
    if (!entCheck.allowed) {
      const message = entCheck.reason === "intro_used"
        ? "You've used your introductory Buy or Skip check."
        : "You've used all your Buy or Skip checks for this month.";
      return json({ error: "quota_exceeded", message }, { status: 429 });
    }
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  // Accept publicId (Cloudinary asset reference) — never a free-form imageUrl.
  // Customer cannot make nAia analyse an arbitrary URL or another customer's asset.
  const { publicId, category, color, brand, forOccasion, whatLike, unsureAbout, colorNote, size } = body;

  if (!publicId || typeof publicId !== "string" || publicId.trim().length === 0) {
    return json({ error: "image_required", message: "Image upload reference required." }, { status: 400 });
  }

  // ── 3. Cloudinary config — required before any verification or analysis ────
  const cfg = getCloudinaryConfig();
  if (!cfg) {
    return json({ error: "service_unavailable", message: "Image service is not configured." }, { status: 503 });
  }

  // ── 4. Ownership check — publicId must belong to the authenticated customer's folder ─
  // Customer ID comes from the authenticated session, never from the request body.
  const ownership = validatePublicIdOwnership(publicId, naiaCustomer.id);
  if (!ownership.ok) {
    return json({ error: "asset_not_owned", message: "Photo does not belong to this account." }, { status: 403 });
  }

  // ── 5. Server-side asset verification via Cloudinary Admin API ─────────────
  const verify = await verifyCloudinaryAsset(publicId, "private");
  if (!verify.ok) {
    return json({
      error: verify.errorCode === "NOT_FOUND" ? "asset_not_found" : "verification_failed",
      message: verify.errorCode === "NOT_FOUND"
        ? "Image not found. Please upload again."
        : "Image verification failed. Please upload again.",
    }, { status: 400 });
  }

  const serverFormat = verify.asset.format.toLowerCase();
  const serverBytes  = verify.asset.bytes;
  const serverWidth  = verify.asset.width;
  const serverHeight = verify.asset.height;

  // Verify delivery type — asset must be private (not public upload)
  if (verify.asset.type !== "private") {
    return json({ error: "invalid_delivery_type", message: "Image must be uploaded via the app." }, { status: 400 });
  }

  // Verify resource type
  if (verify.asset.resourceType !== "image") {
    return json({ error: "invalid_resource_type", message: "Uploaded file must be an image." }, { status: 400 });
  }

  // Format allowlist — derived from Admin API, not client
  const ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
  if (!ALLOWED_FORMATS.has(serverFormat)) {
    return json({ error: "invalid_format", message: `File type "${serverFormat}" is not accepted. Use JPG, PNG, WEBP, or HEIC.` }, { status: 400 });
  }

  // File size — from Admin API
  const SERVER_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (product screenshots may be larger than model photos)
  if (serverBytes > SERVER_MAX_BYTES) {
    return json({ error: "file_too_large", message: `Image too large (${(serverBytes / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.` }, { status: 400 });
  }

  // Dimension bounds — from Admin API
  const MIN_DIM = 100;
  const MAX_DIM = 8000;
  if (serverWidth !== null && serverWidth < MIN_DIM) {
    return json({ error: "invalid_dimensions", message: `Image width (${serverWidth}px) is below the minimum.` }, { status: 400 });
  }
  if (serverHeight !== null && serverHeight < MIN_DIM) {
    return json({ error: "invalid_dimensions", message: `Image height (${serverHeight}px) is below the minimum.` }, { status: 400 });
  }
  if (serverWidth !== null && serverWidth > MAX_DIM) {
    return json({ error: "invalid_dimensions", message: `Image width (${serverWidth}px) exceeds the maximum.` }, { status: 400 });
  }
  if (serverHeight !== null && serverHeight > MAX_DIM) {
    return json({ error: "invalid_dimensions", message: `Image height (${serverHeight}px) exceeds the maximum.` }, { status: 400 });
  }

  // Magic-byte verification — fetch first 12 bytes via signed download URL
  {
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
          return json({ error: "invalid_file", message: "File signature does not match a supported image format." }, { status: 400 });
        }
      }
    } catch {
      return json({ error: "verification_timeout", message: "Image verification timed out. Please try again." }, { status: 400 });
    }
  }

  // ── Layer 2: Global content safety moderation ──────────────────────────────
  // Run on the same signed URL used for magic-byte check — no extra network call.
  const privateImageUrl = buildPrivateDownloadUrl(cfg, publicId, serverFormat, "private");
  {
    const moderation = await moderateImageContent(privateImageUrl);
    if (moderation.status === "MODERATION_UNAVAILABLE") {
      await deleteCloudinaryAsset(publicId, "private");
      try {
        await prisma.journeyEvent.create({
          data: {
            type: "image_moderation_unavailable",
            occurredAt: new Date(),
            customerIdHash: createHash("sha256").update(naiaCustomer.id).digest("hex").slice(0, 16),
            sessionId: "buy-or-skip",
            payload: { feature: "buy-or-skip" },
          },
        });
      } catch { /* audit failure never blocks */ }
      return json({ error: "Image review is temporarily unavailable. Please try again." }, { status: 503 });
    }
    if (moderation.status === "SAFETY_REJECT") {
      await deleteCloudinaryAsset(publicId, "private");
      try {
        await prisma.journeyEvent.create({
          data: {
            type: "image_safety_reject",
            occurredAt: new Date(),
            customerIdHash: createHash("sha256").update(naiaCustomer.id).digest("hex").slice(0, 16),
            sessionId: "buy-or-skip",
            payload: { feature: "buy-or-skip", reasonCode: moderation.reasonCode },
          },
        });
      } catch { /* audit failure never blocks */ }
      return json({ error: "Photo could not be accepted. Please upload a clothing item photo." }, { status: 422 });
    }
  }

  // ── Layer 3: Garment suitability ────────────────────────────────────────────
  {
    const suitability = await screenGarmentSuitability(privateImageUrl, { declaredCategory: category });
    const GARMENT_GUIDANCE = {
      no_garment_visible: "No clothing item was detected. Please upload a photo of a single garment.",
      image_too_blurry: "Photo is too blurry. Please try a clearer photo.",
      garment_excessively_cropped: "The garment is too cropped. Please ensure the full item is visible.",
      multiple_items_ambiguous: "Multiple items detected. Please photograph one item at a time.",
      color_indeterminate: "The colour of this item is unclear in the photo.",
      category_mismatch: "The item in the photo does not match the selected category.",
      item_not_identifiable: "We couldn't identify a wearable fashion item in this photo. Please upload a clear photo of the full item.",
      assessment_failed: "Image assessment is temporarily unavailable. Please try again.",
    };
    if (suitability.status === "RETRY_IMAGE") {
      await deleteCloudinaryAsset(publicId, "private");
      const msg = GARMENT_GUIDANCE[suitability.subCode] ?? "Please upload a clearer photo of a single fashion item.";
      return json({ error: msg, retryImage: true }, { status: 422 });
    }
    // NEEDS_CLARIFICATION: item is usable — proceed (surface subCode in future UI iteration)
  }

  // ── 6. DB-backed idempotency key ────────────────────────────────────────────
  const bucket = Math.floor(Date.now() / (IDEMPOTENCY_WINDOW_SECONDS * 1000));
  const idempotencyKey = "bos:" + createHash("sha256")
    .update(`${naiaCustomer.id}:${publicId}:${bucket}`)
    .digest("hex")
    .slice(0, 24);
  let isIdempotentRepeat = false;

  // ── 7. Claude analysis URL ─────────────────────────────────────────────────
  // privateImageUrl was already built above — reuse it. Never persisted.

  const styleProfile = naiaCustomer.onboardingProfile;

    const closetData = await prisma.customer.findUnique({
      where: { id: naiaCustomer.id },
      select: {
        closetItems: {
          take: 40,
          orderBy: { createdAt: "desc" },
          select: {
            name: true,
            category: true,
            primaryColor: true,
            garmentRelationships: true,
            silhouette: true,
            fitProfile: true,
            formality: true,
            sleeveLength: true,
            necklineCoverage: true,
            shoulderCoverage: true,
            midriffExposed: true,
            customerNote: true,
          }
        }
      }
    });
    // Sort: items with any relationship signal first (preserving DB recency order within each group),
    // then untagged items. This ensures relationship-bearing items appear in the eligible window.
    const rawClosetItems = closetData?.closetItems || [];
    const closetItems = [
      ...rawClosetItems.filter(i => i.garmentRelationships?.length > 0),
      ...rawClosetItems.filter(i => !i.garmentRelationships?.length),
    ];

    const normalizedCategory = (category || "").trim();
    const compatibleClosetCategories = CLOSET_COMPATIBLE_CATEGORIES[normalizedCategory] || ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"];
    const eligibleClosetItems = closetItems.filter(i => compatibleClosetCategories.includes(i.category));

    // ── 5. Call Claude AI ──────────────────────────────────────────────────────
    // Sanitize user-entered strings before embedding them in the prompt
    const sanitize = s => typeof s === "string" ? s.replace(/"/g, "'").replace(/\n/g, " ").trim() : "";
    const safeOccasion    = sanitize(forOccasion);
    const safeWhatLike    = sanitize(whatLike);
    const safeUnsureAbout = sanitize(unsureAbout);
    const safeSize        = sanitize(size);

    let analysisResponse;
    try {
      analysisResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-opus-4-5-20251101",
          max_tokens: 3000,
          messages: [{
            role: "user",
            content: [
              // privateImageUrl is a short-lived server-signed URL (10 min expiry).
              // It is never stored — a fresh URL is generated for each analysis request.
              { type: "image", source: { type: "url", url: privateImageUrl } },
              {
                type: "text",
                text: `You are assessing a clothing item for a specific customer. Every verdict, summary, and section must be grounded in this customer's actual Passport, Closet, and form inputs. Generic statements that could apply to any customer are not acceptable. Every point stated ONCE only — never repeated across sections.

ITEM DETAILS:
- Category: ${category||"unknown"}
- Customer-selected colour: ${Array.isArray(color) ? color.join(", ") : color||"unknown"}
- Brand: ${brand || "unknown"}
${safeSize ? `- Size the customer is considering: ${safeSize}` : ""}
Price information was not provided — do not assess monetary value or make value judgements based on brand or price.

${styleProfile ? `CUSTOMER PASSPORT — use every available field across the entire recommendation:

STYLE IDENTITY
- Style personalities: ${styleProfile.stylePersonalities?.join(", ")}
- Desired feelings when dressed: ${styleProfile.desiredFeelings?.join(", ") || "not specified"}
- Desired impression: ${styleProfile.desiredImpression?.length > 0 ? styleProfile.desiredImpression.join(", ") : "not specified"}
- Fashion risk comfort (1–10): ${styleProfile.comfortLevel ?? "not specified"}
${styleProfile.becoming?.length > 0 ? `- Style aspiration: ${styleProfile.becoming.map(id => optionLabel("becoming", id)).join(", ")}` : ""}
${styleProfile.styleSupport?.length > 0 ? `- Style support goals: ${styleProfile.styleSupport.map(id => optionLabel("style-support", id)).join(", ")}` : ""}
${styleProfile.successfulOutfitGives?.length > 0 ? `- What their best outfits give them: ${styleProfile.successfulOutfitGives.map(id => optionLabel("successful-outfit-gives", id)).join(", ")}` : ""}

LIFESTYLE & OCCASIONS
- Primary lifestyle: ${labelLifestyle(styleProfile.lifestyle) || "not specified"}
- Typical day: ${styleProfile.typicalDay || "not specified"}
→ LIFESTYLE RULE: The wearability conclusion must name these actual occasions and state whether the item suits them specifically. Never write "may have limited wear if you don't attend such events." State the real match or mismatch using the occasions listed above.

COLOUR PALETTE
- Favourite colours: ${styleProfile.favoriteColors?.join(", ")}
- Colours the customer avoids: ${styleProfile.avoidColors?.length > 0 ? styleProfile.avoidColors.join(", ") : "none specified"}
→ COLOUR RULE: For the uploaded item's colour, explain specifically whether it complements the customer's palette, usefully expands it, or conflicts with avoided colours. How does it coordinate with confirmed Closet pieces? Treat favourites as preferences, not exclusions. Never reject a neutral without naming how it works or clashes with this specific palette.

FIT, SILHOUETTE & BODY
- Preferred silhouettes: ${styleProfile.silhouette?.length > 0 ? styleProfile.silhouette.map(id => optionLabel("silhouette", id)).join(", ") : "not specified"}
- Fit preferences: ${styleProfile.fitPreferences?.length > 0 ? styleProfile.fitPreferences.join(", ") : "not on record"}
- Usual top size: ${styleProfile.topSize || "not on record"}${styleProfile.sizingSystem ? ` (${styleProfile.sizingSystem.toUpperCase()} sizing)` : ""}
- Usual bottom size: ${styleProfile.bottomSize || "not on record"}
- Usual dress size: ${styleProfile.dressSize || "not on record"}
- Areas to highlight: ${styleProfile.bodyFocusAreas?.length > 0 ? styleProfile.bodyFocusAreas.join(", ") : "not on record"}
- Areas to minimise: ${styleProfile.bodyAvoidAreas?.length > 0 ? styleProfile.bodyAvoidAreas.join(", ") : "not on record"}
- Style struggles: ${styleProfile.styleStruggles?.length > 0 ? styleProfile.styleStruggles.join(", ") : "not specified"}
${styleProfile.fitConcerns?.length > 0 ? `- Fit considerations: ${styleProfile.fitConcerns.join(", ")}` : ""}${styleProfile.fitConcerns?.includes("other") && styleProfile.fitConcernsNote?.trim() ? `\n- Additional fit note: ${styleProfile.fitConcernsNote.trim()}` : ""}
${styleProfile.preferredCoverage ? `- Coverage preference: ${styleProfile.preferredCoverage}` : ""}
${styleProfile.bodyShape && !["not-sure","prefer-not-to-say"].includes(styleProfile.bodyShape) ? `- Self-described proportions: ${styleProfile.bodyShape}` : ""}
${styleProfile.bustMeasurement || styleProfile.waistMeasurement || styleProfile.hipMeasurement ? `- Customer measurements (${styleProfile.measurementUnit || "unit not set"}): bust ${styleProfile.bustMeasurement || "–"}, waist ${styleProfile.waistMeasurement || "–"}, hips ${styleProfile.hipMeasurement || "–"}` : ""}
${styleProfile.height ? `- Height: ${styleProfile.height}` : ""}
${styleProfile.finalNotes?.trim() ? `- Customer's personal note: ${sanitize(styleProfile.finalNotes)}` : ""}

DRESSING REQUIREMENTS — explicit constraints, not style preferences:
${styleProfile.dressingPreferences?.length > 0
  ? styleProfile.dressingPreferences.map(id => optionLabel("dressing-preferences", id)).join(", ")
  : "none specified"}
→ DRESSING RULE: These are hard requirements. Check the uploaded item AND every suggested closet pairing against them. An item that violates a dressing requirement — exposed arms when arms-covered is required, sleeveless when avoid-sleeveless is specified, cropped when no-cropped-tops is specified, shorts when avoid-shorts is specified — must not receive a BUY verdict and must be flagged explicitly. Apply to the item's visible construction: sleeve length, neckline coverage, hem length, midriff exposure.

→ FIT CERTAINTY RULE: Never write "This will fit you" or any equivalent certainty claim based solely on size or measurement data. Exact-fit conclusions require garment measurements AND a verified size chart comparison.
→ BODY SHAPE RULE: Self-described proportions may inform general styling directions but must never generate universal "flattering for X shape" claims.
→ FIT RULE — priority order (never collapse into "fit cannot be confirmed"):
  1. Preferred silhouettes on record → cite by name: "Their Passport shows a preference for [silhouette] — this item aligns/conflicts."
  2. Fit preferences on record → "Their Passport shows they prefer [preference], so this [item detail] may feel [more/less] secure."
  3. Highlight/minimise areas → apply directly.
  4. Size on record for this category → use for sizing reasoning.
  5. Measurements → fallback only when genuinely absent.

→ LAYERED CONSTRUCTION RULE: When a garment has an overlay (sheer, net, draped, embellished, or lace over a base), assess the UNDERLYING/BASE construction first — its silhouette, waist definition, and fit profile. The overlay does not determine the garment's silhouette or fit unless it is the only layer. A fitted, waist-defined base under a net/sheer/loose overlay must be described as fitted/waist-defined — the overlay is secondary construction, not the silhouette. Never classify a garment as loose or waist-obscuring based on the overlay alone when the underlying construction is visibly fitted. When visual evidence is ambiguous between base and overlay, use qualified language rather than a definitive negative fit claim.

→ FIT vs COVERAGE SEPARATION RULE — always assessed separately, never conflated:
  - SILHOUETTE/FIT PREFERENCE = shape and cut alignment with the customer's stated preference.
  - COVERAGE/DRESSING REQUIREMENT = skin exposure and garment construction constraints.

PERSONALIZATION MANDATE
- BUY: every positive claim must cite a Passport or form field by name. Name the style personality, reference the lifestyle occasions, apply silhouette preference, fit preferences, and colour palette.
- SKIP FOR NOW / SKIP: every blocker must cite a Passport or form field. Structure: "Their Passport shows [field] — this item [conflict/concern]."` : "No style profile on record — give a general analysis."}

${(() => {
  const CURRENT_GOAL_CONTEXT = {
    "understand-my-style":        "understand their personal style better",
    "feel-more-like-myself":      "feel more like themselves when dressed",
    "use-what-i-own":             "make the most of what they already own — avoid adding more without a genuine gap",
    "easier-getting-dressed":     "make getting dressed easier and faster",
    "stop-regret-purchases":      "stop buying things they end up not wearing",
    "more-cohesive-wardrobe":     "build a more cohesive wardrobe",
    "dress-for-my-life":          "dress better for their actual life and occasions",
    "refresh-my-style":           "refresh their style",
    "specific-event-trip-change": "dress well for a specific event, trip, or life change",
  };
  const goals = (styleProfile?.currentGoal ?? [])
    .filter(id => id !== "not-sure-yet" && CURRENT_GOAL_CONTEXT[id]);
  if (goals.length === 0) return "";
  const labels = goals.map(id => CURRENT_GOAL_CONTEXT[id]);
  const goalLine = labels.length === 1 ? labels[0] : labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
  return `CURRENT FOCUS — what the customer is actively working on right now:
They want to ${goalLine}.
→ Let this inform the direction and framing of your reasoning — not override the item evidence. Weight the questions most relevant to this focus: e.g. if they want to stop regret purchases, be more attentive to lifestyle fit, redundancy, and fit uncertainty — but 'stop-regret-purchases' does NOT automatically push statement or occasion pieces toward SKIP; a distinctive piece that genuinely serves real occasions in their life is not a regret purchase, so ask 'is there a realistic pattern of wear here?' not 'does this work for every context?'. If they want to use what they own, assess whether this item fills a genuine gap not already covered by their Closet.
→ Do NOT use CURRENT FOCUS to generate an automatic BUY or SKIP. The verdict must come from the item + Passport + Closet evidence.

`;
})()}CUSTOMER'S INPUTS:

OCCASION: ${safeOccasion || "(not provided)"}
${safeOccasion ? `→ Does this item suit "${safeOccasion}"? One concrete reason referencing the item's formality and that occasion's dress code. If yes, one styling tip. If no, what adjustment would help.` : "→ Suggest the most suitable occasions given this customer's actual lifestyle contexts."}

WHAT THEY LIKE: ${safeWhatLike || "(not provided)"}
${safeWhatLike ? `→ Agree, partly agree, or disagree? One concrete reason based on the item's actual construction — do not restate what they said.` : ""}

WHAT THEY ARE UNSURE ABOUT: ${safeUnsureAbout || "(not provided)"}
${safeUnsureAbout ? `→ Justified, partly justified, or not supported? Use "partly justified" when the concern is about fit or sizing and measurements are not on the Passport. Be direct. Then offer 2–3 specific practical solutions.` : ""}

BEFORE YOU BUY — exactly 2 points (25–40 words each). Do NOT begin either point with a label — the card headings already show these:
1. FIT & PRACTICAL SOLUTION — Open with what IS known from the Passport (preferred silhouettes, fit preferences, coverage, size for this category). Reference by name. Never open with "Fit cannot be confirmed."
2. WEARABILITY — Name at least one of the customer's actual lifestyle contexts (${labelLifestyle(styleProfile?.lifestyle) || "lifestyle not specified"}) and state directly whether this item suits those contexts and how realistically frequent the wear would be. Never use language like "if your lifestyle includes such events."
No brand-sizing claims.

→ OCCASION CALIBRATION RULE: A purchase does NOT need to serve every lifestyle context to be worthwhile. Evaluate whether this piece serves a meaningful real part of the customer's life often enough to justify owning it — not whether it can cover every occasion simultaneously. An occasion-specific item (e.g. a dinner dress, an event piece) can earn BUY when there is realistic use in the customer's actual life. Do not require an occasion piece to also work for everyday or work contexts.

REPETITION RULE: Each colour, concern or trait appears ONCE. Never repeat Final Condition reasoning in any earlier section.

VERDICT-AWARE PERSONALIZATION RULE:
→ VERDICT SEVERITY RULE: Hard SKIP requires strong evidence that the item genuinely conflicts with the customer — a dressing requirement violated, an avoided colour present, an established regret pattern duplicated, or wear being realistically near-zero given the customer's actual occasions. If style alignment is strong, silhouette/colour fit is good, and the item serves a genuine occasion in the customer's life but realistic wear frequency is uncertain, that is SKIP FOR NOW, not SKIP. Default to SKIP FOR NOW when the item has real merit but a specific named uncertainty blocks confident recommendation.
- BUY: every claim must cite a Passport or form field — name the style personality/personalities, reference actual lifestyle occasions, apply silhouette preference, fit preferences and palette. No generic praise.
- SKIP FOR NOW: lead with specific blockers — cite silhouette preference, fit preferences, lifestyle occasions, palette, or dressing requirements by name.
- SKIP: name the specific conflict with the customer's Passport or form data. No softening.
The "betterDirection" field must describe a product type (silhouette, fabric, fit profile, coverage) that would serve this customer better — no brand names.

${eligibleClosetItems.length > 0 ? `COMPATIBLE CLOSET CANDIDATES (pairings must come ONLY from this list):
${eligibleClosetItems.map(i => {
  const rels = i.garmentRelationships?.length > 0 ? ` [${i.garmentRelationships.join(", ")}]` : "";
  const garmentDetail = [
    i.silhouette ? `silhouette: ${i.silhouette}` : null,
    i.fitProfile ? `fit: ${i.fitProfile}` : null,
    i.formality ? `formality: ${i.formality}` : null,
    i.sleeveLength && i.sleeveLength !== "n/a" ? `sleeves: ${i.sleeveLength}` : null,
    i.necklineCoverage && i.necklineCoverage !== "n/a" ? `neckline: ${i.necklineCoverage}` : null,
  ].filter(Boolean).join(", ");
  const noteStr = i.customerNote ? ` | Note: "${i.customerNote}"` : "";
  return `- ${i.name} (${i.category}${i.primaryColor ? ", "+i.primaryColor : ""}${rels})${garmentDetail ? " | "+garmentDetail : ""}${noteStr}`;
}).join("\n")}` : "NO COMPATIBLE CLOSET ITEMS — leave closetPairings as an empty array."}

CLOSET RELATIONSHIP SIGNALS — observed wear behaviour that complements the Passport. It does not override explicit Passport information. If behaviour and Passport disagree, note both rather than silently resolving. One item or a single relationship is evidence, not proof:
- [favourite] / [wear-often] → proven territory. If the uploaded item is structurally very similar (same silhouette, colour, formality), flag genuine redundancy. If it clearly complements, flag as strong evidence of likely use.
- [love-style-struggle] → ambiguous. The uploaded item may compound styling difficulty OR resolve it by creating viable outfits with the existing piece. Examine whether it pairs well structurally.
- [like] → moderate positive signal.
- [occasion-only] → assess whether the uploaded item expands or duplicates that use case.
- [unsure] → lower certainty; do not anchor a positive pairing on an unsure item.
- [rarely-wear] / [regret] → negative behavioural evidence. If the uploaded item is structurally similar, name this as a warning signal. Do not use as a positive pairing anchor.
Items with no relationship tags have no behavioural evidence — treat as neutral.

CLOSET PAIRING RULE: For each pairing state: (a) which of the customer's actual lifestyle occasions this outfit suits, (b) how the two pieces' colours coordinate, (c) how their proportions balance. Every pairing must also pass the DRESSING REQUIREMENT TEST — a pairing that violates a dressing requirement is invalid. Generic "both pieces share an aesthetic" is not acceptable.

CONSISTENCY REQUIREMENT: All advice must point in the same direction. closetPairings and buyIf/skipIf must reflect the same logic.

STRICT RULES:
1. closetPairings: ONLY from the compatible Closet candidates list. Apply OCCASION TEST, BALANCE TEST, and DRESSING REQUIREMENT TEST. Return [] if no piece passes all three.
2. occasions: ${safeOccasion ? `Include "${safeOccasion}" ONLY if the item genuinely suits it.` : "Suggest appropriate occasions given this customer's lifestyle."}
3. Never invent or hallucinate Passport fields, body data, lifestyle habits, owned pieces, or measurements not listed above.
4. VOICE RULE — nAia is an independent decision tool, not a retailer, influencer, or salesperson. Prohibited in every field: "you deserve it", "treat yourself", "must-have", "you need this", "you're going to look amazing", "obsessed", "gorgeous", "trust me", "game-changer", "last chance", "before it's gone", "hurry", "selling fast", "running out", and any equivalent artificial urgency, scarcity pressure, or celebratory sales language. State the case for BUY, SKIP FOR NOW, or SKIP with calm, specific, evidence-based reasoning only.
5. No brand-based value claims. Price was not provided.
6. SECOND-PERSON VOICE — Every customer-facing output field must address the customer directly using 'you' and 'your'. Never use 'they', 'their', 'the customer', 'she', 'he', or any third-person pronoun in any field shown to the customer. For style references, prefer 'your classic-polished style' over 'your classic-polished identity'.
7. FASHION LANGUAGE CALIBRATION — A distinctive, embellished, or statement garment is NOT automatically avant-garde, theatrical, or costume-like. Reserve those terms only when visual evidence genuinely supports them (extreme structural intervention, non-wearable construction, performance-derived aesthetics). For embellished, statement, or occasion-dressier pieces use proportionate language: statement, embellished, occasion-led, dressier, or more directional. Never apply theatrical or avant-garde language to a piece that could realistically be worn to a dinner, event, or occasion.

Respond ONLY with valid JSON, no markdown:
{
  "itemType": "specific type e.g. Maxi Skirt, Blazer, Midi Dress",
  "detectedColor": "AI colour read from the image — ALL CAPS e.g. BEIGE / CREAM",
  "verdict": "BUY" | "SKIP FOR NOW" | "SKIP",
  "confidence": 0-100,
  "styleDNAMatch": "≤20 words — address the customer directly using 'you/your'. Name at least one of your style personalities explicitly and state whether this item aligns or conflicts with it",
  "detailedAnalysis": {
    "silhouette": "≤20 words — address the customer directly using 'you/your'. Relate this cut to your preferred silhouettes and fit preferences from your Passport",
    "color": "≤20 words — address the customer directly using 'you/your'. How this colour works with your specific favourite colours and coordinates with your confirmed Closet pieces",
    "versatility": "≤15 words — address the customer directly using 'you/your'. Realistic assessment given your actual lifestyle occasions",
    "dressingRequirementsCheck": "≤20 words — address the customer directly using 'you/your'. Explicit confirmation or conflict with your dressing requirements; 'no requirements specified' if none on Passport"
  },
  "occasionFit": ${safeOccasion ? `{ "occasion": "natural noun phrase — activity only (e.g. 'evening dining', 'brunch', 'work meetings')", "fits": true or false, "explanation": "≤20 words — address the customer directly using 'you/your'. Concrete reason referencing the item's formality and your lifestyle", "stylingTip": "≤15 words — one specific action" }` : "null"},
  "whatLikeEval": ${safeWhatLike ? `{ "aspect": "${safeWhatLike.slice(0,80)}", "agreement": "agree" or "partly agree" or "disagree", "explanation": "≤20 words — based on item's actual construction" }` : "null"},
  "concernEval": ${safeUnsureAbout ? `{ "concern": "${safeUnsureAbout.slice(0,80)}", "justified": "justified" or "partly justified" or "not supported", "explanation": "≤20 words — address the customer directly using 'you/your'. Direct assessment referencing your Passport data where available", "solutions": ["specific practical solution 1", "specific practical solution 2"] }` : "null"},
  "closetPairings": [{ "occasion": "specific lifestyle occasion from your Passport e.g. work meetings, dinner", "name": "exact item name from the candidate list above", "reason": "≤12 words — colour coordination fact + how proportions balance" }],
  "fillsGap": null | "≤20 words — address the customer directly using 'you/your'. Scope strictly to what is visible in the Closet data: e.g. 'Among the pieces you've added, nAia doesn't currently see a similar [type].' FORBIDDEN: 'you lack', 'you don't own', 'your wardrobe is missing', or any absolute ownership claim. nAia only sees what the customer has uploaded — not uploaded ≠ not owned. Set to null if no genuine gap is visible in the Closet data.",
  "occasions": [],
  "productSnapshot": {
    "observedSilhouette": "token or null — one of: a-line / straight / column / fitted / flared / wrap / shift / oversized / balloon / asymmetric",
    "observedFitProfile": "token or null — one of: fitted / body-skimming / tailored / structured / relaxed / loose / oversized / flowy",
    "observedFormality": "token or null — one of: casual / smart-casual / business-casual / business-formal / occasion / evening",
    "observedSleeveLength": "token or null — one of: full / three-quarter / short / sleeveless / n/a",
    "observedNecklineCoverage": "token or null — one of: high / crew / mock / cowl-high / v-neck / low / off-shoulder / wrap-variable / n/a",
    "observedShoulderCoverage": true or false or null,
    "observedMidriffExposed": true or false or null,
    "observedMaterial": "token or null — e.g. denim / silk / cotton / linen / leather / wool / knit / synthetic / satin",
    "observedPattern": "token or null — one of: solid / stripe / check / floral / abstract / animal-print / geometric / textured / print",
    "observationConfidence": "high — clearly visible / medium — partially visible / low — image quality limits assessment"
  },
  "beforeYouBuy": [
    "25–40 words — address the customer directly using 'you/your'. Open with their preferred silhouettes or fit data from the Passport, then state what to verify if measurements are missing. No label prefix.",
    "25–40 words — address the customer directly using 'you/your'. Name at least one of your actual lifestyle occasions and state directly whether this item suits those occasions and how realistic repeat wear is. No label prefix."
  ],
  "buyIf": "≤20 words — address the customer directly using 'you/your'. The one concrete condition that justifies buying for you",
  "skipIf": "≤20 words — address the customer directly using 'you/your'. The one concrete condition that makes this a mistake for you",
  "betterDirection": null for BUY | "1–3 sentences — address the customer directly using 'you/your'. Describe the product type (silhouette, fabric, fit profile, coverage) that would serve you better for your lifestyle occasions. No brand names.",
  "finalThought": "ONE sentence ≤30 words — address the customer directly using 'you/your'. Name your style personality or lifestyle context, include the entered occasion if provided, state the main condition."
}`
              }
            ]
          }]
        })
      });
    } catch (fetchErr) {
      console.error("[buy-skip] AI fetch failed:", fetchErr?.message?.slice(0, 80));
      return json({ error: "Analysis service unavailable. Please try again." }, { status: 503 });
    }

    // ── 6. Parse AI response ───────────────────────────────────────────────────
    const aiData = await analysisResponse.json();
    if (!aiData.content || !aiData.content[0]) {
      console.error("[buy-skip] Unexpected AI response shape:", JSON.stringify(aiData).slice(0, 200));
      return json({ error: "Analysis failed. Please try again." }, { status: 502 });
    }

    let analysis;
    try {
      const text = aiData.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    } catch {
      console.error("[buy-skip] Could not parse AI response as JSON");
      return json({ error: "Analysis failed. Please try again." }, { status: 502 });
    }

    // Harden closetPairings: validate against eligible closet items only; all fields individually type-checked
    const eligibleClosetNameMap = new Map(
      eligibleClosetItems
        .filter(i => i.name != null && i.name.trim() !== "")
        .map(i => [i.name.toLowerCase().trim(), i.name])
    );
    const seen = new Set();
    const rawPairings = Array.isArray(analysis.closetPairings) ? analysis.closetPairings : [];
    analysis.closetPairings = rawPairings
      .map(p => {
        let rawName = null;
        let rawReason = null;
        let rawOccasion = null;
        if (typeof p === "string") {
          rawName = p;
        } else if (p !== null && typeof p === "object" && !Array.isArray(p)) {
          const nameVal  = typeof p.name  === "string" && p.name.trim()  !== "" ? p.name  : null;
          const itemVal  = typeof p.item  === "string" && p.item.trim()  !== "" ? p.item  : null;
          const titleVal = typeof p.title === "string" && p.title.trim() !== "" ? p.title : null;
          rawName = nameVal ?? itemVal ?? titleVal;
          rawReason = typeof p.reason === "string" && p.reason.trim() !== "" ? p.reason.trim() : null;
          rawOccasion = typeof p.occasion === "string" && p.occasion.trim() !== "" ? p.occasion.trim() : null;
        } else {
          return null;
        }
        if (typeof rawName !== "string" || rawName.trim() === "") return null;
        const canonical = eligibleClosetNameMap.get(rawName.toLowerCase().trim());
        if (!canonical) return null;
        return { occasion: rawOccasion, name: canonical, reason: rawReason };
      })
      .filter(p => p !== null && !seen.has(p.name) && seen.add(p.name));

    // Deterministic fallback: when eligible closet items exist but model returned no valid pairing
    if (analysis.closetPairings.length === 0 && eligibleClosetItems.length > 0) {
      const namedEligible = eligibleClosetItems.filter(i => i.name != null && i.name.trim() !== "");
      if (namedEligible.length > 0) {
        const idx = hashForIndex((publicId || "") + normalizedCategory) % namedEligible.length;
        const fallbackItem = namedEligible[idx];
        analysis.closetPairings = [{
          name: fallbackItem.name,
          reason: "A complementary piece from your Closet to build this look around."
        }];
      }
    }

    // ── 8. Persist analysis (awaited; DB-backed idempotency via unique key) ───
    // Verdict is stated intent only — never a transaction, purchase, or revenue signal.
    // "SKIP FOR NOW" is a conditional skip — persisted as SKIP in the DB enum but preserved in fullAnalysis for display.
    const verdictMap = { BUY: "BUY", "SKIP FOR NOW": "SKIP", SKIP: "SKIP", MAYBE: "MAYBE" };
    const persistedVerdict = verdictMap[analysis.verdict] ?? "INCOMPLETE";
    let analysisRecord;
    {
      try {
        analysisRecord = await prisma.buyOrSkipAnalysis.create({
          data: {
            customerId: naiaCustomer.id,
            verdict: persistedVerdict,
            reasoning:
              typeof analysis.finalThought === "string" && analysis.finalThought.trim() !== ""
                ? analysis.finalThought.slice(0, 1000)
                : "No reasoning provided.",
            productName: null,
            // S0: store private asset reference, not a public CDN URL.
            // imageUrl is kept null for new records; imagePublicId + imageFormat are the canonical refs.
            imageUrl: null,
            imagePublicId: publicId,
            imageFormat: serverFormat,
            source: "buy-or-skip",
            schemaVersion: "2.0",
            idempotencyKey,
            // Batch 3 — rich fields
            confidence:   typeof analysis.confidence === "number" ? analysis.confidence : null,
            category:     normalizedCategory || null,
            colors:       Array.isArray(color) ? color.filter(c => typeof c === "string") : [],
            forOccasion:  typeof forOccasion === "string" && forOccasion.trim() ? forOccasion.trim().slice(0, 500) : null,
            whatLike:     typeof whatLike    === "string" && whatLike.trim()    ? whatLike.trim().slice(0, 500)    : null,
            unsureAbout:  typeof unsureAbout === "string" && unsureAbout.trim() ? unsureAbout.trim().slice(0, 500) : null,
            colorNote:    typeof colorNote   === "string" && colorNote.trim()   ? colorNote.trim().slice(0, 200)   : null,
            itemSize:     typeof size        === "string" && size.trim()        ? size.trim().slice(0, 100)        : null,
            fullAnalysis: {
              verdict:               analysis.verdict,
              confidence:            analysis.confidence,
              itemType:              analysis.itemType             ?? null,
              detectedColor:         typeof analysis.detectedColor === "string" && analysis.detectedColor.trim() ? analysis.detectedColor.trim() : null,
              styleDNAMatch:         analysis.styleDNAMatch        ?? null,
              detailedAnalysis:      analysis.detailedAnalysis     ?? null,
              occasionFit:           analysis.occasionFit          ?? null,
              whatLikeEval:          analysis.whatLikeEval         ?? null,
              concernEval:           analysis.concernEval          ?? null,
              closetPairings:        analysis.closetPairings       ?? [],
              fillsGap:              analysis.fillsGap              ?? null,
              occasions:             analysis.occasions             ?? [],
              productSnapshot:       analysis.productSnapshot       ?? null,
              beforeYouBuy:          Array.isArray(analysis.beforeYouBuy) ? analysis.beforeYouBuy.filter(s => typeof s === "string" && s.trim()) : [],
              buyIf:                 typeof analysis.buyIf  === "string" && analysis.buyIf.trim()  ? analysis.buyIf.trim()  : null,
              skipIf:                typeof analysis.skipIf === "string" && analysis.skipIf.trim() ? analysis.skipIf.trim() : null,
              betterDirection:       typeof analysis.betterDirection === "string" && analysis.betterDirection.trim() ? analysis.betterDirection.trim() : null,
              finalThought:          analysis.finalThought          ?? null,
            },
          },
        });
      } catch (dbErr) {
        if (dbErr?.code === "P2002") {
          // Idempotent repeat — same bucket/customer/image hit a concurrent write.
          isIdempotentRepeat = true;
        } else {
          console.error("[buy-skip] persistence failed:", dbErr?.code ?? "unknown");
          return json(
            { error: "Analysis could not be saved. Please try again." },
            { status: 503 },
          );
        }
      }

      // Event emitted only after confirmed new DB write — deduplicated by idempotency key
      if (!isIdempotentRepeat && analysisRecord) {
        try {
          await recordJourneyEventAwaited(
            emitBuySkipSubmitted({
              customerId: naiaCustomer.id,
              sessionId: "buy-or-skip",
              analysisId: analysisRecord.id,
              verdict: persistedVerdict,
              category: normalizedCategory || null,
            }),
            `buy_skip_submitted:${analysisRecord.id}:v1`,
          );
        } catch {
          // Event emission never blocks the response — analysis is already saved
        }
      }
    }

    return json({
      success: true,
      analysis,
      analysisId: analysisRecord?.id ?? null,
      closetItemCount: closetItems.length,
      eligibleClosetItemCount: eligibleClosetItems.length,
      idempotentRepeat: isIdempotentRepeat,
    });
}


// OUTCOME ACTION — record or update what the customer decided
// Client sends kebab-case values; server maps them to DB enums.
// Ownership is enforced: analysis must belong to the authenticated customer.
// No Profile or Closet fields are mutated — outcome is customer-reported evidence only.

const DECISION_MAP = {
  "bought-it":      "BOUGHT_IT",
  "didnt-buy-it":   "DIDNT_BUY_IT",
  "still-deciding": "STILL_DECIDING",
};

const POST_OUTCOME_MAP = {
  "love-it":     "LOVE_IT",
  "its-okay":    "ITS_OKAY",
  "returned-it": "RETURNED_IT",
};

async function recordOutcome(request) {
  // ── 1. Auth — session only ─────────────────────────────────────────────────
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) {
    return json({ error: "not_authenticated" }, { status: 401 });
  }
  if (naiaCustomer.shopifyCustomerId === "guest") {
    return json({ error: "not_authenticated" }, { status: 401 });
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body", message: "Request body must be valid JSON." }, { status: 400 });
  }

  // analysisId and decision are from the body; customerId is never accepted from the client.
  const { analysisId, decision, postPurchaseOutcome } = body;

  // ── 3. Validate analysisId ─────────────────────────────────────────────────
  if (!analysisId || typeof analysisId !== "string" || analysisId.trim().length === 0) {
    return json({ error: "invalid_input", message: "analysisId is required." }, { status: 400 });
  }

  // ── 4. Validate decision ───────────────────────────────────────────────────
  const dbDecision = DECISION_MAP[decision];
  if (!dbDecision) {
    return json({ error: "invalid_decision", message: `Invalid decision: "${decision}". Must be one of bought-it, didnt-buy-it, still-deciding.` }, { status: 400 });
  }

  // ── 5. Validate postPurchaseOutcome ────────────────────────────────────────
  let dbPostOutcome = null;
  if (postPurchaseOutcome !== undefined && postPurchaseOutcome !== null) {
    if (dbDecision !== "BOUGHT_IT") {
      return json({ error: "invalid_input", message: "postPurchaseOutcome is only valid with decision 'bought-it'." }, { status: 400 });
    }
    dbPostOutcome = POST_OUTCOME_MAP[postPurchaseOutcome];
    if (!dbPostOutcome) {
      return json({ error: "invalid_post_outcome", message: `Invalid postPurchaseOutcome: "${postPurchaseOutcome}". Must be one of love-it, its-okay, returned-it.` }, { status: 400 });
    }
  }

  // ── 6. Ownership check — load analysis owned by this customer ──────────────
  // Never trust customerId from the client. Ownership is derived through the analysis.
  const analysis = await prisma.buyOrSkipAnalysis.findUnique({
    where: { id: analysisId.trim() },
    select: { id: true, customerId: true, category: true },
  });

  if (!analysis) {
    return json({ error: "not_found", message: "Analysis not found." }, { status: 404 });
  }

  if (analysis.customerId !== naiaCustomer.id) {
    return json({ error: "forbidden", message: "Access denied." }, { status: 403 });
  }

  // ── 7. Upsert outcome (create first time; update on repeat) ───────────────
  // analysisId is unique — one outcome per analysis, no duplicate rows.
  const outcome = await prisma.buySkipOutcome.upsert({
    where:  { analysisId: analysis.id },
    create: { analysisId: analysis.id, decision: dbDecision, postPurchaseOutcome: dbPostOutcome },
    update: { decision: dbDecision, postPurchaseOutcome: dbPostOutcome },
  });

  // Taste evidence — extract from BuySkipOutcome
  try {
    const evRows = extractBuySkipEvidence({
      id:                  outcome.id,
      customerId:          naiaCustomer.id,
      postPurchaseOutcome: outcome.postPurchaseOutcome ?? null,
      category:            analysis.category ?? null,
      createdAt:           outcome.createdAt ?? new Date(),
    });
    await writeSourceEvidence(naiaCustomer.id, "BUYSKIP_OUTCOME", outcome.id, evRows);
  } catch (err) {
    console.error("taste-evidence: failed to write BuySkip evidence", err);
  }

  return json({ success: true, outcomeId: outcome.id });
}


// DEPRECATED loader — Batch 1 (2026-07-29)
// WishlistItem model does not exist in schema.prisma; this loader crashed with P2021.
// Saved Looks (style-me/result.tsx intent=save) is the current nAia-owned save mechanism.
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return Response.json({ items: [], authenticated: false, deprecated: true }, { headers: CORS });
}

/**
 * POST /api/wishlist — add or remove wishlist items
 * Body: { action: "add", naiaProductId, title, handle, image }
 *    or: { action: "remove", naiaProductId }
 */
export async function action({ request }) {
  const url = new URL(request.url);
  if (url.searchParams.get("action") === "analyze") {
    return analyzeItem(request);
  }
  if (url.searchParams.get("action") === "outcome") {
    return recordOutcome(request);
  }
  
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    return Response.json({ error: "Not authenticated" }, { status: 401, headers: CORS });
  }

  const body = await request.json();
  const { action: act } = body;

  // Handle pure tracking events (no wishlist modification)
  if (act === "track" && body.sessionId) {
    try {
      await prisma.stylingEvent.create({
        data: {
          customerId: customer.id,
          sessionId: body.sessionId,
          productId: body.naiaProductId,
          productTitle: body.title || "Unknown",
          eventType: body.eventType,
        },
      });
      return Response.json({ success: true }, { headers: CORS });
    } catch (err) {
      console.error('Event tracking failed:', err);
      return Response.json({ error: err.message }, { status: 500, headers: CORS });
    }
  }

  // Track wishlist event if sessionId is provided
  // DEPRECATED: "add" wishlist action — Batch 1 (2026-07-29)
  // WishlistItem model does not exist; crashes with P2021.
  // Saved Looks is the current nAia-owned save mechanism.
  if (act === "add") {
    return Response.json({ error: "deprecated", message: "Use Saved Looks." }, { status: 410, headers: CORS });
  }

  // DEPRECATED: "remove" wishlist action — Batch 1 (2026-07-29)
  if (act === "remove") {
    return Response.json({ error: "deprecated", message: "Use Saved Looks." }, { status: 410, headers: CORS });
  }

  return Response.json({ error: "Unknown action" }, { status: 400, headers: CORS });
}
