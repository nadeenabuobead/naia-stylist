// Professional lens content — one entry per published report × per lens.
// All copy is grounded in the verified public-report data (trend-reports.ts).
// No unsupported commercial claims, no market/demand/performance assertions.
// Editorial conclusions are framed as "nAia's read is…" or "the safer
// interpretation is…" throughout.

export type LensKey =
  | "designer"
  | "buyer"
  | "marketer"
  | "creative-director"
  | "stylist";

// Plain body — used by all non-Designer modules (and THE PRODUCT TRANSLATION)
type BodyModule = { label: string; body: string };

// Designer brief — 3-card structured code block (Principle / Design Move / Avoid)
type StructuredCodeModule = {
  type: "structured-code";
  label: string;
  intro?: string;
  principle: string;
  designMove: string;
  avoid: string;
};

// Designer brief — 2-column decision attribute grid
type DecisionGridModule = {
  type: "decision-grid";
  label: string;
  decisions: { label: string; body: string }[];
};

// Designer brief — avoid chips + closing editorial line
type AvoidChipsModule = {
  type: "avoid-chips";
  label: string;
  chips: string[];
  closing: string;
};

// Designer brief — 2-column prototype item cards
type PrototypeCardsModule = {
  type: "prototype-cards";
  label: string;
  intro?: string;
  cards: { label: string; body: string }[];
};

// Designer brief — numbered fit-test checklist
type ChecklistModule = {
  type: "checklist";
  label: string;
  items: string[];
};

// Designer brief — product category list + fabric logic rows
type ProductBriefModule = {
  type: "product-brief";
  label: string;
  categories: string[];
  fabricHolds: string[];
  fabricMoves: string[];
  proofLine: string;
};

// Final editorial statement — rendered in accent box
type HighlightModule = {
  type: "highlight";
  label: string;
  body: string;
};

export type LensModule =
  | BodyModule
  | StructuredCodeModule
  | DecisionGridModule
  | AvoidChipsModule
  | PrototypeCardsModule
  | ChecklistModule
  | ProductBriefModule
  | HighlightModule;

export type LensContent = {
  modules: LensModule[]; // last entry is always THE DECISION
};

export type ReportLenses = Record<LensKey, LensContent>;

export const LENS_LABELS: Record<LensKey, string> = {
  designer: "Designer",
  buyer: "Buyer",
  marketer: "Marketer",
  "creative-director": "Creative Director",
  stylist: "Stylist",
};

export const VALID_LENSES = new Set<string>([
  "designer",
  "buyer",
  "marketer",
  "creative-director",
  "stylist",
]);

export const PROFESSIONAL_LENS_CONTENT: Record<string, ReportLenses> = {

  // -------------------------------------------------------------------------
  // SPRING 2026 SOFT STRUCTURE
  // Sources: Givenchy SS26; Victoria Beckham SS26
  // -------------------------------------------------------------------------
  "spring-2026-soft-structure": {

    designer: {
      modules: [
        {
          type: "structured-code",
          label: "THE DESIGN CODE",
          intro: "Givenchy's SS26 notes point to tailoring being peeled back toward lightness and ease.",
          principle: "Structure comes from proportion, not stiffness.",
          designMove: "Use one clear line: shoulder, hem, waist, seam, or trouser break.",
          avoid: "Heavy interfacing, overbuilt shoulders, complicated drape.",
        },
        {
          type: "product-brief",
          label: "THE PRODUCT TRANSLATION",
          categories: ["Longline blazer", "Wide-leg trouser", "Draped midi dress", "Structured vest"],
          fabricHolds: ["Structured crepe", "Ponte", "Dry-hand twill"],
          fabricMoves: ["Fluid viscose", "Washed linen", "Lightweight silk"],
          proofLine: "Each piece should prove one thing: a clear silhouette that holds its line without feeling hard.",
        },
        {
          type: "decision-grid",
          label: "DESIGN DECISIONS",
          decisions: [
            { label: "SHOULDER", body: "Softened but present. Avoid hard padding unless the rest of the garment is fluid." },
            { label: "HEM", body: "Long enough to create line. For trousers, test where the break elongates rather than widens." },
            { label: "WAIST", body: "Defined through cut, seam, or proportion — not tightness." },
            { label: "SEAM", body: "Use one controlled construction gesture. The seam should clarify the shape, not decorate it." },
            { label: "FABRIC", body: "Choose body or movement. Do not use limp fabric for a structured piece or stiff fabric for a fluid one." },
            { label: "LENGTH", body: "Let length create authority. Cropped or short proportions need a clear reason." },
          ],
        },
        {
          type: "avoid-chips",
          label: "WHAT NOT TO COPY",
          chips: [
            "OVERBUILT SHOULDERS",
            "HEAVY INTERFACING",
            "COMPLICATED DRAPE",
            "STYLING-DEPENDENT SHAPES",
            "TOO MANY PROPORTION GESTURES",
          ],
          closing: "The value is not in recreating the reference. It is in extracting the construction principle.",
        },
        {
          type: "prototype-cards",
          label: "PROTOTYPE BRIEF",
          intro: "Develop one piece that proves the direction without over-styling it.",
          cards: [
            { label: "LONGLINE BLAZER", body: "Softened shoulder. Clear vertical line. Works without heavy padding." },
            { label: "WIDE-LEG TROUSER", body: "Clean fall. Controlled break. Elongates rather than widens." },
            { label: "DRAPED MIDI", body: "One controlled seam gesture. Movement without collapse." },
            { label: "STRUCTURED VEST", body: "Defines the body without tightness or stiffness." },
          ],
        },
        {
          type: "checklist",
          label: "FIT TEST",
          items: [
            "Does the garment hold its line without feeling hard?",
            "Does the fabric support the cut?",
            "Does the silhouette still work without runway styling?",
            "Can the customer rewear it across more than one occasion?",
            "Is there one gesture, or are there too many competing ideas?",
          ],
        },
        {
          type: "highlight",
          label: "THE DECISION",
          body: "The reference is the question, not the answer.\n\nFor a designer, Soft Structure is not a silhouette to copy. It is a construction problem: how to create presence through proportion, fabric, and line without returning to stiffness.",
        },
      ],
    },

    buyer: {
      modules: [
        {
          label: "THE COMMERCIAL BET",
          body: "Rising signals from this report: softened shoulders, long clean trouser lines, defined waist through cut, asymmetry used with restraint. nAia's read is that the commercial case for this direction is wardrobe utility over trend novelty — an anchor piece that changes the proportion of what a customer already owns is a different commercial proposition than a seasonal statement, and should be stocked and described accordingly.",
        },
        {
          label: "THE ASSORTMENT ROLE",
          body: "The report's investment logic is specific: one longline blazer, draped midi dress, sharply cut wide-leg trouser, structured vest, or sculptural neutral bag. nAia would treat the longline blazer and wide-leg trouser as anchor depth, and the midi and vest as directional tests. The anchor's value is cross-wardrobe utility — it earns its place by working with what the customer already owns, not by completing a new look.",
        },
        {
          label: "THE RISK",
          body: "Fading signals translate directly to assortment risk: rigid suiting (the direction explicitly moves away from it), overly complicated drape (one-occasion use), and the save note is explicit — extreme sculptural constructions are single-season gestures. The safer interpretation is to avoid depth in any extreme structural gesture and focus investment on the independently functional anchor categories.",
        },
        {
          label: "THE DECISION",
          body: "Stock longline blazer and wide-leg trouser as depth anchors. Test extreme sculptural shapes minimally or avoid them. The category's argument is utility, not novelty — describe it that way.",
        },
      ],
    },

    marketer: {
      modules: [
        {
          label: "THE CULTURAL TENSION",
          body: "The tension Soft Structure resolves: presence and authority without visible effort. nAia's read is that this direction speaks to the need to register as considered without appearing to have tried — and the resolution is a garment that holds authority through cut and proportion rather than through embellishment, body-conscious silhouettes, or decorative detail.",
        },
        {
          label: "THE BRAND APPLICATION",
          body: "The Victoria Beckham SS26 source note offers the most transferable communication logic: one deliberate departure from a composed base, with everything else staying calm. nAia's read is that the brand application is specificity, not variety — showing one piece, one proportion decision, one fabric story communicates the same intelligence the garment is designed to demonstrate. Showing the direction across too many silhouettes in one communication dilutes the effect the direction is built on.",
        },
        {
          label: "THE DECISION",
          body: "Brief from the feeling of having already made a considered decision — not the occasion, not the assembled outfit, but the single piece chosen with intelligence. One look, one garment, one reason for it.",
        },
      ],
    },

    "creative-director": {
      modules: [
        {
          label: "THE WORLD-BUILDING MOVE",
          body: "The report's internal logic: not about becoming plain, but about letting cut, proportion, and fabric carry the impression without embellishment or body-conscious cuts. nAia's read is that the world this builds is one where every element earns its place by doing structural work — decoration is not excluded because it is unwelcome, but because the structure does not need it.",
        },
        {
          label: "THE ORIGINAL RESPONSE",
          body: "The Givenchy and Victoria Beckham sources both arrive at the same cultural territory — presence without performance — from different aesthetic starting points. nAia's read is that the creative question is not 'how do we do Soft Structure' but 'what is our brand's original response to this specific tension?' That question has a different answer for every brand, and the difference is the authorship.",
        },
        {
          label: "THE DECISION",
          body: "Identify whether your brand's world argues for effort or ease. If ease, determine whether the construction principle — structure through proportion — can be expressed in your brand's own aesthetic language rather than in this direction's specific visual vocabulary.",
        },
      ],
    },

    stylist: {
      modules: [
        {
          label: "THE CLIENT TRANSLATION",
          body: "The report is specific: most useful for wardrobes seeking polish and presence without tight cuts, revealing silhouettes, or embellished detail. The four verified context cards cover work (structured blazer, fluid trouser, fine knit), dinner (draped midi or column dress, minimal accessories), everyday (one architectural layer with denim), and modest dressing (long vertical layers, one structured element). The direction adapts across all four without requiring a different wardrobe for each.",
        },
        {
          label: "THE STYLING ENTRY POINT",
          body: "The report is direct: a straight or wide-leg trouser the client already owns reads as Soft Structure when paired with a draped blouse or fine knit instead of a matching jacket. The proportion combination is the editorial move, not a new purchase. If a new piece is warranted, the anchor is one longline blazer or wide-leg trouser in a fabric that holds its shape without pressing — keep everything surrounding it simpler.",
        },
        {
          label: "WHEN NOT TO USE IT",
          body: "Wrong for the client who needs visible occasion signals — embellishment, body-conscious silhouettes, decorative detail. Wrong for the client who reads quiet clothing as uneventful. nAia's read is that the already-own restyle is the more honest recommendation at budget constraints than a new purchase that cannot deliver the direction at the fabric level.",
        },
        {
          label: "THE DECISION",
          body: "Start with what the client already owns. Restyle one wide-leg trouser or blazer against a quieter counterpart before recommending a purchase. If the restyle lands, the investment case follows from evidence.",
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // MODERN TAILORING SPRING 2026
  // Source: Victoria Beckham Pre SS26
  // -------------------------------------------------------------------------
  "modern-tailoring-spring-2026": {

    designer: {
      modules: [
        {
          label: "THE DESIGN CODE",
          body: "The report's editorial logic: one tailored anchor piece defines the register; a softer counterpart makes it wearable. The Victoria Beckham Pre SS26 source — the formal and the fluid brought together. nAia's read is that the design decision is the proportion contrast itself (longline against narrow, cropped against wide, structured against relaxed) and that each piece must function independently, not only as part of a paired look.",
        },
        {
          label: "THE PRODUCT TRANSLATION",
          body: "Verified spend: a longline blazer or wide-leg tailored trouser in a fabric with enough body to hold its line across repeated wears. The design test for any piece: does it function with denim, with a skirt, and with a dress — or only with its matching counterpart? Rising signals include waistcoats worn as a top layer and tailored separates specifically. The independently functional separates piece is the direction; the suit is not.",
        },
        {
          label: "WHAT NOT TO COPY",
          body: "Fading signals: suits that only work together, stiff fabric with no movement, trousers that require heels. The save note is specific — a full matching suit in a seasonal colour or fashion-forward cut dates quickly and functions as one outfit. The copy risk is designing pieces that require each other rather than unlocking combinations independently.",
        },
        {
          label: "THE DECISION",
          body: "Design each separates piece to function across at least three different combinations. The investment is in the independent proportion — long enough, relaxed enough, in a fabric that works across more than one season.",
        },
      ],
    },

    buyer: {
      modules: [
        {
          label: "THE COMMERCIAL BET",
          body: "Rising signals: longline blazers, waistcoats as a top layer, fluid trousers, tailored separates. Fading: suits that only work together, stiff fabric with no movement, heels-required trousers. nAia's read is that the commercial case is cross-category utility — one piece that functions with denim, a skirt, and a dress earns its place more reliably than one that only completes a matched look.",
        },
        {
          label: "THE ASSORTMENT ROLE",
          body: "nAia would treat longline blazers and wide-leg tailored trousers as anchor depth, and waistcoats and column skirts as supporting separates. The investment note from this report: start with a longline blazer, wide-leg tailored trouser, waistcoat, clean column skirt, or crisp shirt with enough ease to layer and restyle. The value is combinability — a piece that changes the register of what the customer already owns.",
        },
        {
          label: "THE RISK",
          body: "The fading signals are commercially specific: matched suits in seasonal colours (single-use, dates quickly), stiff fabric with no movement (no cross-season utility), heels-only trousers (occasion-limiting). The safer interpretation is depth in independently functional separates and minimal or no depth in matched suiting or rigid constructions.",
        },
        {
          label: "THE DECISION",
          body: "Stock separates, not sets. Describe each piece by what it works with — not by the trend category it belongs to.",
        },
      ],
    },

    marketer: {
      modules: [
        {
          label: "THE CULTURAL TENSION",
          body: "The tension Modern Tailoring resolves: composure without formality — the specific need to look considered without appearing dressed-up or restricted to one context. nAia's read is that the direction speaks to the person who wants a look that adapts across work, dinner, and travel without requiring a different wardrobe for each. The report's verdict — tailoring as a tool, not a statement — is the emotional territory.",
        },
        {
          label: "THE BRAND APPLICATION",
          body: "The Victoria Beckham Pre SS26 source: one tailored piece and one fluid counterpart brought together. nAia's read is that showing one piece across multiple contexts (with denim, with a relaxed skirt, with a slip dress) is more honest than presenting one assembled complete look — the piece's independence from a partner is what the direction is demonstrating.",
        },
        {
          label: "THE DECISION",
          body: "Brief from the proposition that one well-cut piece changes what everything around it means. Show the piece in three contexts. The intelligence of its independence is the message.",
        },
      ],
    },

    "creative-director": {
      modules: [
        {
          label: "THE WORLD-BUILDING MOVE",
          body: "The report's summary: tailoring becomes more fluid, personal, and wearable when treated as an anchor rather than a uniform. nAia's read is that the creative coherence test is whether every element — product, campaign, retail, styling — argues the same point from different directions. If any element reads as formal matched suiting when the direction is tailoring-as-tool, the world's coherence breaks.",
        },
        {
          label: "THE ORIGINAL RESPONSE",
          body: "The proportion contrast is the design idea: one structured anchor against one relaxed counterpart. nAia's read is that each brand's original response to this is to identify which single tailored piece most expressively represents its own proportion language. That answer is different for every brand, and the difference is the creative authorship.",
        },
        {
          label: "THE DECISION",
          body: "Identify the single tailored piece that most clearly expresses your brand's proportion language. Brief campaign and collection direction from that specific piece — not from tailoring as a category.",
        },
      ],
    },

    stylist: {
      modules: [
        {
          label: "THE CLIENT TRANSLATION",
          body: "Most useful for the client who wants composure without formality — a look that adapts across work, dinner, and travel. Verified context cards: work (tailored trousers, soft shirt or knit), dinner (structured blazer over slip or column dress), travel (fluid trousers, tonal knit, longline blazer), casual (one tailored piece with denim). Wrong for the client who needs matched formal suiting, strict dress codes, or heels-required proportions.",
        },
        {
          label: "THE STYLING ENTRY POINT",
          body: "The report is explicit: a waistcoat or blazer already owned for formal occasions reads as Modern Tailoring when worn open over a relaxed shirt or against a fluid wide-leg trouser. The styling shift — not a new garment — is the update. If a new purchase is warranted: a longline blazer or wide-leg tailored trouser, worn against something relaxed on the other side of the proportion contrast.",
        },
        {
          label: "WHEN NOT TO USE IT",
          body: "Wrong for the client whose environment requires formal matched suiting. Wrong for the client whose primary occasion need is heels-specific proportions. Wrong for the client with no appetite for even one structured element — the direction depends on the contrast between the anchor and the relaxed counterpart, and that requires the client's engagement with the anchor piece.",
        },
        {
          label: "THE DECISION",
          body: "Test whether the client's existing blazer or waistcoat reads as Modern Tailoring when restyled against something relaxed before recommending a purchase. The restyle is the proof of concept.",
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // SPRING 2026 COLOUR DIRECTION
  // Sources: Pantone NYFW SS26 Fashion Color Trend Report; Victoria Beckham SS26
  // -------------------------------------------------------------------------
  "spring-2026-colour-direction": {

    designer: {
      modules: [
        {
          label: "THE DESIGN CODE",
          body: "The nAia method from this report: base + anchor + accent. Each piece serves one role in the system — the base works with everything, the anchor resolves a specific neutral problem (espresso is named explicitly: warmer than black, more grounded than beige), the accent is singular and deliberate. nAia's read is that the design challenge is making the anchor neutrals as carefully resolved as the accent — depth of dye, warmth, relationship to light — not defaulting to the trending shade as the investment.",
        },
        {
          label: "THE PRODUCT TRANSLATION",
          body: "Verified spend: one piece in a deep anchor neutral (espresso, deep navy, washed black) — a trouser, bag, or shoe that fills a genuine gap in the existing neutral base. Verified rising signals: soft white foundations, deep brown as an anchor, a single expressive accessory or knit, purposeful colour contrast. The accessory is the specifically cited accent vehicle — lowest commitment, most immediate legibility, the right starting point before an accent garment.",
        },
        {
          label: "WHAT NOT TO COPY",
          body: "Fading signals: buying several bright pieces that only work together; replacing a full wardrobe for one seasonal shade; over-coordinated colour matching. The save note: multiple pieces in a single seasonal accent colour creates a styling problem, not a colour story. A range that over-indexes on accent pieces without anchor neutrals to support them is the fading pattern the report names explicitly.",
        },
        {
          label: "THE DECISION",
          body: "Design the anchor neutrals with as much care as the accent — they earn their place by working with everything, and that is the harder resolution. The accent piece is secondary to getting the base and anchor right.",
        },
      ],
    },

    buyer: {
      modules: [
        {
          label: "THE COMMERCIAL BET",
          body: "Rising signals: soft white foundations, deep brown as an anchor, a single expressive accessory or knit, purposeful colour contrast. Fading: multiple brights that only work together, wardrobe replacement for one seasonal shade, over-coordinated colour matching. nAia's read is that the commercial distinction is anchor (depth investment, multi-season utility) versus accent (test at accessory level first) — these require different buying strategies and should not be conflated.",
        },
        {
          label: "THE ASSORTMENT ROLE",
          body: "The anchor neutrals — espresso, deep navy, washed black — are the depth proposition across trousers, bags, and shoes. The accent is introduced through accessories first: one bag or flat in a clear accent note allows a test before committing to an accent garment. nAia would treat anchor-heavy base categories as the investment and a single accent accessory as the directional test.",
        },
        {
          label: "THE RISK",
          body: "The fading signals translate to assortment risk: multiple pieces in one seasonal accent colour (the fading pattern the report names directly), and over-coordinated colour collections that require the full set to work. The safer interpretation is testing accent at the single accessory level before any depth commitment.",
        },
        {
          label: "THE DECISION",
          body: "Build anchor depth first. Test accent at the accessory level. Do not commit to accent garment depth without a clear read on how the accessory entry has landed.",
        },
      ],
    },

    marketer: {
      modules: [
        {
          label: "THE CULTURAL TENSION",
          body: "The tension Colour Direction resolves: wanting to use colour expressively without the risk of looking misjudged or temporarily fashionable. nAia's read is that the method — one note through the lowest-commitment piece against a quiet base — is a specific resolution to a specific anxiety. The communication territory is the intelligence of the decision, not the colour itself.",
        },
        {
          label: "THE BRAND APPLICATION",
          body: "The Pantone source documents the season's palette; the Victoria Beckham source adds the communication register: experimentation means one clear departure, not a full palette change. nAia's read is that the brand application is briefing around the decision behind the colour choice — what problem it resolves, what role it plays — rather than the colour itself as a trend signal. The palette is context; the decision logic is the story.",
        },
        {
          label: "THE DECISION",
          body: "Brief from the decision: one accent note and a specific reason for it. The intelligence of the choice — not the colour — is the territory.",
        },
      ],
    },

    "creative-director": {
      modules: [
        {
          label: "THE WORLD-BUILDING MOVE",
          body: "The report provides the creative logic: soft white foundations, a deep warm anchor (espresso is specifically named as resolving a problem — warmer than black, more grounded than beige), one clear accent that changes the mood of the whole look. nAia's read is that the creative position is palette-as-method, not palette-as-season. A brand that can articulate why it chooses espresso over black has a creative position; a brand that adopts the season's trending shades has a collection.",
        },
        {
          label: "THE ORIGINAL RESPONSE",
          body: "The report asks a foundational creative question: is the brand's colour story built on restraint or on expression? The Pantone source documents what the season is doing — that is not the same as what a brand should do. nAia's read is that the creative director's job is to decide which position the brand holds and to build colour choices from that position, not from trend alignment.",
        },
        {
          label: "THE DECISION",
          body: "Articulate why each colour in the palette earns its place — what problem it resolves, what role it serves in the system. Brief from that logic, not from the season's colour report.",
        },
      ],
    },

    stylist: {
      modules: [
        {
          label: "THE CLIENT TRANSLATION",
          body: "Most useful for the client who wants colour to feel purposeful rather than reactive, who already has a quiet wardrobe base, and who is colour-anxious. The four verified context cards: work (colour through a shirt, bag, shoe, or scarf against a calm base), dinner (neutral column or tailored base with one coloured accent), everyday (denim, white, and brown base with one expressive knit, flat, or bag), and modest dressing (long neutral layer; colour through inner layer, bag, shoe, or scarf).",
        },
        {
          label: "THE STYLING ENTRY POINT",
          body: "The report is direct: the client's existing neutral blouse, trouser, or dress is already the base — introduce the accent through the lowest-commitment, highest-visibility piece first. The bag is the most universally applicable entry; for clients without prominent bag presence, the flat or scarf is equivalent. One accent note is the complete introduction.",
        },
        {
          label: "WHEN NOT TO USE IT",
          body: "Wrong for the client who wants a colourful wardrobe — the method is about restraint, and restraint is not the right goal for every client. Wrong for the client whose existing base is already chaotic, because the method requires a quiet base to give the accent room to read. Wrong if the primary need is high visual presence across the full look.",
        },
        {
          label: "THE DECISION",
          body: "Introduce colour through the lowest-commitment, highest-visibility piece for this specific client. Choose the piece's category based on where the client's eyes — and the room's — land first in the outfit.",
        },
      ],
    },
  },
};
