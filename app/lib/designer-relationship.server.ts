// app/lib/designer-relationship.server.ts
// Cross-dimensional relationship intelligence for the Designer Dashboard.
// Answers: What happened? Why? Which combination caused it? What should change?
// Privacy: no names, emails, photos, raw feedback text, signed URLs.

import prisma from "~/db.server";

// ── Helpers ────────────────────────────────────────────────────────────────────

function topN<T extends string>(arr: T[], n: number): T[] {
  const freq: Record<string, number> = {};
  arr.forEach((v) => { if (v) freq[v] = (freq[v] || 0) + 1; });
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k) as T[];
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    let v = JSON.parse(raw);
    if (typeof v === "string") v = JSON.parse(v); // handle double-encoded
    if (Array.isArray(v)) return v.filter(Boolean).map((t: string) => t.trim()).filter(Boolean);
  } catch {}
  return [];
}

function parseDNA(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter(Boolean);
  } catch {}
  return [];
}

const CLOSET_TITLE = (t: string) => {
  const l = t.toLowerCase();
  return (
    l === "white top" || l === "black top" || l.includes("your ") ||
    l.includes("layer") || l.includes("pair your") || l.includes("complemented") ||
    l.includes("wear your") || t.length <= 10
  );
};

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FlatSession {
  occasion: string | null;
  desiredFeeling: string | null;
  currentMood: string | null;
  styleDNA: string[];
  styleFrom: string;
  products: string[];           // nAia product titles only
  rating: number | null;
  rewear: boolean | null;       // true = "Definitely"
  feelingAchieved: string | null; // "Yes"|"Partly"|"No"
  confidenceLift: number | null;
  workedTags: string[];
  didntWorkTags: string[];
  hasReview: boolean;
}

export interface DNAMatrixRow {
  personality: string;
  sessionCount: number;
  reviewCount: number;
  avgRating: number | null;
  rewearRate: number | null;        // 0–1
  avgConfidenceLift: number | null;
  feelingAchievedRate: number | null; // 0–100
  topOccasions: string[];
  topProducts: string[];
  topDesiredFeelings: string[];
  prescriptive: string;
}

export interface EmotionalChainRow {
  currentMood: string;
  desiredFeeling: string;
  count: number;
  achievedRate: number | null;      // 0–100
  avgRating: number | null;
  topProducts: string[];
}

export interface OccasionProductRow {
  occasion: string;
  count: number;
  topPersonalities: string[];
  topDesiredFeelings: string[];
  topProducts: Array<{ name: string; count: number; avgRating: number | null }>;
  successRate: number | null;       // % rating >= 4
  prescriptive: string;
}

export interface ProductNarrativeRow {
  name: string;
  opportunityScore: number;         // 0–100 composite
  bestPersonality: string | null;
  bestOccasion: string | null;
  strongestTransformation: string | null; // "Anxious → Confident"
  mostCommonObjection: string | null;
  avgRating: number;
  rewearRate: number;               // 0–1
  avgConfidenceLift: number | null;
  sampleSize: number;
  topDesiredFeelings: string[];
  topDNA: string[];
  recommendation: string;
  recommendationReason: string;
}

export interface RelationshipKPIs {
  status: "live" | "insufficient-data";
  sampleSize: number;               // sessions with reviews
  totalSessions: number;
  dnaMatrix: DNAMatrixRow[];
  emotionalChain: EmotionalChainRow[];
  occasionProductMatrix: OccasionProductRow[];
  productNarratives: ProductNarrativeRow[];
}

// ── Prescriptive generators ────────────────────────────────────────────────────

function productPrescriptive(p: {
  avgRating: number;
  rewearRate: number;
  mostCommonObjection: string | null;
  avgConfidenceLift: number | null;
  bestPersonality: string | null;
  bestOccasion: string | null;
  sampleSize: number;
}): { recommendation: string; reason: string } {
  const { avgRating, rewearRate, mostCommonObjection, avgConfidenceLift, bestPersonality, bestOccasion, sampleSize } = p;

  if (sampleSize < 3) {
    return {
      recommendation: "Collect more data before acting.",
      reason: `Only ${sampleSize} review${sampleSize !== 1 ? "s" : ""} — patterns are not yet reliable.`,
    };
  }

  // Emotional hero: high confidence lift
  if (avgConfidenceLift !== null && avgConfidenceLift >= 2) {
    const who = bestPersonality ? ` for ${bestPersonality} customers` : "";
    return {
      recommendation: `Continue positioning as an emotional hero piece${who}. Amplify the confidence narrative in product styling and Complete the Look content.`,
      reason: `Average +${avgConfidenceLift.toFixed(1)} confidence lift — this piece genuinely changes how customers feel. That is the highest-value signal in the collection.`,
    };
  }

  // Aspirational: loved but not worn
  if (avgRating >= 4 && rewearRate < 0.4) {
    return {
      recommendation: "Improve occasion guidance and styling content before redesigning the piece.",
      reason: `Customers love it (${avgRating.toFixed(1)}/5) but are not returning to it${bestOccasion ? ` for ${bestOccasion}` : ""}. The piece may be aspirational without clear occasion anchors — sharpen Complete the Look content first.`,
    };
  }

  // Functional but uninspiring
  if (avgRating < 3.5 && rewearRate >= 0.7) {
    return {
      recommendation: "Investigate why customers wear it despite the low rating — review specific fit or quality objections before any design change.",
      reason: `High rewear (${Math.round(rewearRate * 100)}%) suggests utility, but ${avgRating.toFixed(1)}/5 indicates something is being tolerated. Check objection tags for specific friction.`,
    };
  }

  // Formality objection
  if (mostCommonObjection?.toLowerCase().includes("formal")) {
    return {
      recommendation: "Test softer styling photography and casual-occasion looks before changing the garment.",
      reason: `"${mostCommonObjection}" is the top objection. The silhouette may be strong — expand the styling context before altering the product itself.`,
    };
  }

  // General objection with low rating
  if (mostCommonObjection && avgRating < 4) {
    return {
      recommendation: `Address the "${mostCommonObjection}" objection — try a styling variation or updated photography before committing to redesign.`,
      reason: "Style intervention is lower-risk than production changes and can be tested quickly.",
    };
  }

  // Strong performer
  if (avgRating >= 4.5 && rewearRate >= 0.7) {
    const ctx = bestOccasion ? ` for ${bestOccasion}` : "";
    return {
      recommendation: `Increase production allocation${ctx}. Consider a complementary colourway or silhouette variation.`,
      reason: `Proven on both rating (${avgRating.toFixed(1)}/5) and rewear (${Math.round(rewearRate * 100)}%) — this piece warrants deeper investment.`,
    };
  }

  return {
    recommendation: "Monitor for 2–3 more sessions before making production decisions.",
    reason: "Mixed signals — no dominant pattern yet. Avoid acting on insufficient data.",
  };
}

function dnaPrescriptive(row: {
  personality: string;
  avgRating: number | null;
  rewearRate: number | null;
  feelingAchievedRate: number | null;
  topProducts: string[];
  topOccasions: string[];
}): string {
  const { personality, avgRating, rewearRate, feelingAchievedRate, topProducts, topOccasions } = row;
  const product = topProducts[0] || null;
  const occasion = topOccasions[0] || null;

  if (feelingAchievedRate !== null && feelingAchievedRate >= 75) {
    return `nAia is delivering well for ${personality} customers — their desired feeling is achieved ${Math.round(feelingAchievedRate)}% of the time${product ? `. Continue investing in ${product}` : ""}.`;
  }
  if (feelingAchievedRate !== null && feelingAchievedRate < 50) {
    return `${personality} customers are not achieving their desired feeling (${Math.round(feelingAchievedRate)}% success rate). Review whether current products and recommendation logic serve their identity — consider whether the collection has pieces that match their style and emotional aspirations.`;
  }
  if (avgRating !== null && avgRating >= 4 && rewearRate !== null && rewearRate >= 0.6) {
    return `${personality} customers are well-served${occasion ? ` especially for ${occasion}` : ""}. Strengthen content and product depth for this segment to support acquisition.`;
  }
  if (avgRating !== null && avgRating < 3.5) {
    return `${personality} customers are underperforming (${avgRating.toFixed(1)}/5 avg). Investigate whether the collection has pieces that match their style identity and emotional goals.`;
  }
  return `Continue building data for ${personality} — patterns are forming but sample is small.`;
}

function occasionPrescriptive(row: {
  occasion: string;
  successRate: number | null;
  topProducts: Array<{ name: string }>;
  topPersonalities: string[];
}): string {
  const { occasion, successRate, topProducts, topPersonalities } = row;
  const product = topProducts[0]?.name || null;
  const personality = topPersonalities[0] || null;

  if (successRate !== null && successRate >= 80) {
    return `Strong coverage for ${occasion}${product ? ` — ${product} is the anchor piece` : ""}. Invest in complementary pieces (shoes, bag, accessories) to complete the look for this occasion.`;
  }
  if (successRate !== null && successRate < 50) {
    return `${occasion} occasions are underserved (${Math.round(successRate)}% high-rating sessions). Review whether recommended pieces match the mood, formality, and practical requirements of this occasion.`;
  }
  if (personality) {
    return `${occasion} is primarily served for ${personality} customers. Ensure the styling anchors and product selection speak directly to this personality — they are the growth opportunity here.`;
  }
  return `Continue gathering data for ${occasion} — early signals are forming.`;
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function getRelationshipKPIs(dateRangeDays = 30): Promise<RelationshipKPIs> {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - dateRangeDays);

  const EMPTY: RelationshipKPIs = {
    status: "insufficient-data",
    sampleSize: 0,
    totalSessions: 0,
    dnaMatrix: [],
    emotionalChain: [],
    occasionProductMatrix: [],
    productNarratives: [],
  };

  try {
    // Single rich query — sessions + customer profile + suggestions + review
    const sessions = await prisma.stylingSession.findMany({
      where: { createdAt: { gte: dateFrom } },
      select: {
        id: true,
        currentMood: true,
        desiredFeeling: true,
        occasion: true,
        styleDNA: true,
        styleFrom: true,
        selectedSuggestionId: true,
        suggestions: {
          select: {
            id: true,
            items: {
              select: {
                productTitle: true,
                shopifyProductId: true,
                closetItemId: true,
              },
            },
          },
        },
        review: {
          select: {
            overallFeeling: true,
            wouldWearAgain: true,
            desiredFeelingAchieved: true,
            confidenceBefore: true,
            confidenceAfter: true,
            didntWorkTags: true,
            workedTags: true,
          },
        },
        customer: {
          select: {
            onboardingProfile: {
              select: { stylePersonalities: true },
            },
          },
        },
      },
    });

    if (sessions.length === 0) return EMPTY;

    // ── Flatten each session into a uniform record ─────────────────────────────
    const records: FlatSession[] = sessions.map((s) => {
      // Identify selected suggestion
      const sel =
        s.suggestions.find((sg) => sg.id === s.selectedSuggestionId) ??
        s.suggestions[0];

      // nAia products only (no closet items, no AI description fragments)
      const products = (sel?.items ?? [])
        .filter(
          (item) =>
            !item.closetItemId &&
            item.productTitle &&
            !CLOSET_TITLE(item.productTitle)
        )
        .map((item) => item.productTitle!);

      // Merge session-level DNA with permanent onboarding profile
      const sessionDNA = parseDNA(s.styleDNA);
      const profileDNA = s.customer?.onboardingProfile?.stylePersonalities ?? [];
      const styleDNA = [...new Set([...sessionDNA, ...profileDNA])];

      const r = s.review;
      const confidenceLift =
        r?.confidenceBefore != null && r?.confidenceAfter != null
          ? r.confidenceAfter - r.confidenceBefore
          : null;

      return {
        occasion: s.occasion,
        desiredFeeling: s.desiredFeeling,
        currentMood: s.currentMood,
        styleDNA,
        styleFrom: String(s.styleFrom),
        products,
        rating: r?.overallFeeling ?? null,
        rewear: r ? r.wouldWearAgain === "Definitely" : null,
        feelingAchieved: r?.desiredFeelingAchieved ?? null,
        confidenceLift,
        workedTags: parseTags(r?.workedTags),
        didntWorkTags: parseTags(r?.didntWorkTags),
        hasReview: r != null,
      };
    });

    const withReview = records.filter((r) => r.hasReview);
    const sampleSize = withReview.length;

    // ── 1. DNA Matrix ──────────────────────────────────────────────────────────
    const dnaGroups: Record<string, FlatSession[]> = {};
    records.forEach((r) => {
      r.styleDNA.forEach((dna) => {
        const key = dna.trim();
        if (!key) return;
        if (!dnaGroups[key]) dnaGroups[key] = [];
        dnaGroups[key].push(r);
      });
    });

    const dnaMatrix: DNAMatrixRow[] = Object.entries(dnaGroups)
      .filter(([, ss]) => ss.length >= 1)
      .map(([personality, ss]) => {
        const reviewed = ss.filter((s) => s.hasReview);
        const avgRating =
          reviewed.length > 0
            ? reviewed.reduce((sum, s) => sum + (s.rating ?? 0), 0) / reviewed.length
            : null;
        const rewearList = reviewed.filter((s) => s.rewear !== null);
        const rewearRate =
          rewearList.length > 0
            ? rewearList.filter((s) => s.rewear).length / rewearList.length
            : null;
        const liftList = ss.filter((s) => s.confidenceLift !== null);
        const avgConfidenceLift =
          liftList.length > 0
            ? liftList.reduce((sum, s) => sum + (s.confidenceLift ?? 0), 0) / liftList.length
            : null;
        const achievedList = reviewed.filter((s) => s.feelingAchieved !== null);
        const feelingAchievedRate =
          achievedList.length > 0
            ? (achievedList.filter((s) => s.feelingAchieved === "Yes").length /
                achievedList.length) *
              100
            : null;

        const row: DNAMatrixRow = {
          personality,
          sessionCount: ss.length,
          reviewCount: reviewed.length,
          avgRating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
          rewearRate: rewearRate != null ? Math.round(rewearRate * 100) / 100 : null,
          avgConfidenceLift:
            avgConfidenceLift != null ? Math.round(avgConfidenceLift * 10) / 10 : null,
          feelingAchievedRate:
            feelingAchievedRate != null ? Math.round(feelingAchievedRate) : null,
          topOccasions: topN(
            ss.map((s) => s.occasion).filter(Boolean) as string[],
            3
          ),
          topProducts: topN(ss.flatMap((s) => s.products), 3),
          topDesiredFeelings: topN(
            ss.map((s) => s.desiredFeeling).filter(Boolean) as string[],
            3
          ),
          prescriptive: "",
        };
        row.prescriptive = dnaPrescriptive({
          personality,
          avgRating: row.avgRating,
          rewearRate: row.rewearRate,
          feelingAchievedRate: row.feelingAchievedRate,
          topProducts: row.topProducts,
          topOccasions: row.topOccasions,
        });
        return row;
      })
      .sort((a, b) => b.sessionCount - a.sessionCount)
      .slice(0, 10);

    // ── 2. Emotional Chain ─────────────────────────────────────────────────────
    const chainGroups: Record<string, FlatSession[]> = {};
    records
      .filter((r) => r.currentMood && r.desiredFeeling)
      .forEach((r) => {
        const key = `${r.currentMood}|||${r.desiredFeeling}`;
        if (!chainGroups[key]) chainGroups[key] = [];
        chainGroups[key].push(r);
      });

    const emotionalChain: EmotionalChainRow[] = Object.entries(chainGroups)
      .map(([key, ss]) => {
        const [currentMood, desiredFeeling] = key.split("|||");
        const reviewed = ss.filter((s) => s.hasReview);
        const avgRating =
          reviewed.length > 0
            ? reviewed.reduce((sum, s) => sum + (s.rating ?? 0), 0) / reviewed.length
            : null;
        const achievedList = ss.filter((s) => s.feelingAchieved !== null);
        const achievedRate =
          achievedList.length > 0
            ? (achievedList.filter((s) => s.feelingAchieved === "Yes").length /
                achievedList.length) *
              100
            : null;
        return {
          currentMood,
          desiredFeeling,
          count: ss.length,
          achievedRate: achievedRate != null ? Math.round(achievedRate) : null,
          avgRating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
          topProducts: topN(ss.flatMap((s) => s.products), 2),
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    // ── 3. Occasion × Product matrix ───────────────────────────────────────────
    const occGroups: Record<string, FlatSession[]> = {};
    records
      .filter((r) => r.occasion)
      .forEach((r) => {
        if (!occGroups[r.occasion!]) occGroups[r.occasion!] = [];
        occGroups[r.occasion!].push(r);
      });

    const occasionProductMatrix: OccasionProductRow[] = Object.entries(occGroups)
      .filter(([, ss]) => ss.length >= 1)
      .map(([occasion, ss]) => {
        const reviewed = ss.filter((s) => s.hasReview && s.rating != null);
        const successRate =
          reviewed.length > 0
            ? (reviewed.filter((s) => (s.rating ?? 0) >= 4).length / reviewed.length) * 100
            : null;

        // Per-product counts within this occasion
        const prodMap: Record<string, { count: number; ratings: number[] }> = {};
        ss.forEach((s) => {
          s.products.forEach((p) => {
            if (!prodMap[p]) prodMap[p] = { count: 0, ratings: [] };
            prodMap[p].count++;
            if (s.rating != null) prodMap[p].ratings.push(s.rating);
          });
        });
        const topProducts = Object.entries(prodMap)
          .map(([name, d]) => ({
            name,
            count: d.count,
            avgRating:
              d.ratings.length > 0
                ? Math.round((d.ratings.reduce((a, b) => a + b, 0) / d.ratings.length) * 10) / 10
                : null,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 4);

        const row: OccasionProductRow = {
          occasion,
          count: ss.length,
          topPersonalities: topN(ss.flatMap((s) => s.styleDNA), 3),
          topDesiredFeelings: topN(
            ss.map((s) => s.desiredFeeling).filter(Boolean) as string[],
            3
          ),
          topProducts,
          successRate: successRate != null ? Math.round(successRate) : null,
          prescriptive: "",
        };
        row.prescriptive = occasionPrescriptive({
          occasion,
          successRate: row.successRate,
          topProducts: row.topProducts,
          topPersonalities: row.topPersonalities,
        });
        return row;
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // ── 4. Product Narratives ──────────────────────────────────────────────────
    const prodGroups: Record<string, FlatSession[]> = {};
    records.forEach((r) => {
      r.products.forEach((p) => {
        if (!prodGroups[p]) prodGroups[p] = [];
        prodGroups[p].push(r);
      });
    });

    const productNarratives: ProductNarrativeRow[] = Object.entries(prodGroups)
      .filter(([, ss]) => ss.length >= 1)
      .map(([name, ss]) => {
        const reviewed = ss.filter((s) => s.hasReview && s.rating != null);
        const sampleSz = reviewed.length;
        const avgRating =
          reviewed.length > 0
            ? reviewed.reduce((sum, s) => sum + (s.rating ?? 0), 0) / reviewed.length
            : 0;
        const rewearList = reviewed.filter((s) => s.rewear !== null);
        const rewearRate =
          rewearList.length > 0
            ? rewearList.filter((s) => s.rewear).length / rewearList.length
            : 0;
        const liftList = ss.filter((s) => s.confidenceLift !== null);
        const avgConfidenceLift =
          liftList.length > 0
            ? liftList.reduce((sum, s) => sum + (s.confidenceLift ?? 0), 0) / liftList.length
            : null;

        // Composite opportunity score (0–100)
        const ratingScore = (avgRating / 5) * 30;
        const rewearScore = rewearRate * 25;
        const confidenceScore =
          avgConfidenceLift != null ? Math.min(avgConfidenceLift / 5, 1) * 25 : 0;
        const dataScore = Math.min(sampleSz / 5, 1) * 20;
        const opportunityScore = Math.round(ratingScore + rewearScore + confidenceScore + dataScore);

        // Strongest mood → feeling transformation
        const transMap: Record<string, number> = {};
        ss.filter((s) => s.currentMood && s.desiredFeeling).forEach((s) => {
          const key = `${s.currentMood} → ${s.desiredFeeling}`;
          transMap[key] = (transMap[key] || 0) + 1;
        });
        const strongestTransformation =
          Object.entries(transMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

        const allObjections = ss.flatMap((s) => s.didntWorkTags);
        const mostCommonObjection = topN(allObjections, 1)[0] ?? null;
        const bestPersonality = topN(ss.flatMap((s) => s.styleDNA), 1)[0] ?? null;
        const bestOccasion =
          topN(ss.map((s) => s.occasion).filter(Boolean) as string[], 1)[0] ?? null;

        const { recommendation, reason } = productPrescriptive({
          avgRating,
          rewearRate,
          mostCommonObjection,
          avgConfidenceLift,
          bestPersonality,
          bestOccasion,
          sampleSize: sampleSz,
        });

        return {
          name,
          opportunityScore,
          bestPersonality,
          bestOccasion,
          strongestTransformation,
          mostCommonObjection,
          avgRating: Math.round(avgRating * 10) / 10,
          rewearRate: Math.round(rewearRate * 100) / 100,
          avgConfidenceLift:
            avgConfidenceLift != null ? Math.round(avgConfidenceLift * 10) / 10 : null,
          sampleSize: sampleSz,
          topDesiredFeelings: topN(
            ss.map((s) => s.desiredFeeling).filter(Boolean) as string[],
            3
          ),
          topDNA: topN(ss.flatMap((s) => s.styleDNA), 3),
          recommendation,
          recommendationReason: reason,
        };
      })
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 12);

    return {
      status: sampleSize >= 3 ? "live" : "insufficient-data",
      sampleSize,
      totalSessions: records.length,
      dnaMatrix,
      emotionalChain,
      occasionProductMatrix,
      productNarratives,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[designer-relationship] error:", msg);
    return EMPTY;
  }
}
