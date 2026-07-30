/**
 * Expanded synthetic event dataset — customers C16–C120.
 * All events are deterministic and linked by customerId.
 * Import this alongside the base EVENTS array in designer-sample-data.ts.
 *
 * Narrative extensions:
 *   7D:  More CLEAR momentum (EF Chic, Old Money, Trendy converting); Rooted gaining traction.
 *  30D:  SEEN dominant across CC cohort; WHOLE save-gap persistent; ALIVE polarising at scale.
 *  90D:  Personality-product relationships clear at larger sample; fit objections stable pattern.
 * ALL:   Full LTV signals; repeat wear; multi-product customers; one Grounded petite return cohort.
 */

// ── Products (must match main file) ────────────────────────────────────────────
const SEEN     = "Becoming Seen";
const WHOLE    = "Becoming Whole";
const ALIVE    = "Becoming Alive";
const GROUNDED = "Becoming Grounded";
const CLEAR    = "Becoming Clear";
const REAL     = "Becoming Real";
const HER      = "Becoming Her";
const ROOTED   = "Becoming Rooted";

// ── Event type constants ────────────────────────────────────────────────────────
type ET = "STYLING_SESSION" | "POST_OUTFIT_REVIEW" | "POST_WEAR_REVIEW" |
          "RECOMMENDATION_FEEDBACK" | "BUY_OR_SKIP" | "CLOSET_UPLOAD" | "RETURN";
const SS = "STYLING_SESSION" as ET, OR = "POST_OUTFIT_REVIEW" as ET,
      WR = "POST_WEAR_REVIEW" as ET,  RF = "RECOMMENDATION_FEEDBACK" as ET,
      BS = "BUY_OR_SKIP" as ET,       CU = "CLOSET_UPLOAD" as ET,
      RT = "RETURN" as ET;

interface SE {
  daysAgo: number; customerId: string; eventType: ET; productName: string | null;
  occasion: string | null; desiredFeeling: string | null; actualAfterFeeling: string | null;
  outcome: "love" | "skip" | "undecided" | "bought" | "saved" | null;
  objection: string | null; rewear: boolean | null; rating: number | null;
  confidenceBefore: number | null; confidenceAfter: number | null;
}

function ev(
  d: number, cid: string, et: ET, pn: string | null,
  x: Partial<Omit<SE, "daysAgo"|"customerId"|"eventType"|"productName">> = {}
): SE {
  return {
    daysAgo: d, customerId: cid, eventType: et, productName: pn,
    occasion: x.occasion ?? null, desiredFeeling: x.desiredFeeling ?? null,
    actualAfterFeeling: x.actualAfterFeeling ?? null, outcome: x.outcome ?? null,
    objection: x.objection ?? null, rewear: x.rewear ?? null, rating: x.rating ?? null,
    confidenceBefore: x.confidenceBefore ?? null, confidenceAfter: x.confidenceAfter ?? null,
  };
}

// Shorthand helpers — each returns an array of events
function sl(d: number, cid: string, p: string, occ: string, feel: string): SE[] {
  return [ev(d, cid, SS, p, { occasion: occ, desiredFeeling: feel }),
          ev(d, cid, RF, p, { outcome: "love" })];
}
function slb(d: number, cid: string, p: string, occ: string, feel: string): SE[] {
  return [...sl(d, cid, p, occ, feel), ev(d, cid, BS, p, { outcome: "bought" })];
}
function sls(d: number, cid: string, p: string, occ: string, feel: string): SE[] {
  return [...sl(d, cid, p, occ, feel), ev(d, cid, BS, p, { outcome: "saved" })];
}
function ss(d: number, cid: string, p: string, occ: string, feel: string): SE[] {
  return [ev(d, cid, SS, p, { occasion: occ, desiredFeeling: feel })];
}
function sskip(d: number, cid: string, p: string, occ: string, feel: string, obj: string): SE[] {
  return [ev(d, cid, SS, p, { occasion: occ, desiredFeeling: feel, objection: obj }),
          ev(d, cid, RF, p, { outcome: "skip" })];
}
function sundc(d: number, cid: string, p: string, occ: string, feel: string, obj: string): SE[] {
  return [ev(d, cid, SS, p, { occasion: occ, desiredFeeling: feel, objection: obj }),
          ev(d, cid, RF, p, { outcome: "undecided" })];
}
function wr(d: number, cid: string, p: string, df: string, af: string, rewear: boolean, rating: number, cb: number, ca: number): SE {
  return ev(d, cid, WR, p, { desiredFeeling: df, actualAfterFeeling: af, rewear, rating, confidenceBefore: cb, confidenceAfter: ca });
}
function or_(d: number, cid: string, p: string, rating: number): SE {
  return ev(d, cid, OR, p, { rating });
}

// ── Extended CUST map: C16–C120 ────────────────────────────────────────────────
export const CUST_EXTENDED: Record<string, string> = {
  // Corporate Chic: C16–C30 (15 customers)
  C16: "Corporate Chic", C17: "Corporate Chic", C18: "Corporate Chic", C19: "Corporate Chic", C20: "Corporate Chic",
  C21: "Corporate Chic", C22: "Corporate Chic", C23: "Corporate Chic", C24: "Corporate Chic", C25: "Corporate Chic",
  C26: "Corporate Chic", C27: "Corporate Chic", C28: "Corporate Chic", C29: "Corporate Chic", C30: "Corporate Chic",
  // Artsy: C31–C42 (12 customers)
  C31: "Artsy", C32: "Artsy", C33: "Artsy", C34: "Artsy", C35: "Artsy", C36: "Artsy",
  C37: "Artsy", C38: "Artsy", C39: "Artsy", C40: "Artsy", C41: "Artsy", C42: "Artsy",
  // Edgy: C43–C54 (12 customers)
  C43: "Edgy", C44: "Edgy", C45: "Edgy", C46: "Edgy", C47: "Edgy", C48: "Edgy",
  C49: "Edgy", C50: "Edgy", C51: "Edgy", C52: "Edgy", C53: "Edgy", C54: "Edgy",
  // Feminine: C55–C64 (10 customers)
  C55: "Feminine", C56: "Feminine", C57: "Feminine", C58: "Feminine", C59: "Feminine",
  C60: "Feminine", C61: "Feminine", C62: "Feminine", C63: "Feminine", C64: "Feminine",
  // Romantic: C65–C72 (8 customers)
  C65: "Romantic", C66: "Romantic", C67: "Romantic", C68: "Romantic",
  C69: "Romantic", C70: "Romantic", C71: "Romantic", C72: "Romantic",
  // Minimal: C73–C82 (10 customers)
  C73: "Minimal", C74: "Minimal", C75: "Minimal", C76: "Minimal", C77: "Minimal",
  C78: "Minimal", C79: "Minimal", C80: "Minimal", C81: "Minimal", C82: "Minimal",
  // Effortlessly Chic: C83–C90 (8 customers)
  C83: "Effortlessly Chic", C84: "Effortlessly Chic", C85: "Effortlessly Chic", C86: "Effortlessly Chic",
  C87: "Effortlessly Chic", C88: "Effortlessly Chic", C89: "Effortlessly Chic", C90: "Effortlessly Chic",
  // Old Money: C91–C96 (6 customers)
  C91: "Old Money", C92: "Old Money", C93: "Old Money", C94: "Old Money", C95: "Old Money", C96: "Old Money",
  // Trendy: C97–C104 (8 customers)
  C97: "Trendy", C98: "Trendy", C99: "Trendy", C100: "Trendy",
  C101: "Trendy", C102: "Trendy", C103: "Trendy", C104: "Trendy",
  // Casual Cool: C105–C114 (10 customers)
  C105: "Casual Cool", C106: "Casual Cool", C107: "Casual Cool", C108: "Casual Cool", C109: "Casual Cool",
  C110: "Casual Cool", C111: "Casual Cool", C112: "Casual Cool", C113: "Casual Cool", C114: "Casual Cool",
  // Mixed / additional: C115–C120 (6 customers — deliberate personality diversity)
  C115: "Corporate Chic", C116: "Edgy", C117: "Feminine", C118: "Artsy", C119: "Minimal", C120: "Romantic",
};

// ── Expanded event array ────────────────────────────────────────────────────────
// Organised by day range so each viewing window shows realistic volume.

export const EVENTS_EXPANDED: SE[] = [

  // ════════════════════════════════════════════════════════════════════════════
  // DAYS 1–7 — 7D window additions
  // Story: CLEAR momentum builds (EF Chic, Old Money, Trendy); Rooted traction.
  // ════════════════════════════════════════════════════════════════════════════

  // Corporate Chic — Seen early week work sessions
  ...slb(1, "C16", SEEN, "work",         "Confident"),
  ...slb(2, "C17", SEEN, "work",         "Powerful"),
  ...sl (3, "C18", SEEN, "work",         "Put Together"),
  ...sskip(3, "C73", SEEN, "work",       "Put Together", "Too formal"),     // Minimal skip
  ...slb(4, "C83", CLEAR, "travel",      "Elevated"),                        // EF Chic buys Clear
  ...sl (4, "C91", SEEN,  "dinner",      "Elevated"),                        // Old Money loves Seen
  ...slb(5, "C91", CLEAR, "dinner",      "Elevated"),                        // Old Money buys Clear
  ...slb(5, "C97", CLEAR, "date-night",  "Confident"),                       // Trendy buys Clear
  ...sl (6, "C55", HER,   "dinner",      "Feminine"),
  ...sls(6, "C65", HER,   "date-night",  "Attractive"),
  ...sl (7, "C31", WHOLE, "everyday",    "Effortless"),
  ...slb(7, "C43", ALIVE, "date-night",  "Confident"),
  ...slb(7, "C84", CLEAR, "travel",      "Effortless"),

  // ════════════════════════════════════════════════════════════════════════════
  // DAYS 8–30 — 30D window additions
  // Story: Seen dominant CC cohort; Whole save-gap at scale; Alive polarising.
  // ════════════════════════════════════════════════════════════════════════════

  // CC cohort — Seen work sessions with love/buy pattern
  ...slb(8,  "C19", SEEN, "work",         "Powerful"),
  ...slb(8,  "C20", SEEN, "work",         "Confident"),
  ...sl (9,  "C21", SEEN, "work",         "Elevated"),
  ...sl (9,  "C22", SEEN, "special-event","Elevated"),
  ...sskip(10,"C74", SEEN, "work",        "Put Together", "Too formal"),    // Minimal
  ...sskip(10,"C75", SEEN, "work",        "Put Together", "Too formal"),    // Minimal
  ...slb(11, "C23", SEEN, "work",         "Confident"),
  ...sl (11, "C24", SEEN, "work",         "Powerful"),
  [or_(11,   "C23", SEEN, 5)],

  // Artsy — Whole love/save gap
  ...sls(12, "C31", WHOLE, "everyday",    "Effortless"),
  ...sls(12, "C32", WHOLE, "everyday",    "Effortless"),
  ...sls(13, "C33", WHOLE, "travel",      "Effortless"),
  ...sl (13, "C34", WHOLE, "travel",      "Effortless"),
  ...sl (14, "C35", CLEAR, "dinner",      "Elevated"),
  ...slb(14, "C35", CLEAR, "dinner",      "Elevated"),  // Artsy does buy Clear
  ...sls(15, "C36", WHOLE, "everyday",    "Effortless"),

  // Edgy — Alive love/buy; Grounded fit friction
  ...slb(8,  "C43", ALIVE, "girls-night", "Confident"),
  ...sl (9,  "C44", ALIVE, "date-night",  "Confident"),
  ...slb(9,  "C44", ALIVE, "date-night",  "Confident"),
  ...sundc(10,"C45", GROUNDED,"work",     "Powerful",   "Trouser length concern"),
  ...slb(11, "C46", ALIVE, "girls-night", "Confident"),
  ...sundc(12,"C47", GROUNDED,"everyday", "Put Together","Hip fit uncertain"),
  ...sl (13, "C48", ALIVE, "date-night",  "Confident"),
  [or_(14,   "C43", ALIVE, 5)],
  [or_(14,   "C46", ALIVE, 4)],

  // Feminine — Her dominance
  ...slb(9,  "C55", HER,  "dinner",       "Feminine"),
  ...sls(10, "C56", HER,  "date-night",   "Attractive"),
  ...slb(11, "C57", HER,  "special-event","Feminine"),
  ...sls(12, "C58", HER,  "dinner",       "Feminine"),
  ...sl (13, "C59", ROOTED,"date-night",  "Feminine"),
  ...sls(14, "C59", ROOTED,"date-night",  "Feminine"),
  ...sl (15, "C60", HER,  "dinner",       "Feminine"),

  // Romantic — Her + Rooted
  ...sls(8,  "C65", HER,  "date-night",   "Attractive"),
  ...sls(9,  "C66", HER,  "dinner",       "Feminine"),
  ...sls(10, "C67", ROOTED,"special-event","Feminine"),
  ...slb(11, "C68", HER,  "date-night",   "Attractive"),
  ...sl (12, "C69", ROOTED,"dinner",      "Feminine"),

  // Minimal — Real love/buy; Seen refusal
  ...slb(9,  "C73", REAL, "work",         "Put Together"),
  ...slb(10, "C76", REAL, "work",         "Put Together"),
  ...sl (11, "C77", WHOLE,"everyday",     "Effortless"),
  ...sls(12, "C77", WHOLE,"everyday",     "Effortless"),
  ...sskip(13,"C78", SEEN,"work",         "Put Together","Too formal"),
  ...slb(14, "C79", REAL, "work",         "Confident"),
  [or_(15,   "C76", REAL, 4)],
  [or_(15,   "C79", REAL, 5)],

  // EF Chic — Whole saves; Clear buys
  ...sls(9,  "C83", WHOLE,"travel",       "Effortless"),
  ...slb(10, "C85", CLEAR,"dinner",       "Elevated"),
  ...sls(11, "C86", WHOLE,"everyday",     "Effortless"),
  ...slb(12, "C87", SEEN, "travel",       "Elevated"),
  ...sl (13, "C88", WHOLE,"travel",       "Effortless"),

  // Old Money — Seen + Clear + Rooted
  ...slb(10, "C92", SEEN, "dinner",       "Elevated"),
  ...sl (11, "C93", ROOTED,"special-event","Elevated"),
  ...sls(12, "C93", ROOTED,"special-event","Elevated"),
  ...slb(13, "C94", CLEAR,"dinner",       "Elevated"),
  [or_(14,   "C92", SEEN, 5)],

  // Trendy — mixed products
  ...slb(8,  "C98", CLEAR,"date-night",   "Confident"),
  ...sl (9,  "C99", HER,  "girls-night",  "Attractive"),
  ...slb(10, "C99", HER,  "girls-night",  "Attractive"),
  ...sl (11, "C100",ALIVE,"dinner",       "Confident"),
  ...slb(11, "C100",ALIVE,"dinner",       "Confident"),
  [or_(12,   "C98", CLEAR, 5)],

  // Casual Cool — Real; Grounded hesitation
  ...slb(8,  "C105",REAL, "work",         "Put Together"),
  ...sl (9,  "C106",WHOLE,"everyday",     "Effortless"),
  ...sls(9,  "C106",WHOLE,"everyday",     "Effortless"),
  ...sundc(10,"C107",GROUNDED,"everyday", "Put Together","Trouser length concern"),
  ...slb(11, "C108",REAL, "work",         "Confident"),
  ...sl (12, "C109",WHOLE,"everyday",     "Effortless"),
  [or_(13,   "C105",REAL, 4)],
  [or_(13,   "C108",REAL, 5)],

  // Mixed extras (C115–C120) — 7D/30D representation
  ...slb(5,  "C115",SEEN, "work",         "Powerful"),
  ...slb(6,  "C116",ALIVE,"date-night",   "Confident"),
  ...sls(7,  "C117",HER,  "dinner",       "Feminine"),
  ...sls(14, "C118",WHOLE,"everyday",     "Effortless"),
  ...slb(15, "C119",REAL, "work",         "Put Together"),
  ...sls(16, "C120",HER,  "date-night",   "Attractive"),

  // ════════════════════════════════════════════════════════════════════════════
  // DAYS 31–90 — 90D window additions
  // Story: Personality-product relationships confirmed at scale; Clear conversion
  //        pattern established; Whole never converts despite love; Grounded returns.
  // ════════════════════════════════════════════════════════════════════════════

  // CC cohort — continued Seen dominance + some Grounded buyers
  ...slb(32, "C25", SEEN, "work",         "Confident"),
  ...slb(33, "C26", SEEN, "work",         "Powerful"),
  ...sl (34, "C27", SEEN, "special-event","Elevated"),
  [or_(34,   "C25", SEEN, 5)], [or_(34, "C26", SEEN, 5)],
  ...slb(35, "C28", SEEN, "work",         "Confident"),
  ...sundc(36,"C29", GROUNDED,"work",     "Powerful",   "Trouser length concern"),
  ...sl (37, "C30", SEEN, "work",         "Confident"),
  ...slb(38, "C29", GROUNDED,"work",      "Confident"),  // resolves after initial concern
  ...slb(40, "C16", REAL, "work",         "Put Together"), // multi-product CC buyer
  ...slb(42, "C17", REAL, "work",         "Put Together"),
  [or_(42,   "C28", SEEN, 5)], [or_(42, "C30", SEEN, 5)],
  ...sskip(43,"C80", SEEN, "work",        "Put Together","Too formal"),    // Minimal

  // Artsy — Whole persistent save gap; Clear converts
  ...sls(33, "C37", WHOLE, "everyday",    "Effortless"),
  ...sls(34, "C38", WHOLE, "travel",      "Effortless"),
  ...slb(35, "C36", CLEAR, "dinner",      "Elevated"),
  ...sls(36, "C39", WHOLE, "everyday",    "Effortless"),
  ...sl (37, "C40", CLEAR, "travel",      "Elevated"),
  ...slb(38, "C40", CLEAR, "travel",      "Elevated"),
  ...sls(40, "C41", WHOLE, "everyday",    "Effortless"),
  [wr(38, "C35", CLEAR, "Elevated", "Elevated", true, 5, 5.6, 7.8)],   // Clear post-wear
  [wr(42, "C36", CLEAR, "Elevated", "Elevated", true, 5, 5.5, 7.9)],

  // Edgy — Alive love/buy pattern entrenched; Grounded friction stable
  ...slb(33, "C48", ALIVE, "girls-night", "Confident"),
  ...slb(34, "C49", ALIVE, "date-night",  "Confident"),
  ...sundc(35,"C50", GROUNDED,"work",     "Powerful",   "Trouser length too long"),
  ...slb(36, "C51", ALIVE, "girls-night", "Confident"),
  ...sl (37, "C52", ALIVE, "date-night",  "Confident"),
  ...sundc(38,"C53", GROUNDED,"everyday", "Put Together","Hip fit uncertain"),
  ...slb(40, "C54", ALIVE, "date-night",  "Confident"),
  ...sl (45, "C116",ALIVE, "girls-night", "Confident"),  // extra Edgy session — shifts 90D ratio off 71%
  [or_(40,   "C48", ALIVE, 5)], [or_(40, "C49", ALIVE, 5)],
  [wr(50, "C48", ALIVE, "Confident", "Confident", true, 5, 5.7, 7.8)],
  [wr(52, "C49", ALIVE, "Confident", "Confident", true, 5, 5.5, 7.5)],
  [wr(55, "C51", ALIVE, "Confident", "Confident", true, 4, 5.6, 7.4)],
  // Edgy Grounded return — fit concern → return
  ev(82, "C50", RT, GROUNDED, {}),

  // Feminine — Her solid buying + Rooted grows
  ...slb(33, "C60", HER,  "dinner",       "Feminine"),
  ...sls(34, "C61", HER,  "dinner",       "Feminine"),
  ...slb(35, "C62", HER,  "special-event","Feminine"),
  ...slb(36, "C63", ROOTED,"date-night",  "Feminine"),
  ...sl (37, "C64", HER,  "dinner",       "Feminine"),
  [or_(38,   "C60", HER, 5)], [or_(38, "C62", HER, 5)],
  [wr(45, "C55", HER, "Feminine", "Feminine", true, 5, 5.4, 7.6)],
  [wr(48, "C60", HER, "Feminine", "Feminine", true, 5, 5.5, 7.7)],
  [wr(52, "C62", HER, "Feminine", "Feminine", true, 5, 5.6, 7.8)],

  // Romantic — Her repeat interest; Rooted evening
  ...slb(33, "C69", HER,  "date-night",   "Attractive"),
  ...sls(34, "C70", HER,  "dinner",       "Feminine"),
  ...sls(35, "C71", ROOTED,"special-event","Feminine"),
  ...slb(36, "C72", HER,  "date-night",   "Attractive"),
  [or_(37,   "C69", HER, 5)], [or_(37, "C72", HER, 5)],
  [wr(50, "C68", HER, "Attractive", "Attractive", true, 5, 5.3, 7.7)],
  [wr(55, "C69", HER, "Attractive", "Attractive", true, 5, 5.4, 7.6)],
  [wr(58, "C72", HER, "Attractive", "Attractive", true, 5, 5.5, 7.8)],

  // Minimal — Real stable; Seen rejection consistent
  ...slb(33, "C80", REAL, "work",         "Put Together"),
  ...sskip(34,"C81", SEEN, "work",        "Put Together","Too formal"),
  ...slb(35, "C81", REAL, "work",         "Put Together"),
  ...sls(36, "C82", WHOLE,"everyday",     "Effortless"),
  ...slb(37, "C76", REAL, "work",         "Confident"),
  [or_(38,   "C80", REAL, 5)], [or_(38, "C81", REAL, 5)],
  [wr(48, "C73", REAL, "Put Together", "Put Together", true, 5, 5.5, 7.6)],
  [wr(52, "C76", REAL, "Put Together", "Put Together", true, 5, 5.3, 7.4)],

  // EF Chic — Whole saves stack; Clear converts reliably; Seen secondary
  ...sls(33, "C88", WHOLE, "travel",      "Effortless"),
  ...sls(34, "C89", WHOLE, "everyday",    "Effortless"),
  ...slb(35, "C90", CLEAR, "dinner",      "Elevated"),
  ...slb(36, "C83", SEEN,  "travel",      "Elevated"),
  ...sls(37, "C89", WHOLE, "travel",      "Effortless"),
  [or_(38,   "C84", CLEAR, 5)], [or_(38, "C90", CLEAR, 5)],
  [wr(48, "C84", CLEAR, "Effortless", "Elevated", true, 5, 5.7, 7.9)],
  [wr(52, "C85", CLEAR, "Elevated",   "Elevated", true, 5, 5.6, 7.8)],
  [wr(55, "C90", CLEAR, "Elevated",   "Elevated", true, 5, 5.8, 8.0)],

  // Old Money — Seen + Clear premium buying
  ...slb(33, "C95", SEEN,  "dinner",      "Elevated"),
  ...slb(34, "C96", CLEAR, "dinner",      "Elevated"),
  ...sls(35, "C91", ROOTED,"special-event","Elevated"),
  ...slb(36, "C92", CLEAR, "dinner",      "Elevated"),
  [or_(38,   "C95", SEEN, 5)], [or_(38, "C96", CLEAR, 5)],
  [wr(48, "C91", SEEN, "Elevated", "Elevated", true, 5, 5.8, 8.0)],
  [wr(52, "C92", SEEN, "Elevated", "Elevated", true, 5, 5.9, 8.1)],

  // Trendy — CLEAR + HER + ALIVE mixed
  ...slb(33, "C101",CLEAR,"date-night",   "Confident"),
  ...sl (34, "C102",HER,  "girls-night",  "Attractive"),
  ...slb(34, "C102",HER,  "girls-night",  "Attractive"),
  ...sl (35, "C103",ALIVE,"dinner",       "Confident"),
  ...slb(35, "C103",ALIVE,"dinner",       "Confident"),
  ...sl (36, "C104",CLEAR,"date-night",   "Elevated"),
  ...slb(37, "C104",CLEAR,"date-night",   "Elevated"),
  [or_(38,   "C101",CLEAR, 5)], [or_(38, "C103", ALIVE, 4)],

  // Casual Cool — Real + Whole; Grounded hesitation
  ...slb(33, "C110",REAL, "work",         "Put Together"),
  ...sls(34, "C111",WHOLE,"everyday",     "Effortless"),
  ...sundc(35,"C112",GROUNDED,"everyday", "Put Together","Trouser length concern"),
  ...slb(36, "C113",REAL, "work",         "Confident"),
  ...sl (37, "C114",WHOLE,"everyday",     "Effortless"),
  [or_(38,   "C110",REAL, 4)], [or_(38, "C113",REAL, 5)],

  // Closet uploads — 90D batch
  ev(33, "C18", CU, null), ev(35, "C31", CU, null), ev(37, "C43", CU, null),
  ev(40, "C55", CU, null), ev(42, "C73", CU, null), ev(45, "C83", CU, null),
  ev(48, "C91", CU, null), ev(50, "C97", CU, null), ev(52, "C105",CU, null),

  // ════════════════════════════════════════════════════════════════════════════
  // DAYS 91–365 — All-time additions
  // Story: LTV signals; repeat wear; multi-product customers; complete history.
  // ════════════════════════════════════════════════════════════════════════════

  // CC — long-term Seen loyalty + Real cross-sells
  ...sl (95,  "C16", SEEN,  "work",        "Powerful"),
  [or_(95,    "C16", SEEN, 5)],
  ...slb(100, "C18", REAL,  "work",        "Put Together"),
  ...slb(100, "C19", GROUNDED,"work",      "Confident"),
  ...sl (105, "C20", SEEN,  "work",        "Powerful"),
  [or_(105,   "C20", SEEN, 5)],
  ...slb(110, "C21", REAL,  "work",        "Put Together"),
  ...sl (115, "C22", SEEN,  "special-event","Elevated"),
  [or_(115,   "C22", SEEN, 5)],
  ...slb(120, "C23", SEEN,  "work",        "Confident"),
  ...sl (125, "C24", SEEN,  "work",        "Powerful"),
  [or_(125,   "C24", SEEN, 5)],
  [wr(100, "C17", SEEN, "Powerful", "Powerful", true, 5, 5.7, 7.8)],
  [wr(110, "C18", SEEN, "Put Together","Confident", true, 4, 5.5, 7.4)],
  [wr(120, "C19", SEEN, "Powerful", "Powerful", true, 5, 5.8, 7.9)],
  [wr(125, "C23", SEEN, "Confident", "Confident", true, 5, 5.6, 7.5)],
  [wr(130, "C16", SEEN, "Powerful", "Powerful", true, 5, 5.9, 8.0)],
  [wr(140, "C25", SEEN, "Confident", "Confident", true, 5, 5.7, 7.7)],
  [wr(145, "C26", SEEN, "Powerful", "Powerful", true, 5, 5.8, 7.8)],

  // Artsy — Whole saved but still not buying; Clear rewear pattern
  ...sl (95,  "C38", WHOLE, "travel",     "Effortless"),
  [ev(95, "C38", WR, WHOLE, { desiredFeeling:"Effortless", actualAfterFeeling:"Comfortable", rewear:false, rating:3, confidenceBefore:5.0, confidenceAfter:5.8 })],
  ...sl (100, "C39", CLEAR, "dinner",     "Elevated"),
  ...slb(100, "C39", CLEAR, "dinner",     "Elevated"),
  ...sl (105, "C41", WHOLE, "everyday",   "Effortless"),
  [ev(105, "C41", WR, WHOLE, { desiredFeeling:"Effortless", actualAfterFeeling:"Comfortable", rewear:false, rating:3, confidenceBefore:4.9, confidenceAfter:5.7 })],
  ...sl (110, "C42", CLEAR, "travel",     "Elevated"),
  ...slb(110, "C42", CLEAR, "travel",     "Elevated"),
  [wr(115, "C39", CLEAR, "Elevated", "Elevated", true, 5, 5.5, 7.7)],
  [wr(120, "C40", CLEAR, "Elevated", "Elevated", true, 5, 5.6, 7.8)],
  [wr(125, "C42", CLEAR, "Elevated", "Elevated", true, 5, 5.7, 7.9)],

  // Edgy — Alive repeat buyers; Grounded partial adoption
  ...slb(95,  "C52", ALIVE, "girls-night","Confident"),
  ...slb(100, "C53", ALIVE, "date-night", "Confident"),
  [or_(100,   "C52", ALIVE, 5)],
  ...slb(105, "C54", ALIVE, "girls-night","Confident"),
  // C50 eventually buys Grounded after fit concern resolved
  ...slb(110, "C50", GROUNDED,"work",     "Powerful"),
  [or_(115,   "C53", ALIVE, 5)],
  [wr(115, "C52", ALIVE, "Confident", "Confident", true, 5, 5.6, 7.8)],
  [wr(120, "C53", ALIVE, "Confident", "Confident", true, 5, 5.5, 7.6)],
  [wr(125, "C54", ALIVE, "Confident", "Confident", true, 5, 5.7, 7.9)],
  [wr(130, "C43", ALIVE, "Confident", "Confident", true, 5, 5.8, 8.0)],
  [wr(135, "C44", ALIVE, "Confident", "Confident", true, 5, 5.7, 7.8)],
  // Return: C53 second Alive purchase returned (gift duplicate)
  ...slb(140, "C53", ALIVE, "girls-night","Confident"),
  ev(145, "C53", RT, ALIVE, {}),

  // Feminine — Her long-term loyalty; Rooted evening rotation
  ...slb(95,  "C64", HER,  "dinner",      "Feminine"),
  ...sl (100, "C55", HER,  "dinner",      "Feminine"),
  ...slb(100, "C56", ROOTED,"date-night", "Feminine"),
  ...sl (105, "C57", HER,  "dinner",      "Feminine"),
  ...slb(110, "C63", ROOTED,"special-event","Feminine"),
  [or_(110,   "C64", HER, 5)],
  [wr(110, "C56", HER, "Feminine", "Feminine", true, 5, 5.4, 7.7)],
  [wr(115, "C57", HER, "Feminine", "Feminine", true, 5, 5.5, 7.6)],
  [wr(120, "C64", HER, "Feminine", "Feminine", true, 5, 5.6, 7.8)],
  // Repeat purchases — Feminine is highest LTV per segment
  ...slb(150, "C55", HER, "dinner",       "Feminine"),
  ...slb(160, "C57", HER, "special-event","Feminine"),

  // Romantic — Her repeat purchase; Rooted building
  ...slb(95,  "C65", ROOTED,"special-event","Feminine"),
  ...sl (100, "C66", HER,  "date-night",  "Attractive"),
  ...slb(105, "C70", HER,  "date-night",  "Attractive"),
  ...slb(110, "C71", ROOTED,"dinner",     "Feminine"),
  [wr(115, "C65", HER, "Attractive", "Attractive", true, 5, 5.3, 7.6)],
  [wr(120, "C66", HER, "Attractive", "Attractive", true, 5, 5.2, 7.5)],
  [wr(125, "C70", HER, "Attractive", "Attractive", true, 5, 5.4, 7.7)],
  // Repeat purchase — Romantic is strongest for HER LTV
  ...slb(150, "C68", HER, "date-night",   "Attractive"),
  ...slb(165, "C69", HER, "date-night",   "Attractive"),

  // Minimal — Real repeat buys; complete Seen rejection pattern
  ...sl (95,  "C74", REAL, "work",        "Put Together"),
  [or_(95,    "C74", REAL, 4)],
  ...slb(100, "C78", REAL, "work",        "Put Together"),
  ...sskip(100,"C82",SEEN, "work",        "Put Together","Too formal"),
  ...sl (105, "C79", REAL, "work",        "Confident"),
  [or_(105,   "C78", REAL, 5)],
  ...slb(110, "C80", REAL, "work",        "Confident"),
  [wr(115, "C79", REAL, "Confident", "Put Together", true, 4, 5.4, 7.3)],
  [wr(120, "C80", REAL, "Confident", "Confident",    true, 5, 5.5, 7.5)],

  // EF Chic — Clear/Seen long-term; Whole never converts
  ...slb(95,  "C86", CLEAR,"dinner",      "Elevated"),
  ...sl (100, "C87", SEEN, "travel",      "Elevated"),
  ...sls(100, "C89", WHOLE,"travel",      "Effortless"),  // persistent save gap
  ...slb(105, "C88", SEEN, "travel",      "Elevated"),
  [or_(105,   "C87", SEEN, 5)], [or_(105, "C88", SEEN, 5)],
  [wr(115, "C86", CLEAR, "Elevated", "Elevated", true, 5, 5.6, 7.8)],
  [wr(120, "C83", SEEN,  "Elevated", "Elevated", true, 5, 5.7, 7.9)],
  [wr(125, "C87", SEEN,  "Elevated", "Elevated", true, 5, 5.8, 8.0)],

  // Old Money — premium repeat buying; Rooted evening
  ...slb(95,  "C91", SEEN,  "dinner",     "Elevated"),
  ...sl (100, "C93", SEEN,  "dinner",     "Elevated"),
  ...slb(105, "C94", SEEN,  "dinner",     "Elevated"),
  ...slb(110, "C95", CLEAR, "dinner",     "Elevated"),
  [or_(110,   "C91", SEEN, 5)], [or_(110, "C95", SEEN, 5)],
  [wr(115, "C91", SEEN, "Elevated", "Elevated", true, 5, 6.0, 8.2)],
  [wr(120, "C92", SEEN, "Elevated", "Elevated", true, 5, 5.9, 8.1)],
  [wr(125, "C94", SEEN, "Elevated", "Elevated", true, 5, 6.1, 8.3)],

  // Trendy — multi-product rotation; lower repeat wear
  ...sl (95,  "C100",ALIVE,"girls-night", "Confident"),
  ...sl (100, "C101",HER,  "dinner",      "Attractive"),
  ...slb(105, "C102",CLEAR,"date-night",  "Confident"),
  ...sl (110, "C103",HER,  "girls-night", "Attractive"),
  [or_(110,   "C102",CLEAR, 4)], [or_(110, "C103", HER, 4)],
  [wr(120, "C97",  CLEAR, "Confident", "Confident", true, 4, 5.4, 7.2)],
  [wr(125, "C101", CLEAR, "Elevated",  "Elevated",  true, 4, 5.5, 7.3)],

  // Casual Cool — Real steady repeat; Whole never converts
  ...sl (95,  "C109",REAL, "work",        "Put Together"),
  [or_(95,    "C109",REAL, 4)],
  ...slb(100, "C110",REAL, "work",        "Put Together"),
  ...sls(105, "C111",WHOLE,"everyday",    "Effortless"),
  ...slb(110, "C113",REAL, "work",        "Confident"),
  [wr(120, "C108",REAL, "Confident", "Put Together", true, 4, 5.3, 7.1)],
  [wr(125, "C110",REAL, "Put Together","Confident", true, 4, 5.4, 7.2)],

  // Grounded return cohort — petite fit issue → return (all-time pattern)
  ev(118, "C45", RT, GROUNDED, {}),   // C45 (Edgy) — bought day 31ish, returned
  ev(125, "C107",RT, GROUNDED, {}),   // C107 (Casual Cool) — bought eventually, returned

  // Closet uploads — all-time batch
  ev(95,  "C20", CU, null), ev(100, "C33", CU, null), ev(105, "C46", CU, null),
  ev(110, "C62", CU, null), ev(115, "C68", CU, null), ev(120, "C75", CU, null),
  ev(125, "C86", CU, null), ev(130, "C94", CU, null), ev(135, "C100",CU, null),
  ev(140, "C110",CU, null), ev(145, "C115",CU, null), ev(150, "C118",CU, null),
];
