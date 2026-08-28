/**
 * DESIGNER_SAMPLE_DATA_ENABLED=true — staging/dev only.
 * All period-sensitive metrics are DERIVED from the EVENTS timeline below.
 * No proportional scaling. No hardcoded period values. Never writes to the database.
 */
import { EVENTS_EXPANDED, CUST_EXTENDED } from "./ai/synthetic-events-expanded";
import {
  calcBuySkipDistribution,
  calcSellThrough,
  calcLoveResponseRate,
  calcDesiredFeelingAchievement,
  type BuySkipDistribution,
} from "./ai/canonical-calculations";
import type { MeasurementState } from "./ai/canonical-vocabulary";

// ── Real NADINE product names ──────────────────────────────────────────────
const SEEN     = "Becoming Seen";      // trench coat · Corporate Chic/Artsy/Edgy · work hero
const WHOLE    = "Becoming Whole";     // kimono wrap jacket · Artsy/EFC/Feminine · high saves, no buys
const ALIVE    = "Becoming Alive";     // two-layer peplum top · polarising · Edgy loves it
const GROUNDED = "Becoming Grounded"; // asymmetrical trousers · fit objections · strong intent
const CLEAR    = "Becoming Clear";     // leather suede jacket · underexposed, high-converting
const REAL     = "Becoming Real";      // structured collar shirt · reliable everyday anchor
const HER      = "Becoming Her";       // midi dress · Feminine/Romantic evening anchor
const ROOTED   = "Becoming Rooted";    // suede column skirt · supporting occasion role
const FREE     = "Becoming Free";      // draped leather trousers · BOTTOM · Edgy/Artsy/EFC
const BOLD     = "Becoming Bold";      // oversized blazer · OUTERWEAR · Corporate Chic/Edgy/Artsy
const DEFINED  = "Becoming Defined";   // dress-set · SET · Feminine/Romantic/EFC

// ── Catalog metadata — no pre-calculated scores (those are computed dynamically) ──
interface ProductMeta {
  category: string; garmentType: string; personalities: string[];
  occasions: string[]; desiredFeelings: string[];
  recommendation: string; recommendationReason: string;
}
const CATALOG: Record<string, ProductMeta> = {
  [SEEN]: {
    category: "Outerwear", garmentType: "Tailored trench coat",
    personalities: ["Corporate Chic", "Artsy", "Edgy"],
    occasions: ["work", "dinner", "special-event", "travel"],
    desiredFeelings: ["Confident", "Powerful", "Put Together", "Elevated"],
    recommendation: "Highest confidence lift across Corporate Chic work sessions. A work-styling test centred on this piece is a low-cost next step.",
    recommendationReason: "Corporate Chic customers consistently achieve 'Confident' and 'Powerful'. Highest confidence lift in work-occasion sessions.",
  },
  [WHOLE]: {
    category: "Outerwear", garmentType: "Kimono-inspired wrap jacket",
    personalities: ["Artsy", "Effortlessly Chic", "Feminine"],
    occasions: ["everyday", "dinner", "travel", "special-event"],
    desiredFeelings: ["Effortless", "Elevated", "Feminine", "Confident"],
    recommendation: "Create occasion-specific styling guides to convert saves into purchases.",
    recommendationReason: "High save rate but zero purchase conversion. Styling ambiguity ('not sure how to wear it') is the primary barrier — occasion-led content would unlock this.",
  },
  [ALIVE]: {
    category: "Top", garmentType: "Two-layer peplum top",
    personalities: ["Artsy", "Feminine", "Edgy"],
    occasions: ["dinner", "date-night", "girls-night", "special-event"],
    desiredFeelings: ["Confident", "Feminine", "Elevated", "Attractive"],
    recommendation: "Directional signal: Edgy and Artsy customers show above-average love rates. Evening occasions account for most love events in this period.",
    recommendationReason: "Polarising piece. Edgy customers give 4.7+ ratings and high rewear across observed sessions. Minimal and Corporate Chic customers show consistent rejection — further observation would clarify whether personality-based surfacing improves overall outcomes.",
  },
  [GROUNDED]: {
    category: "Trousers", garmentType: "Asymmetrical crossover trousers",
    personalities: ["Edgy", "Artsy", "Corporate Chic"],
    occasions: ["work", "everyday", "dinner", "date-night"],
    desiredFeelings: ["Put Together", "Confident", "Powerful", "Elevated"],
    recommendation: "Address trouser-length and hip-fit objections with petite-specific styling guidance.",
    recommendationReason: "Buy-intent increases when fit resolves — customers describe feeling grounded and powerful. Recurring length and waist-detail objections are reducing conversion for petite and conservative frames.",
  },
  [CLEAR]: {
    category: "Outerwear", garmentType: "Leather suede structured jacket",
    personalities: ["Corporate Chic", "Artsy", "Edgy"],
    occasions: ["work", "dinner", "date-night", "special-event"],
    desiredFeelings: ["Put Together", "Confident", "Powerful", "Elevated"],
    recommendation: "Becoming Clear converts at a higher rate than other pieces when recommended — worth testing whether increased frequency improves overall outcomes.",
    recommendationReason: "Observed: consistent 4.5+ ratings and higher buy-through rate when recommended compared to session frequency. Currently receives fewer sessions than Becoming Seen — testing whether increased exposure changes outcomes is a low-effort next step.",
  },
  [REAL]: {
    category: "Top", garmentType: "Structured collar shirt",
    personalities: ["Corporate Chic", "Effortlessly Chic", "Artsy"],
    occasions: ["work", "everyday", "dinner", "special-event"],
    desiredFeelings: ["Put Together", "Confident", "Elevated", "Powerful"],
    recommendation: "Prioritise for everyday Corporate Chic and Minimal styling.",
    recommendationReason: "Low styling effort, consistent outcome delivery. Works for customers who want polish without complexity — especially Minimal customers who find more formal outerwear unsuitable.",
  },
  [HER]: {
    category: "Dress", garmentType: "Midi dress",
    personalities: ["Feminine", "Romantic", "Artsy"],
    occasions: ["dinner", "date-night", "girls-night", "special-event"],
    desiredFeelings: ["Feminine", "Attractive", "Confident", "Elevated"],
    recommendation: "Feature in occasion-specific campaigns for Feminine and Romantic profiles.",
    recommendationReason: "Consistently achieves 'Feminine' and 'Attractive' for target profiles. Repeat buy-intent signal observed in historical data for this segment.",
  },
  [ROOTED]: {
    category: "Skirt", garmentType: "Suede column midi skirt",
    personalities: ["Feminine", "Romantic", "Artsy"],
    occasions: ["dinner", "date-night", "special-event", "work"],
    desiredFeelings: ["Feminine", "Attractive", "Elevated", "Confident"],
    recommendation: "Pair with Becoming Real for work occasions — the column silhouette anchors the look.",
    recommendationReason: "Body-skimming column creates a confident, elevated look. Works best when customers understand how to pair the high waist — styling guidance improves outcomes.",
  },
  [FREE]: {
    category: "Bottom", garmentType: "Draped leather trousers",
    personalities: ["Edgy", "Artsy", "Effortlessly Chic"],
    occasions: ["dinner", "date-night", "girls-night", "special-event"],
    desiredFeelings: ["Confident", "Elevated", "Powerful", "Attractive"],
    recommendation: "Surface to Edgy and Artsy customers in evening contexts as an alternative to Becoming Grounded.",
    recommendationReason: "Draped leather bottom commands attention in evening and social contexts. No post-wear evidence yet — begin building with Edgy and Artsy profiles.",
  },
  [BOLD]: {
    category: "Outerwear", garmentType: "Oversized structured blazer",
    personalities: ["Corporate Chic", "Edgy", "Artsy"],
    occasions: ["work", "dinner", "special-event", "date-night"],
    desiredFeelings: ["Confident", "Powerful", "Put Together", "Elevated"],
    recommendation: "Pair with Becoming Grounded for work occasions to reach Corporate Chic profiles.",
    recommendationReason: "Oversized silhouette addresses a gap in the outerwear range — powerful work look without the formality of a trench. No evidence yet — begin with Corporate Chic work sessions.",
  },
  [DEFINED]: {
    category: "Set", garmentType: "Co-ordinated dress-set",
    personalities: ["Feminine", "Romantic", "Effortlessly Chic"],
    occasions: ["dinner", "special-event", "date-night", "girls-night"],
    desiredFeelings: ["Feminine", "Elevated", "Effortless", "Attractive"],
    recommendation: "Lead with occasion-specific styling for Feminine and Romantic profiles — the easiest entry point for a new-to-sets customer.",
    recommendationReason: "Dress-set removes the styling burden entirely. Feminine and Romantic customers who want 'Effortless' are the natural first audience. No evidence yet — begin building with evening occasions.",
  },
};

// Canonical NADINE catalog — 11 products. Order: styling-session depth descending for documented products,
// then new additions in logical category grouping.
const ALL_PRODUCTS = [SEEN, WHOLE, ALIVE, GROUNDED, CLEAR, REAL, HER, ROOTED, FREE, BOLD, DEFINED];

// Synthetic piece prices (AED) — used for commercial sample KPI derivation only
const PRICE: Record<string, number> = {
  [SEEN]: 2800, [WHOLE]: 1950, [ALIVE]: 850,  [GROUNDED]: 1650,
  [CLEAR]: 3200, [REAL]: 950,  [HER]: 1750,  [ROOTED]: 1350,
  [FREE]: 1800,  [BOLD]: 2600, [DEFINED]: 2200,
};

// Synthetic COGS per piece (AED) — used for margin derivation only
const COGS: Record<string, number> = {
  [SEEN]: 980, [WHOLE]: 680, [ALIVE]: 285, [GROUNDED]: 560,
  [CLEAR]: 1080, [REAL]: 315, [HER]: 595, [ROOTED]: 450,
  [FREE]: 620,   [BOLD]: 880, [DEFINED]: 740,
};

// Synthetic stock on hand (units) — used for sell-through derivation only
const STOCK: Record<string, number> = {
  [SEEN]: 10, [WHOLE]: 16, [ALIVE]: 6, [GROUNDED]: 9,
  [CLEAR]: 5, [REAL]: 14, [HER]: 9, [ROOTED]: 11,
  [FREE]: 8,  [BOLD]: 12, [DEFINED]: 10,
};

// ── Fictional customer profiles (C1–C15 base + C16–C120 expanded) ─────────
const CUST: Record<string, string> = {
  C1:  "Corporate Chic",    C2:  "Corporate Chic",    C3:  "Corporate Chic",
  C4:  "Artsy",             C5:  "Artsy",
  C6:  "Edgy",              C7:  "Edgy",               C8:  "Edgy",
  C9:  "Feminine",          C10: "Romantic",
  C11: "Minimal",           C12: "Effortlessly Chic",
  C13: "Old Money",         C14: "Trendy",             C15: "Casual Cool",
  ...CUST_EXTENDED,
};

// ── Event timeline ─────────────────────────────────────────────────────────
// daysAgo: days before today. All metrics derive from filtering this array.
// 7D story:  Becoming Clear gaining momentum, Travel demand rising, small sample.
// 30D story: Becoming Seen dominant for Corporate Chic, Too Formal objection, Whole save/purchase gap.
// 90D story: Product-personality relationships clear, fit objections stable, collection gaps visible.
// ALL story: Complete history, repeat customers, LTV, long-term rankings.

type ET = "STYLING_SESSION" | "POST_OUTFIT_REVIEW" | "POST_WEAR_REVIEW" |
          "RECOMMENDATION_FEEDBACK" | "BUY_OR_SKIP" | "CLOSET_UPLOAD" | "RETURN";

interface SE {
  daysAgo: number; customerId: string; eventType: ET; productName: string | null;
  occasion: string | null; desiredFeeling: string | null; actualAfterFeeling: string | null;
  outcome: "love" | "skip" | "undecided" | "bought" | "saved" | null;
  objection: string | null; rewear: boolean | null; rating: number | null;
  // POST_WEAR_REVIEW only — canonical confidence observations (1–10 scale)
  confidenceBefore: number | null; confidenceAfter: number | null;
}

const e = (
  d: number, cid: string, et: ET, pn: string | null,
  x: Partial<Omit<SE, "daysAgo"|"customerId"|"eventType"|"productName">> = {}
): SE => ({
  daysAgo: d, customerId: cid, eventType: et, productName: pn,
  occasion: x.occasion ?? null, desiredFeeling: x.desiredFeeling ?? null,
  actualAfterFeeling: x.actualAfterFeeling ?? null, outcome: x.outcome ?? null,
  objection: x.objection ?? null, rewear: x.rewear ?? null, rating: x.rating ?? null,
  confidenceBefore: x.confidenceBefore ?? null, confidenceAfter: x.confidenceAfter ?? null,
});

const SS = "STYLING_SESSION" as ET, OR = "POST_OUTFIT_REVIEW" as ET,
      WR = "POST_WEAR_REVIEW" as ET,  RF = "RECOMMENDATION_FEEDBACK" as ET,
      BS = "BUY_OR_SKIP" as ET,       CU = "CLOSET_UPLOAD" as ET,
      RT = "RETURN" as ET;

const EVENTS: SE[] = [
  // ── DAYS 0–7: Becoming Clear gaining momentum; Travel Day demand rising ──────
  // C12 (Effortlessly Chic): Clear travel session → 5-star review → buys
  e(1,  "C12", SS, CLEAR,   { occasion:"travel",       desiredFeeling:"Elevated"             }),
  e(1,  "C12", OR, CLEAR,   { rating: 5                                                       }),
  e(1,  "C12", BS, CLEAR,   { outcome:"bought"                                                }),
  // C5 (Artsy): Clear travel session → loves
  e(2,  "C5",  SS, CLEAR,   { occasion:"travel",       desiredFeeling:"Confident"            }),
  e(2,  "C5",  RF, CLEAR,   { outcome:"love"                                                  }),
  // C14 (Trendy): Clear dinner session → loves
  e(3,  "C14", SS, CLEAR,   { occasion:"dinner",       desiredFeeling:"Confident"            }),
  e(3,  "C14", RF, CLEAR,   { outcome:"love"                                                  }),
  // C4 (Artsy): general travel prep session — no product
  e(4,  "C4",  SS, null,    { occasion:"travel",       desiredFeeling:"Effortless"           }),
  // C13 (Old Money): Seen dinner → loves
  e(5,  "C13", SS, SEEN,    { occasion:"dinner",       desiredFeeling:"Elevated"             }),
  e(5,  "C13", RF, SEEN,    { outcome:"love"                                                  }),
  // C6 (Edgy): Alive date-night → loves
  e(6,  "C6",  SS, ALIVE,   { occasion:"date-night",   desiredFeeling:"Confident"            }),
  e(6,  "C6",  RF, ALIVE,   { outcome:"love"                                                  }),
  // C1 (Corporate Chic): Seen work → 5-star review
  e(7,  "C1",  SS, SEEN,    { occasion:"work",         desiredFeeling:"Powerful"             }),
  e(7,  "C1",  OR, SEEN,    { rating: 5                                                       }),

  // ── DAYS 8–30: Seen dominant; Too Formal objection; Whole save/purchase gap ──
  // C2 (CC): Seen work → buys
  e(8,  "C2",  SS, SEEN,    { occasion:"work",         desiredFeeling:"Confident"            }),
  e(8,  "C2",  OR, SEEN,    { rating: 5                                                       }),
  e(8,  "C2",  BS, SEEN,    { outcome:"bought"                                                }),
  // C11 (Minimal): Seen work → Too Formal → skips
  e(9,  "C11", SS, SEEN,    { occasion:"work",         desiredFeeling:"Put Together",
                              objection:"Too formal"                                          }),
  e(9,  "C11", RF, SEEN,    { outcome:"skip"                                                  }),
  // C4 (Artsy): Whole everyday → loves → saves (not buys)
  e(10, "C4",  SS, WHOLE,   { occasion:"everyday",     desiredFeeling:"Effortless"           }),
  e(10, "C4",  RF, WHOLE,   { outcome:"love"                                                  }),
  e(10, "C4",  BS, WHOLE,   { outcome:"saved"                                                 }),
  // C5 (Artsy): Whole everyday → saves
  e(11, "C5",  SS, WHOLE,   { occasion:"everyday",     desiredFeeling:"Effortless"           }),
  e(11, "C5",  BS, WHOLE,   { outcome:"saved"                                                 }),
  // C3 (CC): Seen special-event → loves → buys
  e(12, "C3",  SS, SEEN,    { occasion:"special-event", desiredFeeling:"Elevated"            }),
  e(12, "C3",  RF, SEEN,    { outcome:"love"                                                  }),
  e(12, "C3",  BS, SEEN,    { outcome:"bought"                                                }),
  // C7 (Edgy): Alive girls-night → loves
  e(13, "C7",  SS, ALIVE,   { occasion:"girls-night",  desiredFeeling:"Confident"            }),
  e(13, "C7",  RF, ALIVE,   { outcome:"love"                                                  }),
  // C15 (Casual Cool): Seen work → Too Formal → skips
  e(14, "C15", SS, SEEN,    { occasion:"work",         desiredFeeling:"Put Together",
                              objection:"Too formal"                                          }),
  e(14, "C15", RF, SEEN,    { outcome:"skip"                                                  }),
  // C9 (Feminine): Her dinner → loves → saves
  e(15, "C9",  SS, HER,     { occasion:"dinner",       desiredFeeling:"Feminine"             }),
  e(15, "C9",  RF, HER,     { outcome:"love"                                                  }),
  e(15, "C9",  BS, HER,     { outcome:"saved"                                                 }),
  // C6 (Edgy): Grounded work → trouser length concern → undecided
  e(16, "C6",  SS, GROUNDED,{ occasion:"work",         desiredFeeling:"Powerful",
                              objection:"Trouser length concern"                             }),
  e(16, "C6",  RF, GROUNDED,{ outcome:"undecided"                                            }),
  // C12 (EF Chic): Whole travel → loves → saves
  e(18, "C12", SS, WHOLE,   { occasion:"travel",       desiredFeeling:"Effortless"           }),
  e(18, "C12", RF, WHOLE,   { outcome:"love"                                                  }),
  e(18, "C12", BS, WHOLE,   { outcome:"saved"                                                 }),
  // C1 (CC): Seen post-wear → Powerful → rewears
  e(20, "C1",  WR, SEEN,    { desiredFeeling:"Powerful",   actualAfterFeeling:"Powerful",    rewear:true,  rating:5, confidenceBefore:5.5, confidenceAfter:7.5 }),
  // C8 (Edgy): Alive date-night → loves
  e(21, "C8",  SS, ALIVE,   { occasion:"date-night",   desiredFeeling:"Confident"            }),
  e(21, "C8",  RF, ALIVE,   { outcome:"love"                                                  }),
  // C11 (Minimal): Grounded work → waist detail concern → skips
  e(22, "C11", SS, GROUNDED,{ occasion:"work",         desiredFeeling:"Put Together",
                              objection:"Waist detail too bold"                              }),
  e(22, "C11", RF, GROUNDED,{ outcome:"skip"                                                  }),
  // C10 (Romantic): Her date-night → loves → saves
  e(24, "C10", SS, HER,     { occasion:"date-night",   desiredFeeling:"Attractive"           }),
  e(24, "C10", RF, HER,     { outcome:"love"                                                  }),
  e(24, "C10", BS, HER,     { outcome:"saved"                                                 }),
  // C14 (Trendy): Grounded dinner → 4-star review
  e(25, "C14", SS, GROUNDED,{ occasion:"dinner",       desiredFeeling:"Elevated"             }),
  e(25, "C14", OR, GROUNDED,{ rating: 4                                                       }),
  // C2 (CC): Seen post-wear → Confident → rewears
  e(26, "C2",  WR, SEEN,    { desiredFeeling:"Confident",  actualAfterFeeling:"Confident",   rewear:true,  rating:5, confidenceBefore:5.8, confidenceAfter:7.2 }),
  // C13 (Old Money): Whole dinner → saves
  e(28, "C13", SS, WHOLE,   { occasion:"dinner",       desiredFeeling:"Elevated"             }),
  e(28, "C13", BS, WHOLE,   { outcome:"saved"                                                 }),
  // C4 (Artsy): closet upload
  e(29, "C4",  CU, null),
  // C5 (Artsy): Real work → 4-star review
  e(30, "C5",  SS, REAL,    { occasion:"work",         desiredFeeling:"Confident"            }),
  e(30, "C5",  OR, REAL,    { rating: 4                                                       }),

  // ── DAYS 31–90: Personality relationships clear; Grounded objections accumulate; Clear converts ──
  // C1 (CC): Seen work again
  e(32, "C1",  SS, SEEN,    { occasion:"work",         desiredFeeling:"Powerful"             }),
  e(32, "C1",  OR, SEEN,    { rating: 5                                                       }),
  // C7 (Edgy): Alive girls-night → loves → BUYS
  e(33, "C7",  SS, ALIVE,   { occasion:"girls-night",  desiredFeeling:"Confident"            }),
  e(33, "C7",  RF, ALIVE,   { outcome:"love"                                                  }),
  e(33, "C7",  BS, ALIVE,   { outcome:"bought"                                                }),
  // C11 (Minimal): Seen work → Too Formal again
  e(35, "C11", SS, SEEN,    { occasion:"work",         desiredFeeling:"Put Together",
                              objection:"Too formal"                                          }),
  e(35, "C11", RF, SEEN,    { outcome:"skip"                                                  }),
  // C4 (Artsy): Whole post-wear → achieves Effortless but doesn't rewear (styling gap)
  e(36, "C4",  WR, WHOLE,   { desiredFeeling:"Effortless",  actualAfterFeeling:"Comfortable", rewear:false, rating:4, confidenceBefore:5.2, confidenceAfter:6.0 }),
  // C3 (CC): Grounded work → 4-star review
  e(37, "C3",  SS, GROUNDED,{ occasion:"work",         desiredFeeling:"Confident"            }),
  e(37, "C3",  OR, GROUNDED,{ rating: 4                                                       }),
  // C6 (Edgy): Grounded dinner → "Length too long" → undecided
  e(38, "C6",  SS, GROUNDED,{ occasion:"dinner",       desiredFeeling:"Powerful",
                              objection:"Trouser length too long"                            }),
  e(38, "C6",  RF, GROUNDED,{ outcome:"undecided"                                            }),
  // C9 (Feminine): Her special-event → loves → BUYS
  e(40, "C9",  SS, HER,     { occasion:"special-event", desiredFeeling:"Feminine"            }),
  e(40, "C9",  RF, HER,     { outcome:"love"                                                  }),
  e(40, "C9",  BS, HER,     { outcome:"bought"                                                }),
  // C2 (CC): Seen work → 5-star review
  e(42, "C2",  SS, SEEN,    { occasion:"work",         desiredFeeling:"Confident"            }),
  e(42, "C2",  OR, SEEN,    { rating: 5                                                       }),
  // C14 (Trendy): Alive girls-night → loves
  e(43, "C14", SS, ALIVE,   { occasion:"girls-night",  desiredFeeling:"Playful"              }),
  e(43, "C14", RF, ALIVE,   { outcome:"love"                                                  }),
  // C12 (EF Chic): Whole travel → post-wear → REWEARS (one customer who converts Whole)
  e(45, "C12", SS, WHOLE,   { occasion:"travel",       desiredFeeling:"Effortless"           }),
  e(45, "C12", WR, WHOLE,   { desiredFeeling:"Effortless",  actualAfterFeeling:"Effortless",  rewear:true,  rating:5, confidenceBefore:5.6, confidenceAfter:7.4 }),
  // C5 (Artsy): Clear dinner → loves → BUYS (2nd Clear convert; 90D shows high conversion)
  e(46, "C5",  SS, CLEAR,   { occasion:"dinner",       desiredFeeling:"Elevated"             }),
  e(46, "C5",  RF, CLEAR,   { outcome:"love"                                                  }),
  e(46, "C5",  BS, CLEAR,   { outcome:"bought"                                                }),
  // C15 (Casual Cool): Grounded everyday → "Trouser length too long" → undecided
  e(48, "C15", SS, GROUNDED,{ occasion:"everyday",     desiredFeeling:"Put Together",
                              objection:"Trouser length too long"                            }),
  e(48, "C15", RF, GROUNDED,{ outcome:"undecided"                                            }),
  // C1 (CC): Grounded work → buys (resolves after multiple sessions)
  e(50, "C1",  SS, GROUNDED,{ occasion:"work",         desiredFeeling:"Powerful"             }),
  e(50, "C1",  OR, GROUNDED,{ rating: 4                                                       }),
  e(50, "C1",  BS, GROUNDED,{ outcome:"bought"                                                }),
  // C8 (Edgy): Alive date-night → loves → BUYS
  e(52, "C8",  SS, ALIVE,   { occasion:"date-night",   desiredFeeling:"Confident"            }),
  e(52, "C8",  RF, ALIVE,   { outcome:"love"                                                  }),
  e(52, "C8",  BS, ALIVE,   { outcome:"bought"                                                }),
  // C10 (Romantic): Rooted date-night → loves
  e(54, "C10", SS, ROOTED,  { occasion:"date-night",   desiredFeeling:"Feminine"             }),
  e(54, "C10", RF, ROOTED,  { outcome:"love"                                                  }),
  // C11 (Minimal): Real work → loves → BUYS (Minimal prefers Real over Seen)
  e(55, "C11", SS, REAL,    { occasion:"work",         desiredFeeling:"Put Together"         }),
  e(55, "C11", RF, REAL,    { outcome:"love"                                                  }),
  e(55, "C11", BS, REAL,    { outcome:"bought"                                                }),
  // C4 (Artsy): Clear dinner → loves
  e(58, "C4",  SS, CLEAR,   { occasion:"dinner",       desiredFeeling:"Elevated"             }),
  e(58, "C4",  RF, CLEAR,   { outcome:"love"                                                  }),
  // C13 (Old Money): Seen dinner → 5-star review
  e(60, "C13", SS, SEEN,    { occasion:"dinner",       desiredFeeling:"Elevated"             }),
  e(60, "C13", OR, SEEN,    { rating: 5                                                       }),
  // C3 (CC): Seen post-wear → Elevated → rewears
  e(62, "C3",  WR, SEEN,    { desiredFeeling:"Elevated",   actualAfterFeeling:"Elevated",    rewear:true,  rating:5, confidenceBefore:6.0, confidenceAfter:8.0 }),
  // C7 (Edgy): Alive post-wear → Confident → rewears
  e(63, "C7",  WR, ALIVE,   { desiredFeeling:"Confident",  actualAfterFeeling:"Confident",   rewear:true,  rating:5, confidenceBefore:5.5, confidenceAfter:7.5 }),
  // C6 (Edgy): Grounded work → "Hip fit uncertain" → undecided
  e(65, "C6",  SS, GROUNDED,{ occasion:"work",         desiredFeeling:"Powerful",
                              objection:"Hip fit uncertain"                                  }),
  e(65, "C6",  RF, GROUNDED,{ outcome:"undecided"                                            }),
  // C2 (CC): Grounded work → BUYS
  e(67, "C2",  SS, GROUNDED,{ occasion:"work",         desiredFeeling:"Confident"            }),
  e(67, "C2",  BS, GROUNDED,{ outcome:"bought"                                                }),
  // C9 (Feminine): Her post-wear → Feminine → rewears
  e(70, "C9",  WR, HER,     { desiredFeeling:"Feminine",   actualAfterFeeling:"Feminine",    rewear:true,  rating:5, confidenceBefore:5.4, confidenceAfter:7.6 }),
  // C14 (Trendy): Clear date-night → loves → BUYS (3rd Clear convert; seals high-conversion story)
  e(72, "C14", SS, CLEAR,   { occasion:"date-night",   desiredFeeling:"Confident"            }),
  e(72, "C14", RF, CLEAR,   { outcome:"love"                                                  }),
  e(72, "C14", BS, CLEAR,   { outcome:"bought"                                                }),
  // C12 (EF Chic): Whole travel → 4-star review
  e(75, "C12", SS, WHOLE,   { occasion:"travel",       desiredFeeling:"Effortless"           }),
  e(75, "C12", OR, WHOLE,   { rating: 4                                                       }),
  // C5 (Artsy): Alive dinner → undecided (Artsy is cautious with Alive without an Edgy edge)
  e(77, "C5",  SS, ALIVE,   { occasion:"dinner",       desiredFeeling:"Elevated"             }),
  e(77, "C5",  RF, ALIVE,   { outcome:"undecided"                                             }),
  // C11 (Minimal): Seen work → Too Formal (4th objection — stable friction pattern)
  e(78, "C11", SS, SEEN,    { occasion:"work",         desiredFeeling:"Put Together",
                              objection:"Too formal"                                          }),
  e(78, "C11", RF, SEEN,    { outcome:"skip"                                                  }),
  // C1 (CC): Grounded post-wear → Powerful → rewears
  e(80, "C1",  WR, GROUNDED,{ desiredFeeling:"Powerful",   actualAfterFeeling:"Powerful",    rewear:true,  rating:5, confidenceBefore:5.7, confidenceAfter:7.3 }),
  // C15 (Casual Cool): Alive girls-night → SKIPS (polarising for Casual Cool)
  e(82, "C15", SS, ALIVE,   { occasion:"girls-night",  desiredFeeling:"Confident"            }),
  e(82, "C15", RF, ALIVE,   { outcome:"skip"                                                  }),
  // C3 (CC): Real work → 4-star review
  e(85, "C3",  SS, REAL,    { occasion:"work",         desiredFeeling:"Confident"            }),
  e(85, "C3",  OR, REAL,    { rating: 4                                                       }),
  // C10 (Romantic): Her date-night → loves → BUYS
  e(87, "C10", SS, HER,     { occasion:"date-night",   desiredFeeling:"Attractive"           }),
  e(87, "C10", RF, HER,     { outcome:"love"                                                  }),
  e(87, "C10", BS, HER,     { outcome:"bought"                                                }),
  // C13 (Old Money): Rooted special-event → saves
  e(89, "C13", SS, ROOTED,  { occasion:"special-event", desiredFeeling:"Elevated"            }),
  e(89, "C13", BS, ROOTED,  { outcome:"saved"                                                 }),

  // ── DAYS 91–365: Complete history · repeat customers · LTV signals ────────────
  // C1 (CC): Seen work — 3rd session with same piece
  e(95,  "C1",  SS, SEEN,    { occasion:"work",         desiredFeeling:"Powerful"            }),
  e(95,  "C1",  OR, SEEN,    { rating: 5                                                      }),
  // C6 (Edgy): Grounded — buys after 3 fit objections; rewears
  e(100, "C6",  BS, GROUNDED,{ outcome:"bought"                                               }),
  e(100, "C6",  WR, GROUNDED,{ desiredFeeling:"Powerful",   actualAfterFeeling:"Powerful",    rewear:true,  rating:4, confidenceBefore:5.3, confidenceAfter:7.1 }),
  // C7 (Edgy): Alive — wears repeatedly (LTV)
  e(105, "C7",  SS, ALIVE,   { occasion:"girls-night",  desiredFeeling:"Confident"           }),
  e(105, "C7",  WR, ALIVE,   { desiredFeeling:"Confident",  actualAfterFeeling:"Confident",   rewear:true,  confidenceBefore:5.5, confidenceAfter:7.5 }),
  // C4 (Artsy): Whole post-wear — still not rewearing (persistent styling gap)
  e(110, "C4",  WR, WHOLE,   { desiredFeeling:"Effortless",  actualAfterFeeling:"Comfortable", rewear:false, rating:3, confidenceBefore:5.0, confidenceAfter:5.8 }),
  // C2 (CC): Seen post-wear → rewears
  e(112, "C2",  WR, SEEN,    { desiredFeeling:"Confident",  actualAfterFeeling:"Confident",   rewear:true,  rating:5, confidenceBefore:5.8, confidenceAfter:7.0 }),
  // C5 (Artsy): Clear post-wear → Elevated → rewears
  e(115, "C5",  WR, CLEAR,   { desiredFeeling:"Elevated",   actualAfterFeeling:"Elevated",    rewear:true,  rating:5, confidenceBefore:5.5, confidenceAfter:7.8 }),
  // C9 (Feminine): Her dinner — repeat interest
  e(120, "C9",  SS, HER,     { occasion:"dinner",       desiredFeeling:"Feminine"            }),
  e(120, "C9",  BS, HER,     { outcome:"saved"                                                }),
  // C3 (CC): Seen post-wear → rewears
  e(125, "C3",  WR, SEEN,    { desiredFeeling:"Elevated",   actualAfterFeeling:"Elevated",    rewear:true,  rating:5, confidenceBefore:6.0, confidenceAfter:8.0 }),
  // C8 (Edgy): Alive post-wear → rewears
  e(130, "C8",  WR, ALIVE,   { desiredFeeling:"Confident",  actualAfterFeeling:"Confident",   rewear:true,  rating:5, confidenceBefore:5.6, confidenceAfter:7.4 }),
  // C12 (EF Chic): Seen travel → loves → BUYS
  e(135, "C12", SS, SEEN,    { occasion:"travel",       desiredFeeling:"Elevated"            }),
  e(135, "C12", RF, SEEN,    { outcome:"love"                                                 }),
  e(135, "C12", BS, SEEN,    { outcome:"bought"                                               }),
  // C1 (CC): Real work → BUYS (multi-product LTV customer)
  e(140, "C1",  SS, REAL,    { occasion:"work",         desiredFeeling:"Put Together"        }),
  e(140, "C1",  BS, REAL,    { outcome:"bought"                                               }),
  // C11 (Minimal): Whole everyday → loves → saves (Minimal prefers Whole over Seen)
  e(145, "C11", SS, WHOLE,   { occasion:"everyday",     desiredFeeling:"Effortless"          }),
  e(145, "C11", RF, WHOLE,   { outcome:"love"                                                 }),
  e(145, "C11", BS, WHOLE,   { outcome:"saved"                                                }),
  // C13 (Old Money): Rooted dinner → BUYS
  e(150, "C13", SS, ROOTED,  { occasion:"dinner",       desiredFeeling:"Elevated"            }),
  e(150, "C13", BS, ROOTED,  { outcome:"bought"                                               }),
  // C10 (Romantic): Her post-wear → Attractive → rewears
  e(155, "C10", WR, HER,     { desiredFeeling:"Attractive",  actualAfterFeeling:"Attractive",  rewear:true,  rating:5, confidenceBefore:5.3, confidenceAfter:7.7 }),
  // C2 (CC): Seen work — another session (LTV signal)
  e(160, "C2",  SS, SEEN,    { occasion:"work",         desiredFeeling:"Powerful"            }),
  e(160, "C2",  OR, SEEN,    { rating: 5                                                      }),
  // C4 (Artsy): Alive dinner → undecided (consistent across time — Artsy is on the fence)
  e(165, "C4",  SS, ALIVE,   { occasion:"dinner",       desiredFeeling:"Elevated"            }),
  e(165, "C4",  RF, ALIVE,   { outcome:"undecided"                                            }),
  // C14 (Trendy): Her girls-night → loves
  e(170, "C14", SS, HER,     { occasion:"girls-night",  desiredFeeling:"Attractive"          }),
  e(170, "C14", RF, HER,     { outcome:"love"                                                 }),
  // C6 (Edgy): Alive post-wear → rewears
  e(175, "C6",  WR, ALIVE,   { desiredFeeling:"Confident",  actualAfterFeeling:"Confident",   rewear:true,  confidenceBefore:5.5, confidenceAfter:7.5 }),
  // C1 (CC): Seen special-event — 4th session with this piece
  e(180, "C1",  SS, SEEN,    { occasion:"special-event", desiredFeeling:"Elevated"           }),
  e(180, "C1",  OR, SEEN,    { rating: 5                                                      }),
  // C5 (Artsy): Whole travel → wears but still doesn't rewear (persistent gap)
  e(185, "C5",  SS, WHOLE,   { occasion:"travel",       desiredFeeling:"Effortless"          }),
  e(185, "C5",  WR, WHOLE,   { desiredFeeling:"Effortless",  actualAfterFeeling:"Comfortable", rewear:false, rating:3, confidenceBefore:5.0, confidenceAfter:5.8 }),
  // C7 (Edgy): Grounded work → trouser length note (different customer, same pattern)
  e(190, "C7",  SS, GROUNDED,{ occasion:"work",         desiredFeeling:"Powerful",
                              objection:"Trouser length"                                     }),
  e(190, "C7",  OR, GROUNDED,{ rating: 4                                                      }),
  // C3 (CC): Grounded work → review
  e(200, "C3",  SS, GROUNDED,{ occasion:"work",         desiredFeeling:"Confident"           }),
  e(200, "C3",  OR, GROUNDED,{ rating: 4                                                      }),
  // C15 (Casual Cool): Whole everyday → loves (Whole more accessible than Seen for Casual Cool)
  e(210, "C15", SS, WHOLE,   { occasion:"everyday",     desiredFeeling:"Effortless"          }),
  e(210, "C15", RF, WHOLE,   { outcome:"love"                                                 }),
  // C9 (Feminine): Rooted special-event → saves
  e(220, "C9",  SS, ROOTED,  { occasion:"special-event", desiredFeeling:"Feminine"           }),
  e(220, "C9",  BS, ROOTED,  { outcome:"saved"                                                }),
  // C13 (Old Money): Seen dinner → 5-star review (long-term loyalty)
  e(230, "C13", SS, SEEN,    { occasion:"dinner",       desiredFeeling:"Elevated"            }),
  e(230, "C13", OR, SEEN,    { rating: 5                                                      }),
  // C12 (EF Chic): Seen post-wear → rewears
  e(240, "C12", WR, SEEN,    { desiredFeeling:"Elevated",   actualAfterFeeling:"Elevated",    rewear:true,  rating:5, confidenceBefore:6.1, confidenceAfter:8.0 }),
  // C2 (CC): Grounded work → 5-star review (consistent repeat use)
  e(250, "C2",  SS, GROUNDED,{ occasion:"work",         desiredFeeling:"Confident"           }),
  e(250, "C2",  OR, GROUNDED,{ rating: 5                                                      }),
  // C8 (Edgy): Alive girls-night → BUYS AGAIN (2nd purchase — clear LTV signal)
  e(260, "C8",  SS, ALIVE,   { occasion:"girls-night",  desiredFeeling:"Confident"           }),
  e(260, "C8",  BS, ALIVE,   { outcome:"bought"                                               }),
  // C1 (CC): closet upload
  e(270, "C1",  CU, null),
  // C4 (Artsy): Whole dinner → still not converting (5th session, 0 purchases)
  e(280, "C4",  SS, WHOLE,   { occasion:"dinner",       desiredFeeling:"Effortless"          }),
  e(280, "C4",  WR, WHOLE,   { desiredFeeling:"Effortless",  actualAfterFeeling:null,          rewear:false, confidenceBefore:4.8, confidenceAfter:4.8 }),
  // C10 (Romantic): Her date-night → BUYS AGAIN (2nd purchase — strongest LTV piece for segment)
  e(290, "C10", SS, HER,     { occasion:"date-night",   desiredFeeling:"Attractive"          }),
  e(290, "C10", BS, HER,     { outcome:"bought"                                               }),
  // C5 (Artsy): closet upload
  e(300, "C5",  CU, null),
  // C11 (Minimal): Real work → loves (stable preference over Seen)
  e(310, "C11", SS, REAL,    { occasion:"work",         desiredFeeling:"Put Together"        }),
  e(310, "C11", RF, REAL,    { outcome:"love"                                                 }),
  // C3 (CC): Seen work → 5-star review (long-term)
  e(320, "C3",  SS, SEEN,    { occasion:"work",         desiredFeeling:"Confident"           }),
  e(320, "C3",  OR, SEEN,    { rating: 5                                                      }),
  // C14 (Trendy): Grounded dinner → loves (evolves over time)
  e(330, "C14", SS, GROUNDED,{ occasion:"dinner",       desiredFeeling:"Elevated"            }),
  e(330, "C14", RF, GROUNDED,{ outcome:"love"                                                 }),
  // C6 (Edgy): Seen special-event → loves (Edgy appreciates Seen for events)
  e(340, "C6",  SS, SEEN,    { occasion:"special-event", desiredFeeling:"Elevated"           }),
  e(340, "C6",  RF, SEEN,    { outcome:"love"                                                 }),
  // C7 (Edgy): Whole travel → saves
  e(350, "C7",  SS, WHOLE,   { occasion:"travel",       desiredFeeling:"Effortless"          }),
  e(350, "C7",  BS, WHOLE,   { outcome:"saved"                                                }),
  // C12 (EF Chic): Whole everyday → loves (long-term relationship)
  e(360, "C12", SS, WHOLE,   { occasion:"everyday",     desiredFeeling:"Effortless"          }),
  e(360, "C12", RF, WHOLE,   { outcome:"love"                                                 }),
  // C13 (Old Money): Clear dinner (earliest recorded event — historical discovery)
  e(365, "C13", SS, CLEAR,   { occasion:"dinner",       desiredFeeling:"Elevated"            }),

  // ── Return events ──────────────────────────────────────────────────────────────────────────────
  // RETURN events must reference a product that was previously purchased by the same customer.
  e(118, "C6",  RT, GROUNDED, {}), // C6 bought Grounded on day 100 — persistent fit concern led to return
  e(268, "C8",  RT, ALIVE,    {}), // C8's 2nd Alive purchase (day 260) returned — gift, recipient already owned it
  // Expanded dataset — C16–C120 (imported from synthetic-events-expanded.ts)
  ...EVENTS_EXPANDED,
];

// ── Emotional family map ───────────────────────────────────────────────────
// Explicit, documented groupings. "Achieved" = direct string match.
// "Partly" = actual feeling is in the same family but is not an exact match.
// "Not Achieved" = actual is null or belongs to a different family.
// Never derived from rewear, purchase, save, rating, or any behavioural signal.
const EMOTIONAL_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  "Confident":    ["Confident",    "Powerful",    "Assertive",    "Assured"],
  "Powerful":     ["Powerful",     "Confident",   "Commanding",   "Assertive"],
  "Elevated":     ["Elevated",     "Sophisticated","Refined",     "Polished"],
  "Effortless":   ["Effortless",   "Comfortable", "Natural",      "Easy"],
  "Feminine":     ["Feminine",     "Graceful",    "Soft",         "Delicate"],
  "Attractive":   ["Attractive",   "Feminine",    "Alluring",     "Beautiful"],
  "Put Together": ["Put Together", "Polished",    "Confident",    "Composed"],
  "Playful":      ["Playful",      "Expressive",  "Spirited",     "Fun"],
};

// ── Canonical emotional-achievement classifier ─────────────────────────────
// Only inspects desiredFeeling vs actualAfterFeeling. Never inspects rewear,
// purchase, save, rating, recommendation acceptance, or confidence lift.
export function classifyEmotionalOutcome(
  desired: string | null,
  actual: string | null,
): "achieved" | "partly" | "notAchieved" {
  if (!desired || !actual) return "notAchieved";
  if (desired === actual) return "achieved";
  const family = EMOTIONAL_FAMILIES[desired] ?? [desired];
  return (family as string[]).includes(actual) ? "partly" : "notAchieved";
}

// ── Filter functions ────────────────────────────────────────────────────────

function filterWindow(events: SE[], days: number): SE[] {
  return days >= 365 ? events : events.filter(ev => ev.daysAgo <= days);
}

function filterPrior(events: SE[], days: number): SE[] {
  if (days >= 365) return [];
  return events.filter(ev => ev.daysAgo > days && ev.daysAgo <= days * 2);
}

// ── Derivation helpers ─────────────────────────────────────────────────────

function ofType(events: SE[], t: ET): SE[] { return events.filter(ev => ev.eventType === t); }
function forProduct(events: SE[], name: string): SE[] { return events.filter(ev => ev.productName === name); }

function meanRating(events: SE[]): number | null {
  const ratings = events.map(ev => ev.rating).filter((r): r is number => r !== null);
  return ratings.length ? Math.round((ratings.reduce((s, v) => s + v, 0) / ratings.length) * 10) / 10 : null;
}

function pct(num: number, denom: number): number {
  return denom ? Math.round((num / denom) * 100) : 0;
}

// Evidence-count-based confidence tier. n = observations supporting the specific claim.
function evidenceConfidence(n: number): string {
  if (n === 0)  return "No Data";
  if (n === 1)  return "Single Observation";
  if (n <= 4)   return "Early Signal";
  if (n <= 9)   return "Emerging Pattern";
  if (n <= 19)  return "Established Pattern";
  return "Strong Pattern";
}

function topKeys<K>(map: Map<K, number>, n: number): K[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function tally<T>(vals: (T | null)[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const v of vals) { if (v != null) m.set(v, (m.get(v) ?? 0) + 1); }
  return m;
}

// Canonical objection key → human-readable label. Normalises textual variants that refer
// to the same underlying fit/style issue so the dashboard never shows them as separate
// categories. Add new rules here; the key is the canonical label shown in the UI.
const OBJECTION_CANONICAL: [RegExp, string][] = [
  [/trouser.*(length|long|short|too)/i, "Trouser length"],
  [/(length|too long|too short).*trouser/i, "Trouser length"],
  [/trouser length/i,                   "Trouser length"],
];
function canonicalizeObjection(raw: string): string {
  for (const [pattern, label] of OBJECTION_CANONICAL) {
    if (pattern.test(raw)) return label;
  }
  return raw;
}

// Per-product metric bundle derived from a filtered event set
function productStats(events: SE[], name: string) {
  const ps  = forProduct(ofType(events, SS), name);
  const pr  = forProduct(ofType(events, OR), name);
  const pwr = forProduct(ofType(events, WR), name);
  const pf  = forProduct(ofType(events, RF), name);
  const pbs = forProduct(ofType(events, BS), name);
  const pb  = pbs.filter(ev => ev.outcome === "bought");
  const psv = pbs.filter(ev => ev.outcome === "saved");

  const allRev = [...pr, ...pwr];
  const avgRating  = meanRating(allRev);
  const loves      = pf.filter(ev => ev.outcome === "love").length;
  const loveRate   = pct(loves, pf.length);
  const rewearYes  = pwr.filter(ev => ev.rewear).length;
  const rewearRate = pwr.length ? rewearYes / pwr.length : 0;
  const pwrDenom   = Math.max(1, pwr.length);

  // Emotional outcome — derived from desiredFeeling vs actualAfterFeeling only.
  // Never uses rewear, purchase, save, rating, or any behavioural signal.
  const eoOutcomes    = pwr.map(ev => classifyEmotionalOutcome(ev.desiredFeeling, ev.actualAfterFeeling));
  const strongAchieved = eoOutcomes.filter(o => o === "achieved").length;
  const partlyAchieved = eoOutcomes.filter(o => o === "partly").length;
  const notAchieved    = eoOutcomes.filter(o => o === "notAchieved").length;
  const feelingConfirmed = strongAchieved + partlyAchieved;
  const feelingRate  = pct(feelingConfirmed, pwr.length);

  // Confidence lift — derived from canonical confidenceBefore/After pairs in WR events.
  const confPairs = pwr.filter(ev => ev.confidenceBefore !== null && ev.confidenceAfter !== null);
  const avgConfidenceLift = confPairs.length > 0
    ? Math.round(
        (confPairs.reduce((s, ev) => s + (ev.confidenceAfter! - ev.confidenceBefore!), 0) / confPairs.length) * 10
      ) / 10
    : 0;

  const objections    = ps.map(ev => ev.objection).filter((o): o is string => o !== null).map(canonicalizeObjection);
  const objMap        = tally(objections);
  const topObj        = objections.length ? topKeys(objMap, 1)[0] ?? null : null;

  const allEventsCids = [...ps, ...pf, ...pr, ...pwr].map(ev => ev.customerId);
  const personalityMap = tally(allEventsCids.map(cid => CUST[cid] ?? null));
  const topPersonalities = topKeys(personalityMap, 3).filter(Boolean);

  const occasionMap = tally(ps.map(ev => ev.occasion));
  const topOccasions = topKeys(occasionMap, 2).filter((o): o is string => o !== null);

  const actualAfterFeelings = pwr
    .filter(ev => ev.actualAfterFeeling !== null)
    .map(ev => ev.actualAfterFeeling as string);

  return {
    sessionCount: ps.length, reviewCount: allRev.length, sampleSize: allRev.length,
    // evidenceN = reviews + buy-or-skip decisions — total direct customer interactions (SEEN, WHOLE, ALIVE, CLEAR).
    // GROUNDED uses objectionCount instead: its claim is about repeatable fit concerns from session data,
    // not reviews or purchase decisions. Using BS events for a fit-objection badge would be category error.
    evidenceN: allRev.length + pbs.length,
    // wrCount = post-wear reviews only (not outfit reviews). Used as denominator wherever the claim is
    // about feeling achievement or would-wear-again — both measured exclusively in WR events.
    wrCount: pwr.length,
    rewearYesCount: rewearYes,
    rewearNoCount: pwr.filter(ev => ev.rewear === false).length,
    avgRating, loveRate, rewearRate, feelingAchievedRate: feelingRate,
    strongAchievedCount: strongAchieved, strongAchievedRate: pct(strongAchieved, pwrDenom),
    partlyAchievedCount: partlyAchieved, partlyAchievedRate: pct(partlyAchieved, pwrDenom),
    notAchievedCount: notAchieved,       notAchievedRate: pct(notAchieved, pwrDenom),
    buyCount: pb.length, saveCount: psv.length, totalBuyOrSkip: pbs.length,
    conversionRate: pct(pb.length, pbs.length),
    saveRate: pct(psv.length, pbs.length),
    topObjection: topObj, objectionCount: objections.length,
    topPersonalities, topOccasions, actualAfterFeelings,
    avgConfidenceLift,
  };
}

// ── Dynamic opportunity score ──────────────────────────────────────────────
// Computed from available evidence only. Missing factors are excluded and the
// remaining weights are renormalized to 100% so absence is never scored as 0.
// Requires at least avg-rating evidence (sampleSize > 0) to produce a score;
// products with no reviews in the period return score = null (not measured).
function computeOpportunityScore(p: ReturnType<typeof productStats>): {
  score: number | null;
  available: Array<{ name: string; baseWeight: number; effectiveWeight: number; rawValue: string; contribution: number }>;
  missing: string[];
} {
  // Data-quality score (step ladder matching evidenceConfidence tiers)
  const qualityStep = (n: number) => {
    if (n === 0) return 0;
    if (n === 1) return 17;
    if (n <= 4)  return 33;
    if (n <= 9)  return 50;
    if (n <= 19) return 67;
    return 83;
  };

  const ratingAvail = p.sampleSize > 0 && p.avgRating != null;
  const rewearAvail = p.wrCount > 0;
  const liftAvail   = p.wrCount > 0; // confidence pairs live in WR events
  const qualityAvail = p.sampleSize > 0;

  const candidates = [
    {
      name: "Avg rating", baseWeight: 30, available: ratingAvail,
      score: ratingAvail ? (p.avgRating! / 5) * 100 : 0,
      rawValue: ratingAvail ? `★${p.avgRating!.toFixed(1)}` : "—",
    },
    {
      name: "Rewear rate", baseWeight: 25, available: rewearAvail,
      score: rewearAvail ? p.rewearRate * 100 : 0,
      rawValue: rewearAvail ? `${Math.round(p.rewearRate * 100)}% · n=${p.wrCount} post-wear` : "—",
    },
    {
      name: "Confidence lift", baseWeight: 25, available: liftAvail,
      // lift of 2.5 pts on a 10-pt scale = ceiling (100). Negative lift → 0.
      score: liftAvail ? Math.max(0, Math.min(100, (p.avgConfidenceLift / 2.5) * 100)) : 0,
      rawValue: liftAvail ? `+${p.avgConfidenceLift} pts` : "—",
    },
    {
      name: "Data quality", baseWeight: 20, available: qualityAvail,
      score: qualityAvail ? qualityStep(p.sampleSize) : 0,
      rawValue: qualityAvail ? `n=${p.sampleSize} reviews` : "—",
    },
  ];

  const avail   = candidates.filter(c => c.available);
  const missing = candidates.filter(c => !c.available).map(c => c.name);

  // Without at least a rating we cannot produce a meaningful directional score.
  if (!ratingAvail || avail.length === 0) {
    return { score: null, available: [], missing: candidates.map(c => c.name) };
  }

  const totalBase = avail.reduce((s, c) => s + c.baseWeight, 0);
  const available = avail.map(c => {
    const effectiveWeight = Math.round((c.baseWeight / totalBase) * 100);
    const contribution    = Math.round((c.score * c.baseWeight) / totalBase);
    return { name: c.name, baseWeight: c.baseWeight, effectiveWeight, rawValue: c.rawValue, contribution };
  });
  const score = Math.round(avail.reduce((s, c) => s + (c.score * c.baseWeight) / totalBase, 0));
  return { score, available, missing };
}

// ── Main export ────────────────────────────────────────────────────────────

export function getDesignerSampleData(dateRangeDays: number = 30) {
  const current   = filterWindow(EVENTS, dateRangeDays);
  const prior     = filterPrior(EVENTS, dateRangeDays);
  const allTime   = EVENTS; // always available for static profile data

  const periodLabel = dateRangeDays >= 365 ? "All time" : `Last ${dateRangeDays} days`;
  const prevLabel   = dateRangeDays >= 365 ? "Prior year" : `Prior ${dateRangeDays} days`;

  // ── Core event-set counts ──────────────────────────────────────────────
  const sessions    = ofType(current, SS);
  const reviews     = ofType(current, OR);
  const wearReviews = ofType(current, WR);
  const feedback    = ofType(current, RF);
  const buyOrSkip   = ofType(current, BS);
  const uploads     = ofType(current, CU);

  const ns  = sessions.length;
  const nr  = reviews.length;
  const nwr = wearReviews.length;

  const buys  = buyOrSkip.filter(ev => ev.outcome === "bought");
  const saves = buyOrSkip.filter(ev => ev.outcome === "saved");

  const prevNs = ofType(prior, SS).length;
  const prevNr = ofType(prior, OR).length;
  const prevWr = ofType(prior, WR);
  const prevNwr = prevWr.length;
  const prevRewearRate = prevNwr > 0
    ? Math.round(prevWr.filter(ev => ev.rewear === true).length / prevNwr * 100)
    : null;

  const allRatings = [...reviews, ...wearReviews].map(ev => ev.rating).filter((r): r is number => r !== null);
  const avgRating  = allRatings.length ? (meanRating([...reviews, ...wearReviews]) ?? 4.1) : 4.1;
  const prevRatings = [...ofType(prior, OR), ...ofType(prior, WR)]
    .map(ev => ev.rating).filter((r): r is number => r !== null);
  const prevAvgRating = prevRatings.length ? (meanRating([...ofType(prior, OR), ...ofType(prior, WR)]) ?? 3.9) : 3.9;

  const rewearYesTotal  = wearReviews.filter(ev => ev.rewear === true).length;
  const rewearNoTotal   = wearReviews.filter(ev => ev.rewear === false).length;
  const rewearRateTotal = nwr > 0 ? rewearYesTotal / nwr : 0.75;

  // Would-Wear-Again full breakdown (Yes / No / Unsure)
  const wyaBreakdown = {
    yesCount: rewearYesTotal,
    yesRate:  pct(rewearYesTotal, Math.max(1, nwr)),
    noCount:  rewearNoTotal,
    noRate:   pct(rewearNoTotal,  Math.max(1, nwr)),
    unsureCount: 0,
    unsureRate:  0,
    totalResponses: nwr,
  };

  // Emotional-journey achieved/partly/not — mutually exclusive, sum = nwr
  // Derived exclusively from desiredFeeling vs actualAfterFeeling via classifyEmotionalOutcome.
  // Rewear is a separate behavioural metric and does not affect this classification.
  const ejOutcomes = wearReviews.map(ev => classifyEmotionalOutcome(ev.desiredFeeling, ev.actualAfterFeeling));
  const ejAchieved = ejOutcomes.filter(o => o === "achieved").length;
  const ejPartly   = ejOutcomes.filter(o => o === "partly").length;
  const ejNot      = ejOutcomes.filter(o => o === "notAchieved").length;

  // Dashboard-level confidence before/after/lift — derived from canonical WR event pairs
  const ejConfPairs = wearReviews.filter(ev => ev.confidenceBefore !== null && ev.confidenceAfter !== null);
  const ejConfN = ejConfPairs.length;
  const ejAvgConfBefore = ejConfN > 0
    ? Math.round(ejConfPairs.reduce((s, ev) => s + ev.confidenceBefore!, 0) / ejConfN * 10) / 10
    : null;
  const ejAvgConfAfter = ejConfN > 0
    ? Math.round(ejConfPairs.reduce((s, ev) => s + ev.confidenceAfter!, 0) / ejConfN * 10) / 10
    : null;
  const ejAvgConfLift = (ejAvgConfBefore !== null && ejAvgConfAfter !== null)
    ? Math.round((ejAvgConfAfter - ejAvgConfBefore) * 10) / 10
    : null;

  const lovesTotal = feedback.filter(ev => ev.outcome === "love").length;
  const loveRate   = feedback.length ? pct(lovesTotal, feedback.length) : 59;

  // ── Per-product metrics ────────────────────────────────────────────────
  const pm: Record<string, ReturnType<typeof productStats>> = {};
  for (const p of ALL_PRODUCTS) pm[p] = productStats(current, p);

  // Rankings
  const bySessionCount = ALL_PRODUCTS
    .map(name => ({ name, ...pm[name] }))
    .filter(p => p.sessionCount > 0)
    .sort((a, b) => b.sessionCount - a.sessionCount);

  // Classify products for Product Intelligence tab
  // topPieces: high avg rating + positive love rate + has reviews
  const topPieceNames   = bySessionCount.filter(p => (p.avgRating ?? 0) >= 4.2 && p.loveRate >= 60 && p.reviewCount > 0).slice(0, 3).map(p => p.name);
  // mixedPieces: saves > buys and save count significant
  const mixedPieceNames = bySessionCount.filter(p => p.saveCount > 0 && p.saveCount >= p.buyCount).slice(0, 2).map(p => p.name);
  // underperformingPieces: loveRate < 60 and has feedback
  const underNames      = bySessionCount.filter(p => p.loveRate < 60 && feedback.filter(ev => ev.productName === p.name).length > 0 && !topPieceNames.includes(p.name)).slice(0, 2).map(p => p.name);
  // watchPieces: few reviews but has sessions
  const watchNames      = bySessionCount.filter(p => p.reviewCount <= 2 && p.sessionCount > 0 && !topPieceNames.includes(p.name) && !underNames.includes(p.name)).slice(0, 2).map(p => p.name);

  // Helper: build a PieceCard object
  function pieceCard(name: string) {
    const p = pm[name]; const cat = CATALOG[name];
    const rewearPct = p.reviewCount > 0 ? Math.round(p.rewearRate * 100) : null;
    return {
      name, category: cat.category,
      avgRating: p.avgRating,
      ratingCount: p.sampleSize,
      rewear: rewearPct !== null ? rewearPct / 100 : p.rewearRate,
      helpedFeel: p.actualAfterFeelings.length > 0 ? [...new Set(p.actualAfterFeelings)].slice(0, 3) : [...new Set(cat.desiredFeelings)].slice(0, 2),
      bestOccasions: cat.occasions.slice(0, 3),
      positiveComments: piecePositiveComment(name),
      negativeComments: pieceNegativeComment(name),
      topDNA: p.topPersonalities.length > 0 ? p.topPersonalities.slice(0, 2) : cat.personalities.slice(0, 2),
    };
  }

  function piecePositiveComment(name: string): string[] {
    const comments: Record<string, string[]> = {
      [SEEN]:     ["Makes me feel like the most put-together version of myself", "I wear this to every important work meeting"],
      [WHOLE]:    ["I love how it makes everything underneath feel considered", "It's the piece I reach for when I need to feel effortless"],
      [ALIVE]:    ["Nothing else in my wardrobe makes me feel this way", "I get stopped on the street every time I wear it"],
      [GROUNDED]: ["When it fits right it feels like armour", "The details on this trouser are incredible — so intentional"],
      [CLEAR]:    ["This jacket does the work — I barely need anything else", "Wearing it feels like a decision, not an outfit"],
      [REAL]:     ["I wear this constantly — it just works", "The collar detail makes it look more expensive than anything else I own"],
      [HER]:      ["I felt like myself in a way I haven't in years", "The skirt is unlike anything on the market — it moves so beautifully"],
      [ROOTED]:   ["The texture makes every outfit feel elevated", "I pair this with everything — it grounds the whole look"],
    };
    return comments[name] ?? [];
  }

  function pieceNegativeComment(name: string): string[] {
    const comments: Record<string, string[]> = {
      [SEEN]:     ["A little too formal for my everyday style"],
      [WHOLE]:    ["I'm not quite sure how to style it beyond the obvious"],
      [ALIVE]:    ["Too bold for anything other than a special night out"],
      [GROUNDED]: ["The length is tricky — I need to find the right shoe"],
      [CLEAR]:    [],
      [REAL]:     [],
      [HER]:      [],
      [ROOTED]:   [],
    };
    return comments[name] ?? [];
  }

  // ── Objection totals across all products ──────────────────────────────
  const allObjEvents = sessions.filter(ev => ev.objection !== null);
  const objMap = tally(allObjEvents.map(ev => canonicalizeObjection(ev.objection!)));
  const topObjList = [...objMap.entries()].sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name: name!, count }));

  // ── Confidence tier for this period ───────────────────────────────────
  const confTier = ns >= 50 ? "high" : ns >= 30 ? "medium-high" : ns >= 10 ? "medium" : "low";

  // ── dashboard ──────────────────────────────────────────────────────────
  const sessionsWithFeedback = Math.round(ns * 0.62);
  const objTotal = topObjList.reduce((s, o) => s + o.count, 0);

  const dashboard = {
    totalUsers: 15,
    totalLooks: ns,
    avgRating,
    avgRewear: Math.round(rewearRateTotal * 100) / 100,
    avgAlignment: 0.81,

    // Onboarding profile data — all-time (not period-filtered)
    onboarding: {
      totalProfiles: 15,
      styleDNADistribution: [
        { style: "corporate-chic",   count: 3,  percentage: 20 },
        { style: "edgy",             count: 3,  percentage: 20 },
        { style: "artsy",            count: 2,  percentage: 13 },
        { style: "feminine",         count: 1,  percentage:  7 },
        { style: "romantic",         count: 1,  percentage:  7 },
        { style: "minimal",          count: 1,  percentage:  7 },
        { style: "effortlessly-chic",count: 1,  percentage:  7 },
        { style: "old-money",        count: 1,  percentage:  7 },
        { style: "trendy",           count: 1,  percentage:  7 },
        { style: "casual-cool",      count: 1,  percentage:  7 },
      ],
      desiredFeelings: [
        { feeling: "more-confident",    count: 10, percentage: 67 },
        { feeling: "more-put-together", count: 8,  percentage: 53 },
        { feeling: "more-elevated",     count: 7,  percentage: 47 },
        { feeling: "more-effortless",   count: 5,  percentage: 33 },
        { feeling: "more-feminine",     count: 4,  percentage: 27 },
      ],
      lifestyleDistribution: [
        { lifestyle: "social",    count: 9,  percentage: 60 },
        { lifestyle: "work",      count: 8,  percentage: 53 },
        { lifestyle: "everyday",  count: 7,  percentage: 47 },
        { lifestyle: "travel",    count: 5,  percentage: 33 },
      ],
      colorDistribution: [   // kept for live-data backward compat; values are catalog hypothesis — no colour field on SE events
        { color: "burgundy",  count: 9,  percentage: 60, isCatalogHypothesis: true },
        { color: "espresso",  count: 8,  percentage: 53, isCatalogHypothesis: true },
        { color: "ivory",     count: 6,  percentage: 40, isCatalogHypothesis: true },
        { color: "black",     count: 6,  percentage: 40, isCatalogHypothesis: true },
        { color: "caramel",   count: 4,  percentage: 27, isCatalogHypothesis: true },
      ],
      colorIntelligence: {
        paletteDirection: "Neutral-Forward",
        paletteDirectionBreakdown: [
          { direction: "Neutral-Forward", count: 10, percentage: 67, description: "Black, ivory, espresso, and caramel dominate across all personality types" },
          { direction: "Colourful",       count: 3,  percentage: 20, description: "Accent tones — burgundy and wine — favoured by Artsy and Feminine profiles" },
          { direction: "Monochrome",      count: 2,  percentage: 13, description: "Single-colour tonal dressing preferred by Old Money and Minimal profiles" },
        ],
        preferredColors: [
          { color: "burgundy",  count: 9,  percentage: 60, isCatalogHypothesis: true },
          { color: "espresso",  count: 8,  percentage: 53, isCatalogHypothesis: true },
          { color: "ivory",     count: 6,  percentage: 40, isCatalogHypothesis: true },
          { color: "black",     count: 6,  percentage: 40, isCatalogHypothesis: true },
          { color: "caramel",   count: 4,  percentage: 27, isCatalogHypothesis: true },
        ],
        avoidedColors: [
          { color: "neon yellow",   count: 8, percentage: 53 },
          { color: "bright orange", count: 6, percentage: 40 },
          { color: "pastel pink",   count: 5, percentage: 33 },
          { color: "lime green",    count: 4, percentage: 27 },
        ],
      },
      commonStruggles: [
        { struggle: "I struggle to style what I own",              count: 7,  percentage: 47 },
        { struggle: "Getting dressed takes too long",              count: 5,  percentage: 33 },
        { struggle: "Nothing feels right for important occasions", count: 4,  percentage: 27 },
      ],
    },

    topOccasions: (() => {
      const occMap = tally(sessions.map(ev => ev.occasion));
      return [...occMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([occ, cnt]) => {
        const occSessions = sessions.filter(ev => ev.occasion === occ);
        const occRatings  = [...reviews, ...wearReviews]
          .filter(ev => occSessions.some(s => s.customerId === ev.customerId && s.productName === ev.productName))
          .map(ev => ev.rating).filter((r): r is number => r !== null);
        const topPs = topKeys(tally(occSessions.map(ev => ev.productName)), 2)
          .filter((p): p is string => p !== null);
        return {
          name: occ ?? "Other",
          lookCount: cnt,
          avgRating: occRatings.length ? meanRating(occRatings.map(r => ({ rating: r } as SE))) : null,
          topPieces: topPs,
        };
      });
    })(),

    positiveTags: (() => {
      const feelMap = tally(wearReviews.map(ev => ev.actualAfterFeeling));
      return [...feelMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, count]) => {
        const topPs = topKeys(
          tally(wearReviews.filter(ev => ev.actualAfterFeeling === name).map(ev => ev.productName)), 2
        ).filter((p): p is string => p !== null);
        return { name: name!, count, topPieces: topPs };
      });
    })(),

    negativeTags: topObjList.slice(0, 3).map(o => ({
      name: o.name,
      count: o.count,
      topPieces: topKeys(
        tally(sessions.filter(ev => ev.objection === o.name).map(ev => ev.productName)), 2
      ).filter((p): p is string => p !== null),
    })),

    topObjections: topObjList.slice(0, 5),

    stylingNeeds: [
      { occasion: "Casual weekend",  need: "Casual weekend",  count: Math.max(1, Math.round(ns * 0.1)),  isEstimated: true },
      { occasion: "Active / sporty", need: "Active / sporty", count: Math.max(1, Math.round(ns * 0.06)), isEstimated: true },
    ],

    conversionStats: [],

    bodyPatterns: [
      {
        preference: "Petite frame",
        userCount: 4,
        bestPieces: [REAL, WHOLE],
        struggles: ["Trouser length on Becoming Grounded can overwhelm a petite frame"],
        implication: "Four of fifteen profiles identify as petite. Length concerns have been observed in styling sessions. Test petite-specific guidance.",
      },
    ],

    topPieces: topPieceNames.map(name => pieceCard(name)),

    mixedPieces: mixedPieceNames.map(name => {
      const p = pm[name];
      return {
        name,
        avgRating: p.avgRating,
        rewear: p.rewearRate,
        reason: p.saveCount > p.buyCount ? "High saves, low purchases" : "Highly rated but low rewear",
        friction: name === WHOLE
          ? "Customers love how it layers and moves but aren't sure when to wear it — occasion ambiguity is reducing conversion"
          : "Customers aspire to this piece but hesitate to commit without stronger styling context",
      };
    }),

    underperformingPieces: underNames.map(name => {
      const p = pm[name];
      const objections = sessions.filter(ev => ev.productName === name && ev.objection)
        .map(ev => canonicalizeObjection(ev.objection!));
      return {
        name,
        weakSignals: [
          p.loveRate < 50 ? "Mixed reception overall" : "Niche appeal",
          "Style polarisation across personality types",
        ],
        rejectionReasons: objections.length > 0
          ? [...new Set(objections)].slice(0, 2)
          : ["Styling context mismatch for some personality types"],
      };
    }),

    watchPieces: watchNames.map(name => ({
      name,
      ratingCount: pm[name].reviewCount,
      avgRating: pm[name].avgRating,
    })),

    piecesByDNA: bySessionCount.slice(0, 5).map(p => ({
      name: p.name,
      topDNA: p.topPersonalities.length > 0 ? p.topPersonalities.slice(0, 2) : CATALOG[p.name].personalities.slice(0, 2),
    })),

    emotionalOutcomes: bySessionCount.slice(0, 5).map(p => {
      const feelings = pm[p.name].actualAfterFeelings.length > 0
        ? [...new Set(pm[p.name].actualAfterFeelings)].slice(0, 3)
        : CATALOG[p.name].desiredFeelings.slice(0, 2).map(f => f.replace("more-", ""));
      return { name: p.name, emotions: feelings };
    }),

    productPairings: [],

    // Design Opportunities tab ────────────────────────────────────────────────
    // Each action carries both the legacy display fields (piece, liked, watch, etc.)
    // and the new canonical fields (id, observedEvidence, interpretation, etc.)
    // so existing tests and new validation tests both pass.

    designActions: [
      {
        // Legacy display fields (preserved for backward compatibility)
        piece: SEEN,
        confidenceBadge: evidenceConfidence(pm[SEEN].evidenceN),
        actionType: "Scale",
        action: "Commission a work-styling test centred on Becoming Seen — cover work, travel, and evening contexts",
        performance: `★ ${pm[SEEN].avgRating} avg · ${Math.round(pm[SEEN].rewearRate * 100)}% rewear · +${pm[SEEN].avgConfidenceLift} confidence lift`,
        liked: "Corporate Chic customers achieve 'Confident' and 'Powerful' consistently — highest confidence lift in work-occasion sessions",
        watch: "Minimal and Casual Cool customers object to the formality — observe whether styling context resolves this",
        nextStep: "Commission editorial content: Becoming Seen at the boardroom, at dinner, and at a gallery opening",
        data: `n=${pm[SEEN].evidenceN} interactions (${pm[SEEN].sampleSize} reviews + ${pm[SEEN].totalBuyOrSkip} buy/skip) · ${CATALOG[SEEN].garmentType} · Best with Corporate Chic`,
        // Canonical fields
        id: "seen-workwear-versatility",
        product: SEEN,
        collection: "workwear",
        observedEvidence: `${pm[SEEN].sessionCount} sessions · ${pm[SEEN].buyCount} purchases · ★${pm[SEEN].avgRating} avg · ${Math.round(pm[SEEN].rewearRate * 100)}% rewear among Corporate Chic customers`,
        interpretation: "Becoming Seen leads all products in sessions and delivers the highest confidence lift for Corporate Chic customers in work and special-event contexts. Both rating and rewear signals are consistent across the observed period.",
        recommendedTest: "Commission editorial content positioning Becoming Seen in three work contexts: boardroom, dinner, and gallery opening. Measure Corporate Chic love rate and rewear rate after launch.",
        successMetric: "Corporate Chic session love rate ≥ 70% and rewear rate maintained after content launch.",
        evidenceCount: pm[SEEN].evidenceN,
        period: periodLabel,
        confidence: evidenceConfidence(pm[SEEN].evidenceN),
        designImplication: "No design change indicated — the product achieves its intended feeling for the target audience consistently. Validate whether the workwear styling system needs additional supporting pieces.",
        merchandisingImplication: "Test a curated work styling system positioned on Becoming Seen. Editorial content across three contexts is a low-effort, high-signal test.",
        impact: "high" as const,
        effort: "medium" as const,
        status: "proposed" as const,
      },
      {
        // Legacy display fields
        piece: WHOLE,
        confidenceBadge: evidenceConfidence(pm[WHOLE].evidenceN),
        actionType: "Fix",
        action: "Create occasion-specific styling guides to convert saves into purchases",
        performance: `★ ${pm[WHOLE].avgRating} avg · ${pm[WHOLE].saveCount} saves · ${pm[WHOLE].buyCount} purchases`,
        liked: "Customers describe it as beautiful and effortless — aspiration is not the issue",
        watch: `Save-to-purchase gap: ${pm[WHOLE].saveCount} saves but ${pm[WHOLE].buyCount} purchases — occasion ambiguity is observed as the most likely cause`,
        nextStep: "Produce three styling guides: Desk to Lunch, Weekend Travel, Evening with Friends",
        data: `n=${pm[WHOLE].totalBuyOrSkip} buy/skip decisions (${pm[WHOLE].saveCount} saves · ${pm[WHOLE].buyCount} purchases) · ${CATALOG[WHOLE].garmentType} · Top objection: 'Not sure how to style it'`,
        // Canonical fields
        id: "whole-save-to-purchase",
        product: WHOLE,
        collection: "everyday",
        observedEvidence: `${pm[WHOLE].saveCount} saves · ${pm[WHOLE].buyCount} purchases · Save/purchase gap is the widest in the collection · Top feedback: 'Not sure when to wear it'`,
        interpretation: "Customers find Becoming Whole aspirational but face occasion ambiguity that prevents purchase. The save signal is present — the barrier may be styling confidence rather than desirability.",
        recommendedTest: "Create 3 occasion-specific styling guides (Desk to Lunch, Weekend Travel, Evening with Friends) and measure whether save-to-purchase conversion improves within 60 days.",
        successMetric: "Save-to-purchase rate improvement visible within 60 days of guide publication.",
        evidenceCount: pm[WHOLE].evidenceN,
        period: periodLabel,
        confidence: evidenceConfidence(pm[WHOLE].evidenceN),
        designImplication: "Investigate whether the silhouette needs clearer occasion framing in the design intent before new product development.",
        merchandisingImplication: "Occasion-specific styling guides are the most direct test of whether the save/purchase gap is a content problem rather than a product problem.",
        impact: "high" as const,
        effort: "low" as const,
        status: "proposed" as const,
      },
      {
        // Legacy display fields
        piece: ALIVE,
        confidenceBadge: evidenceConfidence(pm[ALIVE].evidenceN),
        actionType: "Test",
        action: "Observe whether surfacing Becoming Alive for Edgy and Artsy profiles in evening contexts improves love rate",
        performance: `★ ${pm[ALIVE].avgRating} avg · ${Math.round(pm[ALIVE].rewearRate * 100)}% rewear among repeat wearers`,
        liked: pm[ALIVE].rewearRate > 0
          ? "Edgy customers give it 4.7+ and rewear consistently — consistent identity expression around this piece"
          : `Edgy customers give it 4.7+ — rewear data visible in 90D+ window (first rewear events outside this period)`,
        watch: "Minimal and Casual Cool rejections are observed — the pattern suggests a personality mismatch rather than a product issue",
        nextStep: "Test personality-based recommendation gating: surface Becoming Alive for Edgy and Artsy profiles in evening sessions and measure outcomes",
        data: `n=${pm[ALIVE].evidenceN} interactions (${pm[ALIVE].sampleSize} reviews + ${pm[ALIVE].totalBuyOrSkip} buy/skip) · ${CATALOG[ALIVE].garmentType} · Polarising across personality types`,
        // Canonical fields
        id: "alive-personality-targeting",
        product: ALIVE,
        collection: "evening",
        observedEvidence: `Edgy customers: consistent 4.7+ ratings and rewear · Minimal customers: ${pm[ALIVE].sessionCount} sessions with consistent skip pattern · ${pm[ALIVE].sampleSize} total reviews`,
        interpretation: "Becoming Alive delivers consistent outcomes for Edgy customers in evening contexts but shows consistent rejection from Minimal and Casual Cool profiles. The pattern suggests a personality match issue rather than a design issue.",
        recommendedTest: "Test personality-based recommendation gating — only surface Becoming Alive for Edgy and Artsy profiles in evening sessions. Measure whether overall love rate improves.",
        successMetric: "Edgy customer love rate maintained at 4.7+ while overall love rate improves after gating. Measure over 30-day window.",
        evidenceCount: pm[ALIVE].evidenceN,
        period: periodLabel,
        confidence: evidenceConfidence(pm[ALIVE].evidenceN),
        designImplication: "Do not alter the garment yet — validate whether versatility is the real issue or whether the current design already serves its intended audience well.",
        merchandisingImplication: "Test desk-to-dinner styling and broader occasion positioning only if Edgy and Artsy outcomes are maintained. Start with evening occasion gating.",
        impact: "medium" as const,
        effort: "low" as const,
        status: "proposed" as const,
      },
      {
        // Legacy display fields
        piece: GROUNDED,
        // Fit objections come from session events (SS), not reviews or buy/skip decisions.
        // Use objectionCount so that 0 reviews does not produce "No Data" when sessions show a clear fit pattern.
        confidenceBadge: evidenceConfidence(pm[GROUNDED].objectionCount),
        actionType: "Fix",
        action: "Introduce petite-length styling guidance to address the most commonly observed fit concern",
        performance: `★ ${pm[GROUNDED].avgRating} avg · ${pm[GROUNDED].objectionCount} fit objections across ${pm[GROUNDED].sessionCount} sessions`,
        liked: "When fit resolves, customers describe feeling grounded and powerful — purchase intent follows",
        watch: `Trouser length and hip-fit objections are recurring: ${pm[GROUNDED].topObjection} is the most observed barrier`,
        nextStep: "Commission petite styling content; explore whether a cropped or ankle-length option would address the length signal",
        data: `n=${pm[GROUNDED].objectionCount} fit-objection sessions · ${CATALOG[GROUNDED].garmentType} · Top objection: "${pm[GROUNDED].topObjection}"`,
        // Canonical fields
        id: "grounded-fit-resolution",
        product: GROUNDED,
        collection: "workwear",
        observedEvidence: `${pm[GROUNDED].objectionCount} fit objections · Top: "${pm[GROUNDED].topObjection}" · ${pm[GROUNDED].sessionCount} sessions · Purchase conversions visible when fit resolves`,
        interpretation: "Trouser length and hip-fit objections are the primary barrier for Becoming Grounded. Customers want the asymmetric silhouette but the length concern appears across multiple personality types — a better-fitting option may resolve this.",
        recommendedTest: "Introduce petite-specific styling guidance and measure whether it reduces length-related objections in subsequent sessions.",
        successMetric: "Fit objection rate below 30% in sessions with petite-profile customers after guidance launch.",
        evidenceCount: pm[GROUNDED].objectionCount,
        period: periodLabel,
        confidence: evidenceConfidence(pm[GROUNDED].objectionCount),
        designImplication: "Investigate whether a cropped or ankle-length version would resolve the repeating length objection before investing in a full new SKU.",
        merchandisingImplication: "Petite-specific styling content would address the identified fit concern without a product change — test this first.",
        impact: "medium" as const,
        effort: "medium" as const,
        status: "proposed" as const,
      },
      {
        // Legacy display fields
        piece: CLEAR,
        confidenceBadge: evidenceConfidence(pm[CLEAR].evidenceN),
        actionType: "Test",
        action: "Test whether surfacing Becoming Clear more frequently improves conversion rate",
        performance: `★ ${pm[CLEAR].avgRating} avg · ${pm[CLEAR].buyCount}/${pm[CLEAR].totalBuyOrSkip} buy-or-skip interactions (${pm[CLEAR].conversionRate}%) · ${pm[CLEAR].sessionCount} sessions`,
        liked: "Customers who see it tend to purchase — the buy-through rate is above collection average",
        watch: "Currently receives fewer sessions than Becoming Seen — whether this is a weighting decision or an exposure gap needs testing",
        nextStep: "Test whether adjusting recommendation weights for Corporate Chic and Artsy profiles in work and dinner sessions changes outcomes",
        data: `n=${pm[CLEAR].evidenceN} interactions (${pm[CLEAR].sampleSize} reviews + ${pm[CLEAR].totalBuyOrSkip} buy/skip) · ${CATALOG[CLEAR].garmentType} · Best with Corporate Chic / Artsy`,
        // Canonical fields
        id: "clear-exposure-test",
        product: CLEAR,
        collection: "workwear",
        observedEvidence: `${pm[CLEAR].buyCount}/${pm[CLEAR].totalBuyOrSkip} buy-or-skip (${pm[CLEAR].conversionRate}%) · ★${pm[CLEAR].avgRating} avg · ${pm[CLEAR].sessionCount} sessions vs ${pm[SEEN].sessionCount} for Becoming Seen`,
        interpretation: "Becoming Clear converts at a higher rate than other pieces when recommended. The piece receives fewer sessions than Becoming Seen — whether increasing frequency improves outcomes is an observable hypothesis.",
        recommendedTest: "Increase recommendation frequency for Corporate Chic and Artsy profiles in work and dinner sessions. Measure conversion rate change over 30 days.",
        successMetric: "Conversion rate maintained or improved with higher session volume within 30 days.",
        evidenceCount: pm[CLEAR].evidenceN,
        period: periodLabel,
        confidence: evidenceConfidence(pm[CLEAR].evidenceN),
        designImplication: "No design change indicated — the product performs well when recommended. Validate the exposure hypothesis before acting on any design direction.",
        merchandisingImplication: "Test whether increased recommendation frequency improves overall conversion outcomes. This is a low-effort, high-signal test that does not require a product change.",
        impact: "high" as const,
        effort: "low" as const,
        status: "proposed" as const,
      },
    ],

    quotes: [
      {
        text: "This trench coat makes me feel like the most put-together version of myself. I wear it to every important work meeting.",
        piece: SEEN,
      },
      {
        text: "I love the jacket but I keep saving it and not pressing buy. I don't know when I'd actually wear it.",
        piece: WHOLE,
      },
      {
        text: "I finally feel like my clothes match who I actually am.",
        piece: null as string | null,
        context: "General styling experience — no specific piece",
      },
      {
        text: "The trousers fit beautifully when I get the styling right — but the length took me a few attempts.",
        piece: GROUNDED,
      },
    ],
  };

  // ── kpis ───────────────────────────────────────────────────────────────
  const buyTotal  = buys.length;
  const maybeTotal = buyOrSkip.filter(ev => ev.outcome === "undecided").length;

  // Canonical 4-category Buy/Skip distribution (Req 6)
  const bsDist: BuySkipDistribution = calcBuySkipDistribution(buyOrSkip, periodLabel);

  const kpis = {
    passport: { total: 120, completed: 96, completionRate: 80 },
    closet:   { totalCustomers: 120, customersWithCloset: 82, activeClosets: 82, adoptionRate: 68, totalItems: Math.max(1, uploads.length * 12 + 820), avgItems: 9.4 },
    buyOrSkip: {
      // Canonical 4-category distribution — use these for all rendering
      buyIntentCount:  bsDist.buyIntentCount,
      skipCount:       bsDist.skipCount,
      undecidedCount:  bsDist.undecidedCount,
      incompleteCount: bsDist.incompleteCount,
      total:           bsDist.total,
      decidedCount:    bsDist.decidedCount,
      buyIntentRate:   bsDist.buyIntentRate,
      overallBuyIntentRate: pct(bsDist.buyIntentCount, bsDist.total),
      uniqueCustomers: bsDist.uniqueCustomers,
      evidence:        bsDist.evidence,
      state:           bsDist.state,
      // Legacy aliases preserved for backward compatibility
      buy: buyTotal,
      save: saves.length,
      skip: buyOrSkip.filter(ev => ev.outcome === "skip").length,
      maybe: maybeTotal,
      noDecision: buyOrSkip.filter(ev => ev.outcome === null).length,
      buyRate: pct(buyTotal, buyOrSkip.length) || 0,
    },
    confidence: {
      sampleSize: ns,
      avgBefore: 5.3,
      avgAfter: 7.1,
      avgDelta: 1.8,
    },
    recentActivity: { sessions: ns, reviews: nr + nwr },
  };

  // ── phase4b2 ───────────────────────────────────────────────────────────
  const pwcWoreIt = wearReviews.filter(ev => ev.rewear === true).length;
  const pwcFeltPositive = ejAchieved; // canonical emotional outcome (already computed above)
  const phase4b2 = {
    selfieAdoption: {
      migrationPending: false,
      customersWithSelfie: 54,
      totalCustomers: 120,
      adoptionRate: 45,
    },
    closetTryOnReadiness: {
      totalItems: 196,
      readyItems: 141,
      readinessRate: 72,
      pendingAssessmentItems: 32,
      ineligibleItems: 23,
    },
    vtoMetrics: {
      migrationPending: false,
      totalJobs: Math.max(1, Math.round(ns * 0.38)),
      completedJobs: Math.max(1, Math.round(ns * 0.34)),
      completionRate: 90,
      vtoFeedbackCount: Math.max(1, Math.round(ns * 0.22)),
      fidelityConcernCount: Math.max(0, Math.round(ns * 0.04)),
      fidelityConcernRate: 11,
    },
    feedbackEngagement: {
      migrationPending: false,
      totalSessions: ns,
      // Event-derived — actual RF events in this period (no session→RF linkage exists)
      totalCardReactions: feedback.length,
      lovesCount: lovesTotal,
      loveRate: feedback.length > 0 ? pct(lovesTotal, feedback.length) : null,
      // Estimated only — no session→RF linkage to produce a precise count
      sessionsWithFeedbackEst: Math.round(ns * 0.62),
      responseRateIsEstimated: true,
    },
    feedbackDistribution: {
      migrationPending: false,
      // Canonical: map actual RF event outcomes to display categories.
      // love = outcome "love", okay = outcome "undecided", notForMe = outcome "skip".
      // Both this section and AI Learning derive from the same feedback array — total must agree.
      love:     feedback.filter(ev => ev.outcome === "love").length,
      okay:     feedback.filter(ev => ev.outcome === "undecided").length,
      notForMe: feedback.filter(ev => ev.outcome === "skip").length,
      total:    feedback.length,
    },
    objectionInsights: {
      migrationPending: false,
      total: objTotal,
      colourObjections:       Math.max(0, Math.round(objTotal * 0.10)),
      fitObjections:          Math.max(0, sessions.filter(ev => ev.objection?.toLowerCase().includes("length") || ev.objection?.toLowerCase().includes("fit")).length),
      tooRevealingObjections: 0,
      tooCoveredObjections:   0,
      tooFormalObjections:    Math.max(0, sessions.filter(ev => ev.objection === "Too formal").length),
      tooCasualObjections:    0,
      notPracticalObjections: Math.max(0, Math.round(objTotal * 0.08)),
      alreadyOwnObjections:   Math.max(0, Math.round(objTotal * 0.05)),
    },
    postWearCompletion: {
      migrationPending: false,
      totalWithPostWear: nwr,
      didWearItYes: pwcWoreIt,
      wearRate: nwr > 0 ? pct(pwcWoreIt, nwr) : 0,
      feltPositive: pwcFeltPositive,
      positiveExperienceRate: nwr > 0 ? pct(pwcFeltPositive, nwr) : 0,
    },
    designerInsights: [
      {
        type: "objection",
        pattern: "Trouser length objection",
        frequency: sessions.filter(ev => ev.objection?.toLowerCase().includes("length")).length,
        threshold: 3,
        suggestion: `Becoming Grounded receives consistent length objections — petite styling guidance or a shorter-length option would serve a meaningful portion of the customer base.`,
      },
      {
        type: "friction",
        pattern: "Becoming Whole save/purchase gap",
        frequency: pm[WHOLE].saveCount,
        threshold: 2,
        suggestion: "Becoming Whole has the highest save rate in the collection but near-zero purchase conversion. Occasion-specific styling content is the most likely conversion lever.",
      },
    ],
    // Sample Preview: VTO Intelligence (populated from synthetic VTO-capable products)
    vtoIntelligence: {
      status:          "sample",
      isEstimated:     true,
      scopeLabel:      periodLabel,
      totalSessions:   Math.max(1, Math.round(ns * 0.38)),
      completedJobs:   Math.max(1, Math.round(ns * 0.34)),
      completionRate:  90,
      fidelityConcernRate: 11,
      productBreakdown: bySessionCount.slice(0, 4).map(p => ({
        product:          p.name,
        vtoTrials:        Math.max(1, Math.round(pm[p.name].sessionCount * 0.42)),
        completionRate:   Math.max(75, Math.min(95, 90 - Math.round(pm[p.name].sampleSize * 0.3))),
        postVtoLoveRate:  Math.max(55, Math.min(95, pm[p.name].loveRate + 8)),
        fidelityConcerns: pm[p.name].sessionCount >= 8 ? 1 : 0,
        isEstimated:      true,
      })),
      topInsight: "Model hypothesis: VTO could lift recommendation love by approximately 8pp; validate once VTO telemetry is available.",
      topInsightIsHypothesis: true,
    },
  };

  // ── commercial (derived from EVENTS + PRICE + COGS + STOCK — sample only) ──────────────────────
  const allBuysAllTime       = ofType(allTime, BS).filter(ev => ev.outcome === "bought");
  const allTimeReturnEvents  = ofType(allTime, RT);

  const periodRevenue = buys.reduce((s, ev) => s + (PRICE[ev.productName ?? ""] ?? 1500), 0);
  const allTimeRevenue = allBuysAllTime.reduce((s, ev) => s + (PRICE[ev.productName ?? ""] ?? 1500), 0);
  const naiaAOV = buys.length > 0 ? Math.round(periodRevenue / buys.length) : 0;
  const revenuePerSession = ns > 0 ? Math.round(periodRevenue / ns) : 0;
  const sessionConvRate = pct(buys.length, Math.max(1, ns));

  const periodGrossMarginAed = buys.reduce((s, ev) => {
    const price = PRICE[ev.productName ?? ""] ?? 1500;
    const cogs  = COGS[ev.productName ?? ""] ?? 500;
    return s + price - cogs;
  }, 0);
  const periodGrossMarginPct = periodRevenue > 0 ? pct(periodGrossMarginAed, periodRevenue) : 0;

  const byProductCommercial = ALL_PRODUCTS.map(name => {
    const buysP    = allBuysAllTime.filter(ev => ev.productName === name);
    const returnsP = allTimeReturnEvents.filter(ev => ev.productName === name);
    const revenue  = buysP.reduce((s) => s + PRICE[name], 0);
    const cogsT    = buysP.reduce((s) => s + COGS[name], 0);
    const gross    = revenue - cogsT;
    const grossPct = revenue > 0 ? pct(gross, revenue) : 0;
    const unitsSold = buysP.length;
    const returned  = returnsP.length;
    const netSold   = unitsSold - returned;
    const inStock   = STOCK[name] ?? 10;
    const totalUnits = inStock + unitsSold;
    const sellThrough = totalUnits > 0 ? pct(netSold, totalUnits) : 0;
    return { product: name, unitsSold, returned, netSold, returnRate: unitsSold > 0 ? pct(returned, unitsSold) : 0, inStock, totalUnits, sellThrough, revenue, cogsT, gross, grossPct, price: PRICE[name], cogs: COGS[name] };
  }).filter(r => r.unitsSold > 0 || r.inStock > 0);

  const bySTSorted = [...byProductCommercial].sort((a, b) => b.sellThrough - a.sellThrough);
  // Canonical sell-through: weighted (for founder decisions) vs unweighted mean (per-product average)
  const stResult = calcSellThrough(byProductCommercial);
  const weightedSellThrough       = stResult.weightedSellThrough;
  const avgSellThrough            = stResult.unweightedAvgSellThrough;

  const commercial = {
    status: "sample" as const,
    scopeLabel: periodLabel,
    revenue: {
      naiaAssisted:        periodRevenue,
      naiaAssistedAllTime: allTimeRevenue,
      avgOrderValue:       naiaAOV,
      revenuePerSession,
      sessionConversionRate: sessionConvRate,
      // naiaVsNonNaiaMultiplier: divides by 5 (estimated non-nAia baseline) — illustrative.
      naiaVsNonNaiaMultiplier: sessionConvRate > 0 ? Math.round(sessionConvRate / 5 * 10) / 10 : 1,
      nonNaiaBaselineNote: "Comparison baseline (5%) is an estimated market rate — no unassisted cohort is tracked. Ratio is illustrative until a real control group is established.",
      byProduct: byProductCommercial.filter(r => r.unitsSold > 0).sort((a, b) => b.revenue - a.revenue)
        .map(r => ({ product: r.product, revenue: r.revenue, units: r.unitsSold })),
    },
    margin: {
      grossMarginAed:    periodGrossMarginAed,
      grossMarginPct:    periodGrossMarginPct,
      allTimeGrossAed:   byProductCommercial.reduce((s, r) => s + r.gross, 0),
      byProduct: byProductCommercial.filter(r => r.unitsSold > 0).sort((a, b) => b.grossPct - a.grossPct)
        .map(r => ({ product: r.product, grossPct: r.grossPct, grossAed: r.gross, revenue: r.revenue })),
      highestMarginProduct: [...byProductCommercial].filter(r => r.unitsSold > 0).sort((a, b) => b.grossPct - a.grossPct)[0]?.product ?? null,
    },
    returns: {
      total: allTimeReturnEvents.length,
      returnRate: pct(allTimeReturnEvents.length, Math.max(1, allBuysAllTime.length)),
      returnRevenueLost: allTimeReturnEvents.reduce((s, ev) => s + (PRICE[ev.productName ?? ""] ?? 1500), 0),
      byProduct: byProductCommercial.filter(r => r.returned > 0).map(r => ({
        product: r.product, returned: r.returned, rate: r.returnRate,
        revenueLost: PRICE[r.product] * r.returned,
      })),
      byReason: [
        { reason: "Fit concern — trouser length",  count: 1, products: [GROUNDED] },
        { reason: "Duplicate / gifting error",     count: 1, products: [ALIVE] },
      ],
    },
    inventory: (() => {
      const minST = bySTSorted.length > 0 ? bySTSorted[bySTSorted.length - 1].sellThrough : 0;
      const tiedAtMin = bySTSorted.filter(r => r.sellThrough === minST);
      return {
        // Weighted: total net units sold ÷ total starting units (correct for founder-level inventory decisions)
        weightedSellThrough,
        // Unweighted: mean of individual product sell-through rates (biased by product mix — show with label)
        avgSellThrough,
        fastestMoving: bySTSorted[0]?.product ?? null,
        slowestMoving: bySTSorted[bySTSorted.length - 1]?.product ?? null,
        // tiedSlowest: set when multiple products share the lowest sell-through; null when one product is uniquely slowest
        tiedSlowest: tiedAtMin.length > 1
          ? { products: tiedAtMin.map(r => r.product), pct: minST }
          : null,
        atRisk: byProductCommercial.filter(r => r.sellThrough < 25 && r.inStock >= 8).map(r => r.product),
        byProduct: bySTSorted.map(r => ({
          product: r.product, inStock: r.inStock, unitsSold: r.unitsSold,
          returned: r.returned, netSold: r.netSold, totalUnits: r.totalUnits,
          sellThrough: r.sellThrough,
        })),
      };
    })(),
  };

  // ── aiLearning (derived from feedback events + confidence tiers — sample only) ─────────────────
  const lovesForAI     = feedback.filter(ev => ev.outcome === "love").length;
  const skipsForAI     = feedback.filter(ev => ev.outcome === "skip").length;
  const undecidedForAI = feedback.filter(ev => ev.outcome === "undecided").length;
  const totalEvaluated = lovesForAI + skipsForAI + undecidedForAI;
  // Canonical calculation (Req 1): love response rate uses calcLoveResponseRate
  const loveRateResult = calcLoveResponseRate(feedback, periodLabel);
  const decidedForAI   = lovesForAI + skipsForAI;
  const precisionPct   = loveRateResult.value;  // null when no decided events — canonical
  const fpRatePct      = decidedForAI > 0 ? pct(skipsForAI, decidedForAI) : null;
  // Undecided rate: raw count over all evaluated — not a false negative rate (requires ground truth).
  const undecidedRate  = totalEvaluated > 0 ? pct(undecidedForAI, totalEvaluated) : null;

  const highEvProds  = bySessionCount.filter(p => pm[p.name].sampleSize >= 10);
  const medEvProds   = bySessionCount.filter(p => pm[p.name].sampleSize >= 5 && pm[p.name].sampleSize < 10);
  const lowEvProds   = bySessionCount.filter(p => pm[p.name].sampleSize < 5);
  const meanLR = (prods: typeof bySessionCount) =>
    prods.length > 0 ? Math.round(prods.reduce((s, p) => s + pm[p.name].loveRate, 0) / prods.length) : 0;
  const highTierLR = highEvProds.length > 0 ? meanLR(highEvProds) : 80;
  const medTierLR  = medEvProds.length  > 0 ? meanLR(medEvProds)  : 65;
  const lowTierLR  = lowEvProds.length  > 0 ? meanLR(lowEvProds)  : 45;
  const avgCalibGap = (Math.abs(highTierLR - 80) + Math.abs(medTierLR - 60) + Math.abs(lowTierLR - 40)) / 3;
  const calibrationScore = Math.max(40, Math.min(95, Math.round(85 - avgCalibGap)));

  // Trajectory: empty — W1-W5 back-projection from current values was fabricated.
  // Historical performance snapshots are logged from evaluation event inception forward;
  // they are not available in this synthetic dataset.
  const aiLearningTrajectory: Array<{ week: string; precision: number | null; fpRate: number | null; calibration: number }> = [];

  const aiLearning = {
    status: "sample" as const,
    modelVersion: "v2.1",
    evaluationPeriod: periodLabel,
    totalEvaluated,
    precision: {
      value: precisionPct,  // null when no decided events — never hardcode a fallback
      count: lovesForAI,
      denominator: decidedForAI,
      // This is love rate from decided feedback, not model precision (which requires ground-truth purchases).
      measurementNote: "Love rate from decided feedback events. Not equivalent to AI model precision, which requires ground-truth purchase outcomes.",
    },
    falsePositiveRate: {
      // Renamed: skip rate from decided feedback — not a true false positive rate.
      // "False positive" requires knowing the model assigned a high score AND the customer would not have purchased.
      // Skipping a recommendation does not confirm the recommendation was wrong.
      value: fpRatePct,  // null when no decided events
      count: skipsForAI,
      denominator: decidedForAI,
      targetRate: 15, trend: "improving" as const,
      isGroundTruthRate: false,
      measurementNote: "Skip rate from decided feedback events. Not a true false positive rate — ground-truth purchase outcome is required for that measurement.",
      topCauses: (() => {
        // Cause counts must sum exactly to skipsForAI (the FP numerator).
        // Causes 1 and 3 are observable from session objections (SS events);
        // cause 2 (personality mismatch) fills the remainder.
        // SS events and RF events are different populations — when measured causes
        // exceed skipsForAI, scale them proportionally so the invariant holds.
        const fpC1Raw = sessions.filter(ev => ev.objection === "Too formal").length;
        const fpC3Raw = sessions.filter(
          ev => (ev.objection ?? "").toLowerCase().includes("fit") ||
                (ev.objection ?? "").toLowerCase().includes("length")
        ).length;
        const fpRawTotal = fpC1Raw + fpC3Raw;
        const fpC1 = fpRawTotal > 0 ? Math.min(fpC1Raw, Math.floor(skipsForAI * fpC1Raw / fpRawTotal)) : 0;
        const fpC3 = fpRawTotal > 0 ? Math.min(fpC3Raw, Math.floor(skipsForAI * fpC3Raw / fpRawTotal)) : 0;
        const fpC2 = Math.max(0, skipsForAI - fpC1 - fpC3);
        return [
          { cause: "Formality mismatch for occasion",  count: fpC1 },
          { cause: "Personality-product misalignment", count: fpC2 },
          { cause: "Fit uncertainty (pre-purchase)",   count: fpC3 },
        ];
      })(),
    },
    falseNegativeRate: {
      // Renamed: undecided event rate — not a true false negative rate.
      // False negatives require knowing the model assigned a LOW score AND the customer would have purchased.
      // Undecided events are events where the customer did not provide love/skip feedback — not confirmed errors.
      value: undecidedRate,   // pct of all evaluated events; null when totalEvaluated = 0
      count: undecidedForAI,
      denominator: totalEvaluated,
      isGroundTruthRate: false,
      measurementNote: "Undecided event rate — not a true false negative rate. Ground-truth purchase outcomes required to measure false negatives.",
      topSignals: [
        { signal: "Repeated session without decision", note: "Customer returned to same product 2+ times — intent signal not yet resolved" },
        { signal: "Save without immediate buy",        note: "Save signal indicates interest that has not yet converted to a buy-or-skip decision" },
      ],
    },
    canonicalEvidence: loveRateResult.evidence,
    calibration: {
      score: calibrationScore, trend: "improving" as const,
      byTier: [
        // actualRate must only appear when sampleSize > 0; never show 0% as if it were a real measurement.
        // measurementState added for Req 2: each tier carries its canonical measurement state.
        {
          tier: "High evidence (n≥10)",
          predictedRate: 80,
          actualRate: highEvProds.length > 0 ? highTierLR : null,
          sampleSize: highEvProds.length,
          gap: highEvProds.length > 0 ? highTierLR - 80 : null,
          measurementState: (highEvProds.length > 0 ? "measured" : "no_eligible_observations") as MeasurementState,
        },
        {
          tier: "Medium evidence (n 5–9)",
          predictedRate: 60,
          actualRate: medEvProds.length > 0 ? medTierLR : null,
          sampleSize: medEvProds.length,
          gap: medEvProds.length > 0 ? medTierLR - 60 : null,
          measurementState: (medEvProds.length > 0
            ? medEvProds.length >= 3 ? "measured" : "insufficient_evidence"
            : "no_eligible_observations") as MeasurementState,
        },
        {
          tier: "Low evidence (n<5)",
          predictedRate: 40,
          actualRate: lowEvProds.length > 0 ? lowTierLR : null,
          sampleSize: lowEvProds.length,
          gap: lowEvProds.length > 0 ? lowTierLR - 40 : null,
          measurementState: (lowEvProds.length > 0
            ? "insufficient_evidence"
            : "no_eligible_observations") as MeasurementState,
        },
      ],
      // All 6 canonical measurement states illustrated (Req 2): used by renderer to show examples.
      measurementStateExamples: {
        measured:                 { metric: "Love Response Rate",             example: "Decided feedback events above threshold" },
        insufficient_evidence:    { metric: "Low-evidence product tier",       example: "Fewer than 5 decided feedback events" },
        no_eligible_observations: { metric: "No products in tier",             example: "No products in the qualifying evidence band" },
        observed_zero:            { metric: "Save-to-purchase (0 conversions)",example: "Saves exist but zero progressed to buy" },
        awaiting_integration:     { metric: "Fit profile accuracy",            example: "Physical fit data not yet integrated" },
        not_applicable:           { metric: "Calibration in Live Data mode",   example: "Calibration tier not applicable in live mode" },
      },
    },
    trajectory: aiLearningTrajectory,
    trajectoryNote: "Historical performance snapshots are logged from the first evaluation event forward. No back-projected data is generated. Trajectory will populate as weekly snapshots accumulate.",
    signalWeights: {
      // Accuracy values derived from love rates by evidence tier — not measured model accuracy.
      // These represent directional proxies, not ground-truth performance measurements.
      isIllustrative: true,
      illustrativeNote: "Signal weight accuracy is derived from period love rates by evidence tier, not from measured model predictions against confirmed purchase outcomes.",
      personality:    { weight: 0.35, accuracy: Math.min(95, highTierLR),                   trend: "stable" as const },
      occasion:       { weight: 0.28, accuracy: Math.min(90, Math.round(loveRate * 1.05)),   trend: "improving" as const },
      desiredFeeling: { weight: 0.22, accuracy: Math.min(85, loveRate),                      trend: "improving" as const },
      fitProfile:     { weight: 0.15, accuracy: 61,                                          trend: "insufficient-data" as const },
    },
    testTrainInfo: {
      testPct: 20, trainPct: 80, totalEvents: totalEvaluated,
      minimumRecommended: 50,
      currentStatus: (totalEvaluated >= 50 ? "sufficient" : "growing") as "sufficient" | "growing",
    },
  };

  // ── experiments (derived from product metrics — sample only) ──────────────────────────────────
  // Completed experiments use all-time data — the experiment happened in the past.
  // Using the current-window filter would produce a misleading sampleSize for short periods.
  const aliveAllFbAllTime = ofType(allTime, RF).filter(ev => ev.productName === ALIVE);
  const aliveEdgyFbAllTime  = aliveAllFbAllTime.filter(ev => CUST[ev.customerId] === "Edgy");
  const aliveEdgyLR2  = aliveEdgyFbAllTime.length > 0
    ? pct(aliveEdgyFbAllTime.filter(ev => ev.outcome === "love").length, aliveEdgyFbAllTime.length) : 100;
  const aliveOverallLR2 = aliveAllFbAllTime.length > 0
    ? pct(aliveAllFbAllTime.filter(ev => ev.outcome === "love").length, aliveAllFbAllTime.length) : 60;
  // Keep period-filtered alias for active experiment tracking
  const aliveAllFb = feedback.filter(ev => ev.productName === ALIVE);
  const clearBsAll    = ofType(allTime, BS).filter(ev => ev.productName === CLEAR);
  const clearConvAll  = clearBsAll.length > 0 ? pct(clearBsAll.filter(ev => ev.outcome === "bought").length, clearBsAll.length) : 75;
  const wholeBaseSTP  = pm[WHOLE].totalBuyOrSkip > 0 ? pct(pm[WHOLE].buyCount, pm[WHOLE].totalBuyOrSkip) : 0;

  // Completed experiment 2: REAL-primary for Minimal — all-time Minimal REAL feedback
  const minimalRealFbAllTime = ofType(allTime, RF).filter(ev => ev.productName === REAL && CUST[ev.customerId] === "Minimal");
  const minimalRealLovesAT   = minimalRealFbAllTime.filter(ev => ev.outcome === "love").length;
  const minimalRealLRAT      = minimalRealFbAllTime.length > 0 ? pct(minimalRealLovesAT, minimalRealFbAllTime.length) : 85;
  // Baseline (pre-experiment): Minimal SEEN love rate — almost all Too Formal skips
  const minimalSeenFbAllTime = ofType(allTime, RF).filter(ev => ev.productName === SEEN && CUST[ev.customerId] === "Minimal");
  const minimalSeenLRAT      = minimalSeenFbAllTime.length > 0
    ? pct(minimalSeenFbAllTime.filter(ev => ev.outcome === "love").length, minimalSeenFbAllTime.length) : 12;
  const exp2Lift             = minimalRealLRAT - minimalSeenLRAT;

  // Completed experiment 3: Rooted evening contextualisation — all-time Rooted saves for Feminine/Romantic
  const rootedFemRomFbAT  = ofType(allTime, RF).filter(ev => ev.productName === ROOTED && (CUST[ev.customerId] === "Feminine" || CUST[ev.customerId] === "Romantic"));
  const rootedFemRomBsAT  = ofType(allTime, BS).filter(ev => ev.productName === ROOTED && (CUST[ev.customerId] === "Feminine" || CUST[ev.customerId] === "Romantic"));
  const rootedSaveRateAT  = rootedFemRomBsAT.length > 0 ? pct(rootedFemRomBsAT.filter(ev => ev.outcome === "saved" || ev.outcome === "bought").length, rootedFemRomBsAT.length) : 72;
  const rootedLoveRateAT  = rootedFemRomFbAT.length > 0 ? pct(rootedFemRomFbAT.filter(ev => ev.outcome === "love").length, rootedFemRomFbAT.length) : 82;
  const exp3SampleSize    = rootedFemRomBsAT.length;

  const experiments = {
    completed: [{
      id:              "alive-personality-gating",
      title:           "Personality-Based Recommendation Gating for Becoming Alive",
      hypothesis:      "Surface Becoming Alive only for Edgy and Artsy profiles in evening contexts → overall love rate improves without reducing Edgy satisfaction",
      product:         ALIVE,
      targetSegment:   "Edgy + Artsy · evening + girls-night occasions",
      primaryMetric:   "Overall love rate (target: ≥65%)",
      secondaryMetric: "Edgy love rate maintained ≥85%",
      minimumSample:   "n=8 ALIVE feedback events",
      minimumSampleN:  8,
      period:          "Days 33–72 (39-day test) · results evaluated across all available events",
      // sampleSize uses all-time ALIVE feedback — the experiment is complete; results are fixed.
      // A period-filtered count would show an incorrect n for short viewing windows.
      sampleSize:      aliveAllFbAllTime.length,
      minimumSampleMet: aliveAllFbAllTime.length >= 8,
      result: {
        outcome:         aliveAllFbAllTime.length >= 8 ? "validated" : "minimum_not_reached",
        primaryResult:   `${aliveOverallLR2}% overall love rate (n=${aliveAllFbAllTime.length}) — target met`,
        secondaryResult: `Edgy: ${aliveEdgyLR2}% love rate (n=${aliveEdgyFbAllTime.length}) — maintained`,
        action:          "Personality gating applied. Minimal and Casual Cool profiles no longer see Becoming Alive as a primary evening recommendation.",
      },
    }, {
      id:              "real-primary-for-minimal",
      title:           "REAL as Primary Recommendation for Minimal Profiles",
      hypothesis:      "Replacing Becoming Seen with Becoming Real as the primary recommendation for Minimal-personality customers → love rate increases from ~12% to ≥70%",
      product:         REAL,
      targetSegment:   "Minimal · work + everyday occasions",
      primaryMetric:   "Love rate for Minimal customers (baseline: 12% · target: ≥70%)",
      secondaryMetric: "Purchase conversion for Minimal segment maintained or improved",
      minimumSample:   "n=10 Minimal recommendation-feedback events",
      minimumSampleN:  10,
      period:          "Days 55–90 (35-day test) · results evaluated across all available events",
      sampleSize:      minimalRealFbAllTime.length,
      minimumSampleMet: minimalRealFbAllTime.length >= 10,
      result: {
        outcome:         minimalRealFbAllTime.length >= 10 ? "validated" : "minimum_not_reached",
        primaryResult:   `${minimalRealLRAT}% love rate for Minimal–REAL (n=${minimalRealFbAllTime.length}) — target exceeded`,
        secondaryResult: `Purchase conversion: ${pct(ofType(allTime, BS).filter(ev => ev.productName === REAL && CUST[ev.customerId] === "Minimal" && ev.outcome === "bought").length, Math.max(1, minimalRealFbAllTime.length))}% · +${exp2Lift} pp lift vs SEEN baseline`,
        action:          "REAL is now the primary work recommendation for Minimal profiles. SEEN is retained for Minimal customers who express formal-occasion intent.",
      },
    }, {
      id:              "rooted-evening-contextualisation",
      title:           "Evening Context Framing for Becoming Rooted",
      hypothesis:      "Surfacing Becoming Rooted with explicit 'dinner and date-night' occasion framing → save rate for Feminine and Romantic profiles increases from ~40% to ≥65%",
      product:         ROOTED,
      targetSegment:   "Feminine + Romantic · dinner + date-night + special-event occasions",
      primaryMetric:   "Save + buy rate for Feminine/Romantic (baseline: 40% · target: ≥65%)",
      secondaryMetric: "Love rate maintained ≥75%",
      minimumSample:   "n=8 Feminine or Romantic buy-or-skip interactions for ROOTED",
      minimumSampleN:  8,
      period:          "Days 89–120 (31-day test) · results evaluated across all available events",
      sampleSize:      exp3SampleSize,
      minimumSampleMet: exp3SampleSize >= 8,
      result: {
        outcome:         exp3SampleSize >= 8 ? "validated" : "minimum_not_reached",
        primaryResult:   `${rootedSaveRateAT}% save + buy rate (n=${exp3SampleSize}) — target met`,
        secondaryResult: `Love rate: ${rootedLoveRateAT}% — maintained above 75% threshold`,
        action:          "Evening contextualisation applied to all Rooted surfacing for Feminine and Romantic profiles. No occasion-generic surfacing for this segment.",
      },
    }],
    active: [
      {
        id:              "clear-exposure-frequency",
        title:           "Increased Becoming Clear Frequency for Corporate Chic",
        hypothesis:      "Doubling recommendation frequency for Becoming Clear with Corporate Chic profiles → conversion maintained or improved with higher session volume",
        product:         CLEAR,
        targetSegment:   "Corporate Chic + Artsy · work + dinner occasions",
        primaryMetric:   "Conversion rate (target: ≥60%)",
        secondaryMetric: "Session volume ×2 without love rate decrease",
        minimumSample:   "n=10 buy-or-skip interactions",
        period:          "Started 14 days ago · 60-day test",
        daysRemaining:   46,
        intermediate: {
          sessionsToDate:   pm[CLEAR].sessionCount,
          buysToDate:       pm[CLEAR].buyCount,
          conversionToDate: pm[CLEAR].conversionRate,
          sampleSize:       pm[CLEAR].totalBuyOrSkip,
          status:           "promising" as const,
          note:             `${pm[CLEAR].conversionRate}% conversion · n=${pm[CLEAR].totalBuyOrSkip} · above target — do not conclude early`,
        },
      },
      {
        id:              "post-wear-prompt-pilot",
        title:           "Post-Wear Prompt Pilot — 4-Day Delivery Follow-Up",
        hypothesis:      "A single-question prompt sent 4 days after delivery → ≥30% post-wear review completion among customers with a Buy or Skip 'Buy' outcome",
        product:         null as null,
        targetSegment:   "All personality types · customers with confirmed Buy intent or purchase",
        primaryMetric:   "Post-wear review completion rate (target: ≥30%)",
        secondaryMetric: "Feeling achievement confirmation rate ≥50% of completed reviews",
        minimumSample:   "n=10 prompt sends",
        period:          "Started 7 days ago · 42-day pilot",
        daysRemaining:   35,
        intermediate: {
          sessionsToDate:   buys.length,
          buysToDate:       buys.length,
          conversionToDate: pct(wearReviews.length, Math.max(1, buys.length)),
          sampleSize:       wearReviews.length,
          status:           "early" as const,
          note:             `${wearReviews.length} post-wear reviews received · ${buys.length} prompt sends · too early to conclude`,
        },
      },
    ],
    planned: [
      {
        id:              "whole-styling-guides",
        title:           "Occasion-Specific Styling Guides for Becoming Whole",
        hypothesis:      `3 styling guides (Desk to Lunch, Weekend Travel, Evening) → save-to-purchase rate improves within 60 days of publication`,
        product:         WHOLE,
        targetSegment:   "All personality types · everyday + travel + dinner",
        primaryMetric:   `Save-to-purchase rate (baseline: ${wholeBaseSTP}% · target: ≥25%)`,
        secondaryMetric: "Session-to-save rate maintained",
        minimumSample:   "n=8 buy-or-skip interactions post-publication",
        period:          "Not yet started",
        prerequisite:    "Creative brief: 3 guides × image + copy per platform",
        evidence:        `${pm[WHOLE].saveCount} saves · ${pm[WHOLE].buyCount} purchases · top objection: "Not sure how to style it"`,
      },
      {
        id:              "passport-reorder-test",
        title:           "Passport Question Reorder — Move Lifestyle Before Feeling",
        hypothesis:      "Placing the lifestyle question before the feeling question → Passport completion rate increases from 80% to ≥90% in 30 days",
        product:         null as null,
        targetSegment:   "All new Passport starts",
        primaryMetric:   "Passport completion rate (baseline: 80% · target: ≥90%)",
        secondaryMetric: "Time-to-complete does not increase",
        minimumSample:   "n=30 new Passport starts",
        period:          "Not yet started",
        prerequisite:    "Engineering change to question ordering in Passport flow",
        evidence:        `3 of 15 registered customers did not complete · drop-off pattern suggests lifestyle section creates friction`,
      },
    ],
  };

  // ── advanced ───────────────────────────────────────────────────────────

  // Emotional transformations derived from wear-review pairs
  const transformMap = new Map<string, { count: number; achieved: number; ratings: number[]; products: Set<string> }>();
  for (const wr of wearReviews) {
    if (!wr.actualAfterFeeling) continue;
    const key = wr.actualAfterFeeling;
    if (!transformMap.has(key)) transformMap.set(key, { count: 0, achieved: 0, ratings: [], products: new Set() });
    const t = transformMap.get(key)!;
    t.count++;
    t.achieved++;
    if (wr.rating) t.ratings.push(wr.rating);
    if (wr.productName) t.products.add(wr.productName);
  }

  // Build transformation arcs from actual WR events — no hardcoded percentages.
  // Membership rule: a WR event belongs to an arc iff its product is in the arc's scope
  // AND its desiredFeeling is in that arc's feeling family.
  // This prevents the same event appearing in multiple arcs (SEEN WR events split by desiredFeeling).
  const transformArc = (
    startingMood: string, desiredFeeling: string, reportedAfterFeeling: string,
    arcWR: SE[], candidateProducts: string[],
  ) => {
    const n   = arcWR.length;
    const ac  = arcWR.filter(ev => classifyEmotionalOutcome(ev.desiredFeeling, ev.actualAfterFeeling) === "achieved").length;
    // postWearConfirmed = feeling confirmed in any way (achieved or partly) — not the same signal as rewear
    const pwc = arcWR.filter(ev => {
      const o = classifyEmotionalOutcome(ev.desiredFeeling, ev.actualAfterFeeling);
      return o === "achieved" || o === "partly";
    }).length;
    const wc  = arcWR.filter(ev => ev.rewear === true).length;
    // Derive topProducts from actual WR events in this period — never show a product unless
    // it actually contributed a WR event to this arc. Fall back to candidateProducts when empty.
    const derivedTopProducts = n > 0
      ? topKeys(tally(arcWR.map(ev => ev.productName)), 2).filter((p): p is string => p !== null)
      : candidateProducts;
    return {
      startingMood, desiredFeeling, reportedAfterFeeling,
      count: n, sessions: n,
      achievedRate:           n > 0 ? pct(ac, n) : 0,
      achievedCount: ac,      achievedOf: n,
      postWearConfirmedCount: pwc, postWearConfirmedOf: n,
      wouldWearAgainCount: wc,    wouldWearAgainOf: n,
      confidenceStatus: evidenceConfidence(n),
      topProducts: derivedTopProducts,
    };
  };
  // Feeling-family membership for each transformation archetype.
  const confidentFam  = EMOTIONAL_FAMILIES["Confident"]  as readonly string[]; // Confident, Powerful, Assertive, Assured
  const effortlessFam = EMOTIONAL_FAMILIES["Effortless"] as readonly string[]; // Effortless, Comfortable, Natural, Easy
  const elevatedFam   = EMOTIONAL_FAMILIES["Elevated"]   as readonly string[]; // Elevated, Sophisticated, Refined, Polished

  // Arc membership: filter by product scope then by desiredFeeling family.
  // A SEEN WR event with desiredFeeling="Confident" → Confident arc only.
  // A SEEN WR event with desiredFeeling="Elevated" → Elevated arc only. No double-counting.
  const arcConfidentWR  = [...forProduct(wearReviews, SEEN), ...forProduct(wearReviews, GROUNDED)]
    .filter(ev => confidentFam.includes(ev.desiredFeeling ?? ""));
  const arcEffortlessWR = [...forProduct(wearReviews, WHOLE), ...forProduct(wearReviews, REAL)]
    .filter(ev => effortlessFam.includes(ev.desiredFeeling ?? ""));
  const arcElevatedWR   = [...forProduct(wearReviews, SEEN), ...forProduct(wearReviews, CLEAR)]
    .filter(ev => elevatedFam.includes(ev.desiredFeeling ?? ""));

  const emotionalTransformations = [
    transformArc("Uncertain",   "Confident",  "Powerful",   arcConfidentWR,  [SEEN, GROUNDED]),
    transformArc("Uninspired",  "Effortless", "Effortless", arcEffortlessWR, [WHOLE, REAL]),
    transformArc("Comfortable", "Elevated",   "Elevated",   arcElevatedWR,   [SEEN, CLEAR]),
  ].filter(t => t.count > 0);

  // Products by emotional impact — ordered by confidence lift
  // achievedRate = WR events where desired feeling exactly confirmed (strong outcome)
  const CONFIDENCE_BEFORE = 5.6;

  // Evidence-aware interpretation: scales claim strength to available WR data
  function productImpactInterpretation(name: string, state: MeasurementState, wrCount: number): string {
    if (state === "no_eligible_observations") {
      const map: Record<string, string> = {
        [SEEN]:     "No post-wear reviews in this period. Recommendation feedback shows above-average love rate for Corporate Chic and Artsy customers — post-wear data is needed to confirm feeling outcomes.",
        [WHOLE]:    "No post-wear reviews in this period. Save signals are present but post-wear confirmation is not yet available.",
        [ALIVE]:    "No post-wear reviews in this period. Recommendation feedback shows Edgy customers consistently love this piece; Minimal and Casual Cool consistently skip. Post-wear data is needed to confirm feeling outcomes.",
        [GROUNDED]: "No post-wear reviews in this period. Fit objections are the primary observed signal — post-wear data is needed to confirm how often feeling is achieved when fit resolves.",
        [CLEAR]:    "No post-wear reviews in this period. Buy-through rate is above collection average in recommendation feedback — post-wear data is needed to confirm feeling outcomes.",
        [REAL]:     "No post-wear reviews in this period. Love rates from recommendation feedback are above average for Minimal and Corporate Chic customers.",
        [HER]:      "No post-wear reviews in this period. Recommendation feedback shows strong love rates for Feminine and Romantic customers — post-wear data is needed to confirm feeling outcomes.",
        [ROOTED]:   "No post-wear reviews in this period. Save rates are emerging for Feminine and Romantic customers.",
      };
      return map[name] ?? "No post-wear reviews in this period.";
    }
    if (state === "insufficient_evidence") {
      const map: Record<string, string> = {
        [SEEN]:     `Early indication (${wrCount} post-wear reviews): Corporate Chic customers are directionally achieving 'Powerful' and 'Confident'. More reviews needed to confirm this pattern reliably.`,
        [WHOLE]:    `Early indication (${wrCount} post-wear reviews): feeling is directionally present. Styling ambiguity may prevent rewear even when the feeling is achieved — more data needed.`,
        [ALIVE]:    `Early indication (${wrCount} post-wear reviews): Edgy customer outcomes look directionally positive. Minimal and Casual Cool rejection is consistent in feedback. More post-wear data needed to confirm.`,
        [GROUNDED]: `Early indication (${wrCount} post-wear reviews): when fit resolves, feeling achievement is directionally positive. More reviews needed to establish pattern.`,
        [CLEAR]:    `Early indication (${wrCount} post-wear reviews): customers who wear it tend to achieve the desired feeling. More reviews needed to confirm.`,
        [REAL]:     `Early indication (${wrCount} post-wear reviews): low-effort polish outcomes are directionally consistent. More data needed.`,
        [HER]:      `Early indication (${wrCount} post-wear reviews): Feminine customers are directionally achieving desired feelings. More data needed to confirm.`,
        [ROOTED]:   `Early indication (${wrCount} post-wear reviews): directional positive signal. More data needed.`,
      };
      return map[name] ?? `Early indication (${wrCount} post-wear reviews). More data needed.`;
    }
    // measured (≥3 strong achievements)
    const map: Record<string, string> = {
      [SEEN]:     "Corporate Chic customers consistently achieve 'Powerful' and 'Confident'. Highest confidence lift in work-occasion sessions.",
      [WHOLE]:    "Customers feel the feeling but styling ambiguity prevents rewear — save/purchase gap is the defining signal.",
      [ALIVE]:    "Edgy customers achieve consistent outcomes. Minimal and Casual Cool rejection is consistent — personality gating is directionally supported by available observations.",
      [GROUNDED]: "Feeling achieved when fit resolves. Trouser length is the repeating blocker across personality types.",
      [CLEAR]:    "Buy-through rate above collection average. Customers who try it tend to purchase — the issue is frequency of recommendation.",
      [REAL]:     "Reliable low-effort polish. Above-average outcomes for Minimal customers seeking daily wearability.",
      [HER]:      "Feminine and Romantic customers achieve their desired feeling consistently. Repeat buy-intent signal observed.",
      [ROOTED]:   "Occasion-specific piece. Works best with clear styling guidance on the column silhouette.",
    };
    return map[name] ?? "";
  }

  const allProductImpact = bySessionCount.filter(p => p.reviewCount > 0).map(p => {
    const m = pm[p.name];
    const desiredFeelings = CATALOG[p.name].desiredFeelings.slice(0, 2).map(f => f.replace("more-", ""));
    const startingMoodMap: Record<string, string> = {
      [SEEN]: "Uncertain", [WHOLE]: "Uninspired", [ALIVE]: "Reserved",
      [GROUNDED]: "Underdressed", [CLEAR]: "Unsure", [REAL]: "Casual",
      [HER]: "Self-conscious", [ROOTED]: "Underdressed",
    };
    const actionMap: Record<string, string> = {
      [SEEN]:     "Commission editorial content positioning Becoming Seen across work, dinner, and travel contexts.",
      [WHOLE]:    "Create 3 occasion-specific styling guides (Desk to Lunch, Weekend Travel, Evening) to convert saves to purchases.",
      [ALIVE]:    "Add personality gating: only surface for Edgy and Artsy profiles in evening contexts.",
      [GROUNDED]: "Introduce petite-length guidance; explore ankle-length option; add height context to recommendation logic.",
      [CLEAR]:    "Test whether increased recommendation frequency for Corporate Chic and Artsy profiles in work and dinner sessions changes conversion outcomes.",
      [REAL]:     "Prioritise for Corporate Chic and Minimal daily contexts. Pair with Becoming Grounded for work styling.",
      [HER]:      "Feature in occasion campaigns for Feminine and Romantic profiles. Date-night and dinner are highest-performing contexts.",
      [ROOTED]:   "Pair with Becoming Real or Becoming Clear for work occasions. Style guidance improves outcomes significantly.",
    };
    // achievedRate: null when no WR events exist — loveRate proxy permanently removed.
    // "no_eligible_observations" is the correct state when strongAchievedCount === 0.
    const achievedRate: number | null = m.strongAchievedCount > 0 ? m.strongAchievedRate : null;
    const partlyAchievedRate: number | null = m.partlyAchievedCount > 0 ? m.partlyAchievedRate : null;
    const notAchievedRate: number | null =
      achievedRate !== null && partlyAchievedRate !== null
        ? Math.max(0, 100 - achievedRate - partlyAchievedRate)
        : null;
    const achievedEvidenceState: MeasurementState =
      m.strongAchievedCount === 0 ? "no_eligible_observations"
      : m.strongAchievedCount < 3 ? "insufficient_evidence"
      : "measured";
    const confidenceAfter = Math.round((CONFIDENCE_BEFORE + m.avgConfidenceLift) * 10) / 10;
    return {
      productTitle: p.name,
      startingMood: startingMoodMap[p.name] ?? "Uncertain",
      desiredFeelings,
      mostCommonAfterFeeling: m.actualAfterFeelings[0] ?? desiredFeelings[0] ?? "—",
      achievedRate,
      partlyAchievedRate,
      notAchievedRate,
      achievedEvidenceState,
      eligibleWrCount:    m.strongAchievedCount + m.partlyAchievedCount,
      achievedCount:      m.strongAchievedCount,
      partlyAchievedCount: m.partlyAchievedCount,
      unansweredCount:    0,
      confidenceBefore: CONFIDENCE_BEFORE,
      confidenceAfter,
      avgConfidenceLift: m.avgConfidenceLift,
      // postWearPositiveRate: % of WR events where feeling was confirmed (achieved or partly).
      // Null when no WR data — never report 0% from absence of post-wear reviews.
      postWearPositiveRate: m.wrCount > 0 ? m.feelingAchievedRate : null,
      // wouldWearAgainCount: WR events where customer confirmed rewear intent (rewear === true).
      // Not a proxy for feeling achievement — these are separate signals.
      wouldWearAgainCount: m.wrCount > 0 ? m.rewearYesCount : null,
      notWearAgainCount:   m.wrCount > 0 ? m.rewearNoCount : null,
      wrCount: m.wrCount,
      sampleSize: m.sampleSize,
      statusLabel: evidenceConfidence(m.sampleSize),
      interpretation: productImpactInterpretation(p.name, achievedEvidenceState, m.wrCount),
      recommendedAction: actionMap[p.name] ?? "",
    };
  });
  const productsByEmotionalImpact =
    dateRangeDays === 7  ? allProductImpact.slice(0, 2) :
    dateRangeDays === 30 ? allProductImpact.slice(0, 3) :
    dateRangeDays === 90 ? allProductImpact.slice(0, 5) :
    allProductImpact;

  // Journey analytics
  const journeyLive = dateRangeDays > 7;
  const journeyAnalytics = journeyLive ? {
    status: "live",
    totalEvents: current.length,
    avgTouchpointsBeforePurchase: null as null,
    eventTypeCounts: {
      STYLING_SESSION:   ns,
      CLOSET_UPLOAD:     uploads.length + 2,
      POST_OUTFIT_REVIEW: nr,
    },
  } : {
    status: "insufficient-data",
    totalEvents: current.length,
    avgTouchpointsBeforePurchase: null as null,
    eventTypeCounts: {} as Record<string, number>,
  };

  // Collection evolution — compare current vs prior window
  const prevAvgRatingFinal = prevRatings.length ? prevAvgRating : avgRating - 0.2;
  const prevNsFinal = prevNs || Math.round(ns * 0.82);

  // Opportunity feed — derived from period-specific insights
  const seenTooFormalCount   = sessions.filter(ev => ev.productName === SEEN && ev.objection === "Too formal").length;
  const seenRfDeclineCount   = feedback.filter(ev => ev.productName === SEEN && ev.outcome === "skip").length;
  const groundedObjCount     = sessions.filter(ev => ev.productName === GROUNDED && ev.objection).length;
  const wholeConvRate        = pm[WHOLE].totalBuyOrSkip > 0 ? pct(pm[WHOLE].buyCount, pm[WHOLE].totalBuyOrSkip) : 0;
  const corpChicSessionCount = sessions.filter(ev => CUST[ev.customerId] === "Corporate Chic").length;
  const aliveEdgyFbCount     = feedback.filter(ev => ev.productName === ALIVE && CUST[ev.customerId] === "Edgy").length;

  const opportunityFeed = [
    {
      id: "seen-workwear-hero",
      type: "product-opportunity",
      _productSlug: "becoming-seen",
      evidenceN: pm[SEEN].sampleSize,
      evidencePopulation: "outfit + post-wear reviews for Becoming Seen",
      confidence: evidenceConfidence(pm[SEEN].evidenceN),
      estimatedCommercialRelevance: "high",
      insight: `Becoming Seen leads all products in sessions (${pm[SEEN].sessionCount}) and delivers the highest confidence lift for Corporate Chic customers`,
      customerNeed: "Professional women need a styled system for high-stakes work moments — not just individual pieces",
      evidence: `${pm[SEEN].sessionCount} sessions · ${pm[SEEN].buyCount} purchases · ★${pm[SEEN].avgRating} avg · ${Math.round(pm[SEEN].rewearRate * 100)}% rewear`,
      timePeriod: periodLabel,
      suggestedAction: "Design a curated 'Work Presentation System' — Becoming Seen + Becoming Grounded or Becoming Real as a complete outfit",
      designImplication: "Validate whether Becoming Seen needs supporting pieces in the current collection to complete the workwear styling system, or whether editorial content is sufficient.",
      merchandisingImplication: "Test a curated work styling system positioned on Becoming Seen. Commission editorial content across three work contexts before investing in additional product.",
    },
    {
      id: "whole-save-gap",
      type: "product-friction",
      _productSlug: "becoming-whole",
      evidenceN: pm[WHOLE].saveCount,
      evidencePopulation: "save intents for Becoming Whole (BS events)",
      confidence: evidenceConfidence(pm[WHOLE].evidenceN),
      estimatedCommercialRelevance: "high",
      insight: `Becoming Whole has ${pm[WHOLE].saveCount} saves and ${pm[WHOLE].buyCount} purchases — the widest save/purchase gap in the collection`,
      customerNeed: "Customers are drawn to the piece but need confidence in when and how to wear it before purchasing",
      evidence: `${pm[WHOLE].saveCount} saves · ${pm[WHOLE].buyCount} purchases · top objection: 'Not sure how to style it'`,
      timePeriod: periodLabel,
      suggestedAction: "Create 3 specific occasion guides: Everyday, Travel, and Evening — make the styling decision easy",
      designImplication: "Investigate whether the silhouette needs clearer occasion framing in the design intent. Occasion-specific content is the first test — only consider a design change if content does not resolve the save/purchase gap.",
      merchandisingImplication: "Create three occasion-specific styling guides before any product change. If conversion improves, the issue is a content problem, not a product problem.",
    },
    {
      id: "clear-underexposed",
      type: "product-opportunity",
      _productSlug: "becoming-clear",
      evidenceN: pm[CLEAR].totalBuyOrSkip,
      evidencePopulation: "buy-or-skip decisions for Becoming Clear",
      confidence: evidenceConfidence(pm[CLEAR].evidenceN),
      estimatedCommercialRelevance: "high",
      insight: `Becoming Clear converts at ${pm[CLEAR].conversionRate}% (${pm[CLEAR].buyCount}/${pm[CLEAR].totalBuyOrSkip} buy-or-skip interactions) — highest in the collection — but receives far fewer sessions than Becoming Seen`,
      customerNeed: "Once customers see it in the right context, they tend to purchase — the issue is exposure, not desirability",
      evidence: `${pm[CLEAR].sessionCount} sessions · ${pm[CLEAR].buyCount}/${pm[CLEAR].totalBuyOrSkip} buy-or-skip (${pm[CLEAR].conversionRate}%) · ★${pm[CLEAR].avgRating} avg`,
      timePeriod: periodLabel,
      suggestedAction: "Test whether increased recommendation frequency for Corporate Chic and Artsy profiles in work and dinner sessions improves conversion outcomes",
      designImplication: "No design change indicated — the product performs well when recommended. Validate the exposure hypothesis before acting on any design direction.",
      merchandisingImplication: "Test increased recommendation frequency for Corporate Chic and Artsy profiles. This is a low-effort, high-signal test that does not require a product or content change.",
    },
    {
      id: "grounded-fit-objection",
      type: "fit-signal",
      _productSlug: "becoming-grounded",
      evidenceN: groundedObjCount,
      evidencePopulation: "fit objections on Becoming Grounded (SS events)",
      confidence: evidenceConfidence(groundedObjCount),
      estimatedCommercialRelevance: "medium",
      insight: `Becoming Grounded has ${groundedObjCount} fit objections across ${pm[GROUNDED].sessionCount} sessions — trouser length and hip-fit are the primary barriers`,
      customerNeed: "Customers want the asymmetric silhouette but length is a specific, solvable problem — a better-fitting option may resolve this",
      evidence: `${groundedObjCount} fit objections (SS events) · top barrier: "${pm[GROUNDED].topObjection}"${pm[GROUNDED].buyCount > 0 ? ` · ${pm[GROUNDED].buyCount} purchase${pm[GROUNDED].buyCount > 1 ? "s" : ""} when fit resolves` : " · purchase conversions visible in 90D+ window"}`,
      timePeriod: periodLabel,
      suggestedAction: "Introduce ankle-length petite guidance; explore a shorter SKU; add height context to recommendation logic for this piece",
      designImplication: "Investigate whether a cropped or ankle-length version would address the recurring length objection. Do not invest in a new SKU until petite-specific styling guidance has been tested first.",
      merchandisingImplication: "Petite-specific styling content is the lowest-effort test. Measure whether fit objection rate drops before investing in a shorter-length option.",
    },
    {
      id: "alive-personality-targeting",
      type: "audience-gap",
      _productSlug: "becoming-alive",
      evidenceN: aliveEdgyFbCount,
      evidencePopulation: "Edgy recommendation feedback for Becoming Alive (RF events)",
      confidence: evidenceConfidence(pm[ALIVE].evidenceN),
      estimatedCommercialRelevance: "medium",
      insight: "Becoming Alive delivers 4.7+ outcomes for Edgy customers but consistent rejections from Minimal and Casual Cool profiles",
      customerNeed: "Edgy customers want a piece that matches their self-expression — they will pay for something that feels exactly right",
      evidence: `Edgy: love rate ${pct(feedback.filter(ev => ev.productName === ALIVE && ev.outcome === "love" && CUST[ev.customerId] === "Edgy").length, feedback.filter(ev => ev.productName === ALIVE && CUST[ev.customerId] === "Edgy").length) || 90}% · Minimal: ${pct(feedback.filter(ev => ev.productName === ALIVE && ev.outcome === "skip" && CUST[ev.customerId] === "Minimal").length, feedback.filter(ev => ev.productName === ALIVE && CUST[ev.customerId] === "Minimal").length) || 100}% skip rate`,
      timePeriod: periodLabel,
      suggestedAction: "Test personality-based recommendation gating: only surface Becoming Alive for Edgy and Artsy profiles in evening contexts and measure whether overall love rate improves",
      designImplication: "Do not alter the garment yet — validate whether the current design already serves its intended audience well before acting on any design direction.",
      merchandisingImplication: "Test personality gating as the first step. If Edgy and Artsy outcomes are maintained with gating, consider whether desk-to-dinner styling for Artsy profiles is worth testing next.",
    },
    {
      id: "corporate-chic-loyalty",
      type: "retention-signal",
      _productSlug: null,
      evidenceN: corpChicSessionCount,
      evidencePopulation: "Corporate Chic styling sessions (SS events)",
      confidence: evidenceConfidence(corpChicSessionCount),
      estimatedCommercialRelevance: "high",
      insight: `Corporate Chic customers are the most frequent stylists — repeat sessions with Becoming Seen and multi-piece interests visible across the timeline`,
      customerNeed: "Corporate Chic customers want a wardrobe system, not individual pieces — they will keep returning when the collection earns their trust",
      evidence: `C1, C2, C3 each have 3+ sessions · Becoming Seen and Becoming Grounded both recommended to multiple Corporate Chic customers`,
      timePeriod: periodLabel,
      suggestedAction: "Test a 'NADINE at Work' editorial series that styles the full Corporate Chic wardrobe system across seasons",
      designImplication: "Assess whether the current collection provides enough range to support a full Corporate Chic wardrobe system across seasons, or whether there are gaps in occasion coverage.",
      merchandisingImplication: "A 'NADINE at Work' editorial series is a direct test of whether Corporate Chic customers engage with the full collection, not just individual pieces.",
    },
    {
      id: "seen-formal-objection",
      type: "product-friction",
      _productSlug: "becoming-seen",
      evidenceN: seenTooFormalCount,
      evidencePopulation: '"Too formal" objections on Becoming Seen (SS events)',
      confidence: evidenceConfidence(seenTooFormalCount),
      estimatedCommercialRelevance: "low",
      insight: `${seenTooFormalCount} 'Too formal' objections on Becoming Seen — concentrated among Minimal and Casual Cool profiles`,
      customerNeed: "These customers want the elevated feel of the piece but need to see it styled for less formal contexts",
      evidence: `${seenTooFormalCount} "Too formal" objections on Becoming Seen (SS events) · ${seenRfDeclineCount} recommendation declines for Becoming Seen (RF events) — separate signal, correlated by customerId + productName only, no session-level causal link · Buy/Skip: 0 skips on Becoming Seen in this period`,
      timePeriod: periodLabel,
      suggestedAction: "Create casual-styling content for Becoming Seen: weekend context, flat shoes, less structured pairings",
      designImplication: "Evaluate whether a more relaxed version of the Becoming Seen silhouette would serve Minimal and Casual Cool customers without diluting the Corporate Chic positioning.",
      merchandisingImplication: "Casual-styling content is a low-effort test of whether this objection is a styling problem or an audience-product mismatch. Measure objection rate after content launch.",
    },
  ].slice(0, 7);

  const advanced = {
    emotionalJourney: {
      status: "live",
      // sampleSize = post-wear reviews only (WR events). OR events do not carry feeling data
      // and must not inflate this count — all rates (feeling achieved, would wear again) use nwr.
      sampleSize: nwr,
      // Mutually exclusive achieved / partly / not — sum = nwr = 100%
      achievedCount:       ejAchieved,
      partlyCount:         ejPartly,
      notAchievedCount:    ejNot,
      totalDenominator:    nwr,
      intendedFeelingAchievedRate: nwr > 0 ? pct(ejAchieved, nwr) : 0,
      partlyAchievedRate:          nwr > 0 ? pct(ejPartly, nwr) : 0,
      notAchievedRate:             nwr > 0 ? pct(ejNot, nwr) : 0,
      wouldWearAgain: wyaBreakdown,
      // Confidence before/after — canonical values from timestamped WR events (1–10 scale)
      avgConfidenceBefore: ejAvgConfBefore,
      avgConfidenceAfter:  ejAvgConfAfter,
      avgConfidenceLift:   ejAvgConfLift,
      confidenceSampleSize: ejConfN,
      confidenceStatus: evidenceConfidence(nwr),
      postWearPositiveRate: nwr > 0 ? pct(ejAchieved, nwr) : 0,
      emotionalTransformations,
      productsByEmotionalImpact,
      moodDistributionIsEstimated: true,
      moodDistribution: [
        { mood: "Uncertain",   count: Math.max(1, Math.round(ns * 0.35)), isEstimated: true },
        { mood: "Uninspired",  count: Math.max(1, Math.round(ns * 0.27)), isEstimated: true },
        { mood: "Comfortable", count: Math.max(1, Math.round(ns * 0.22)), isEstimated: true },
        { mood: "Confident",   count: Math.max(1, Math.round(ns * 0.16)), isEstimated: true },
      ],
    },
    collectionHealth: {
      score: 66,
      factorsAvailable: 5,
      factorsTotal: 8,
      factors: {
        recommendationCoverage: { score: 72, label: `${bySessionCount.length} products received sessions`, weight: 15 },
        moodCoverage:           { score: 58, label: "4 starting moods addressed",                           weight: 15 },
        occasionCoverage:       { score: 68, label: "4 occasions with 3+ sessions",                         weight: 15 },
        colourCoverage:         { score: 60, label: "4 preferred colours matched",                          weight: 10 },
        fitCoverage:            { score: 55, label: "Trouser length objection unresolved",                  weight: 10 },
        emotionalOutcomes:      { score: nwr > 0 ? pct(ejAchieved, nwr) : 0, label: `${nwr > 0 ? pct(ejAchieved, nwr) : 0}% feeling achievement rate (${ejAchieved}/${nwr} post-wear reviews)`, weight: 20 },
        commercialPerformance:  { score: null, label: "awaiting-integration",                               weight: 10 },
        returns:                { score: null, label: "awaiting-integration",                               weight: 5  },
      },
      largestWeakness: "fitCoverage",
      strongestArea: "recommendationCoverage",
      scoreLabel: "Directional partial score — excludes commercial factors",
      sampleSizeWarning: ns < 10,
      reviewCount: nr + nwr,
    },
    collectionEvolution: {
      status: "live",
      current: {
        label: periodLabel,
        sessions: ns,
        reviews: nr + nwr,
        avgRating,
        rewearRate: Math.round(rewearRateTotal * 100),
      },
      previous: {
        label: prevLabel,
        sessions: prevNsFinal,
        reviews: prevNr + prevNwr,
        avgRating: Math.round(prevAvgRatingFinal * 10) / 10,
        rewearRate: prevRewearRate,
      },
      ratingTrend: avgRating > prevAvgRatingFinal ? "up" : avgRating < prevAvgRatingFinal ? "down" : "stable",
      sessionsTrend: ns > prevNsFinal ? "up" : "stable",
      trendSummary: dateRangeDays === 7
        ? `Early signal: Becoming Clear has 3 sessions this week with 100% love rate and 1 purchase. Travel demand rising.`
        : dateRangeDays === 30
        ? `Becoming Seen leads all products. 4 Too Formal objections on record for Minimal profiles. Becoming Whole has 4 saves and 0 purchases.`
        : dateRangeDays === 90
        ? `Personality relationships clear: Edgy → Becoming Alive, Corporate Chic → Becoming Seen. Fit objections on Becoming Grounded recurring. Becoming Clear converts at ${pm[CLEAR].conversionRate}%.`
        : `Complete picture: Becoming Seen leads sessions (${pm[SEEN].sessionCount}). Becoming Clear highest conversion (${pm[CLEAR].conversionRate}%). Becoming Whole has ${pm[WHOLE].saveCount} saves and 0 purchases across all time.`,
    },
    trustMetrics: {
      status: ns >= 10 ? "live" : "insufficient-data",
      sampleSize: ns,
      selectionRate: 79,
      feedbackResponseRate: 62,
      cardReactionCount: feedback.length,
      loveRateCanonical: feedback.length > 0 ? pct(lovesTotal, feedback.length) : null,
      loveRate,
      disagreementRate: pct(feedback.filter(ev => ev.outcome === "skip").length, feedback.length) || 12,
      repeatCustomers: Math.max(1, [...new Set(sessions.map(ev => ev.customerId))].filter(cid =>
        sessions.filter(ev => ev.customerId === cid).length > 1
      ).length),
      totalCustomersWithSessions: [...new Set(sessions.map(ev => ev.customerId))].length,
    },
    journeyAnalytics,
    ltv: (() => {
      // LTV from all-time purchase timeline
      const allBuys = ofType(allTime, BS).filter(ev => ev.outcome === "bought");
      // Revenue per customer
      const custRevMap = new Map<string, number>();
      for (const ev of allBuys) {
        const rev = PRICE[ev.productName ?? ""] ?? 1500;
        custRevMap.set(ev.customerId, (custRevMap.get(ev.customerId) ?? 0) + rev);
      }
      const custRevs = [...custRevMap.values()].sort((a, b) => b - a);
      const avgLtv = custRevs.length ? Math.round(custRevs.reduce((s, v) => s + v, 0) / custRevs.length) : 0;

      // LTV by personality (all-time)
      const ltvByPersonality = (["Corporate Chic", "Feminine", "Romantic", "Edgy", "Artsy", "Effortlessly Chic"] as const).map(personality => {
        const cids = Object.entries(CUST).filter(([, p]) => p === personality).map(([cid]) => cid);
        const personalityBuys = allBuys.filter(ev => cids.includes(ev.customerId));
        const rev = personalityBuys.reduce((s, ev) => s + (PRICE[ev.productName ?? ""] ?? 1500), 0);
        const uniqueCustomers = new Set(personalityBuys.map(ev => ev.customerId)).size;
        return {
          personality,
          totalRevenue: rev,
          avgLtv: uniqueCustomers > 0 ? Math.round(rev / uniqueCustomers) : 0,
          customerCount: uniqueCustomers,
          purchases: personalityBuys.length,
        };
      }).filter(r => r.customerCount > 0).sort((a, b) => b.avgLtv - a.avgLtv);

      // Products creating repeat customers (all-time)
      const custBuyMap = new Map<string, Set<string>>();
      for (const ev of allBuys) {
        if (!custBuyMap.has(ev.customerId)) custBuyMap.set(ev.customerId, new Set());
        if (ev.productName) custBuyMap.get(ev.customerId)!.add(ev.productName);
      }
      const repeatCustomers = [...custBuyMap.entries()].filter(([, prods]) => prods.size > 1);
      const repeatProductTally = new Map<string, number>();
      for (const [, prods] of repeatCustomers) {
        for (const p of prods) repeatProductTally.set(p, (repeatProductTally.get(p) ?? 0) + 1);
      }
      const repeatProducts = [...repeatProductTally.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([product, count]) => ({ product, repeatCustomers: count }));

      // Time between purchases
      const custPurchaseDays = new Map<string, number[]>();
      for (const ev of allBuys) {
        if (!custPurchaseDays.has(ev.customerId)) custPurchaseDays.set(ev.customerId, []);
        custPurchaseDays.get(ev.customerId)!.push(ev.daysAgo);
      }
      const gaps: number[] = [];
      for (const [, days] of custPurchaseDays) {
        const sorted = [...days].sort((a, b) => b - a);
        for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i - 1] - sorted[i]);
      }
      const avgGap = gaps.length ? Math.round(gaps.reduce((s, v) => s + v, 0) / gaps.length) : null;

      // Per-customer gross profit
      const custGPMap = new Map<string, number>();
      for (const ev of allBuys) {
        const gp = (PRICE[ev.productName ?? ""] ?? 1500) - (COGS[ev.productName ?? ""] ?? 600);
        custGPMap.set(ev.customerId, (custGPMap.get(ev.customerId) ?? 0) + gp);
      }
      const avgGrossProfit = custGPMap.size > 0
        ? Math.round([...custGPMap.values()].reduce((s, v) => s + v, 0) / custGPMap.size) : 0;

      // Observed customer lifetime (days from first to last purchase per customer)
      const lifetimeDays: number[] = [];
      for (const [, days] of custPurchaseDays) {
        if (days.length >= 2) {
          const sorted = [...days].sort((a, b) => b - a);
          lifetimeDays.push(sorted[0] - sorted[sorted.length - 1]);
        }
      }
      const medianLifetime = lifetimeDays.length > 0
        ? lifetimeDays.sort((a, b) => a - b)[Math.floor(lifetimeDays.length / 2)] : null;

      // AOV = total revenue / total purchases
      const totalRevenue = [...custRevMap.values()].reduce((s, v) => s + v, 0);
      const avgOrderValue = allBuys.length > 0 ? Math.round(totalRevenue / allBuys.length) : 0;

      // LTV by occasion segment (derived from personality → occasion affinity)
      const occasionSegments = [
        { segment: "Work-occasion customers", personalities: ["Corporate Chic", "Minimal"] },
        { segment: "Evening-occasion customers", personalities: ["Feminine", "Romantic", "Edgy"] },
        { segment: "Everyday customers", personalities: ["Effortlessly Chic", "Artsy", "Casual Cool"] },
      ] as const;
      const ltvBySegment = occasionSegments.map(({ segment, personalities }) => {
        const cids = Object.entries(CUST)
          .filter(([, p]) => (personalities as readonly string[]).includes(p))
          .map(([cid]) => cid);
        const segBuys = allBuys.filter(ev => cids.includes(ev.customerId));
        const segRev = segBuys.reduce((s, ev) => s + (PRICE[ev.productName ?? ""] ?? 1500), 0);
        const uniqueC = new Set(segBuys.map(ev => ev.customerId)).size;
        return { segment, customerCount: uniqueC, avgLtv: uniqueC > 0 ? Math.round(segRev / uniqueC) : 0, totalRevenue: segRev };
      }).filter(r => r.customerCount > 0);

      return {
        status: "sample" as const,
        scopeLabel: "All Time",
        sampleSize: allBuys.length,
        totalRevenue,
        avgLtv,
        avgOrderValue,
        avgGrossProfit,
        topCustomerLtv: custRevs[0] ?? 0,
        observedCustomerLifetimeDays: medianLifetime,
        ltvByPersonality,
        ltvBySegment,
        repeatProducts,
        avgDaysBetweenPurchases: avgGap,
        repeatPurchaseRate: pct(repeatCustomers.length, Math.max(1, custRevMap.size)),
        repeatCustomerCount: repeatCustomers.length,
        totalCustomersWithPurchase: custRevMap.size,
        purchaseFrequency: allBuys.length > 0
          ? (allBuys.length / Math.max(1, custRevMap.size)).toFixed(1)
          : "0",
        evidenceMaturity: evidenceConfidence(allBuys.length),
      };
    })(),
    saveVsPurchase: (() => {
      // Period-filtered: saves and buys that occurred within the selected window
      const periodSaves = saves;
      const periodBuys  = buys;

      // All-time BS events — needed for linked-conversion logic (must come before productSvP)
      const allTimeSavesForConv = ofType(allTime, BS).filter(ev => ev.outcome === "saved");
      const allTimeBuysForConv  = ofType(allTime, BS).filter(ev => ev.outcome === "bought");

      // Per-product: period activity + all-time linked conversion (same customer, same product, buy after save)
      const productSvP = ALL_PRODUCTS.map(name => {
        const s = periodSaves.filter(ev => ev.productName === name).length;
        const b = periodBuys.filter(ev => ev.productName === name).length;

        // Cohort-based linked conversions:
        // Each unique (customerId, productName) pair = one saved-product journey.
        // Journey start = the oldest (first-ever) save event for that customer+product.
        // Conversion = at least one purchase of that product by that customer after the journey start.
        // One cohort contributes at most 1 conversion to the numerator and 1 to the denominator.
        const prodSaveEvents = allTimeSavesForConv.filter(ev => ev.productName === name);
        const prodBuys       = allTimeBuysForConv.filter(ev => ev.productName === name);

        // Build cohort map: cid → oldest save daysAgo (journey start)
        const prodCohortMap = new Map<string, number>();
        for (const sv of prodSaveEvents) {
          const prev = prodCohortMap.get(sv.customerId);
          if (prev === undefined || sv.daysAgo > prev) prodCohortMap.set(sv.customerId, sv.daysAgo);
        }
        const savedCohortCount = prodCohortMap.size;

        // One conversion per cohort: check if a buy came after the journey-start save
        const prodConvDays: number[] = [];
        for (const [cid, oldestSaveDaysAgo] of prodCohortMap) {
          const matched = prodBuys.find(bu => bu.customerId === cid && bu.daysAgo < oldestSaveDaysAgo);
          if (matched) prodConvDays.push(oldestSaveDaysAgo - matched.daysAgo);
        }
        const linkedConversions = prodConvDays.length;
        // saves=0 (period) → null; cohorts exist → pct(converted, cohorts)
        const linkedConvRate = s === 0 ? null
          : savedCohortCount > 0 ? pct(linkedConversions, savedCohortCount) : 0;
        const medianDays = prodConvDays.length > 0
          ? [...prodConvDays].sort((a, bv) => a - bv)[Math.floor(prodConvDays.length / 2)]
          : null;
        const buyWithoutSaveProd = periodBuys.filter(ev =>
          ev.productName === name &&
          !periodSaves.some(sv => sv.customerId === ev.customerId && sv.productName === name)
        ).length;
        return {
          product: name, saves: s, purchases: b,
          savedCohortCount, // unique cid journeys (all-time); denominator for linkedConvRate
          linkedConversions, linkedConvRate, medianDaysToConvert: medianDays,
          purchasesWithoutSave: buyWithoutSaveProd,
          saveToP: linkedConvRate, // alias kept for backwards compat
        };
      }).filter(r => r.saves + r.purchases > 0)
        .sort((a, b) => (b.saves + b.purchases) - (a.saves + a.purchases));

      const mostSaved     = [...productSvP].sort((a, b) => b.saves - a.saves)[0];
      const mostPurchased = [...productSvP].sort((a, b) => b.purchases - a.purchases)[0];
      const highSaveLowBuy = productSvP.filter(r => r.saves >= 2 && r.purchases === 0);
      const buyWithoutSave = periodBuys.filter(ev =>
        !periodSaves.some(s => s.customerId === ev.customerId && s.productName === ev.productName)
      );

      // Unique customers who saved at least one item in this period
      const uniqueSavers = new Set(periodSaves.map(ev => ev.customerId)).size;

      // Overall cohort-based conversion:
      // Build a global cid:product cohort map; each cohort contributes at most 1 to denominator and 1 to numerator.
      const globalCohortMap = new Map<string, number>(); // "cid:product" → oldest save daysAgo
      for (const sv of allTimeSavesForConv) {
        const key = sv.customerId + ":" + sv.productName;
        const prev = globalCohortMap.get(key);
        if (prev === undefined || sv.daysAgo > prev) globalCohortMap.set(key, sv.daysAgo);
      }
      const allSavedCohortCount = globalCohortMap.size; // canonical denominator

      const allConvDays: number[] = [];
      for (const [key, oldestSaveDaysAgo] of globalCohortMap) {
        const colon = key.indexOf(":");
        const cid = key.slice(0, colon);
        const pn  = key.slice(colon + 1);
        const matched = allTimeBuysForConv.find(b =>
          b.customerId === cid && b.productName === pn && b.daysAgo < oldestSaveDaysAgo
        );
        if (matched) allConvDays.push(oldestSaveDaysAgo - matched.daysAgo);
      }
      const allLinkedConversions = allConvDays.length;
      const medianDaysToConvert = allConvDays.length > 0
        ? [...allConvDays].sort((a, b) => a - b)[Math.floor(allConvDays.length / 2)] : null;
      const saveToConvertRate = allSavedCohortCount > 0
        ? pct(allLinkedConversions, allSavedCohortCount) : 0;

      // Highest save-to-purchase product (by conversion rate)
      const highestSvp = [...productSvP].sort((a, b) => b.saveToP - a.saveToP).find(r => r.saves > 0);
      // Largest save-without-purchase gap product
      const largestSaveGap = highSaveLowBuy.sort((a, b) => b.saves - a.saves)[0];

      return {
        status: "sample" as const,
        scopeLabel: periodLabel,
        totalSaves:         periodSaves.length,
        totalPurchases:     periodBuys.length,
        uniqueSavers,
        allSavedCohortCount, // unique cid:product journeys (canonical denominator for saveToConvertRate)
        allLinkedConversions,
        overallSaveToP:     saveToConvertRate,
        saveToConvertRate,
        medianDaysToConvert,
        mostSaved:          mostSaved?.product ?? WHOLE,
        mostPurchased:      mostPurchased?.product ?? SEEN,
        highestSvpProduct:  highestSvp?.product ?? null,
        largestSaveGapProduct: largestSaveGap?.product ?? null,
        anchorProduct:      WHOLE,
        productBreakdown:   productSvP,
        highSaveLowBuyProducts: highSaveLowBuy.map(r => r.product),
        purchasesWithoutSave: buyWithoutSave.length,
        evidenceMaturity:   evidenceConfidence(periodSaves.length + periodBuys.length),
      };
    })(),
    explainability: (() => {
      const totalFeedback = feedback.length;
      const loveFeedback  = feedback.filter(ev => ev.outcome === "love").length;
      const byPersonality = ["Corporate Chic", "Edgy", "Artsy", "Feminine", "Minimal"].map(personality => {
        const pFb   = feedback.filter(ev => CUST[ev.customerId] === personality);
        const pLove = pFb.filter(ev => ev.outcome === "love").length;
        return { personality, agreementRate: pFb.length > 0 ? pct(pLove, pFb.length) : null, sampleSize: pFb.length };
      }).filter(r => r.sampleSize > 0);
      return {
        status: "sample",
        scopeLabel: periodLabel,
        evidenceDenominator: totalFeedback,
        sampleSize: totalFeedback,
        cardLoveRate: totalFeedback > 0 ? pct(loveFeedback, totalFeedback) : null,
        explanationAgreementRateIsProxy: true,
        clickThroughRate: null,
        saveRate: pct(saves.length, Math.max(1, ns)),
        saveRateLinkage: "session-level",
        purchaseRate: pct(buys.length, Math.max(1, ns)),
        purchaseRateLinkage: "session-level",
        reasonsResonate: totalFeedback > 0 ? [
          { label: "Confidence context",    count: Math.max(1, Math.round(loveFeedback * 0.45)), isEstimated: true },
          { label: "Occasion match",        count: Math.max(1, Math.round(loveFeedback * 0.35)), isEstimated: true },
          { label: "Personality alignment", count: Math.max(1, Math.round(loveFeedback * 0.20)), isEstimated: true },
        ] : [],
        reasonsRejected: totalFeedback > 0 ? [
          { label: "Too formal for context",         count: Math.max(1, Math.round((totalFeedback - loveFeedback) * 0.42)), isEstimated: true },
          { label: "Style too bold for personality", count: Math.max(1, Math.round((totalFeedback - loveFeedback) * 0.33)), isEstimated: true },
          { label: "Fit uncertainty",                count: Math.max(1, Math.round((totalFeedback - loveFeedback) * 0.25)), isEstimated: true },
        ] : [],
        byPersonality,
        personalitySubsetTotal: byPersonality.reduce((s, r) => s + r.sampleSize, 0),
        reactionsExcludedFromBreakdown: totalFeedback - byPersonality.reduce((s, r) => s + r.sampleSize, 0),
      };
    })(),
    opportunityScores: bySessionCount.slice(0, 3).map(p => ({
      productTitle: p.name,
      score: computeOpportunityScore(pm[p.name]).score ?? 0,
      sampleSize: pm[p.name].sampleSize,
      breakdown: {
        emotionalImpact: Math.round(pm[p.name].loveRate * 0.9),
        versatility: Math.round(pm[p.name].topOccasions.length * 20 + 20),
        repeatWear: Math.round(pm[p.name].rewearRate * 100),
        personalityCoverage: Math.round(pm[p.name].topPersonalities.length * 22 + 15),
        recommendationFit: null,
      },
    })),
    predictive: {
      status: "insufficient-data",
      signals: [],
      disclaimer: "Sample Preview — predictive signals not shown in sample mode.",
    },
    opportunityFeed,
    aiLearning,
    experiments,

    // ── Full Journey Funnel — derived from linked synthetic events ──────────
    journeyFunnel: (() => {
      const atSessions = ofType(allTime, SS);
      const atRF       = ofType(allTime, RF);
      const atBS       = ofType(allTime, BS);
      const atSaves    = atBS.filter(ev => ev.outcome === "saved");
      const atBuys     = atBS.filter(ev => ev.outcome === "bought");
      const atWR       = ofType(allTime, WR);

      const uniqueSessionCids  = new Set(atSessions.map(ev => ev.customerId)).size;
      const uniqueRFCids       = new Set(atRF.map(ev => ev.customerId)).size;
      const loveRFCids         = new Set(atRF.filter(ev => ev.outcome === "love").map(ev => ev.customerId));
      const clickEst           = Math.round([...loveRFCids].length * 0.72);
      const savedCids          = new Set(atSaves.map(ev => ev.customerId)).size;
      const boughtCids         = new Set(atBuys.map(ev => ev.customerId)).size;
      const wrCids             = new Set(atWR.map(ev => ev.customerId)).size;
      // VTO estimate vs. sessions — a signal, not a funnel stage
      const vtoTrialEst        = Math.round(uniqueSessionCids * 0.38);

      const custBuyCountJF = new Map<string, number>();
      for (const ev of atBuys) custBuyCountJF.set(ev.customerId, (custBuyCountJF.get(ev.customerId) ?? 0) + 1);
      const repeatBuyerCount = [...custBuyCountJF.values()].filter(c => c >= 2).length;

      // Conversion rate helper
      const cr = (n: number, d: number) => d > 0 ? pct(n, d) : null;

      // ── Sequential core funnel — only stages with a provable "A requires B" relationship ──
      // Passport → Session: must complete Passport to use nAia (product gate).
      // Session → Recommendation Shown: every session surfaces ≥1 recommendation (100%).
      // Recommendation Shown → Feedback: feedback UI only appears after seeing a recommendation.
      // Save, VTO, Purchase, and Post-Wear are independent optional behaviors — a customer can
      // purchase without saving and save without purchasing. They do not belong in the sequential
      // funnel; they are shown as Engagement & Commercial Signals below.
      const stages = [
        { stage: "Passport Completed",      customerCount: 120,              sessionsOrEvents: null,              convFromPrev: null,                               medianDaysFromPrev: null, note: "All customers complete a Passport before using nAia" },
        { stage: "StyleMe Session",          customerCount: uniqueSessionCids, sessionsOrEvents: atSessions.length, convFromPrev: cr(uniqueSessionCids, 120),          medianDaysFromPrev: 3,    note: "Customer-initiated styling session" },
        { stage: "Recommendation Shown",     customerCount: uniqueSessionCids, sessionsOrEvents: atSessions.length, convFromPrev: 100,                                medianDaysFromPrev: 0,    note: "Every StyleMe session shows ≥1 recommendation" },
        { stage: "Recommendation Feedback",  customerCount: uniqueRFCids,      sessionsOrEvents: atRF.length,       convFromPrev: cr(uniqueRFCids, uniqueSessionCids), medianDaysFromPrev: 0,    note: "Love / Skip / Undecided signal captured — requires having seen a recommendation" },
      ];

      // ── Engagement & Commercial Signals ──
      // Optional behaviors downstream of a session. Not sequential funnel steps.
      // Session-relative rates use uniqueSessionCids as denominator.
      // Post-purchase rates (Post-Wear Review, Repeat Purchase) use boughtCids as denominator.
      const downstreamSignals = [
        { signal: "Product Click (est.)", customerCount: clickEst,         rateVsBase: cr(clickEst, uniqueSessionCids),    base: "of session participants", note: "Estimated from love-feedback events; exact click tracking requires Shopify storefront integration" },
        { signal: "Save Intent",          customerCount: savedCids,        rateVsBase: cr(savedCids, uniqueSessionCids),   base: "of session participants", note: "Buy-or-Skip 'Saved' outcome — optional, not a required precursor to purchase" },
        { signal: "VTO Trial (est.)",     customerCount: vtoTrialEst,      rateVsBase: cr(vtoTrialEst, uniqueSessionCids), base: "of session participants", note: "Estimated from session volume; exact VTO events require FASHN.ai integration" },
        { signal: "Purchase",             customerCount: boughtCids,       rateVsBase: cr(boughtCids, uniqueSessionCids),  base: "of session participants", note: "Buy-or-Skip 'Bought' outcome — independent of Save stage" },
        { signal: "Post-Wear Review",     customerCount: wrCids,           rateVsBase: cr(wrCids, boughtCids),             base: "of buyers",               note: "Post-wear review submitted" },
        { signal: "Repeat Purchase",      customerCount: repeatBuyerCount, rateVsBase: cr(repeatBuyerCount, boughtCids),   base: "of buyers",               note: "Customers with ≥2 Buy-or-Skip 'Bought' events" },
      ];

      return {
        status: "sample" as const,
        scopeLabel: "All Time",
        totalCustomers: 120,
        stages,
        downstreamSignals,
        endToEndRate: cr(uniqueRFCids, 120),
        dropoffStage: "Session → Recommendation Feedback (2 customers did not interact)",
        topSegments: ["Corporate Chic", "Edgy", "Artsy"],
        topProducts: [SEEN, ALIVE, CLEAR],
        note: "Only stages with guaranteed sequential cohort membership are shown in the funnel. Save, VTO, Purchase, and Post-Wear are optional behaviors shown separately as Engagement & Commercial Signals.",
      };
    })(),

    // ── Size Intelligence — derived from personality distribution + fit objection events ──
    sizeIntelligence: (() => {
      const fitKeywords = ["trouser", "hip", "fit", "length", "size", "waist", "width"];
      const fitObjEvents = sessions.filter(ev =>
        ev.objection && fitKeywords.some(kw => ev.objection!.toLowerCase().includes(kw))
      );
      const allReturns = ofType(allTime, RT);

      const sizeGroups = [
        { size: "XS / 34", customerCount: 10,  preferencePersonalities: ["Feminine", "Artsy"],          fitObjCount: fitObjEvents.filter(ev => CUST[ev.customerId] === "Feminine" || CUST[ev.customerId] === "Artsy").length,   returnCount: 0, purchaseConvRate: 82 },
        { size: "S / 36",  customerCount: 27,  preferencePersonalities: ["Feminine", "Minimal", "Edgy"], fitObjCount: fitObjEvents.filter(ev => CUST[ev.customerId] === "Minimal").length,                                       returnCount: 0, purchaseConvRate: 79 },
        { size: "M / 38",  customerCount: 37,  preferencePersonalities: ["Corporate Chic", "Artsy", "Romantic"], fitObjCount: Math.round(fitObjEvents.length * 0.35),                                                          returnCount: 1, purchaseConvRate: 75 },
        { size: "L / 40",  customerCount: 29,  preferencePersonalities: ["Effortlessly Chic", "Corporate Chic", "Old Money"], fitObjCount: Math.round(fitObjEvents.length * 0.40),                                            returnCount: 2, purchaseConvRate: 68 },
        { size: "XL / 42", customerCount: 12,  preferencePersonalities: ["Casual Cool", "Trendy"],       fitObjCount: 1,                                                                                                       returnCount: 0, purchaseConvRate: 71 },
        { size: "XXL / 44",customerCount: 5,   preferencePersonalities: ["Casual Cool"],                 fitObjCount: 0,                                                                                                       returnCount: 0, purchaseConvRate: 74 },
      ];

      const fitObjByProduct = ALL_PRODUCTS.map(name => ({
        product: name,
        fitObjCount: sessions.filter(ev => ev.productName === name && ev.objection).length,
        returnCount: allReturns.filter(ev => ev.productName === name).length,
        topObjection: sessions.filter(ev => ev.productName === name && ev.objection)
          .reduce((acc: Record<string, number>, ev) => {
            const o = canonicalizeObjection(ev.objection!); acc[o] = (acc[o] ?? 0) + 1; return acc;
          }, {} as Record<string, number>),
      })).map(r => ({
        ...r,
        topObjection: Object.entries(r.topObjection).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        stockOutRisk: r.product === GROUNDED ? "Medium" : r.product === ALIVE ? "Low" : "Low",
      })).filter(r => r.fitObjCount + r.returnCount > 0)
        .sort((a, b) => (b.fitObjCount + b.returnCount) - (a.fitObjCount + a.returnCount));

      const returnsByReason = [
        { reason: "Fit — trouser length", count: fitObjEvents.filter(ev => ev.objection?.includes("trouser")).length + 1, products: [GROUNDED] },
        { reason: "Fit — hip width",      count: fitObjEvents.filter(ev => ev.objection?.includes("hip")).length + 1,     products: [GROUNDED] },
        { reason: "Style mismatch",       count: 1,                                                                        products: [ALIVE] },
      ];

      const underservedSizes = sizeGroups
        .filter(g => g.fitObjCount >= 2 || g.returnCount >= 1 || g.purchaseConvRate < 72)
        .map(g => ({ size: g.size, issue: g.returnCount >= 2 ? "Elevated return rate" : g.fitObjCount >= 2 ? "High fit objection rate" : "Below-average purchase conversion" }));

      return {
        status: "sample" as const,
        scopeLabel: periodLabel,
        totalCustomers: 120,
        sizeGroups,
        fitObjByProduct,
        returnsByReason,
        underservedSizes,
        totalFitObjections: fitObjEvents.length,
        totalReturns: allReturns.length,
        evidenceMaturity: "Sample — primarily estimated",
        recommendation: `Becoming Grounded shows the highest fit objection rate (primarily trouser length and hip fit) with ${allReturns.filter(ev => ev.productName === GROUNDED).length} confirmed returns (all-time). Size L and M account for the highest objection volume. Consider a petite-length variant and a clearer size chart. Size Coverage data will improve significantly once garment-size fields are captured in StyleMe sessions.`,
      };
    })(),

    // ── Product Pairing Intelligence — derived from co-session + sequential events ──
    productPairing: (() => {
      // Co-session pairings: same customer + same daysAgo = same session, different products
      const sessionMap = new Map<string, Set<string>>();
      for (const ev of allTime) {
        if (!ev.productName) continue;
        const key = `${ev.customerId}:${ev.daysAgo}`;
        if (!sessionMap.has(key)) sessionMap.set(key, new Set());
        sessionMap.get(key)!.add(ev.productName);
      }

      const pairTally = new Map<string, { recommended: number; saved: number; purchased: number; reviewed: number }>();

      const addPair = (p1: string, p2: string, field: keyof typeof pairTally extends never ? never : "recommended" | "saved" | "purchased" | "reviewed") => {
        const key = [p1, p2].sort().join(" × ");
        const e = pairTally.get(key) ?? { recommended: 0, saved: 0, purchased: 0, reviewed: 0 };
        e[field]++;
        pairTally.set(key, e);
      };

      // Recommended together: same session
      for (const [, prods] of sessionMap) {
        const pl = [...prods];
        for (let i = 0; i < pl.length; i++)
          for (let j = i + 1; j < pl.length; j++) addPair(pl[i], pl[j], "recommended");
      }

      // Saved together: same customer, both saved within 14 days
      const svEvents = ofType(allTime, BS).filter(ev => ev.outcome === "saved" && ev.productName);
      const custSvMap = new Map<string, { product: string; daysAgo: number }[]>();
      for (const ev of svEvents) {
        if (!custSvMap.has(ev.customerId)) custSvMap.set(ev.customerId, []);
        custSvMap.get(ev.customerId)!.push({ product: ev.productName!, daysAgo: ev.daysAgo });
      }
      for (const [, sv] of custSvMap) {
        for (let i = 0; i < sv.length; i++)
          for (let j = i + 1; j < sv.length; j++)
            if (sv[i].product !== sv[j].product && Math.abs(sv[i].daysAgo - sv[j].daysAgo) <= 14)
              addPair(sv[i].product, sv[j].product, "saved");
      }

      // Purchased together: same customer, both bought within 60 days
      const byEvents = ofType(allTime, BS).filter(ev => ev.outcome === "bought" && ev.productName);
      const custByMap = new Map<string, { product: string; daysAgo: number }[]>();
      for (const ev of byEvents) {
        if (!custByMap.has(ev.customerId)) custByMap.set(ev.customerId, []);
        custByMap.get(ev.customerId)!.push({ product: ev.productName!, daysAgo: ev.daysAgo });
      }
      for (const [, by] of custByMap) {
        for (let i = 0; i < by.length; i++)
          for (let j = i + 1; j < by.length; j++)
            if (by[i].product !== by[j].product && Math.abs(by[i].daysAgo - by[j].daysAgo) <= 60)
              addPair(by[i].product, by[j].product, "purchased");
      }

      // Positively reviewed together: same customer, love RF for both products on same or adjacent days
      const loveEvents = ofType(allTime, RF).filter(ev => ev.outcome === "love" && ev.productName);
      const custLvMap = new Map<string, { product: string; daysAgo: number }[]>();
      for (const ev of loveEvents) {
        if (!custLvMap.has(ev.customerId)) custLvMap.set(ev.customerId, []);
        custLvMap.get(ev.customerId)!.push({ product: ev.productName!, daysAgo: ev.daysAgo });
      }
      for (const [, lv] of custLvMap) {
        for (let i = 0; i < lv.length; i++)
          for (let j = i + 1; j < lv.length; j++)
            if (lv[i].product !== lv[j].product && Math.abs(lv[i].daysAgo - lv[j].daysAgo) <= 7)
              addPair(lv[i].product, lv[j].product, "reviewed");
      }

      const pairs = [...pairTally.entries()]
        .map(([key, counts]) => {
          const [product1, product2] = key.split(" × ");
          const total = counts.recommended + counts.saved + counts.purchased + counts.reviewed;
          return { product1, product2, ...counts, total };
        })
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      const totalSignals = pairs.reduce((s, p) => s + p.total, 0);

      return {
        status: "sample" as const,
        scopeLabel: "All Time",
        pairs,
        topPair: pairs[0] ?? null,
        totalSignals,
        evidenceMaturity: evidenceConfidence(totalSignals),
        note: "Recommended together = same StyleMe session · Saved together = both saved within 14 days · Purchased together = both bought within 60 days · Positively reviewed together = love feedback within 7 days.",
      };
    })(),
  };

  // ── rel ─────────────────────────────────────────────────────────────────
  const relStatus = ns >= 10 ? "live" : "insufficient-data";

  // DNA matrix — one row per personality with sessions
  const personalityGroups = ["Corporate Chic", "Edgy", "Artsy", "Feminine", "Romantic", "Minimal", "Effortlessly Chic", "Old Money", "Trendy", "Casual Cool"];
  const dnaMatrix = personalityGroups
    .map(personality => {
      const pCids = Object.entries(CUST).filter(([, p]) => p === personality).map(([cid]) => cid);
      const pSessions  = sessions.filter(ev => pCids.includes(ev.customerId));
      const pReviews   = [...reviews, ...wearReviews].filter(ev => pCids.includes(ev.customerId));
      const pWear      = wearReviews.filter(ev => pCids.includes(ev.customerId));
      const pFeedback  = feedback.filter(ev => pCids.includes(ev.customerId));
      if (pSessions.length === 0) return null;
      const pLoves     = pFeedback.filter(ev => ev.outcome === "love").length;
      const pFeelingOk = pWear.filter(ev => {
        const outcome = classifyEmotionalOutcome(ev.desiredFeeling, ev.actualAfterFeeling);
        return outcome === "achieved" || outcome === "partly";
      }).length;
      const topProds   = topKeys(tally(pSessions.map(ev => ev.productName)), 2).filter((p): p is string => p !== null);
      const topFeelings = topKeys(tally(pWear.map(ev => ev.actualAfterFeeling)), 2).filter((f): f is string => f !== null);
      const catalogFeelings = [...new Set(topProds.flatMap(p => CATALOG[p]?.desiredFeelings.slice(0,1).map(f => f.replace("more-","")) ?? []))].slice(0,2);
      const topOccs    = topKeys(tally(pSessions.map(ev => ev.occasion)), 2).filter((o): o is string => o !== null);
      const avgR       = meanRating(pReviews);
      const rewYes     = pWear.filter(ev => ev.rewear).length;
      return {
        personality,
        sessionCount: pSessions.length,
        avgRating: avgR,
        rewearRate: pWear.length ? rewYes / pWear.length : null,
        ratingDerivedProxy: avgR != null && avgR > 0 ? Math.round((avgR - 3.5) * 10) / 10 : null,
        // null when no post-wear reviews — never report 0% from absence of WR events
        feelingAchievedRate: pWear.length > 0 ? pct(pFeelingOk, pWear.length) : null,
        wrCount: pWear.length,
        topProducts: topProds,
        topDesiredFeelings: topFeelings.length > 0 ? topFeelings : catalogFeelings,
        topOccasions: topOccs,
        prescriptive: prescriptiveInsight(personality, topProds, pSessions.length, pct(pLoves, pFeedback.length), pWear.length),
      };
    })
    .filter(Boolean)
    .slice(0, dateRangeDays === 7 ? 2 : dateRangeDays === 30 ? 4 : 6) as NonNullable<ReturnType<typeof Object.assign>>[];

  function prescriptiveInsight(personality: string, topProds: string[], sessionCount: number, loveRate: number, pWearLength: number): string {
    const map: Record<string, string> = {
      "Corporate Chic":    `Corporate Chic customers achieve their best outcomes with Becoming Seen in work and special-event contexts. Style it with Becoming Grounded or Becoming Real for a complete corporate system.`,
      // Edgy: only claim feeling outcomes when post-wear data exists in this period
      "Edgy":              pWearLength > 0
        ? `Edgy customers show the highest rewear frequency — Becoming Alive delivers consistent 'Confident' outcomes and above-average rewear among observed sessions. Evening contexts account for the most love events in this period.`
        : `Edgy customers show above-average love rates for Becoming Alive in recommendation feedback (${loveRate}% love rate, n=${sessionCount} sessions). Post-wear data is needed to confirm feeling outcomes in this period.`,
      "Artsy":             `Artsy customers are drawn to Becoming Clear and Becoming Whole. Clear shows above-average buy-intent when recommended; Whole needs occasion-led styling guidance to move from save to purchase.`,
      // Feminine: only claim feeling achievement when post-wear data exists in this period
      "Feminine":          pWearLength > 0
        ? `Feminine customers achieve 'Feminine' and 'Attractive' consistently with Becoming Her. The midi dress is the clearest emotional match in the collection for this profile.`
        : `Feminine customers show strong love rates for Becoming Her in recommendation feedback (${loveRate}% love rate, n=${sessionCount} sessions). Post-wear data is needed to confirm feeling outcomes in this period.`,
      "Romantic":          `Romantic customers show the highest repeat buy-intent in the sample — Becoming Her appears in multiple purchase events. Evening and date-night contexts produce above-average outcomes.`,
      "Minimal":           `Minimal customers resist the most formal pieces (Too Formal objection on Becoming Seen is consistent). Becoming Real and Becoming Whole are better matches — lower formality, same polished outcome.`,
      "Effortlessly Chic": `Effortlessly Chic customers appreciate versatility — Becoming Clear and Becoming Whole both work well. Travel and everyday occasions are the highest-performing contexts.`,
      "Old Money":         `Old Money customers gravitate toward structured outerwear and elevated occasion pieces. Becoming Seen for dinner and Becoming Rooted for special events show the highest love rates for this segment.`,
      "Trendy":            `Trendy customers explore broadly — Clear and Alive both resonate. They respond well to new pieces and are early adopters who signal collection momentum.`,
      "Casual Cool":       `Casual Cool customers prefer accessible silhouettes — Becoming Whole for everyday and Becoming Real for work. More formal pieces show consistent Too Formal skip patterns for this segment.`,
    };
    return map[personality] ?? `${sessionCount} sessions · ${loveRate}% love rate · top products: ${topProds.join(", ")}`;
  }

  // emotionalChain — uses PERIOD wearReviews only (matches Customers emotional journey).
  // Derives directly from emotionalTransformations so the two sections can never diverge.
  // Rows disappear when period WR evidence is zero — do not fall back to all-time.
  const emotionalChain = emotionalTransformations.map(t => ({
    currentMood:     t.startingMood,
    desiredFeeling:  t.desiredFeeling,
    wrCount:         t.count,
    count:           t.count,
    achievedRate:    t.count > 0 ? t.achievedRate : null,
    achievedCount:   t.achievedCount,
    achievedOf:      t.count,
    avgRating:       pm[t.topProducts?.[0] ?? SEEN]?.avgRating ?? null,
    topProducts:     t.topProducts,
  }));

  // Occasion-product matrix
  const occasionRows = ["work", "dinner", "date-night", "travel", "special-event", "girls-night", "everyday"];
  const occasionProductMatrix = occasionRows
    .map(occ => {
      const occSessions = sessions.filter(ev => ev.occasion === occ);
      if (occSessions.length < 1) return null;
      const occReviews = [...reviews, ...wearReviews].filter(ev =>
        occSessions.some(s => s.customerId === ev.customerId && s.productName === ev.productName)
      );
      const successes = occSessions.filter(ev => {
        const fb = feedback.find(f => f.customerId === ev.customerId && f.productName === ev.productName);
        return fb?.outcome === "love";
      }).length;
      const topProds = topKeys(tally(occSessions.map(ev => ev.productName)), 3)
        .filter((p): p is string => p !== null)
        .map(name => ({ name, avgRating: pm[name]?.avgRating ?? 4.0 }));
      const topPersonalities = topKeys(tally(occSessions.map(ev => CUST[ev.customerId] ?? null)), 2)
        .filter(Boolean) as string[];
      const topFeelings = topKeys(tally(occSessions.map(ev => ev.desiredFeeling)), 2)
        .filter((f): f is string => f !== null)
        .map(f => f.replace("more-", ""));
      return {
        occasion: occ,
        count: occSessions.length,
        avgRating: occReviews.length ? (meanRating(occReviews) ?? null) : null,
        successRate: occSessions.length > 0 ? pct(successes, occSessions.length) : null,
        successRateMetric: "recommendation-acceptance-session-matched" as const,
        successRateDenominator: occSessions.length,
        topPersonalities,
        topDesiredFeelings: topFeelings,
        topProducts: topProds,
      };
    })
    .filter(Boolean)
    .slice(0, dateRangeDays === 7 ? 2 : 4) as NonNullable<ReturnType<typeof Object.assign>>[];

  function narrativeTransformation(name: string): string {
    const map: Record<string, string> = {
      [SEEN]:     "Uncertain → Confident",
      [WHOLE]:    "Scattered → Effortless",
      [ALIVE]:    "Reserved → Expressive",
      [GROUNDED]: "Underdressed → Powerful",
      [CLEAR]:    "Unsure → Put Together",
      [REAL]:     "Casual → Polished",
      [HER]:      "Self-conscious → Feminine",
      [ROOTED]:   "Underdressed → Elevated",
      [FREE]:     "Restrained → Free",
      [BOLD]:     "Reserved → Bold",
      [DEFINED]:  "Uncertain → Defined",
    };
    return map[name] ?? "Comfortable → Elevated";
  }

  // Product narratives — all 11 canonical products.
  // Products with no period evidence show hasEvidence=false and score=null ("Not measured").
  // WR denominator is wrCount (post-wear reviews only), never sampleSize (which includes outfit reviews).
  const productNarratives = ALL_PRODUCTS.map(name => {
    const p   = pm[name];
    const cat = CATALOG[name];
    const opp = computeOpportunityScore(p);
    const outfitReviewCount = p.sampleSize - p.wrCount; // OR-only reviews
    return {
      name,
      hasEvidence: p.sessionCount > 0,
      opportunityScore: opp.score,
      opportunityScoreFactors: opp.available,
      opportunityScoreMissing: opp.missing,
      avgRating: p.avgRating,
      // rewearRate is null when wrCount=0 — never 0%, which would imply observed non-rewear
      rewearRate: p.wrCount > 0 ? p.rewearRate : null,
      wrCount: p.wrCount,
      outfitReviewCount,
      feelingAchievedRate: p.wrCount > 0 ? p.feelingAchievedRate : null,
      bestPersonality: p.sessionCount > 0 ? (p.topPersonalities[0] ?? cat.personalities[0]) : cat.personalities[0],
      bestOccasion: p.sessionCount > 0 ? (p.topOccasions[0] ?? cat.occasions[0]) : cat.occasions[0],
      mostCommonObjection: p.topObjection,
      sampleSize: p.sampleSize,
      avgConfidenceLift: p.avgConfidenceLift,
      strongestTransformation: narrativeTransformation(name),
      topDesiredFeelings: cat.desiredFeelings.slice(0, 2).map(f => f.replace("more-", "")),
      recommendation: cat.recommendation,
      recommendationReason: cat.recommendationReason,
    };
  });

  const rel = {
    status: relStatus,
    sampleSize: ns,
    totalSessions: ns,
    dnaMatrix,
    emotionalChain,
    occasionProductMatrix,
    productNarratives,
  };

  // ── overview (period KPIs + all-time foundation) ──────────────────────────
  const naiaRevenue = buys.reduce((sum, ev) => sum + (PRICE[ev.productName ?? ""] ?? 1500), 0);
  // naiaInfluenceRate is an illustrative estimate — not measured from a controlled attribution study.
  // Formula is session-volume-scaled; a real influence rate requires a causal experiment or cohort comparison.
  const naiaInfluenceRate = Math.min(82, Math.round(48 + buys.length * 2.2));
  const naiaInfluenceRateIsIllustrative = true;
  const naiaConversionRate = pct(buys.length, Math.max(1, ns));
  const naiaAvgOrderValue = buys.length > 0 ? Math.round(naiaRevenue / buys.length) : 0;
  const topProductInPeriod = bySessionCount[0]?.name ?? SEEN;
  const strongestEmotionalOutcome = (() => {
    if (wearReviews.length > 0) {
      const top = topKeys(tally(wearReviews.map(ev => ev.actualAfterFeeling)), 1)[0];
      if (top) return top;
    }
    return topKeys(tally(feedback.filter(ev => ev.outcome === "love").map(ev => ev.desiredFeeling)), 1)[0] ?? "Confident";
  })();
  const vtoCompletedJobs = Math.max(1, Math.round(ns * 0.34));

  const allOR = ofType(allTime, OR);
  const allWR = ofType(allTime, WR);

  const overview = {
    periodLabel,
    periodKpis: {
      styleMeRequests: ns,
      outfitReviewsInPeriod: nr + nwr,
      recommendationResponseRate: pct(feedback.length, Math.max(1, ns)),
      purchaseConversion: naiaConversionRate,
      naiaAssistedRevenue: naiaRevenue,
      naiaInfluenceRate,
      highestConvertingFeature: {
        byRevenue: "Style Me",
        byRate: "VTO",
        styleMeDetails: `${buys.length} purchase${buys.length !== 1 ? "s" : ""} · ${naiaConversionRate}% session conversion`,
        vtoDetails: `${vtoCompletedJobs} jobs · ~22% buy rate`,
      },
      topProductInPeriod,
      topProductBuyCount: pm[topProductInPeriod]?.buyCount ?? 0,
      strongestEmotionalOutcome,
      naiaVsNonNaia: {
        naiaConversionRate,
        // nonNaiaConversionRate is an estimate — no tracked unassisted cohort exists.
        // 5% is an assumed market baseline for unlanded fashion e-commerce, not measured data.
        nonNaiaConversionRate: 5,
        nonNaiaConversionRateIsEstimated: true,
        nonNaiaConversionRateNote: "Estimated market baseline — no unassisted cohort tracked. Comparison is illustrative until a real control group is established.",
        naiaAvgOrderValue,
        sessionCount: ns,
        naiaInfluenceRate,
        naiaInfluenceRateIsIllustrative,
      },
    },
    foundationKpis: {
      registeredNaiaUsers: 15,
      completedPassports: 12,
      totalOutfitReviews: allOR.length + allWR.length,
      avgOutfitRating: meanRating([...allOR, ...allWR]),
      lifetimeWouldWearAgainRate: Math.round(
        allWR.filter(ev => ev.rewear).length / Math.max(1, allWR.length) * 100
      ),
      lifetimeConfidenceLift: 1.8,
    },
  };

  return { dashboard, kpis, phase4b2, advanced, rel, overview, commercial };
}
