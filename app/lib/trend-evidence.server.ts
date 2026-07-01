import prisma from "../db.server";
import type { TrendReportData } from "./trend-reports";

// ---------------------------------------------------------------------------
// Evidence bundle — assembled server-side, scoped to exactly one customer,
// fetched with `select` (never `include`) so only fields this feature
// actually reads ever leave the database. No general Customer fields and no
// full related records are loaded.
//
// StylingEvent is intentionally not included: it tracks product-level
// engagement (clicks/try-on/wishlist), which doesn't map to any of the five
// required Trend Edit sections and would widen scope without adding a
// signal this feature actually uses.
// ---------------------------------------------------------------------------

export type ShopperProfileEvidence = {
  stylePersonalities: string[];
  favoriteColors: string[];
  lifestyle: string | null;
  desiredFeeling: string | null;
  desiredFeelings: string[];
  desiredImpression: string[];
  fitPreferences: string[];
};

export type ShopperClosetItemEvidence = {
  name: string | null;
  category: string;
  primaryColor: string | null;
  styleTags: string[];
};

export type ShopperSavedLookEvidence = {
  name: string | null;
  occasion: string | null;
};

export type ShopperReviewSignal = {
  reviewCount: number;
  workedTags: string[];
  didntWorkTags: string[];
};

export type ShopperEvidenceBundle = {
  hasProfile: boolean;
  profile: ShopperProfileEvidence | null;
  closetItems: ShopperClosetItemEvidence[];
  savedLooks: ShopperSavedLookEvidence[];
  reviewSignal: ShopperReviewSignal;
};

const EMPTY_BUNDLE: ShopperEvidenceBundle = {
  hasProfile: false,
  profile: null,
  closetItems: [],
  savedLooks: [],
  reviewSignal: { reviewCount: 0, workedTags: [], didntWorkTags: [] },
};

// customerId must come from the authenticated session only (requireCurrentNaiaCustomer) —
// never from a route param, query string, or request body.
export async function getShopperEvidence(customerId: string): Promise<ShopperEvidenceBundle> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      onboardingProfile: {
        select: {
          stylePersonalities: true,
          favoriteColors: true,
          lifestyle: true,
          desiredFeeling: true,
          desiredFeelings: true,
          desiredImpression: true,
          fitPreferences: true,
          completed: true,
        },
      },
      closetItems: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          name: true,
          category: true,
          primaryColor: true,
          styleTags: true,
        },
      },
      savedLooks: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          name: true,
          occasion: true,
        },
      },
      postOutfitReviews: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          workedTags: true,
          didntWorkTags: true,
        },
      },
    },
  });

  if (!customer) return EMPTY_BUNDLE;

  const profile = customer.onboardingProfile;
  const hasProfile = Boolean(profile?.completed);

  const workedTags: string[] = [];
  const didntWorkTags: string[] = [];
  for (const review of customer.postOutfitReviews) {
    if (review.workedTags) {
      try {
        const parsed = JSON.parse(review.workedTags);
        if (Array.isArray(parsed)) workedTags.push(...parsed);
      } catch {
        // malformed legacy data — skip rather than fail the page
      }
    }
    if (review.didntWorkTags) {
      try {
        const parsed = JSON.parse(review.didntWorkTags);
        if (Array.isArray(parsed)) didntWorkTags.push(...parsed);
      } catch {
        // malformed legacy data — skip rather than fail the page
      }
    }
  }

  return {
    hasProfile,
    profile: hasProfile && profile ? {
      stylePersonalities: profile.stylePersonalities ?? [],
      favoriteColors: profile.favoriteColors ?? [],
      lifestyle: profile.lifestyle ?? null,
      desiredFeeling: profile.desiredFeeling ?? null,
      desiredFeelings: profile.desiredFeelings ?? [],
      desiredImpression: profile.desiredImpression ?? [],
      fitPreferences: profile.fitPreferences ?? [],
    } : null,
    closetItems: customer.closetItems.map((item) => ({
      name: item.name,
      category: item.category,
      primaryColor: item.primaryColor,
      styleTags: item.styleTags ?? [],
    })),
    savedLooks: customer.savedLooks.map((look) => ({
      name: look.name,
      occasion: look.occasion,
    })),
    reviewSignal: {
      reviewCount: customer.postOutfitReviews.length,
      workedTags: [...new Set(workedTags)],
      didntWorkTags: [...new Set(didntWorkTags)],
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic, code-based selection. No AI call here — this is the full
// V1 implementation, not a fallback path. Every line below only ever
// references text already present in `report` (the looked-up static
// report) or `evidence` (this customer's own data). Nothing is invented.
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word / whole-phrase matching only, case-insensitive. "red" must not
// match inside "tailored" or "structured"; "soft structure" must match the
// exact phrase "soft structure". Terms come from stored Passport/Closet
// data, so they're regex-escaped before use.
function matchedTerms(haystack: string, terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = (raw ?? "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "i");
    if (pattern.test(haystack)) {
      seen.add(key);
      out.push(term);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Style translation maps. Each map is keyed by the exact option `id` values
// defined in app/lib/onboarding/quiz-data.ts (the only values that are ever
// actually stored on OnboardingProfile / ClosetItem) and lists the report
// styling-direction words that are a genuine, code-owned, human-reviewed
// connection to that option. A map never invents a connection that isn't
// already implied by nAia's own style vocabulary, and it is only ever used
// to decide whether to surface a sentence already grounded in: (a) a value
// the shopper actually chose, and (b) a word or phrase that actually
// appears in the report's own text. No body, size, fit-success, or
// purchase-outcome claims are made anywhere in these maps.
// ---------------------------------------------------------------------------

// Keys: style-personalities option ids.
const PERSONALITY_STYLE_MAP: Record<string, { label: string; terms: string[] }> = {
  "old-money": { label: "Old Money", terms: ["tailoring", "tailored", "structured", "clean", "longline"] },
  "artsy": { label: "Artsy", terms: ["sculptural", "asymmetric", "drape", "gesture"] },
  "edgy": { label: "Edgy", terms: ["asymmetric", "sculptural", "defined", "structured"] },
  "feminine": { label: "Feminine", terms: ["fluid", "draped", "soft", "midi", "column", "feminine"] },
  "corporate-chic": { label: "Corporate Chic", terms: ["tailoring", "tailored", "blazer", "trouser", "structured", "polished"] },
  "effortlessly-chic": { label: "Effortlessly Chic", terms: ["ease", "fluid", "clean", "quiet", "familiar"] },
  "minimal": { label: "Minimal", terms: ["clean", "restrained", "quiet", "architectural"] },
  "trendy": { label: "Trendy", terms: ["sculptural", "asymmetric", "structured", "fluid"] },
  "romantic": { label: "Romantic", terms: ["fluid", "draped", "soft", "midi", "ease"] },
  "casual-cool": { label: "Casual Cool", terms: ["ease", "fluid", "familiar", "trouser", "denim"] },
};

// Keys: the union of desired-impression and desired-feelings option ids
// (both describe an aspirational identity word, just asked two ways).
const ASPIRATION_STYLE_MAP: Record<string, { label: string; terms: string[] }> = {
  "refined": { label: "refined", terms: ["tailoring", "tailored", "clean", "restrained", "structured", "architectural"] },
  "creative": { label: "creative", terms: ["sculptural", "asymmetric", "drape", "gesture", "architectural"] },
  "powerful": { label: "powerful", terms: ["structured", "defined", "trouser", "blazer", "presence"] },
  "soft-confident": { label: "soft but confident", terms: ["fluid", "soft", "clean", "structured", "polished", "confident"] },
  "effortless": { label: "effortless", terms: ["ease", "fluid", "familiar", "quiet", "clean"] },
  "interesting": { label: "interesting", terms: ["sculptural", "asymmetric", "gesture", "architectural", "drape"] },
  "put-together": { label: "put together", terms: ["tailoring", "tailored", "structured", "clean", "polished", "blazer"] },
  "confident": { label: "confident", terms: ["structured", "defined", "trouser", "blazer", "presence"] },
  "comfortable": { label: "comfortable", terms: ["ease", "fluid", "familiar", "relaxed"] },
  "elegant": { label: "elegant", terms: ["fluid", "draped", "column", "restrained", "polished"] },
  "attractive": { label: "attractive", terms: ["polished", "feminine", "confident", "clean"] },
  // "feminine" is shared with desired-feelings and reuses the same entry as
  // PERSONALITY_STYLE_MAP's "feminine" terms, written out here because the
  // two maps are keyed independently.
  "feminine": { label: "feminine", terms: ["fluid", "draped", "midi", "column", "feminine", "soft"] },
};

// Keys: fit-preferences option ids.
const FIT_SILHOUETTE_MAP: Record<string, { label: string; terms: string[] }> = {
  "defined-waist": { label: "Defined Waist", terms: ["waist", "tailoring", "tailored", "structured"] },
  "relaxed-fits": { label: "Relaxed Fits", terms: ["ease", "fluid", "relaxed", "familiar"] },
  "structured": { label: "Structured Pieces", terms: ["structured", "blazer", "tailoring", "tailored", "architectural"] },
  "oversized": { label: "Oversized Layers", terms: ["ease", "longline", "familiar", "fluid"] },
  "flowy": { label: "Flowy Pieces", terms: ["fluid", "draped", "ease", "soft"] },
  "coverage": { label: "More Coverage", terms: ["long", "layer", "trouser", "column", "vertical"] },
  "fitted": { label: "Fitted Looks", terms: ["defined", "clean", "column", "structured"] },
  "simple": { label: "Simple Outfits", terms: ["clean", "quiet", "restrained", "familiar"] },
};

// Keys: favorite-colors option ids. Values are the real words inside each
// option's display name (e.g. "White / Cream" → "white", "cream"), since
// those are the words that can plausibly appear in editorial report text —
// the kebab-case id itself never will.
const COLOR_SEARCH_MAP: Record<string, { label: string; terms: string[] }> = {
  "black": { label: "Black", terms: ["black"] },
  "white-cream": { label: "White / Cream", terms: ["white", "cream"] },
  "beige-brown": { label: "Beige / Brown", terms: ["beige", "brown"] },
  "grey": { label: "Grey", terms: ["grey", "gray"] },
  "navy": { label: "Navy", terms: ["navy"] },
  "red-burgundy": { label: "Red / Burgundy", terms: ["red", "burgundy"] },
  "green": { label: "Green", terms: ["green"] },
  "pink": { label: "Pink", terms: ["pink"] },
  "prints": { label: "Prints", terms: ["print", "prints"] },
  "colorful": { label: "Colorful Pieces", terms: ["colour", "color", "colourful", "colorful"] },
};

// Keys: the ClosetCategory enum (prisma/schema.prisma). Used only as a
// fallback when no individual closet item's own name/tags matched — this
// surfaces a category-level formula reference, never a claim about a
// specific garment's styling details. Categories with no plausible report
// vocabulary (jewelry, activewear, swimwear, loungewear, other) are left
// empty on purpose: they simply never produce a formula match, rather than
// forcing one.
const CLOSET_CATEGORY_MAP: Record<string, { label: string; terms: string[] }> = {
  TOPS: { label: "tops", terms: ["top", "knit", "shirt", "jersey"] },
  BOTTOMS: { label: "bottoms", terms: ["trouser", "skirt", "denim"] },
  DRESSES: { label: "dresses", terms: ["dress", "midi", "column", "slip"] },
  OUTERWEAR: { label: "outerwear", terms: ["blazer", "jacket", "layer", "longline", "vest"] },
  SHOES: { label: "shoes", terms: ["shoe"] },
  BAGS: { label: "bags", terms: ["bag"] },
  ACCESSORIES: { label: "accessories", terms: ["scarf", "accessories", "accessory"] },
  JEWELRY: { label: "jewelry", terms: [] },
  ACTIVEWEAR: { label: "activewear", terms: [] },
  SWIMWEAR: { label: "swimwear", terms: [] },
  LOUNGEWEAR: { label: "loungewear", terms: [] },
  OTHER: { label: "other pieces", terms: [] },
};

// Keys: lifestyle option ids. Values are an ordered preference of
// report.howToWear[].feeling labels — the first one present in a given
// report is used, since not every report covers every context.
const LIFESTYLE_HOWTO_MAP: Record<string, string[]> = {
  "office": ["For work", "For everyday"],
  "hybrid": ["For work", "For everyday"],
  "busy-mom": ["For everyday", "For casual days"],
  "casual-days": ["For casual days", "For everyday"],
  "events": ["For dinner"],
  "on-the-go": ["For everyday", "For travel"],
  "travel": ["For travel", "For everyday"],
  "creative": ["For everyday", "For casual days"],
};

// Free-text keyword map, used only for SavedLook.occasion (a free-text
// field — see the "From Your Closet (saved looks)" comment below for why
// this is the one signal that still needs fuzzy keyword matching rather
// than an id lookup). Keys are literal report.howToWear[].feeling strings.
const CONTEXT_SIGNAL_MAP: Record<string, string[]> = {
  "For work": ["work", "office", "professional", "career"],
  "For dinner": ["dinner", "evening", "date night", "going out"],
  "For everyday": ["everyday", "daily", "errands", "weekend"],
  "For travel": ["travel", "commute", "trips"],
  "For casual days": ["casual", "relaxed", "low-key"],
  "For modest dressing": ["modest", "covered", "conservative"],
};

// Positive-direction-only report text: keyTrends, rising, naiaInterpretation,
// howToWear directions, wardrobeNote, investmentNotes. Deliberately excludes
// `fading` — that text describes what the report says to move away from, so
// matching a shopper's style words against it would produce a backwards
// "this suits you" claim built from a "this is going out" sentence.
function buildPositiveReportText(report: TrendReportData): string {
  return [
    ...report.keyTrends.map((t) => `${t.name} ${t.description}`),
    ...(report.rising ?? []),
    report.naiaInterpretation ?? "",
    ...(report.howToWear ?? []).map((h) => h.direction),
    report.wardrobeNote ?? "",
    report.investmentNotes ?? "",
  ].join(" ");
}

type TranslationHit = { label: string; term: string };

// Walks `ids` against `map`, returning one hit per id that has any match in
// `haystack`. Greedily prefers a term not already in `usedPhrases` so two
// different sections don't lean on the exact same matched word, then
// records whatever term it used so later calls (across sections) see it.
function translateAllHits(
  ids: string[],
  map: Record<string, { label: string; terms: string[] }>,
  haystack: string,
  usedPhrases: Set<string>,
): TranslationHit[] {
  const out: TranslationHit[] = [];
  for (const id of ids) {
    const entry = map[id];
    if (!entry || entry.terms.length === 0) continue;
    const hits = matchedTerms(haystack, entry.terms);
    if (hits.length === 0) continue;
    const fresh = hits.find((h) => !usedPhrases.has(h.toLowerCase())) ?? hits[0];
    out.push({ label: entry.label, term: fresh });
    usedPhrases.add(fresh.toLowerCase());
  }
  return out;
}

export type ShopperEdit = {
  whatSuitsYou: string[];
  approachCarefully: string[];
  approachCarefullySource: "personal" | "report-only" | "none";
  colourSilhouetteRead: string[];
  fromCloset: string[];
  fromSavedLooks: string[];
  nextStep: string;
  contributedEvidence: string[];
};

const MAX_SECTION_INSIGHTS = 2;

export function buildShopperEdit(report: TrendReportData, evidence: ShopperEvidenceBundle): ShopperEdit {
  const profile = evidence.profile;
  const positiveText = buildPositiveReportText(report);

  let profileContributed = false;
  let closetContributed = false;
  let savedLooksContributed = false;
  let reviewsContributed = false;

  // Shared across every section below: once a report word has been used as
  // the grounding for one insight, later sections prefer a different word
  // before falling back to reusing it, so the page doesn't read as the same
  // phrase repeated five times.
  const usedPhrases = new Set<string>();

  // --- What Suits You ---
  // Priority: style-personality translation, then desired-impression /
  // desired-feelings translation, then lifestyle → howToWear context, then
  // (only if truly nothing translates) the report's own naiaInterpretation
  // text, clearly framed as the report's note rather than a personal one.
  const whatSuitsYou: string[] = [];
  if (profile) {
    for (const hit of translateAllHits(profile.stylePersonalities, PERSONALITY_STYLE_MAP, positiveText, usedPhrases)) {
      if (whatSuitsYou.length >= MAX_SECTION_INSIGHTS) break;
      whatSuitsYou.push(`Your ${hit.label} style direction aligns with the report's focus on ${hit.term}.`);
      profileContributed = true;
    }

    if (whatSuitsYou.length < MAX_SECTION_INSIGHTS) {
      const aspirationIds = [...profile.desiredImpression, ...profile.desiredFeelings];
      for (const hit of translateAllHits(aspirationIds, ASPIRATION_STYLE_MAP, positiveText, usedPhrases)) {
        if (whatSuitsYou.length >= MAX_SECTION_INSIGHTS) break;
        whatSuitsYou.push(`You've said you want to feel ${hit.label} — this report's ${hit.term} note speaks directly to that.`);
        profileContributed = true;
      }
    }

    if (whatSuitsYou.length < MAX_SECTION_INSIGHTS) {
      const lifestyleIds = (profile.lifestyle ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const lid of lifestyleIds) {
        if (whatSuitsYou.length >= MAX_SECTION_INSIGHTS) break;
        const priority = LIFESTYLE_HOWTO_MAP[lid];
        if (!priority) continue;
        const match = (report.howToWear ?? []).find((h) => priority.includes(h.feeling));
        if (match && !usedPhrases.has(match.feeling.toLowerCase())) {
          whatSuitsYou.push(`${match.feeling} — ${match.direction} This fits how you described your day-to-day.`);
          usedPhrases.add(match.feeling.toLowerCase());
          profileContributed = true;
        }
      }
    }
  }
  if (whatSuitsYou.length === 0) {
    whatSuitsYou.push(
      profile && report.naiaInterpretation
        ? `The report's own note on who this suits: "${report.naiaInterpretation}" Your Passport doesn't clearly echo this yet, but it's worth reading on its own terms.`
        : "Nothing here lines up clearly with your Passport yet — that's worth knowing rather than guessing. As your Passport fills in, this section will get sharper."
    );
  }

  // --- What to Approach Carefully ---
  // "personal": a genuine conflict between a past rated look and this
  // report. "report-only": no personal conflict exists, so this is just the
  // report's own fading list — rendered de-emphasised as "Report Notes" by
  // the route, never framed as advice about the shopper. "none": neither
  // exists, so the section is hidden entirely rather than filled with a
  // placeholder sentence.
  let approachCarefully: string[] = [];
  let approachCarefullySource: "personal" | "report-only" | "none" = "none";
  if (evidence.reviewSignal.reviewCount > 0 && evidence.reviewSignal.didntWorkTags.length > 0) {
    const personal: string[] = [];
    for (const trend of report.keyTrends) {
      if (personal.length >= MAX_SECTION_INSIGHTS) break;
      const hits = matchedTerms(`${trend.name} ${trend.description}`, evidence.reviewSignal.didntWorkTags);
      if (hits.length > 0) {
        personal.push(`${trend.name} — you've noted "${hits[0]}" on past looks, so approach this one carefully.`);
      }
    }
    if (personal.length > 0) {
      approachCarefully = personal;
      approachCarefullySource = "personal";
      reviewsContributed = true;
    }
  }
  if (approachCarefully.length === 0 && report.fading && report.fading.length > 0) {
    approachCarefully = report.fading.slice(0, MAX_SECTION_INSIGHTS).map((f) => `${f} — the report itself flags this as fading.`);
    approachCarefullySource = "report-only";
  }

  // --- Your Colour & Silhouette Read ---
  // Priority: exact favourite-colour overlap, then fit-preference
  // translation, then style-personality translation (if not already spent
  // in What Suits You), then the report's own rising list as a last resort.
  const colourSilhouetteRead: string[] = [];
  if (profile) {
    const colorHits: TranslationHit[] = [];
    for (const cid of profile.favoriteColors) {
      const entry = COLOR_SEARCH_MAP[cid];
      if (!entry) continue;
      const hits = matchedTerms(positiveText, entry.terms);
      const fresh = hits.find((h) => !usedPhrases.has(h.toLowerCase()));
      if (fresh) {
        colorHits.push({ label: entry.label, term: fresh });
        usedPhrases.add(fresh.toLowerCase());
      }
    }
    for (const hit of colorHits) {
      if (colourSilhouetteRead.length >= MAX_SECTION_INSIGHTS) break;
      colourSilhouetteRead.push(`${hit.label} — a colour you already favour, and it's part of this season's palette (${hit.term}).`);
      profileContributed = true;
    }

    if (colourSilhouetteRead.length < MAX_SECTION_INSIGHTS) {
      for (const hit of translateAllHits(profile.fitPreferences, FIT_SILHOUETTE_MAP, positiveText, usedPhrases)) {
        if (colourSilhouetteRead.length >= MAX_SECTION_INSIGHTS) break;
        colourSilhouetteRead.push(`Your preference for ${hit.label.toLowerCase()} is in range here — ${hit.term} is part of this season's silhouette direction.`);
        profileContributed = true;
      }
    }

    if (colourSilhouetteRead.length < MAX_SECTION_INSIGHTS) {
      for (const hit of translateAllHits(profile.stylePersonalities, PERSONALITY_STYLE_MAP, positiveText, usedPhrases)) {
        if (colourSilhouetteRead.length >= MAX_SECTION_INSIGHTS) break;
        colourSilhouetteRead.push(`For your ${hit.label} direction, ${hit.term} is a silhouette note worth watching this season.`);
        profileContributed = true;
      }
    }
  }
  if (colourSilhouetteRead.length === 0) {
    const risingPick = (report.rising ?? []).slice(0, MAX_SECTION_INSIGHTS);
    colourSilhouetteRead.push(
      risingPick.length > 0
        ? `This season's silhouette direction centres on ${risingPick.join(" and ").toLowerCase()} — worth comparing against your own colours and fits when you're ready to shop.`
        : "Your Passport doesn't clearly echo a colour or fit note in this particular report — that's alright, the next report may land differently."
    );
  }

  // --- From Your Closet (items) ---
  // Priority: a specific item's own name/category/colour/tags matching the
  // report text, then — only for categories not already matched by name —
  // a category-level formula reference. The formula reference deliberately
  // does not quote wardrobeNote/investmentNotes verbatim (that text belongs
  // to "One Next Step"); it names only the matched concept word and points
  // the shopper there for the full read.
  const fromCloset: string[] = [];
  const matchedCategories = new Set<string>();
  for (const item of evidence.closetItems) {
    if (fromCloset.length >= MAX_SECTION_INSIGHTS) break;
    const terms = [item.category, item.primaryColor ?? "", ...item.styleTags].filter(Boolean);
    const hits = matchedTerms(positiveText, terms);
    if (hits.length > 0 && item.name) {
      fromCloset.push(`${item.name} — pairs naturally with this direction (${hits[0]}).`);
      closetContributed = true;
      matchedCategories.add(item.category);
    }
  }
  if (fromCloset.length < MAX_SECTION_INSIGHTS) {
    const consideredCategories = new Set<string>();
    for (const item of evidence.closetItems) {
      if (fromCloset.length >= MAX_SECTION_INSIGHTS) break;
      if (matchedCategories.has(item.category) || consideredCategories.has(item.category)) continue;
      consideredCategories.add(item.category);
      const entry = CLOSET_CATEGORY_MAP[item.category];
      if (!entry || entry.terms.length === 0) continue;
      const hits = matchedTerms(positiveText, entry.terms);
      const fresh = hits.find((h) => !usedPhrases.has(h.toLowerCase())) ?? hits[0];
      if (fresh) {
        fromCloset.push(`Start with your ${entry.label}: ${fresh} is part of the report's seasonal formula. Use that category as your starting point, then see "One Next Step" for the full styling direction.`);
        closetContributed = true;
        usedPhrases.add(fresh.toLowerCase());
      }
    }
  }

  // --- From Your Closet (saved looks) ---
  // SavedLook.occasion is a free-text field (not a fixed option id like
  // lifestyle), so it still needs keyword matching via CONTEXT_SIGNAL_MAP
  // rather than an id lookup. Only real name/occasion, only on a grounded
  // match.
  const fromSavedLooks: string[] = [];
  for (const look of evidence.savedLooks) {
    if (!look.name || !look.occasion) continue;
    const contextMatch = (report.howToWear ?? []).find((entry) => {
      const keywords = CONTEXT_SIGNAL_MAP[entry.feeling];
      return keywords ? matchedTerms(look.occasion ?? "", keywords).length > 0 : false;
    });
    if (contextMatch) {
      fromSavedLooks.push(`Your saved look "${look.name}" is for ${look.occasion}, which makes it a useful reference point for this report's ${contextMatch.feeling.toLowerCase()} direction.`);
      savedLooksContributed = true;
    }
  }

  // --- One Next Step ---
  // Always the report's own wardrobeNote/investmentNotes, reworded as a
  // single action — never a description of a missing evidence type. Falls
  // back to data-entry language only when the closet is literally empty and
  // the report itself offers nothing (neither case applies to any of the
  // three published reports today).
  let nextStep: string;
  if (report.wardrobeNote) {
    nextStep = report.wardrobeNote;
  } else if (report.investmentNotes) {
    nextStep = report.investmentNotes;
  } else if (evidence.closetItems.length === 0) {
    nextStep = "Add a few pieces to your Closet and this section will start pointing to specific items you already own.";
  } else {
    nextStep = "Revisit this report once you've added more to your Passport for a sharper read.";
  }

  const contributedEvidence: string[] = [];
  if (profileContributed) contributedEvidence.push("your Passport");
  if (closetContributed) contributedEvidence.push("your Closet");
  if (savedLooksContributed) contributedEvidence.push("a saved look");
  if (reviewsContributed) {
    const n = evidence.reviewSignal.reviewCount;
    contributedEvidence.push(`${n} rated look${n === 1 ? "" : "s"}`);
  }

  return {
    whatSuitsYou,
    approachCarefully,
    approachCarefullySource,
    colourSilhouetteRead,
    fromCloset,
    fromSavedLooks,
    nextStep,
    contributedEvidence,
  };
}
