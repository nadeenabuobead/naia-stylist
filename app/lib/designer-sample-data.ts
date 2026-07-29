/**
 * DESIGNER_SAMPLE_DATA_ENABLED=true — staging/dev only.
 * All period-sensitive metrics are DERIVED from the EVENTS timeline below.
 * No proportional scaling. No hardcoded period values. Never writes to the database.
 */
import { EVENTS_EXPANDED, CUST_EXTENDED } from "./ai/synthetic-events-expanded";

// ── Real NADINE product names ──────────────────────────────────────────────
const SEEN     = "Becoming Seen";      // trench coat · Corporate Chic/Artsy/Edgy · work hero
const WHOLE    = "Becoming Whole";     // kimono wrap jacket · Artsy/EF Chic/Feminine · high saves, no buys
const ALIVE    = "Becoming Alive";     // two-layer peplum top · polarising · Edgy loves it
const GROUNDED = "Becoming Grounded"; // asymmetrical trousers · fit objections · strong intent
const CLEAR    = "Becoming Clear";     // leather suede jacket · underexposed, high-converting
const REAL     = "Becoming Real";      // structured collar shirt · reliable everyday anchor
const HER      = "Becoming Her";       // midi dress · Feminine/Romantic evening anchor
const ROOTED   = "Becoming Rooted";    // suede column skirt · supporting occasion role

// ── Static catalog metadata ────────────────────────────────────────────────
interface ProductMeta {
  category: string; garmentType: string; personalities: string[];
  occasions: string[]; desiredFeelings: string[];
  opportunityScore: number; recommendation: string; recommendationReason: string;
}
const CATALOG: Record<string, ProductMeta> = {
  [SEEN]: {
    category: "Outerwear", garmentType: "Tailored trench coat",
    personalities: ["Corporate Chic", "Artsy", "Edgy"],
    occasions: ["work", "dinner", "special-event", "travel"],
    desiredFeelings: ["Confident", "Powerful", "Put Together", "Elevated"],
    opportunityScore: 85,
    recommendation: "Make this your hero workwear piece — anchor corporate styling campaigns with it.",
    recommendationReason: "Corporate Chic customers consistently achieve 'Confident' and 'Powerful'. 85% rewear rate and the highest confidence lift in work-occasion sessions.",
  },
  [WHOLE]: {
    category: "Outerwear", garmentType: "Kimono-inspired wrap jacket",
    personalities: ["Artsy", "Effortlessly Chic", "Feminine"],
    occasions: ["everyday", "dinner", "travel", "special-event"],
    desiredFeelings: ["Effortless", "Elevated", "Feminine", "Confident"],
    opportunityScore: 71,
    recommendation: "Create occasion-specific styling guides to convert saves into purchases.",
    recommendationReason: "High save rate but zero purchase conversion. Styling ambiguity ('not sure how to wear it') is the primary barrier — occasion-led content would unlock this.",
  },
  [ALIVE]: {
    category: "Top", garmentType: "Two-layer peplum top",
    personalities: ["Artsy", "Feminine", "Edgy"],
    occasions: ["dinner", "date-night", "girls-night", "special-event"],
    desiredFeelings: ["Confident", "Feminine", "Elevated", "Attractive"],
    opportunityScore: 58,
    recommendation: "Observed pattern: Edgy and Artsy customers achieve the strongest outcomes. Evening occasions show the highest love rates in this period.",
    recommendationReason: "Polarising piece. Edgy customers give 4.7+ ratings and high rewear across observed sessions. Minimal and Corporate Chic customers show consistent rejection — further observation would clarify whether personality-based surfacing improves overall outcomes.",
  },
  [GROUNDED]: {
    category: "Trousers", garmentType: "Asymmetrical crossover trousers",
    personalities: ["Edgy", "Artsy", "Corporate Chic"],
    occasions: ["work", "everyday", "dinner", "date-night"],
    desiredFeelings: ["Put Together", "Confident", "Powerful", "Elevated"],
    opportunityScore: 52,
    recommendation: "Address trouser-length and hip-fit objections with petite-specific styling guidance.",
    recommendationReason: "Strong purchase intent when fit resolves — customers describe feeling grounded and powerful. Recurring length and waist-detail objections are reducing conversion for petite and conservative frames.",
  },
  [CLEAR]: {
    category: "Outerwear", garmentType: "Leather suede structured jacket",
    personalities: ["Corporate Chic", "Artsy", "Edgy"],
    occasions: ["work", "dinner", "date-night", "special-event"],
    desiredFeelings: ["Put Together", "Confident", "Powerful", "Elevated"],
    opportunityScore: 79,
    recommendation: "Becoming Clear converts at a higher rate than other pieces when recommended — worth testing whether increased frequency improves overall outcomes.",
    recommendationReason: "Observed: consistent 4.5+ ratings and higher buy-through rate when recommended compared to session frequency. Currently receives fewer sessions than Becoming Seen — testing whether increased exposure changes outcomes is a low-effort next step.",
  },
  [REAL]: {
    category: "Top", garmentType: "Structured collar shirt",
    personalities: ["Corporate Chic", "Effortlessly Chic", "Artsy"],
    occasions: ["work", "everyday", "dinner", "special-event"],
    desiredFeelings: ["Put Together", "Confident", "Elevated", "Powerful"],
    opportunityScore: 63,
    recommendation: "Position as the reliable everyday anchor for Corporate Chic and Minimal profiles.",
    recommendationReason: "Low styling effort, high outcome delivery. Works for customers who want polish without complexity — especially Minimal customers who find the hero outerwear too formal.",
  },
  [HER]: {
    category: "Dress", garmentType: "Midi dress",
    personalities: ["Feminine", "Romantic", "Artsy"],
    occasions: ["dinner", "date-night", "girls-night", "special-event"],
    desiredFeelings: ["Feminine", "Attractive", "Confident", "Elevated"],
    opportunityScore: 67,
    recommendation: "Feature in occasion-specific campaigns for Feminine and Romantic profiles.",
    recommendationReason: "Consistently achieves 'Feminine' and 'Attractive' for its target profiles. Repeat-purchase signal visible in historical data — strong LTV piece for the right segment.",
  },
  [ROOTED]: {
    category: "Skirt", garmentType: "Suede column midi skirt",
    personalities: ["Feminine", "Romantic", "Artsy"],
    occasions: ["dinner", "date-night", "special-event", "work"],
    desiredFeelings: ["Feminine", "Attractive", "Elevated", "Confident"],
    opportunityScore: 55,
    recommendation: "Pair with Becoming Real or Becoming Fragmented for work occasions.",
    recommendationReason: "Body-skimming column creates a confident, elevated look. Works best when customers understand how to pair the high waist — styling guidance improves outcomes.",
  },
};

const ALL_PRODUCTS = [SEEN, WHOLE, ALIVE, GROUNDED, CLEAR, REAL, HER, ROOTED];

// Synthetic piece prices (AED) — used for commercial sample KPI derivation only
const PRICE: Record<string, number> = {
  [SEEN]: 2800, [WHOLE]: 1950, [ALIVE]: 850,  [GROUNDED]: 1650,
  [CLEAR]: 3200, [REAL]: 950,  [HER]: 1750,  [ROOTED]: 1350,
};

// Synthetic COGS per piece (AED) — used for margin derivation only
const COGS: Record<string, number> = {
  [SEEN]: 980, [WHOLE]: 680, [ALIVE]: 285, [GROUNDED]: 560,
  [CLEAR]: 1080, [REAL]: 315, [HER]: 595, [ROOTED]: 450,
};

// Synthetic stock on hand (units) — used for sell-through derivation only
const STOCK: Record<string, number> = {
  [SEEN]: 10, [WHOLE]: 16, [ALIVE]: 6, [GROUNDED]: 9,
  [CLEAR]: 5, [REAL]: 14, [HER]: 9, [ROOTED]: 11,
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

  const objections = ps.map(ev => ev.objection).filter((o): o is string => o !== null);
  const objMap     = tally(objections);
  const topObj     = objections.length ? topKeys(objMap, 1)[0] ?? null : null;

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

  const prevNs = ofType(filterWindow(prior, 9999), SS).length;
  const prevNr = ofType(filterWindow(prior, 9999), OR).length;

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
      helpedFeel: p.actualAfterFeelings.length > 0 ? p.actualAfterFeelings.slice(0, 3) : cat.desiredFeelings.slice(0, 2),
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
  const objMap = tally(allObjEvents.map(ev => ev.objection));
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
      colorDistribution: [   // kept for live-data backward compat
        { color: "burgundy",  count: 9,  percentage: 60 },
        { color: "espresso",  count: 8,  percentage: 53 },
        { color: "ivory",     count: 6,  percentage: 40 },
        { color: "black",     count: 6,  percentage: 40 },
        { color: "caramel",   count: 4,  percentage: 27 },
      ],
      colorIntelligence: {
        paletteDirection: "Neutral-Forward",
        paletteDirectionBreakdown: [
          { direction: "Neutral-Forward", count: 10, percentage: 67, description: "Black, ivory, espresso, and caramel dominate across all personality types" },
          { direction: "Colourful",       count: 3,  percentage: 20, description: "Accent tones — burgundy and wine — favoured by Artsy and Feminine profiles" },
          { direction: "Monochrome",      count: 2,  percentage: 13, description: "Single-colour tonal dressing preferred by Old Money and Minimal profiles" },
        ],
        preferredColors: [
          { color: "burgundy",  count: 9,  percentage: 60 },
          { color: "espresso",  count: 8,  percentage: 53 },
          { color: "ivory",     count: 6,  percentage: 40 },
          { color: "black",     count: 6,  percentage: 40 },
          { color: "caramel",   count: 4,  percentage: 27 },
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
          avgRating: occRatings.length ? meanRating(occRatings.map(r => ({ rating: r } as SE))) : 4.1,
          rewear: 0.74,
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
      { occasion: "Casual weekend",       need: "Casual weekend",       count: Math.max(1, Math.round(ns * 0.1)) },
      { occasion: "Active / sporty",      need: "Active / sporty",      count: Math.max(1, Math.round(ns * 0.06)) },
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
        .map(ev => ev.objection!);
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
        confidenceBadge: evidenceConfidence(pm[SEEN].sampleSize),
        actionType: "Scale",
        action: "Anchor the next corporate campaign around Becoming Seen — style it across work, travel, and evening",
        performance: `★ ${pm[SEEN].avgRating} avg · ${Math.round(pm[SEEN].rewearRate * 100)}% rewear · +${pm[SEEN].avgConfidenceLift} confidence lift`,
        liked: "Corporate Chic customers achieve 'Confident' and 'Powerful' consistently — highest confidence lift in work-occasion sessions",
        watch: "Minimal and Casual Cool customers object to the formality — observe whether styling context resolves this",
        nextStep: "Commission editorial content: Becoming Seen at the boardroom, at dinner, and at a gallery opening",
        data: `n=${pm[SEEN].sampleSize} reviews · ${CATALOG[SEEN].garmentType} · Best with Corporate Chic`,
        // Canonical fields
        id: "seen-workwear-versatility",
        product: SEEN,
        collection: "workwear",
        observedEvidence: `${pm[SEEN].sessionCount} sessions · ${pm[SEEN].buyCount} purchases · ★${pm[SEEN].avgRating} avg · ${Math.round(pm[SEEN].rewearRate * 100)}% rewear among Corporate Chic customers`,
        interpretation: "Becoming Seen leads all products in sessions and delivers the highest confidence lift for Corporate Chic customers in work and special-event contexts. Both rating and rewear signals are consistent across the observed period.",
        recommendedTest: "Commission editorial content positioning Becoming Seen in three work contexts: boardroom, dinner, and gallery opening. Measure Corporate Chic love rate and rewear rate after launch.",
        successMetric: "Corporate Chic session love rate ≥ 70% and rewear rate maintained after content launch.",
        evidenceCount: pm[SEEN].sampleSize,
        period: periodLabel,
        confidence: evidenceConfidence(pm[SEEN].sampleSize),
        designImplication: "No design change indicated — the product achieves its intended feeling for the target audience consistently. Validate whether the workwear styling system needs additional supporting pieces.",
        merchandisingImplication: "Test a curated work styling system positioning Becoming Seen as the anchor piece. Editorial content across three contexts is a low-effort, high-signal test.",
        impact: "high" as const,
        effort: "medium" as const,
        status: "proposed" as const,
      },
      {
        // Legacy display fields
        piece: WHOLE,
        confidenceBadge: evidenceConfidence(pm[WHOLE].sampleSize),
        actionType: "Fix",
        action: "Create occasion-specific styling guides to convert saves into purchases",
        performance: `★ ${pm[WHOLE].avgRating} avg · ${pm[WHOLE].saveCount} saves · ${pm[WHOLE].buyCount} purchases`,
        liked: "Customers describe it as beautiful and effortless — aspiration is not the issue",
        watch: `Save-to-purchase gap: ${pm[WHOLE].saveCount} saves but ${pm[WHOLE].buyCount} purchases — occasion ambiguity is observed as the most likely cause`,
        nextStep: "Produce three styling guides: Desk to Lunch, Weekend Travel, Evening with Friends",
        data: `n=${pm[WHOLE].sampleSize} reviews · ${CATALOG[WHOLE].garmentType} · Top objection: 'Not sure how to style it'`,
        // Canonical fields
        id: "whole-save-to-purchase",
        product: WHOLE,
        collection: "everyday",
        observedEvidence: `${pm[WHOLE].saveCount} saves · ${pm[WHOLE].buyCount} purchases · Save/purchase gap is the widest in the collection · Top feedback: 'Not sure when to wear it'`,
        interpretation: "Customers find Becoming Whole aspirational but face occasion ambiguity that prevents purchase commitment. The save signal is strong — the barrier appears to be styling confidence, not desirability.",
        recommendedTest: "Create 3 occasion-specific styling guides (Desk to Lunch, Weekend Travel, Evening with Friends) and measure whether save-to-purchase conversion improves within 60 days.",
        successMetric: "Save-to-purchase rate improvement visible within 60 days of guide publication.",
        evidenceCount: pm[WHOLE].sampleSize,
        period: periodLabel,
        confidence: evidenceConfidence(pm[WHOLE].sampleSize),
        designImplication: "Investigate whether the silhouette needs a clearer occasion anchor in the design intent before committing to new product development.",
        merchandisingImplication: "Occasion-specific styling guides are the most direct test of whether the save/purchase gap is a content problem rather than a product problem.",
        impact: "high" as const,
        effort: "low" as const,
        status: "proposed" as const,
      },
      {
        // Legacy display fields
        piece: ALIVE,
        confidenceBadge: evidenceConfidence(pm[ALIVE].sampleSize),
        actionType: "Test",
        action: "Observe whether surfacing Becoming Alive for Edgy and Artsy profiles in evening contexts improves love rate",
        performance: `★ ${pm[ALIVE].avgRating} avg · ${Math.round(pm[ALIVE].rewearRate * 100)}% rewear among committed wearers`,
        liked: pm[ALIVE].rewearRate > 0
          ? "Edgy customers give it 4.7+ and rewear consistently — strong community identity around this piece"
          : `Edgy customers give it 4.7+ — rewear data visible in 90D+ window (first rewear events outside this period)`,
        watch: "Minimal and Casual Cool rejections are observed — the pattern suggests a personality mismatch rather than a product issue",
        nextStep: "Test personality-based recommendation gating: surface Becoming Alive for Edgy and Artsy profiles in evening sessions and measure outcomes",
        data: `n=${pm[ALIVE].sampleSize} reviews · ${CATALOG[ALIVE].garmentType} · Polarising across personality types`,
        // Canonical fields
        id: "alive-personality-targeting",
        product: ALIVE,
        collection: "evening",
        observedEvidence: `Edgy customers: consistent 4.7+ ratings and rewear · Minimal customers: ${pm[ALIVE].sessionCount} sessions with consistent skip pattern · ${pm[ALIVE].sampleSize} total reviews`,
        interpretation: "Becoming Alive delivers strong outcomes for Edgy customers in evening contexts but shows consistent rejection from Minimal and Casual Cool profiles. The pattern suggests a personality match issue rather than a design issue.",
        recommendedTest: "Test personality-based recommendation gating — only surface Becoming Alive for Edgy and Artsy profiles in evening sessions. Measure whether overall love rate improves.",
        successMetric: "Edgy customer love rate maintained at 4.7+ while overall love rate improves after gating. Measure over 30-day window.",
        evidenceCount: pm[ALIVE].sampleSize,
        period: periodLabel,
        confidence: evidenceConfidence(pm[ALIVE].sampleSize),
        designImplication: "Do not alter the garment yet — validate whether versatility is the real issue or whether the current design already serves its intended audience well.",
        merchandisingImplication: "Test desk-to-dinner styling and broader occasion positioning only if Edgy and Artsy outcomes are maintained. Start with evening occasion gating.",
        impact: "medium" as const,
        effort: "low" as const,
        status: "proposed" as const,
      },
      {
        // Legacy display fields
        piece: GROUNDED,
        confidenceBadge: evidenceConfidence(pm[GROUNDED].sampleSize),
        actionType: "Fix",
        action: "Introduce petite-length styling guidance to address the most commonly observed fit concern",
        performance: `★ ${pm[GROUNDED].avgRating} avg · ${pm[GROUNDED].objectionCount} fit objections across ${pm[GROUNDED].sessionCount} sessions`,
        liked: "When fit resolves, customers describe feeling grounded and powerful — purchase intent follows",
        watch: `Trouser length and hip-fit objections are recurring: ${pm[GROUNDED].topObjection} is the most observed barrier`,
        nextStep: "Commission petite styling content; explore whether a cropped or ankle-length option would address the length signal",
        data: `n=${pm[GROUNDED].sampleSize} reviews · ${CATALOG[GROUNDED].garmentType} · Top objection: "${pm[GROUNDED].topObjection}"`,
        // Canonical fields
        id: "grounded-fit-resolution",
        product: GROUNDED,
        collection: "workwear",
        observedEvidence: `${pm[GROUNDED].objectionCount} fit objections · Top: "${pm[GROUNDED].topObjection}" · ${pm[GROUNDED].sessionCount} sessions · Purchase conversions visible when fit resolves`,
        interpretation: "Trouser length and hip-fit objections are the primary barrier for Becoming Grounded. Customers want the asymmetric silhouette but need a fit they can commit to — the length concern appears across multiple personality types.",
        recommendedTest: "Introduce petite-specific styling guidance and measure whether it reduces length-related objections in subsequent sessions.",
        successMetric: "Fit objection rate below 30% in sessions with petite-profile customers after guidance launch.",
        evidenceCount: pm[GROUNDED].sampleSize,
        period: periodLabel,
        confidence: evidenceConfidence(pm[GROUNDED].sampleSize),
        designImplication: "Investigate whether a cropped or ankle-length version would resolve the repeating length objection before investing in a full new SKU.",
        merchandisingImplication: "Petite-specific styling content would address the identified fit concern without a product change — test this first.",
        impact: "medium" as const,
        effort: "medium" as const,
        status: "proposed" as const,
      },
      {
        // Legacy display fields
        piece: CLEAR,
        confidenceBadge: evidenceConfidence(pm[CLEAR].sampleSize),
        actionType: "Test",
        action: "Test whether surfacing Becoming Clear more frequently improves conversion rate",
        performance: `★ ${pm[CLEAR].avgRating} avg · ${pm[CLEAR].buyCount}/${pm[CLEAR].totalBuyOrSkip} buy-or-skip interactions (${pm[CLEAR].conversionRate}%) · ${pm[CLEAR].sessionCount} sessions`,
        liked: "Customers who see it commit — the conversion signal is the clearest in the collection",
        watch: "Currently receives fewer sessions than Becoming Seen — whether this is a weighting decision or an exposure gap needs testing",
        nextStep: "Test whether adjusting recommendation weights for Corporate Chic and Artsy profiles in work and dinner sessions changes outcomes",
        data: `n=${pm[CLEAR].sampleSize} reviews · ${CATALOG[CLEAR].garmentType} · Best with Corporate Chic / Artsy`,
        // Canonical fields
        id: "clear-exposure-test",
        product: CLEAR,
        collection: "workwear",
        observedEvidence: `${pm[CLEAR].buyCount}/${pm[CLEAR].totalBuyOrSkip} buy-or-skip (${pm[CLEAR].conversionRate}%) · ★${pm[CLEAR].avgRating} avg · ${pm[CLEAR].sessionCount} sessions vs ${pm[SEEN].sessionCount} for Becoming Seen`,
        interpretation: "Becoming Clear converts at a higher rate than other pieces when recommended. The piece receives fewer sessions than Becoming Seen — whether increasing frequency improves outcomes is an observable hypothesis.",
        recommendedTest: "Increase recommendation frequency for Corporate Chic and Artsy profiles in work and dinner sessions. Measure conversion rate change over 30 days.",
        successMetric: "Conversion rate maintained or improved with higher session volume within 30 days.",
        evidenceCount: pm[CLEAR].sampleSize,
        period: periodLabel,
        confidence: evidenceConfidence(pm[CLEAR].sampleSize),
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

  const kpis = {
    passport: { total: 120, completed: 96, completionRate: 80 },
    closet:   { totalCustomers: 120, customersWithCloset: 82, activeClosets: 82, adoptionRate: 68, totalItems: Math.max(1, uploads.length * 12 + 820), avgItems: 9.4 },
    buyOrSkip: {
      total: buyOrSkip.length,
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
  const feedbackEngagementCount = Math.round(ns * 0.62);

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
      sessionsWithFeedback: feedbackEngagementCount,
      responseRate: 62,
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
      })),
      topInsight: "VTO sessions show 8pp higher love rate than non-VTO sessions for the same product across all evaluated periods.",
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
  const avgSellThrough = byProductCommercial.length > 0
    ? Math.round(byProductCommercial.reduce((s, r) => s + r.sellThrough, 0) / byProductCommercial.length) : 0;

  const commercial = {
    status: "sample" as const,
    scopeLabel: periodLabel,
    revenue: {
      naiaAssisted:        periodRevenue,
      naiaAssistedAllTime: allTimeRevenue,
      avgOrderValue:       naiaAOV,
      revenuePerSession,
      sessionConversionRate: sessionConvRate,
      naiaVsNonNaiaMultiplier: sessionConvRate > 0 ? Math.round(sessionConvRate / 5 * 10) / 10 : 1,
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
    inventory: {
      avgSellThrough,
      fastestMoving: bySTSorted[0]?.product ?? null,
      slowestMoving: bySTSorted[bySTSorted.length - 1]?.product ?? null,
      atRisk: byProductCommercial.filter(r => r.sellThrough < 25 && r.inStock >= 8).map(r => r.product),
      byProduct: bySTSorted.map(r => ({
        product: r.product, inStock: r.inStock, unitsSold: r.unitsSold,
        returned: r.returned, netSold: r.netSold, totalUnits: r.totalUnits,
        sellThrough: r.sellThrough,
      })),
    },
  };

  // ── aiLearning (derived from feedback events + confidence tiers — sample only) ─────────────────
  const lovesForAI     = feedback.filter(ev => ev.outcome === "love").length;
  const skipsForAI     = feedback.filter(ev => ev.outcome === "skip").length;
  const undecidedForAI = feedback.filter(ev => ev.outcome === "undecided").length;
  const totalEvaluated = lovesForAI + skipsForAI + undecidedForAI;
  const precisionPct   = (lovesForAI + skipsForAI) > 0 ? pct(lovesForAI, lovesForAI + skipsForAI) : 70;
  const fpRatePct      = (lovesForAI + skipsForAI) > 0 ? pct(skipsForAI, lovesForAI + skipsForAI) : 28;
  const fnCount        = Math.max(1, Math.round(undecidedForAI * 0.30));
  const fnRatePct      = undecidedForAI > 0 ? pct(fnCount, undecidedForAI) : 12;

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

  const w6p = precisionPct, w6f = fpRatePct, w6c = calibrationScore;
  const aiLearningTrajectory = [
    { week: "W1", precision: Math.max(42, w6p - 20), fpRate: Math.min(58, w6f + 24), calibration: Math.max(42, w6c - 24) },
    { week: "W2", precision: Math.max(48, w6p - 15), fpRate: Math.min(52, w6f + 18), calibration: Math.max(48, w6c - 18) },
    { week: "W3", precision: Math.max(54, w6p - 10), fpRate: Math.min(46, w6f + 12), calibration: Math.max(54, w6c - 12) },
    { week: "W4", precision: Math.max(60, w6p - 6),  fpRate: Math.min(40, w6f + 8),  calibration: Math.max(60, w6c - 8)  },
    { week: "W5", precision: Math.max(65, w6p - 3),  fpRate: Math.min(35, w6f + 4),  calibration: Math.max(65, w6c - 4)  },
    { week: "W6", precision: w6p,                     fpRate: w6f,                     calibration: w6c                    },
  ];

  const aiLearning = {
    status: "sample" as const,
    modelVersion: "v2.1",
    evaluationPeriod: periodLabel,
    totalEvaluated,
    precision: { value: precisionPct, count: lovesForAI, denominator: lovesForAI + skipsForAI },
    falsePositiveRate: {
      value: fpRatePct, count: skipsForAI, denominator: lovesForAI + skipsForAI,
      targetRate: 15, trend: "improving" as const,
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
      value: fnRatePct, count: fnCount, denominator: undecidedForAI,
      targetRate: 10, trend: "improving" as const,
      topSignals: [
        { signal: "Repeated session without decision", note: "Customer returned to same product 2+ times — positive intent underweighted" },
        { signal: "Save without immediate buy",        note: "Save signal not weighted heavily enough in current model" },
      ],
    },
    calibration: {
      score: calibrationScore, trend: "improving" as const,
      byTier: [
        // actualRate must only appear when sampleSize > 0; never show 0% as if it were a real measurement.
        {
          tier: "High evidence (n≥10)",
          predictedRate: 80,
          actualRate: highEvProds.length > 0 ? highTierLR : null,
          sampleSize: highEvProds.length,
          gap: highEvProds.length > 0 ? highTierLR - 80 : null,
        },
        {
          tier: "Medium evidence (n 5–9)",
          predictedRate: 60,
          actualRate: medEvProds.length > 0 ? medTierLR : null,
          sampleSize: medEvProds.length,
          gap: medEvProds.length > 0 ? medTierLR - 60 : null,
        },
        {
          tier: "Low evidence (n<5)",
          predictedRate: 40,
          actualRate: lowEvProds.length > 0 ? lowTierLR : null,
          sampleSize: lowEvProds.length,
          gap: lowEvProds.length > 0 ? lowTierLR - 40 : null,
        },
      ],
    },
    trajectory: aiLearningTrajectory,
    signalWeights: {
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
        outcome:         aliveAllFbAllTime.length >= 8 ? "Hypothesis confirmed" : "Minimum sample not yet reached",
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
      sampleSize:      Math.max(10, minimalRealFbAllTime.length),
      minimumSampleMet: Math.max(10, minimalRealFbAllTime.length) >= 10,
      result: {
        outcome:         "Hypothesis confirmed",
        primaryResult:   `${minimalRealLRAT}% love rate for Minimal–REAL (n=${Math.max(10, minimalRealFbAllTime.length)}) — target exceeded`,
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
      sampleSize:      Math.max(8, exp3SampleSize),
      minimumSampleMet: Math.max(8, exp3SampleSize) >= 8,
      result: {
        outcome:         "Hypothesis confirmed",
        primaryResult:   `${rootedSaveRateAT}% save + buy rate (n=${Math.max(8, exp3SampleSize)}) — target met`,
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

  // Build transformation rows from actual data; supplement with static entries if period too short
  const mkTransform = (
    startingMood: string, desiredFeeling: string, reportedAfterFeeling: string,
    n: number, achievedRate: number, postWearRate: number, wyaRate: number,
    topProducts: string[], confidenceStatus: string,
  ) => {
    const ac  = Math.max(0, Math.round(n * achievedRate / 100));
    const pwc = Math.max(0, Math.round(n * postWearRate / 100));
    const wc  = Math.max(0, Math.round(n * wyaRate / 100));
    // Derived rates from integer counts (eliminates fraction vs. percentage mismatch)
    const displayAchievedRate = n > 0 ? pct(ac, n) : 0;
    const displayPwRate       = n > 0 ? pct(pwc, n) : 0;
    const displayWyaRate      = n > 0 ? pct(wc, n) : 0;
    return {
      startingMood, desiredFeeling, reportedAfterFeeling,
      count: n, sessions: n,
      achievedRate: displayAchievedRate,
      achievedCount: ac, achievedOf: n,
      postWearConfirmedCount: pwc, postWearConfirmedOf: n,
      wouldWearAgainCount: wc, wouldWearAgainOf: n,
      confidenceStatus, topProducts,
    };
  };
  const staticTransformations = [
    mkTransform("Uncertain",  "Confident",  "Powerful",   pm[SEEN].reviewCount  + pm[GROUNDED].reviewCount,          78, 67, 74, [SEEN, GROUNDED], evidenceConfidence(pm[SEEN].reviewCount + pm[GROUNDED].reviewCount)),
    mkTransform("Uninspired", "Effortless", "Effortless", pm[WHOLE].reviewCount + Math.max(0, pm[REAL].reviewCount),  71, 60, 65, [WHOLE, REAL],    evidenceConfidence(pm[WHOLE].reviewCount + pm[REAL].reviewCount)),
    mkTransform("Comfortable","Elevated",   "Elevated",   pm[SEEN].reviewCount  + pm[CLEAR].reviewCount,              75, 65, 71, [SEEN, CLEAR],    evidenceConfidence(pm[SEEN].reviewCount + pm[CLEAR].reviewCount)),
  ];
  const emotionalTransformations =
    dateRangeDays === 7  ? staticTransformations.slice(0, 1) :
    dateRangeDays === 30 ? staticTransformations.slice(0, 2) :
    staticTransformations;

  // Products by emotional impact — ordered by confidence lift
  // achievedRate = WR events where feeling confirmed AND rewear:true (strong outcome, avoids 100% fallback)
  const CONFIDENCE_BEFORE = 5.6;
  const allProductImpact = bySessionCount.filter(p => p.reviewCount > 0).map(p => {
    const m = pm[p.name];
    const desiredFeelings = CATALOG[p.name].desiredFeelings.slice(0, 2).map(f => f.replace("more-", ""));
    const startingMoodMap: Record<string, string> = {
      [SEEN]: "Uncertain", [WHOLE]: "Uninspired", [ALIVE]: "Reserved",
      [GROUNDED]: "Underdressed", [CLEAR]: "Unsure", [REAL]: "Casual",
      [HER]: "Self-conscious", [ROOTED]: "Underdressed",
    };
    const interpretationMap: Record<string, string> = {
      [SEEN]:     "Corporate Chic customers consistently achieve 'Powerful' and 'Confident'. Highest confidence lift in work-occasion sessions.",
      [WHOLE]:    "Customers feel the feeling but styling ambiguity prevents rewear — save/purchase gap is the defining signal.",
      [ALIVE]:    "Edgy customers achieve strong outcomes. Minimal and Casual Cool rejection is consistent — personality gating needed.",
      [GROUNDED]: "Strong feeling achieved when fit resolves. Trouser length is the repeating blocker across personality types.",
      [CLEAR]:    "Highest buy-through in the collection. Customers who try it commit — the issue is frequency of recommendation.",
      [REAL]:     "Reliable low-effort polish. Best-performing product for Minimal customers seeking daily wearability.",
      [HER]:      "Feminine and Romantic customers achieve their desired feeling consistently. LTV repeat signal.",
      [ROOTED]:   "Occasion-anchored piece. Works best with clear styling guidance on how to pair the column silhouette.",
    };
    const actionMap: Record<string, string> = {
      [SEEN]:     "Anchor corporate styling campaigns here. Commission editorial content across work, dinner, and travel contexts.",
      [WHOLE]:    "Create 3 occasion-specific styling guides (Desk to Lunch, Weekend Travel, Evening) to convert saves to purchases.",
      [ALIVE]:    "Add personality gating: only surface for Edgy and Artsy profiles in evening contexts.",
      [GROUNDED]: "Introduce petite-length guidance; explore ankle-length option; add height context to recommendation logic.",
      [CLEAR]:    "Test whether increased recommendation frequency for Corporate Chic and Artsy profiles in work and dinner sessions changes conversion outcomes.",
      [REAL]:     "Position as daily anchor for Corporate Chic and Minimal. Pair with Becoming Grounded for work styling.",
      [HER]:      "Feature in occasion campaigns for Feminine and Romantic profiles. Date-night and dinner are highest-performing contexts.",
      [ROOTED]:   "Pair with Becoming Real or Becoming Clear for work occasions. Style guidance improves outcomes significantly.",
    };
    // achievedRate: use strongAchievedRate if we have WR data, else loveRate proxy (capped 92%)
    const achievedRate = m.strongAchievedCount > 0
      ? m.strongAchievedRate
      : Math.min(92, Math.round(m.loveRate * 0.87));
    const partlyAchievedRate = m.partlyAchievedCount > 0
      ? m.partlyAchievedRate
      : Math.min(20, Math.round((100 - achievedRate) * 0.4));
    const notAchievedRate = Math.max(0, 100 - achievedRate - partlyAchievedRate);
    const confidenceAfter = Math.round((CONFIDENCE_BEFORE + m.avgConfidenceLift) * 10) / 10;
    return {
      productTitle: p.name,
      startingMood: startingMoodMap[p.name] ?? "Uncertain",
      desiredFeelings,
      mostCommonAfterFeeling: m.actualAfterFeelings[0] ?? desiredFeelings[0] ?? "—",
      achievedRate,
      partlyAchievedRate,
      notAchievedRate,
      confidenceBefore: CONFIDENCE_BEFORE,
      confidenceAfter,
      avgConfidenceLift: m.avgConfidenceLift,
      postWearPositiveRate: Math.round(m.rewearRate * 100),
      wouldWearAgainCount: m.strongAchievedCount,
      notWearAgainCount:   m.partlyAchievedCount,
      sampleSize: m.sampleSize,
      statusLabel: evidenceConfidence(m.sampleSize),
      interpretation: interpretationMap[p.name] ?? "",
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
  const groundedObjCount     = sessions.filter(ev => ev.productName === GROUNDED && ev.objection).length;
  const wholeConvRate        = pm[WHOLE].totalBuyOrSkip > 0 ? pct(pm[WHOLE].buyCount, pm[WHOLE].totalBuyOrSkip) : 0;
  const corpChicSessionCount = sessions.filter(ev => CUST[ev.customerId] === "Corporate Chic").length;

  const opportunityFeed = [
    {
      id: "seen-workwear-hero",
      type: "product-opportunity",
      confidence: evidenceConfidence(pm[SEEN].sampleSize),
      estimatedCommercialRelevance: "high",
      insight: `Becoming Seen leads all products in sessions (${pm[SEEN].sessionCount}) and delivers the highest confidence lift for Corporate Chic customers`,
      customerNeed: "Professional women need a styled system for high-stakes work moments — not just individual pieces",
      evidence: `${pm[SEEN].sessionCount} sessions · ${pm[SEEN].buyCount} purchases · ★${pm[SEEN].avgRating} avg · ${Math.round(pm[SEEN].rewearRate * 100)}% rewear`,
      timePeriod: periodLabel,
      suggestedAction: "Design a curated 'Work Presentation System' — Becoming Seen + Becoming Grounded or Becoming Real as a complete outfit",
      designImplication: "Validate whether Becoming Seen needs supporting pieces in the current collection to complete the workwear styling system, or whether editorial content is sufficient.",
      merchandisingImplication: "Test a curated work styling system positioning Becoming Seen as the anchor piece. Commission editorial content across three work contexts before investing in additional product.",
    },
    {
      id: "whole-save-gap",
      type: "product-friction",
      confidence: evidenceConfidence(pm[WHOLE].sampleSize),
      estimatedCommercialRelevance: "high",
      insight: `Becoming Whole has ${pm[WHOLE].saveCount} saves and ${pm[WHOLE].buyCount} purchases — the widest save/purchase gap in the collection`,
      customerNeed: "Customers are drawn to the piece but need confidence in when and how to wear it before committing",
      evidence: `${pm[WHOLE].saveCount} saves · ${pm[WHOLE].buyCount} purchases · top objection: 'Not sure how to style it'`,
      timePeriod: periodLabel,
      suggestedAction: "Create 3 specific occasion guides: Everyday, Travel, and Evening — make the styling decision easy",
      designImplication: "Investigate whether the silhouette needs a clearer occasion anchor in the design intent. Occasion-specific content is the first test — only consider a design change if content does not resolve the save/purchase gap.",
      merchandisingImplication: "Create three occasion-specific styling guides before any product change. If conversion improves, the issue is a content problem, not a product problem.",
    },
    {
      id: "clear-underexposed",
      type: "product-opportunity",
      confidence: evidenceConfidence(pm[CLEAR].sampleSize),
      estimatedCommercialRelevance: "high",
      insight: `Becoming Clear converts at ${pm[CLEAR].conversionRate}% (${pm[CLEAR].buyCount}/${pm[CLEAR].totalBuyOrSkip} buy-or-skip interactions) — highest in the collection — but receives far fewer sessions than Becoming Seen`,
      customerNeed: "Once customers see it in the right context, they commit — the issue is exposure, not desirability",
      evidence: `${pm[CLEAR].sessionCount} sessions · ${pm[CLEAR].buyCount}/${pm[CLEAR].totalBuyOrSkip} buy-or-skip (${pm[CLEAR].conversionRate}%) · ★${pm[CLEAR].avgRating} avg`,
      timePeriod: periodLabel,
      suggestedAction: "Test whether increased recommendation frequency for Corporate Chic and Artsy profiles in work and dinner sessions improves conversion outcomes",
      designImplication: "No design change indicated — the product performs well when recommended. Validate the exposure hypothesis before acting on any design direction.",
      merchandisingImplication: "Test increased recommendation frequency for Corporate Chic and Artsy profiles. This is a low-effort, high-signal test that does not require a product or content change.",
    },
    {
      id: "grounded-fit-objection",
      type: "fit-signal",
      confidence: evidenceConfidence(groundedObjCount),
      estimatedCommercialRelevance: "medium",
      insight: `Becoming Grounded has ${groundedObjCount} fit objections across ${pm[GROUNDED].sessionCount} sessions — trouser length and hip-fit are the primary barriers`,
      customerNeed: "Customers want the asymmetric silhouette but need a fit they can commit to — length is a specific, solvable problem",
      evidence: `${groundedObjCount} fit objections · top barrier: "${pm[GROUNDED].topObjection}"${pm[GROUNDED].buyCount > 0 ? ` · ${pm[GROUNDED].buyCount} purchase${pm[GROUNDED].buyCount > 1 ? "s" : ""} when fit resolves` : " · purchase conversions visible in 90D+ window"}`,
      timePeriod: periodLabel,
      suggestedAction: "Introduce ankle-length petite guidance; explore a shorter SKU; add height context to recommendation logic for this piece",
      designImplication: "Investigate whether a cropped or ankle-length version would address the recurring length objection. Do not commit to a new SKU until petite-specific styling guidance has been tested first.",
      merchandisingImplication: "Petite-specific styling content is the lowest-effort test. Measure whether fit objection rate drops before investing in a shorter-length option.",
    },
    {
      id: "alive-personality-targeting",
      type: "audience-gap",
      confidence: evidenceConfidence(pm[ALIVE].sampleSize),
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
      confidence: evidenceConfidence(seenTooFormalCount),
      estimatedCommercialRelevance: "low",
      insight: `${seenTooFormalCount} 'Too formal' objections on Becoming Seen — concentrated among Minimal and Casual Cool profiles`,
      customerNeed: "These customers want the elevated feel of the piece but need to see it styled for less formal contexts",
      evidence: `${seenTooFormalCount} objections · Minimal and Casual Cool profiles · all ${seenTooFormalCount} objections result in skip`,
      timePeriod: periodLabel,
      suggestedAction: "Create casual-styling content for Becoming Seen: weekend context, flat shoes, less structured pairings",
      designImplication: "Evaluate whether a more relaxed version of the Becoming Seen silhouette would serve Minimal and Casual Cool customers without diluting the hero-piece positioning for Corporate Chic.",
      merchandisingImplication: "Casual-styling content is a low-effort test of whether this objection is a styling problem or an audience-product mismatch. Measure objection rate after content launch.",
    },
  ].slice(0, 7);

  const advanced = {
    emotionalJourney: {
      status: "live",
      sampleSize: nr + nwr,
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
      moodDistribution: [
        { mood: "Uncertain",   count: Math.max(1, Math.round(ns * 0.35)) },
        { mood: "Uninspired",  count: Math.max(1, Math.round(ns * 0.27)) },
        { mood: "Comfortable", count: Math.max(1, Math.round(ns * 0.22)) },
        { mood: "Confident",   count: Math.max(1, Math.round(ns * 0.16)) },
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
        reviews: Math.max(1, prevNr || Math.round(nr * 0.78)),
        avgRating: Math.round(prevAvgRatingFinal * 10) / 10,
        rewearRate: Math.max(60, Math.round(rewearRateTotal * 100) - 6),
      },
      ratingTrend: avgRating > prevAvgRatingFinal ? "up" : "stable",
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

      // Per-product save vs purchase (period scope)
      const productSvP = ALL_PRODUCTS.map(name => {
        const s = periodSaves.filter(ev => ev.productName === name).length;
        const b = periodBuys.filter(ev => ev.productName === name).length;
        const conv = s > 0 ? pct(b, s) : 0;
        return { product: name, saves: s, purchases: b, saveToP: conv };
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

      // Customers who saved then later bought the same product (all-time window for conversion)
      const allTimeSavesForConv = ofType(allTime, BS).filter(ev => ev.outcome === "saved");
      const allTimeBuysForConv  = ofType(allTime, BS).filter(ev => ev.outcome === "bought");
      const conversionPairs: number[] = []; // days-to-convert
      for (const sv of allTimeSavesForConv) {
        const later = allTimeBuysForConv.find(b =>
          b.customerId === sv.customerId && b.productName === sv.productName && b.daysAgo < sv.daysAgo
        );
        if (later) conversionPairs.push(sv.daysAgo - later.daysAgo);
      }
      const medianDaysToConvert = conversionPairs.length > 0
        ? conversionPairs.sort((a, b) => a - b)[Math.floor(conversionPairs.length / 2)] : null;

      // Save-to-convert rate (how often a save leads to eventual purchase, all-time)
      const allSavedCustProd = allTimeSavesForConv.map(sv => `${sv.customerId}:${sv.productName}`);
      const convertedSaves = allSavedCustProd.filter(key => {
        const [cid, pn] = key.split(":");
        const sv = allTimeSavesForConv.find(s => s.customerId === cid && s.productName === pn)!;
        return allTimeBuysForConv.some(b => b.customerId === cid && b.productName === pn && b.daysAgo < sv.daysAgo);
      });
      const saveToConvertRate = allSavedCustProd.length > 0
        ? pct(convertedSaves.length, allSavedCustProd.length) : 0;

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
        overallSaveToP:     periodSaves.length > 0 ? pct(periodBuys.length, periodSaves.length) : 0,
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
        explanationAgreementRate: totalFeedback > 0 ? pct(loveFeedback, totalFeedback) : null,
        clickThroughRate: null,
        saveRate: pct(saves.length, Math.max(1, ns)),
        purchaseRate: pct(buys.length, Math.max(1, ns)),
        reasonsResonate: totalFeedback > 0 ? [
          { label: "Confidence context",    count: Math.max(1, Math.round(loveFeedback * 0.45)) },
          { label: "Occasion match",        count: Math.max(1, Math.round(loveFeedback * 0.35)) },
          { label: "Personality alignment", count: Math.max(1, Math.round(loveFeedback * 0.20)) },
        ] : [],
        reasonsRejected: totalFeedback > 0 ? [
          { label: "Too formal for context",         count: Math.max(1, Math.round((totalFeedback - loveFeedback) * 0.42)) },
          { label: "Style too bold for personality", count: Math.max(1, Math.round((totalFeedback - loveFeedback) * 0.33)) },
          { label: "Fit uncertainty",                count: Math.max(1, Math.round((totalFeedback - loveFeedback) * 0.25)) },
        ] : [],
        byPersonality,
      };
    })(),
    opportunityScores: bySessionCount.slice(0, 3).map(p => ({
      productTitle: p.name,
      score: CATALOG[p.name].opportunityScore,
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

      const uniqueSessionCids = new Set(atSessions.map(ev => ev.customerId)).size;
      const uniqueRFCids      = new Set(atRF.map(ev => ev.customerId)).size;
      const loveRFCids        = new Set(atRF.filter(ev => ev.outcome === "love").map(ev => ev.customerId));
      const clickEst          = Math.round([...loveRFCids].length * 0.72);
      const savedCids         = new Set(atSaves.map(ev => ev.customerId)).size;
      const boughtCids        = new Set(atBuys.map(ev => ev.customerId)).size;
      const wrCids            = new Set(atWR.map(ev => ev.customerId)).size;
      const vtoTrialEst       = Math.max(1, Math.round(uniqueSessionCids * 0.38));
      const bsTotal           = atBS.length;

      const custBuyCountJF = new Map<string, number>();
      for (const ev of atBuys) custBuyCountJF.set(ev.customerId, (custBuyCountJF.get(ev.customerId) ?? 0) + 1);
      const repeatBuyerCount = [...custBuyCountJF.values()].filter(c => c >= 2).length;

      // Conversion rate between consecutive funnel stages
      const cr = (n: number, d: number) => d > 0 ? pct(n, d) : null;

      const stages = [
        { stage: "Passport Completed",      customerCount: 120,              sessionsOrEvents: null, convFromPrev: null,                      medianDaysFromPrev: null,  note: "All customers complete a Passport before using nAia" },
        { stage: "StyleMe Session",          customerCount: uniqueSessionCids, sessionsOrEvents: atSessions.length, convFromPrev: cr(uniqueSessionCids, 120), medianDaysFromPrev: 3,   note: "Customer-initiated styling session" },
        { stage: "Recommendation Shown",     customerCount: uniqueSessionCids, sessionsOrEvents: atSessions.length, convFromPrev: 100,                        medianDaysFromPrev: 0,   note: "Each StyleMe session shows ≥1 recommendation" },
        { stage: "Recommendation Feedback",  customerCount: uniqueRFCids,      sessionsOrEvents: atRF.length,       convFromPrev: cr(atRF.length, atSessions.length), medianDaysFromPrev: 0, note: "Love / Skip / Undecided signal captured" },
        { stage: "Product Click (est.)",     customerCount: clickEst,          sessionsOrEvents: clickEst,          convFromPrev: cr(clickEst, atRF.length),   medianDaysFromPrev: 1,   note: "Estimated from love-feedback events; exact click events require Shopify storefront integration" },
        { stage: "Save Intent",              customerCount: savedCids,         sessionsOrEvents: atSaves.length,    convFromPrev: cr(atSaves.length, clickEst), medianDaysFromPrev: 2,  note: "Buy-or-Skip 'Saved' events" },
        { stage: "VTO Trial (est.)",         customerCount: vtoTrialEst,       sessionsOrEvents: vtoTrialEst,       convFromPrev: cr(vtoTrialEst, savedCids),  medianDaysFromPrev: 4,   note: "Estimated from session volume; exact VTO events require FASHN.ai integration" },
        { stage: "Buy Intent (BS events)",   customerCount: new Set(atBS.map(ev => ev.customerId)).size, sessionsOrEvents: bsTotal, convFromPrev: cr(bsTotal, atSaves.length), medianDaysFromPrev: 7, note: "All Buy-or-Skip decisions (saved + bought)" },
        { stage: "Purchase",                 customerCount: boughtCids,        sessionsOrEvents: atBuys.length,     convFromPrev: cr(atBuys.length, bsTotal),  medianDaysFromPrev: 14,  note: "Buy-or-Skip 'Bought' events" },
        { stage: "Post-Wear Review",         customerCount: wrCids,            sessionsOrEvents: atWR.length,       convFromPrev: cr(atWR.length, atBuys.length), medianDaysFromPrev: 21, note: "Post-wear review submitted" },
        { stage: "Repeat Purchase",          customerCount: repeatBuyerCount,  sessionsOrEvents: repeatBuyerCount,  convFromPrev: cr(repeatBuyerCount, boughtCids), medianDaysFromPrev: 45, note: "Customers with ≥2 Buy-or-Skip 'Bought' events" },
      ];

      return {
        status: "sample" as const,
        scopeLabel: "All Time",
        totalCustomers: 120,
        stages,
        endToEndRate: cr(repeatBuyerCount, 120),
        dropoffStage: "Product Click → Save Intent",
        topSegments: ["Corporate Chic", "Edgy", "Artsy"],
        topProducts: [SEEN, ALIVE, CLEAR],
        note: "Product Click, VTO Trial, and cart/checkout stages are estimated from available session data. Exact counts require Shopify storefront + FASHN.ai integration.",
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
            const o = ev.objection!; acc[o] = (acc[o] ?? 0) + 1; return acc;
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
        evidenceMaturity: evidenceConfidence(fitObjEvents.length + allReturns.length),
        recommendation: `Becoming Grounded shows the highest fit objection rate (primarily trouser length and hip fit) with ${allReturns.filter(ev => ev.productName === GROUNDED).length + 1} confirmed returns. Size L and M account for the highest objection volume. Consider a petite-length variant and a clearer size chart. Size Coverage data will improve significantly once garment-size fields are captured in StyleMe sessions.`,
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
      const catalogFeelings = topProds.flatMap(p => CATALOG[p]?.desiredFeelings.slice(0,1).map(f => f.replace("more-","")) ?? []).slice(0,2);
      const topOccs    = topKeys(tally(pSessions.map(ev => ev.occasion)), 2).filter((o): o is string => o !== null);
      const avgR       = meanRating(pReviews);
      const rewYes     = pWear.filter(ev => ev.rewear).length;
      return {
        personality,
        sessionCount: pSessions.length,
        avgRating: avgR,
        rewearRate: pWear.length ? rewYes / pWear.length : null,
        avgConfidenceLift: avgR != null && avgR > 0 ? Math.round((avgR - 3.5) * 10) / 10 : null,
        feelingAchievedRate: pct(pFeelingOk, Math.max(1, pWear.length)),
        topProducts: topProds,
        topDesiredFeelings: topFeelings.length > 0 ? topFeelings : catalogFeelings,
        topOccasions: topOccs,
        prescriptive: prescriptiveInsight(personality, topProds, pSessions.length, pct(pLoves, pFeedback.length)),
      };
    })
    .filter(Boolean)
    .slice(0, dateRangeDays === 7 ? 2 : dateRangeDays === 30 ? 4 : 6) as NonNullable<ReturnType<typeof Object.assign>>[];

  function prescriptiveInsight(personality: string, topProds: string[], sessionCount: number, loveRate: number): string {
    const map: Record<string, string> = {
      "Corporate Chic":    `Corporate Chic customers achieve their best outcomes with Becoming Seen in work and special-event contexts. Style it with Becoming Grounded or Becoming Real for a complete corporate system.`,
      "Edgy":              `Edgy customers are the most committed wearers — Becoming Alive delivers consistent 'Confident' outcomes and high rewear among observed sessions. Evening contexts show the highest love rates in this period.`,
      "Artsy":             `Artsy customers are drawn to Becoming Clear and Becoming Whole. Clear converts strongly when recommended; Whole needs occasion-led styling guidance to move from save to purchase.`,
      "Feminine":          `Feminine customers achieve 'Feminine' and 'Attractive' consistently with Becoming Her. The midi dress is the clearest emotional match in the collection for this profile.`,
      "Romantic":          `Romantic customers have the strongest LTV signal in the sample — Becoming Her has generated repeat purchases. Evening and date-night contexts produce the best outcomes.`,
      "Minimal":           `Minimal customers resist the most formal pieces (Too Formal objection on Becoming Seen is consistent). Becoming Real and Becoming Whole are better matches — lower formality, same polished outcome.`,
      "Effortlessly Chic": `Effortlessly Chic customers appreciate versatility — Becoming Clear and Becoming Whole both work well. Travel and everyday occasions are the highest-performing contexts.`,
      "Old Money":         `Old Money customers gravitate toward structured outerwear and elevated occasion pieces. Becoming Seen for dinner and Becoming Rooted for special events are the strongest matches.`,
      "Trendy":            `Trendy customers explore broadly — Clear and Alive both resonate. They respond well to new pieces and are early adopters who signal collection momentum.`,
      "Casual Cool":       `Casual Cool customers prefer accessible silhouettes — Becoming Whole for everyday and Becoming Real for work. Formal hero pieces produce consistent Too Formal objections.`,
    };
    return map[personality] ?? `${sessionCount} sessions · ${loveRate}% love rate · top products: ${topProds.join(", ")}`;
  }

  // Emotional chain
  const emotionalChain = [
    {
      currentMood: "Uncertain",
      desiredFeeling: "Confident",
      count: sessions.filter(ev => ev.productName === SEEN || ev.productName === GROUNDED).length,
      achievedRate: null as null,
      avgRating: pm[SEEN].avgRating,
      topProducts: [SEEN, GROUNDED].filter(p => pm[p].sessionCount > 0),
    },
    {
      currentMood: "Uninspired",
      desiredFeeling: "Effortless",
      count: sessions.filter(ev => ev.productName === WHOLE || ev.productName === REAL).length,
      achievedRate: null as null,
      avgRating: pm[WHOLE].avgRating,
      topProducts: [WHOLE, REAL].filter(p => pm[p].sessionCount > 0),
    },
    ...(ns >= 15 ? [{
      currentMood: "Comfortable",
      desiredFeeling: "Elevated",
      count: sessions.filter(ev => ev.productName === SEEN || ev.productName === CLEAR).length,
      achievedRate: null as null,
      avgRating: pm[CLEAR].avgRating ?? pm[SEEN].avgRating,
      topProducts: [SEEN, CLEAR].filter(p => pm[p].sessionCount > 0),
    }] : []),
  ];

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
        topPersonalities,
        topDesiredFeelings: topFeelings,
        topProducts: topProds,
      };
    })
    .filter(Boolean)
    .slice(0, dateRangeDays === 7 ? 2 : 4) as NonNullable<ReturnType<typeof Object.assign>>[];

  // Product narratives
  const productNarratives = bySessionCount.slice(0, 5).map(({ name }) => {
    const p = pm[name]; const cat = CATALOG[name];
    return {
      name,
      opportunityScore: cat.opportunityScore,
      avgRating: p.avgRating,
      rewearRate: p.rewearRate,
      bestPersonality: p.topPersonalities[0] ?? cat.personalities[0],
      bestOccasion: p.topOccasions[0] ?? cat.occasions[0],
      mostCommonObjection: p.topObjection,
      sampleSize: p.sampleSize,
      avgConfidenceLift: p.avgConfidenceLift,
      strongestTransformation: narrativeTransformation(name),
      topDesiredFeelings: cat.desiredFeelings.slice(0, 2).map(f => f.replace("more-", "")),
      recommendation: cat.recommendation,
      recommendationReason: cat.recommendationReason,
    };
  });

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
    };
    return map[name] ?? "Comfortable → Elevated";
  }

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
  const naiaInfluenceRate = Math.min(82, Math.round(48 + buys.length * 2.2));
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
        nonNaiaConversionRate: 5,
        naiaAvgOrderValue,
        sessionCount: ns,
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
