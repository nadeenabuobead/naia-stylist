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

export type TrendReportData = {
  slug: string;
  title: string;
  season: string;
  publishedAt: string;
  summary: string;
  editorialIntro: string;
  keyTrends: TrendReportKeyTrend[];
  rising?: string[];
  fading?: string[];
  brandsToWatch?: { name: string; why: string }[];
  investmentNotes?: string;
  naiaInterpretation?: string;
  howToWear?: { feeling: string; direction: string }[];
  wardrobeNote?: string;
  sources: TrendReportSource[];
  published: boolean;
};

export const trendReports: TrendReportData[] = [
  {
    slug: "spring-2026-soft-structure",
    title: "The Shape of Spring 2026: Soft Structure",
    season: "Spring 2026",
    publishedAt: "2026-06-30",
    summary:
      "A nAia edit on softened tailoring, controlled shape, and clothes that create presence without stiffness.",
    editorialIntro:
      "Soft Structure is nAia’s reading of a useful Spring 2026 direction: tailoring with more lightness, one considered sculptural gesture, and enough ease for real life. It is not about becoming plain. It is about letting cut, proportion, and fabric carry the impression.",
    keyTrends: [
      {
        name: "Tailoring, softened",
        description:
          "Choose jackets and trousers that hold a line without feeling severe. Pair one structured piece with one fluid piece.",
      },
      {
        name: "One sculptural gesture",
        description:
          "Use one defined shoulder, wrapped neckline, curved hem, asymmetric line, or controlled drape; keep the rest of the outfit calm.",
      },
      {
        name: "Lightness around the body",
        description:
          "Look for fabrics that either hold a clean shape or move with ease rather than trapping the body.",
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
    brandsToWatch: [
      {
        name: "Givenchy",
        why: "Its Spring Summer 2026 show notes describe peeling back tailoring structure toward lightness and ease.",
      },
      {
        name: "Victoria Beckham",
        why: "Its Spring Summer 2026 framing centres experimental gestures and unexpected dressing compositions.",
      },
    ],
    investmentNotes:
      "Buy one piece that changes the proportion of what you already own: a longline blazer, draped midi dress, sharply cut wide-leg trouser, structured vest, or sculptural neutral bag. Skip extreme volume or rigid tailoring that does not suit your real life.",
    naiaInterpretation:
      "This works especially well for someone who wants to feel polished, feminine, and confident without relying on tight, revealing, or overly decorated clothes.",
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
        direction: "Use long vertical layers and one structured element, then let the remaining pieces move.",
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
    summary:
      "Tailoring becomes more fluid, personal, and wearable when it is treated as an anchor rather than a uniform.",
    editorialIntro:
      "The nAia edit for modern tailoring is less corporate, more personal. It uses a tailored element to give a look clarity, then softens it with fluid fabric, relaxed styling, or an unexpected proportion.",
    keyTrends: [
      {
        name: "Formal meets fluid",
        description:
          "Balance a structured jacket, vest, or trouser with a softer element such as a draped skirt, fine knit, slip dress, or relaxed shirt.",
      },
      {
        name: "Separates over matching sets",
        description:
          "A tailored piece should work across at least three outfits; the goal is flexibility, not one complete suit.",
      },
      {
        name: "Proportion does the styling",
        description:
          "Use one clear contrast: a long blazer with a narrow skirt, a cropped jacket with a wider trouser, or a vest with a longline trouser.",
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
    brandsToWatch: [
      {
        name: "Victoria Beckham",
        why: "Its Pre Spring Summer 2026 collection explicitly describes a meeting of formal and fluid dressing.",
      },
      {
        name: "Givenchy",
        why: "Its Spring Summer 2026 notes support a softer reading of structure and tailoring.",
      },
    ],
    investmentNotes:
      "Start with a longline blazer, straight or wide-leg tailored trouser, waistcoat, clean column skirt, or crisp shirt with enough ease to layer and restyle.",
    naiaInterpretation:
      "Use tailoring when you want to feel composed at work, travel, dinner, or meetings without looking overly managed.",
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
    slug: "spring-2026-colour-direction",
    title: "Colour Direction: The Quiet Base & the Clear Accent",
    season: "Spring 2026",
    publishedAt: "2026-06-30",
    summary:
      "An nAia method for using a calm wardrobe foundation with one expressive colour note.",
    editorialIntro:
      "This is not a claim that every Spring 2026 wardrobe should use the same colours. It is the nAia approach to making colour feel more wearable: build from a quiet base, then add one clear accent that changes the mood of the look.",
    keyTrends: [
      {
        name: "The quiet base",
        description:
          "Use soft white, cream, stone, espresso, black, or washed denim as repeatable foundations.",
      },
      {
        name: "One intentional accent",
        description:
          "Choose a single expressive colour through a top, knit, shoe, bag, scarf, or evening piece rather than several competing bright items.",
      },
      {
        name: "Contrast over perfect matching",
        description:
          "Let a grounded neutral meet one distinct interruption instead of forcing a fully tonal look.",
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
    brandsToWatch: [
      {
        name: "Pantone",
        why: "Its New York Fashion Week Spring Summer 2026 report frames colour around authenticity, individuality, and personal combinations.",
      },
      {
        name: "Victoria Beckham",
        why: "Its Spring Summer 2026 framing supports experimentation and personal expression in dressing.",
      },
    ],
    investmentNotes:
      "Buy one neutral foundation piece and one accent piece that works with at least three things you already own. Deep espresso is an especially useful anchor when black feels too hard and beige feels too safe.",
    naiaInterpretation:
      "Colour is worth buying when it changes your existing wardrobe, not when it creates a new styling problem.",
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
        direction: "Use a long neutral layer and introduce colour through the inner layer, bag, shoe, or scarf.",
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
