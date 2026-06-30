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

// Small, explicit, code-owned signal map — connects free-text Passport
// fields (lifestyle, desiredFeeling, desiredFeelings) to the report's own
// howToWear contexts. Used only because these fields are rarely a literal
// text match for a styling direction. The map never invents new styling
// advice — it only decides whether to surface a context the report already
// wrote (report.howToWear[].direction) for a context the shopper named.
// Keys are literal report.howToWear[].feeling strings as written in
// app/lib/trend-reports.ts.
const CONTEXT_SIGNAL_MAP: Record<string, string[]> = {
  "For work": ["work", "office", "professional", "career"],
  "For dinner": ["dinner", "evening", "date night", "going out"],
  "For everyday": ["everyday", "daily", "errands", "weekend"],
  "For travel": ["travel", "commute", "trips"],
  "For casual days": ["casual", "relaxed", "low-key"],
  "For modest dressing": ["modest", "covered", "conservative"],
};

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

export function buildShopperEdit(report: TrendReportData, evidence: ShopperEvidenceBundle): ShopperEdit {
  const profile = evidence.profile;

  let profileContributed = false;
  let closetContributed = false;
  let savedLooksContributed = false;
  let reviewsContributed = false;

  // Direct-overlap terms: style personalities, favourite colours, fit
  // preferences, and desired impression — checked verbatim against report
  // text first, before any signal map is used.
  const styleTerms = profile
    ? [...profile.stylePersonalities, ...profile.favoriteColors, ...profile.fitPreferences, ...profile.desiredImpression]
    : [];

  // Context text for the signal map only: lifestyle + desired feeling(s),
  // which describe a situation rather than a style word.
  const contextText = profile
    ? [profile.lifestyle ?? "", profile.desiredFeeling ?? "", ...profile.desiredFeelings].filter(Boolean).join(" ")
    : "";

  // --- What Suits You ---
  const whatSuitsYou: string[] = [];
  if (profile) {
    for (const trend of report.keyTrends) {
      const hits = matchedTerms(`${trend.name} ${trend.description}`, styleTerms);
      if (hits.length > 0) {
        whatSuitsYou.push(`${trend.name} — this lines up with ${hits.join(" and ")}, already part of how you describe your style.`);
        profileContributed = true;
      }
    }

    if (report.naiaInterpretation) {
      const hits = matchedTerms(report.naiaInterpretation, styleTerms);
      if (hits.length > 0) {
        whatSuitsYou.push(`The report's own note on who this suits mentions ${hits.join(" and ")} — already part of how you describe yourself.`);
        profileContributed = true;
      }
    }

    if (contextText) {
      const contextMatch = (report.howToWear ?? []).find((entry) => {
        const keywords = CONTEXT_SIGNAL_MAP[entry.feeling];
        return keywords ? matchedTerms(contextText, keywords).length > 0 : false;
      });
      if (contextMatch) {
        whatSuitsYou.push(`${contextMatch.feeling} — ${contextMatch.direction} This is the report's own direction for that context, and it lines up with how you described your lifestyle.`);
        profileContributed = true;
      }
    }
  }
  if (whatSuitsYou.length === 0) {
    whatSuitsYou.push(
      "Nothing here lines up clearly with your Passport yet — that's worth knowing rather than guessing. As your Passport fills in, this section will get sharper."
    );
  }

  // --- What to Approach Carefully ---
  let approachCarefully: string[] = [];
  let approachCarefullySource: "personal" | "report-only" | "none" = "none";
  if (evidence.reviewSignal.reviewCount > 0 && evidence.reviewSignal.didntWorkTags.length > 0) {
    const personal: string[] = [];
    for (const trend of report.keyTrends) {
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
    approachCarefully = report.fading.map((f) => `${f} — the report itself flags this as fading.`);
    approachCarefullySource = "report-only";
  }
  if (approachCarefully.length === 0) {
    approachCarefully = ["This report doesn't flag anything in particular to approach carefully — read it as an open invitation rather than a caution."];
    approachCarefullySource = "none";
  }

  // --- Your Colour & Silhouette Read ---
  const colourSilhouetteRead: string[] = [];
  if (profile) {
    const trendText = [
      ...(report.rising ?? []),
      ...report.keyTrends.map((t) => t.description),
    ].join(" ");
    for (const color of profile.favoriteColors) {
      if (matchedTerms(trendText, [color]).length > 0) {
        colourSilhouetteRead.push(`${color} — a colour you already favour, and it shows up in this season's direction.`);
        profileContributed = true;
      }
    }
    for (const fit of profile.fitPreferences) {
      if (matchedTerms(trendText, [fit]).length > 0) {
        colourSilhouetteRead.push(`${fit} — this season's silhouettes have room for this preference.`);
        profileContributed = true;
      }
    }
  }
  if (colourSilhouetteRead.length === 0) {
    colourSilhouetteRead.push("Your Passport doesn't list a favourite colour or fit preference that clearly echoes this season's direction — that's alright, the next report may land differently.");
  }

  // --- From Your Closet (items) ---
  const fromCloset: string[] = [];
  const reportText = [
    ...report.keyTrends.map((t) => `${t.name} ${t.description}`),
    ...(report.rising ?? []),
    report.wardrobeNote ?? "",
  ].join(" ");
  for (const item of evidence.closetItems) {
    const terms = [item.category, item.primaryColor ?? "", ...item.styleTags].filter(Boolean);
    if (matchedTerms(reportText, terms).length > 0 && item.name) {
      fromCloset.push(`${item.name} — pairs naturally with this direction.`);
      closetContributed = true;
    }
  }

  // --- From Your Closet (saved looks) — only real name/occasion, only on a grounded match ---
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
  let nextStep: string;
  if (evidence.closetItems.length === 0) {
    nextStep = "Add a few pieces to your Closet and this section will start pointing to specific items you already own.";
  } else if (fromCloset.length === 0 && fromSavedLooks.length === 0) {
    nextStep = "None of your saved Closet pieces or looks line up with this direction yet — that's a natural gap to fill, not a problem with what you already own.";
  } else if (report.wardrobeNote) {
    nextStep = report.wardrobeNote;
  } else {
    nextStep = "Revisit this report once you've added more to your Closet or Passport for a sharper read.";
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
