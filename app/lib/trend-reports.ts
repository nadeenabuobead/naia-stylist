export type TrendReportSource = {
  publisher: string;
  title: string;
  publishedAt?: string;
  url: string;
};

export type TrendReportKeyTrend = {
  name: string;
  description: string;
};

export type TrendReportReferenceCard = {
  brand: string;
  collection?: string;
  signal: string;   // only what the cited source explicitly states or clearly shows
  naiaRead: string; // nAia interpretation, visual observation, or real-wardrobe translation
};

export type TrendReportSpendSaveSkip = {
  spend: string;
  save: string;
  alreadyOwn: string;
};

export type TrendReportData = {
  slug: string;
  title: string;
  season: string;
  publishedAt: string;
  mood?: string;
  summary: string;
  editorialIntro: string;
  keyTrends: TrendReportKeyTrend[];
  rising?: string[];
  fading?: string[];
  referencesBehindThisEdit?: TrendReportReferenceCard[];
  brandsToWatch?: { name: string; why: string }[]; // retained for type compat; not used in current data
  spendSaveSkip?: TrendReportSpendSaveSkip;
  investmentNotes?: string; // retained: read by trend-evidence.server.ts buildShopperEdit nextStep fallback
  naiaInterpretation?: string;
  naiaVerdict?: string;
  howToWear?: { feeling: string; direction: string }[];
  wardrobeNote?: string;
  sources: TrendReportSource[];
  published: boolean;
};

export const trendReports: TrendReportData[] = [
  {
    slug: "spring-2026-soft-structure",
    title: "Spring 2026 Wardrobe Edit: Soft Structure",
    season: "Spring 2026",
    publishedAt: "2026-06-30",
    mood: "Quiet Presence",
    summary:
      "A nAia edit on softened tailoring, controlled shape, and clothes that create presence without stiffness.",
    editorialIntro:
      "Soft Structure is nAia's Spring 2026 edit: tailoring that holds a silhouette line through cut and proportion rather than through stiffness, paired with one considered gesture — a softened shoulder, a wrapped front, a curved hem — and enough ease for real occasions. The working components are the longline blazer, the clean wide-leg trouser, and fabrics that either hold their shape without pressing or move freely without going limp. It is not about becoming plain. It is about letting cut, proportion, and fabric carry the impression without embellishment or body-conscious cuts.",
    keyTrends: [
      {
        name: "Softened tailoring",
        description:
          "A jacket or trouser that holds its silhouette through cut and fabric weight — a longline blazer with a clean shoulder, wide-leg trousers with enough length to break at the foot. The structure comes from proportion, not from stiff interfacing. Pair one clearly shaped piece with one that simply moves.",
      },
      {
        name: "One sculptural gesture",
        description:
          "One defined element per outfit: a softened-but-present shoulder, a wrapped or tie-front neckline, a curved or asymmetric hemline, a controlled drape across one seam. The gesture reads because everything around it stays composed. Two gestures cancel each other out.",
      },
      {
        name: "Fabric that earns its place",
        description:
          "Fabrics that either hold a clean line — structured crepe, ponte, dry-hand twill — or move with the body — fluid viscose, washed linen, lightweight silk. The cut and the fabric must agree: a softly structured jacket needs a fabric with enough body to hold its shoulder; a fluid piece should move without clinging.",
      },
    ],
    rising: [
      "Softened shoulders",
      "Long clean trouser lines",
      "Defined waist through cut",
      "Asymmetry used with restraint",
    ],
    fading: [
      "Rigid head-to-toe office suiting",
      "Overly complicated drape",
      "Statement pieces with no repeat value",
    ],
    referencesBehindThisEdit: [
      {
        brand: "Givenchy",
        signal:
          "Givenchy's Spring Summer 2026 Womenswear show notes describe the collection as peeling back tailoring structure toward lightness and ease.",
        naiaRead:
          "The operative nAia instruction: reduce the stiffness, keep the line. A silhouette reads as structured when the proportion is right — longline, clean shoulder, sufficient length — without needing heavy interfacing or rigid canvas to hold it there. This is what makes the direction replicable in a real wardrobe rather than confined to a show context.",
      },
      {
        brand: "Victoria Beckham",
        signal:
          "Victoria Beckham's Spring Summer 2026 collection is framed around experimental gestures, naïve compositions, happy accidents, and an exploration of adolescent dressing.",
        naiaRead:
          "The wearable translation: one deliberate departure from the composed base — an asymmetric seam, a wrapped front, a curved hem — with everything else staying calm. The experimental gesture at a real-wardrobe scale is a single considered choice, not a head-to-toe editorial statement.",
      },
    ],
    spendSaveSkip: {
      spend:
        "One longline blazer, clean wide-leg trouser, or draped midi dress in a fabric that holds its shape without pressing. This is the anchor piece that changes the proportion of what you already own.",
      save:
        "Extreme sculptural pieces — heavily padded shoulders, oversized balloon sleeves, aggressively asymmetric construction. These are single-season gestures with no repeat value.",
      alreadyOwn:
        "A straight or wide-leg trouser you already own reads as soft structure when paired with a draped blouse or fine knit instead of a matching jacket. The proportion combination is the editorial move — not a new purchase.",
    },
    investmentNotes:
      "Buy one piece that changes the proportion of what you already own: a longline blazer, draped midi dress, sharply cut wide-leg trouser, structured vest, or sculptural neutral bag. Skip extreme volume or rigid tailoring that does not suit your real life.",
    naiaInterpretation:
      "This trend is especially useful for you if you want to feel polished and considered without relying on tight cuts, revealing silhouettes, or embellished detail — soft structure gives presence through proportion and fabric weight, not decoration.",
    naiaVerdict:
      "Soft Structure is the most practically useful Spring 2026 direction for a wardrobe that already exists. It does not require starting over — it requires one anchor piece with real proportion worn against something familiar. The mistake to avoid: buying structured pieces that are too stiff or too fashion-forward to rewear across more than one season.",
    howToWear: [
      {
        feeling: "For work",
        direction: "A softly structured blazer, fluid trouser, and fine knit or clean top.",
      },
      {
        feeling: "For dinner",
        direction: "A draped midi or column dress with minimal accessories.",
      },
      {
        feeling: "For everyday",
        direction: "One architectural layer with denim or another familiar base.",
      },
      {
        feeling: "For modest dressing",
        direction:
          "Use long vertical layers and one structured element, then let the remaining pieces move.",
      },
    ],
    wardrobeNote:
      "One architectural piece + one familiar fluid piece + restrained accessories = quiet presence.",
    sources: [
      {
        publisher: "Givenchy",
        title: "Spring Summer 2026 Womenswear Show",
        url: "https://www.givenchy.com/us/en-US/cm/explore/collections/spring-summer-26-womenswear-show",
      },
      {
        publisher: "Victoria Beckham",
        title: "Spring Summer 2026",
        publishedAt: "2025-10-04",
        url: "https://www.victoriabeckham.com/pages/spring-summer-2026",
      },
    ],
    published: true,
  },
  {
    slug: "modern-tailoring-spring-2026",
    title: "The New Language of Modern Tailoring",
    season: "Spring 2026",
    publishedAt: "2026-06-30",
    mood: "Composed, Not Corporate",
    summary:
      "Tailoring becomes more fluid, personal, and wearable when it is treated as an anchor rather than a uniform.",
    editorialIntro:
      "Modern tailoring works when you treat the tailored piece as a tool rather than a uniform. A well-cut blazer, waistcoat, or trouser gives a look clarity and register — then a softer counterpart makes it wearable across more than one context. The proportion contrast does the styling: a longline blazer against a narrow skirt, a cropped jacket against a wide-leg trouser, a waistcoat worn as a top layer with relaxed denim. This is less about the suit and more about which one tailored piece, worn with intention, changes the feeling of everything around it.",
    keyTrends: [
      {
        name: "One tailored anchor, one soft counterpart",
        description:
          "A structured jacket, waistcoat, or trouser defines the register of the look. The counterpart — a fine knit, draped skirt, fluid shirt, slip dress — makes it wearable rather than severe. Neither piece does all the work. The contrast between the two is the point.",
      },
      {
        name: "Separates over matching sets",
        description:
          "A tailored piece earns its place when it functions across at least three outfits — with denim, with a draped skirt, with a slip dress. If it only works with its matching bottom, it is a costume, not a wardrobe investment. Buy the jacket and the trouser separately unless the combination is genuinely versatile.",
      },
      {
        name: "Let proportion do the styling",
        description:
          "One deliberate contrast: a longline blazer against a narrow skirt; a cropped jacket against a wider-leg trouser; a waistcoat worn as a top layer against flared or wide-leg denim. The proportion difference is the editorial decision — accessorising on top of a matched suit is not styling.",
      },
    ],
    rising: [
      "Longline blazers",
      "Waistcoats as a top layer",
      "Fluid trousers",
      "Tailored separates",
    ],
    fading: [
      "Suits that only work together",
      "Stiff fabric with no movement",
      "Trousers that require heels to make sense",
    ],
    referencesBehindThisEdit: [
      {
        brand: "Victoria Beckham",
        collection: "Pre SS26",
        signal:
          "Victoria Beckham's Pre Spring Summer 2026 collection brings together the formal with the fluid.",
        naiaRead:
          "The most actionable read: a tailored piece does not need a matching counterpart to read as deliberate. It reads more considered when contrasted with something relaxed — a blazer over a slip, a waistcoat with wide-leg denim, tailored trousers against a loose knit or draped top.",
      },
    ],
    spendSaveSkip: {
      spend:
        "A longline blazer or well-cut wide-leg trouser in a fabric with enough body to hold its line across repeated wears. It should function independently with denim, a skirt, and a dress.",
      save:
        "A full matching suit in a seasonal colour or a fashion-forward cut. It dates quickly, functions as one outfit, and rarely survives the season it was bought for.",
      alreadyOwn:
        "A waistcoat or blazer you have been wearing formally reads as modern tailoring when worn open over a relaxed shirt or against a fluid wide-leg trouser. The styling shift — not a new garment — is the update.",
    },
    investmentNotes:
      "Start with a longline blazer, straight or wide-leg tailored trouser, waistcoat, clean column skirt, or crisp shirt with enough ease to layer and restyle.",
    naiaInterpretation:
      "This trend is especially useful for you if you need to feel composed and considered at work, dinner, or travel without appearing overly managed or formally dressed — modern tailoring is the move from dressed to considered.",
    naiaVerdict:
      "Modern tailoring works when the tailored piece is treated as a tool, not a statement. One well-cut jacket or trouser changes the register of everything worn with it. The investment is in the proportion — long enough, relaxed enough in the leg or sleeve, in a fabric that works across more than one season.",
    howToWear: [
      {
        feeling: "For work",
        direction: "Tailored trousers with a soft shirt, knit, or clean jersey top.",
      },
      {
        feeling: "For dinner",
        direction: "A structured blazer over a slip, draped skirt, or column dress.",
      },
      {
        feeling: "For travel",
        direction: "Fluid trousers, a tonal knit, and a longline blazer.",
      },
      {
        feeling: "For casual days",
        direction: "One tailored piece with denim, a white T-shirt, or flats.",
      },
    ],
    wardrobeNote:
      "One tailored anchor + one fluid or familiar piece + one intentional proportion = modern polish without stiffness.",
    sources: [
      {
        publisher: "Victoria Beckham",
        title: "Pre Spring Summer 2026",
        url: "https://www.victoriabeckham.com/collections/pre-spring-summer-2026",
      },
    ],
    published: true,
  },
  {
    slug: "spring-2026-colour-direction",
    title: "Colour Direction: The Quiet Base & the Clear Accent",
    season: "Spring 2026",
    publishedAt: "2026-06-30",
    mood: "One Accent, Everything Changes",
    summary:
      "An nAia method for using a calm wardrobe foundation with one expressive colour note.",
    editorialIntro:
      "This is not a claim that every Spring 2026 wardrobe should use the same colours. It is the nAia method for making colour purposeful rather than reactive: build from a quiet base — soft white, cream, stone, espresso, washed denim, or black — then add one clear accent that changes the mood of the whole look. The accent can be a knit, a bag, a flat, a scarf, or an evening piece. One strong accent note lands more powerfully than two competing ones; the quiet base is what gives the accent room to read. Deep espresso is the most underused anchor in this palette — it functions as a warm neutral where black feels too hard and beige feels too safe.",
    keyTrends: [
      {
        name: "Build from a repeatable quiet base",
        description:
          "Soft white, cream, stone, espresso, washed denim, or black. These are the pieces that earn their place by working with everything in the wardrobe, not just with each other. The base is not the interesting part — it is the condition for the interesting part.",
      },
      {
        name: "One clear accent, positioned deliberately",
        description:
          "A single expressive colour through one item. Placement matters: an accent on the top half reads more casual; through a bag, flat, or shoe it reads more intentional. One strong colour note lands more powerfully than two competing ones. The accent does not need to coordinate with anything except the base.",
      },
      {
        name: "Contrast over coordination",
        description:
          "Let a calm neutral meet one clear interruption. The interruption does not need to match anything else in the outfit — it just needs not to clash with the base. Over-coordinated colour matching erases the effect the accent was meant to create.",
      },
    ],
    rising: [
      "Soft white foundations",
      "Deep brown as an anchor",
      "A single expressive accessory or knit",
      "Purposeful colour contrast",
    ],
    fading: [
      "Buying several bright pieces that only work together",
      "Replacing a whole wardrobe for one seasonal shade",
      "Over-coordinated colour matching",
    ],
    referencesBehindThisEdit: [
      {
        brand: "Pantone",
        signal:
          "Pantone's New York Fashion Week Spring / Summer 2026 Fashion Color Trend Report (September 2025) documents the season's colour palette direction.",
        naiaRead:
          "The nAia method for making colour purposeful: one quiet foundation, one deep anchor, one clear accent. Seasonal colour is less about buying the trending shade and more about finding the single accent that changes what you already own. The discipline is the operative word — one accent that earns its place across multiple existing outfits is more useful than three that compete.",
      },
      {
        brand: "Victoria Beckham",
        signal:
          "Victoria Beckham's Spring Summer 2026 collection supports personal expression and experimentation in dressing.",
        naiaRead:
          "Experimentation at this scale means one clear departure, not a full palette change. The composed base gives the colour note room to read as intentional rather than accidental. This is the visual logic behind introducing an accent through the lowest-commitment, highest-visibility piece first — a bag, flat, or scarf — before committing to a full accent garment.",
      },
    ],
    spendSaveSkip: {
      spend:
        "One piece in a deep anchor neutral — espresso, deep navy, or washed black — that fills a genuine gap in your wardrobe base: a trouser, bag, or shoe in a shade that works with more of what you already own than your current equivalent.",
      save:
        "Multiple pieces in a single seasonal accent colour bought to complete a look. One accent item changes the wardrobe. Three coordinated bright items create a styling problem.",
      alreadyOwn:
        "A neutral blouse, trouser, or dress you already own is already the base. Introduce the accent through the lowest-commitment, highest-visibility piece first — a bag, flat, or scarf — before committing to a full accent garment.",
    },
    investmentNotes:
      "Buy one neutral foundation piece and one accent piece that works with at least three things you already own. Deep espresso is an especially useful anchor when black feels too hard and beige feels too safe.",
    naiaInterpretation:
      "This trend is especially useful for you if you feel drawn to colour but dissatisfied with how it lands — the quiet base and one accent method gives colour a clear role in the outfit rather than leaving it to compete with everything else.",
    naiaVerdict:
      "Colour direction is a method, not a palette. The nAia approach: one quiet foundation, one deep anchor, one clear accent. The value is in the discipline — choosing one accent that changes everything you already own rather than buying into a seasonal shade that only works in one context.",
    howToWear: [
      {
        feeling: "For work",
        direction: "A calm base with colour through a shirt, bag, shoe, scarf, or fine knit.",
      },
      {
        feeling: "For dinner",
        direction: "A neutral column or tailored base with one coloured satin or leather accent.",
      },
      {
        feeling: "For everyday",
        direction: "Denim, white, and brown as a base; add one expressive knit, flat, or bag.",
      },
      {
        feeling: "For modest dressing",
        direction:
          "Use a long neutral layer and introduce colour through the inner layer, bag, shoe, or scarf.",
      },
    ],
    wardrobeNote:
      "One quiet base + one deep anchor + one clear accent = colour with intention.",
    sources: [
      {
        publisher: "Pantone",
        title: "Fashion Color Trend Report: New York Fashion Week Spring / Summer 2026",
        publishedAt: "2025-09-11",
        url: "https://www.pantone.com/articles/fashion-color-trend-report/new-york-fashion-week-spring-summer-2026",
      },
      {
        publisher: "Victoria Beckham",
        title: "Spring Summer 2026",
        publishedAt: "2025-10-04",
        url: "https://www.victoriabeckham.com/pages/spring-summer-2026",
      },
    ],
    published: true,
  },
];
