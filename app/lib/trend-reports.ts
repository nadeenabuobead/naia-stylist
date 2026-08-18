export type TrendReportSource = {
  publisher: string;
  descriptor?: string;
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
  naiaTake?: string;
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
          "A jacket, trouser, or dress that holds its silhouette through cut and fabric weight — a longline blazer with a clean shoulder, wide-leg trousers with enough length to break at the foot, a draped midi dress in a fabric that keeps its line. The structure comes from proportion, not from stiff interfacing.",
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
      "Statement pieces that only work once",
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
        "One longline blazer, clean wide-leg trouser, or draped midi dress in a fabric that holds its shape without pressing. Look for a silhouette that reads as proportioned through cut — not padded through interfacing.",
      save:
        "Extreme sculptural pieces — heavily padded shoulders, oversized balloon sleeves, aggressively asymmetric construction. These are single-season gestures with no repeat value.",
      alreadyOwn:
        "A straight or wide-leg trouser or blazer you already own reads as soft-structured when the fabric holds its line and the silhouette sits through cut rather than stiffness. Check the piece, not just the outfit.",
    },
    investmentNotes:
      "Buy one piece that changes the proportion of what you already own: a longline blazer, draped midi dress, sharply cut wide-leg trouser, structured vest, or sculptural neutral bag. Skip extreme volume or rigid tailoring that does not suit your real life.",
    naiaInterpretation:
      "Especially useful as a shopping lens: it gives a criterion for what makes a structured piece worth buying — does its shape come from cut and fabric weight, or from stiffness and internal padding? A piece that holds itself is the investment.",
    naiaVerdict:
      "Soft Structure is the most practically useful Spring 2026 direction for a wardrobe that already exists. It does not require starting over — it requires one anchor piece with real proportion worn against something familiar. The mistake to avoid: buying structured pieces that are too stiff or too fashion-forward to rewear across more than one season.",
    howToWear: [
      {
        feeling: "When presence is the goal",
        direction:
          "A garment that holds its shape through cut does the register work that styling usually has to. In professional, social, or considered contexts, the silhouette reads as intentional — nothing around it has to do more.",
      },
      {
        feeling: "In relaxed and everyday contexts",
        direction:
          "One piece with genuine construction creates visual ease that multiple layers or accessories usually have to construct together. The discipline is reduction: fewer pieces, more resolved result.",
      },
    ],
    wardrobeNote:
      "A piece that holds its silhouette through cut and fabric weight — not through stiffness — is the only commitment this direction asks.",
    naiaTake:
      "The practical test is not how a piece looks on a hanger. It is whether the silhouette comes from cut, proportion, and fabric behaviour — or from heavy interfacing and internal stiffness. A piece that holds its shape through cut has stronger rewear potential across seasons and contexts. A piece that borrows structure from padding or from the outfit assembled around it will need styling to rescue it. That is the Soft Structure criterion.",
    sources: [
      {
        publisher: "Givenchy",
        descriptor: "Brand collection page",
        title: "Spring Summer 2026 Womenswear Show",
        url: "https://www.givenchy.com/us/en-US/cm/explore/collections/spring-summer-26-womenswear-show",
      },
      {
        publisher: "Victoria Beckham",
        descriptor: "Official collection notes",
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
      "Modern Tailoring is especially useful where a wardrobe needs composure without formality. One tailored anchor, styled with a softer counterpart, creates a considered look that can move between work, dinner, and travel.",
    naiaVerdict:
      "Modern tailoring works when the tailored piece is treated as a tool, not a statement. One well-cut jacket or trouser changes the register of everything worn with it. The investment is in the proportion — long enough, relaxed enough in the leg or sleeve, in a fabric that works across more than one season.",
    howToWear: [
      {
        feeling: "The contrast is context-independent",
        direction:
          "A tailored piece worn against something relaxed creates register at work, at dinner, and at the weekend — because the contrast is doing the work, not the formality of the setting.",
      },
      {
        feeling: "The value is in cross-purposing",
        direction:
          "One tailored anchor changes the tone of fluid counterparts across multiple outfits. The variation comes from what the anchor meets, not from buying a different anchor for each occasion.",
      },
      {
        feeling: "Proportion is the styling decision",
        direction:
          "Once the anchor and its counterpart are set, there is nothing left to add. This direction does not compound through layering or accessorising.",
      },
    ],
    wardrobeNote:
      "One tailored anchor + one fluid or familiar piece + one intentional proportion = modern polish without stiffness.",
    naiaTake:
      "The argument is strategic rather than aesthetic: one well-chosen tailored piece, worn against fluid counterparts you already own, multiplies functional outfits without multiplying the wardrobe. The buying question is not whether the tailored piece looks good in isolation, but whether it changes the register of several pieces you already own. If it only works in one tightly defined look, its wardrobe value is narrower.",
    sources: [
      {
        publisher: "Victoria Beckham",
        descriptor: "Brand collection page",
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
      "Colour Direction is especially useful for wardrobes that want colour to feel purposeful rather than reactive. A quiet base and one clear accent gives colour a defined role instead of letting it compete with the rest of the look.",
    naiaVerdict:
      "Colour direction is a method, not a palette. The nAia approach: one quiet foundation, one deep anchor, one clear accent. The value is in the discipline — choosing one accent that changes everything you already own rather than buying into a seasonal shade that only works in one context.",
    howToWear: [
      {
        feeling: "The ratio is constant",
        direction:
          "One composed foundation, one deliberate departure — across all contexts. How the accent is deployed changes (bag, shoe, outer layer, knit), but the proportion does not.",
      },
      {
        feeling: "Colour works through contrast, not coverage",
        direction:
          "One precise accent against a quiet ground reads with clarity. Multiple coloured pieces in the same look reduce the contrast and dilute the effect the accent was meant to create.",
      },
    ],
    wardrobeNote:
      "One quiet base + one deep anchor + one clear accent = colour with intention.",
    naiaTake:
      "The distinction that matters is between seasonal colour and colour discipline. Seasonal colour tells you which shades are current; colour discipline tells you that one deliberate accent, placed against a composed quiet base, works regardless of which shades are current. Espresso and warm deep brown are where nAia sees some of the clearest unrealised styling value in this palette: they can ground a look with the depth of black while feeling softer than black and less expected than beige. The Pantone data establishes the broader palette direction. The espresso observation is nAia's editorial read.",
    sources: [
      {
        publisher: "Pantone",
        descriptor: "Fashion colour report",
        title: "Fashion Color Trend Report: New York Fashion Week Spring / Summer 2026",
        publishedAt: "2025-09-11",
        url: "https://www.pantone.com/articles/fashion-color-trend-report/new-york-fashion-week-spring-summer-2026",
      },
      {
        publisher: "Victoria Beckham",
        descriptor: "Official collection notes",
        title: "Spring Summer 2026",
        publishedAt: "2025-10-04",
        url: "https://www.victoriabeckham.com/pages/spring-summer-2026",
      },
    ],
    published: true,
  },
];
