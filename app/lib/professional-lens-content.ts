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

// Buying brief — stacked labeled rows (assortment role, depth recommendation)
type StackedRowsModule = {
  type: "stacked-rows";
  label: string;
  rows: { label: string; body: string; sub?: string }[];
};

// Buyer brief — premium assortment category cards with items line + commercial note
type AssortmentCardsModule = {
  type: "assortment-cards";
  label: string;
  cards: { label: string; items: string; note: string }[];
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
  | StackedRowsModule
  | AssortmentCardsModule
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
          label: "THE COMMERCIAL READ",
          body: "Soft Structure is not a loud trend. It is a wardrobe-upgrade trend.\n\nIts commercial value is in pieces that feel new enough to justify buying, but familiar enough to wear often: longline blazers, wide-leg trousers, structured vests, and draped midi dresses.",
        },
        {
          type: "assortment-cards",
          label: "THE ASSORTMENT ROLE",
          cards: [
            {
              label: "CORE WARDROBE",
              items: "Wide-leg trousers · longline blazers · soft tailoring separates",
              note: "High repeat value. Strongest depth opportunity.",
            },
            {
              label: "ELEVATED OCCASION",
              items: "Draped midi dresses · fluid suiting · structured vests",
              note: "Buy selectively. Works best with strong styling context.",
            },
            {
              label: "STATEMENT BUY",
              items: "One proportion-led piece only",
              note: "Use as a directional signal, not a volume play.",
            },
          ],
        },
        {
          type: "decision-grid",
          label: "BUYING DECISIONS",
          decisions: [
            { label: "CATEGORY", body: "Prioritise trousers, blazers, vests, and midi dresses over novelty tops." },
            { label: "PRICE TIER", body: "Best suited to mid-to-premium price points where fabric and cut can justify the trend." },
            { label: "FABRIC", body: "Buy into fabrics that hold line without stiffness: structured crepe, dry-hand twill, ponte, fluid viscose." },
            { label: "COLOUR", body: "Neutrals and grounded tones will carry the trend better than loud colourways." },
            { label: "MERCHANDISING", body: "Style with quiet supporting pieces so the silhouette reads clearly." },
            { label: "TIMING", body: "Works best as a transitional wardrobe update, not a peak-only seasonal statement." },
          ],
        },
        {
          type: "avoid-chips",
          label: "RISK CHECK",
          chips: [
            "OVERBUYING OVERSIZED SHAPES",
            "TOO MUCH STRUCTURED SUITING",
            "LOW-QUALITY FABRIC",
            "RUNWAY-ONLY SILHOUETTES",
            "UNCLEAR USE CASE",
          ],
          closing: "The risk is not that the trend is too directional. The risk is buying versions that do not feel wearable enough to repeat.",
        },
        {
          type: "stacked-rows",
          label: "COMMERCIAL CONFIDENCE",
          rows: [
            { label: "HIGH CONFIDENCE", body: "Wide-leg trousers, longline blazers, soft tailoring separates.", sub: "High repeat value; easy wardrobe integration." },
            { label: "MEDIUM CONFIDENCE", body: "Draped midi dresses, structured vests.", sub: "Commercially useful, but more dependent on customer lifestyle, styling context, and price point." },
            { label: "LOW CONFIDENCE", body: "Extreme sculptural pieces, heavy padded shoulders, runway-only shapes.", sub: "Low repeat value; higher risk of looking over-designed or too occasion-specific." },
          ],
        },
        {
          type: "stacked-rows",
          label: "DEPTH RECOMMENDATION",
          rows: [
            { label: "BUY DEEPER", body: "Clean wide-leg trousers, longline blazers, soft tailoring separates." },
            { label: "TEST LIGHTLY", body: "Structured vests, proportion-led statement pieces, and draped midi dresses where the use case is occasion-specific." },
            { label: "HOLD OFF", body: "Overbuilt shoulders, extreme volume, stiff suiting, pieces that only work when heavily styled." },
          ],
        },
        {
          type: "highlight",
          label: "THE DECISION",
          body: "Buy the principle, not the runway shape.\n\nFor a buyer, Soft Structure is a controlled commercial opportunity: strong enough to refresh the assortment, but safest when bought through wearable anchor pieces with clear styling use.",
        },
      ],
    },

    marketer: {
      modules: [
        {
          label: "THE CULTURAL TENSION",
          body: "Customers want to look considered without looking like they tried too hard. They want presence without performance, authority without stiffness, polish without decoration.\n\nSoft Structure resolves this. It gives clothing a clear visual authority — without requiring the customer to perform it.",
        },
        {
          type: "highlight",
          label: "THE MESSAGE",
          body: "Soft Structure is not about dressing up. It is about looking like the decision was already made.",
        },
        {
          type: "prototype-cards",
          label: "CAMPAIGN ANGLES",
          cards: [
            { label: "QUIET AUTHORITY", body: "For work, meetings, travel, and composed everyday dressing. Polish that does not announce itself." },
            { label: "ONE DECISION DRESSING", body: "One piece carries the look; everything else supports it. The outfit feels resolved before it starts." },
            { label: "PRESENCE WITHOUT PERFORMANCE", body: "Polish through proportion, not obvious styling. The garment does the work so the wearer does not have to." },
            { label: "THE FINISHED LOOK", body: "The piece that makes the outfit feel resolved — without adding more layers, accessories, or effort." },
            { label: "WARDROBE UPGRADE", body: "Not a new persona. A cleaner way to make the wardrobe feel current." },
          ],
        },
        {
          type: "stacked-rows",
          label: "VISUAL DIRECTION",
          rows: [
            { label: "COMPOSITION", body: "One garment, clearly shown. Avoid over-layered styling. Use negative space — let the silhouette breathe." },
            { label: "POSE & SETTING", body: "Calm poses. Neutral settings. Nothing that competes with the line of the garment." },
            { label: "DETAILS", body: "Close shots of cut, shoulder, hem, and drape. Fabric handle is part of the story — show it." },
            { label: "COLOUR", body: "Neutral and grounded tones. Avoid colourways that pull focus from the silhouette." },
          ],
        },
        {
          type: "stacked-rows",
          label: "COPY RULES",
          rows: [
            { label: "SAY", body: "Composed · considered · clean · proportion · presence · ease · softened tailoring · quiet confidence" },
            { label: "AVOID", body: "Boss babe · power dressing · statement-making · dramatic · must-have trend · runway-inspired · officewear-only" },
          ],
        },
        {
          type: "avoid-chips",
          label: "CONTENT HOOKS",
          chips: [
            "THE PIECE THAT MAKES THE OUTFIT FEEL FINISHED",
            "STRUCTURE WITHOUT STIFFNESS",
            "ONE GESTURE. EVERYTHING ELSE QUIET.",
            "POLISHED, WITHOUT LOOKING PERFORMED",
            "THE NEW WAY TO LOOK CONSIDERED",
            "THE OUTFIT DOES NOT NEED MORE. IT NEEDS ONE CLEAR DECISION.",
          ],
          closing: "Use these as social captions, email subject lines, or product description openers. Each one works alone.",
        },
        {
          type: "avoid-chips",
          label: "WHAT NOT TO DO",
          chips: [
            "MARKET AS A LOUD TREND",
            "MAKE IT A FULL OUTFIT FORMULA",
            "MAKE IT LOOK LIKE A RUNWAY COPY",
            "OVER-STYLE THE CAMPAIGN",
            "OVER-EXPLAIN THE DIRECTION",
            "FRAME AS OFFICEWEAR ONLY",
          ],
          closing: "The more you over-explain or over-style it, the less believable it becomes. The direction works because it feels effortless.",
        },
        {
          type: "highlight",
          label: "THE DECISION",
          body: "Brief from the feeling of already having made a considered decision.\n\nOne look, one garment, one reason for it.",
        },
      ],
    },

    "creative-director": {
      modules: [
        {
          label: "THE CREATIVE READ",
          body: "Soft Structure is not about drama. It is about controlled ease — clothes with enough shape to hold the frame, and enough softness to let the woman stay present.\n\nThe visual job is not to announce the trend. It is to show the woman wearing the decision she has already made.",
        },
        {
          label: "THE VISUAL WORLD",
          body: "Quiet interiors. Negative space. Neutral architecture. Soft diffused daylight.\n\nThe set must earn its place by framing the garment, not competing with it. Fabric, proportion, and the woman's presence carry the image. Everything else is background.",
        },
        {
          type: "stacked-rows",
          label: "THE IMAGE MUST PROVE",
          rows: [
            { label: "THE GARMENT HOLDS THE FRAME", body: "The line, drape, and proportion must be clear before anything else." },
            { label: "THE WOMAN HOLDS THE PRESENCE", body: "She should feel self-possessed, not styled into a concept." },
            { label: "THE SET SUPPORTS THE SILHOUETTE", body: "The environment should frame the silhouette, not become the image." },
          ],
        },
        {
          type: "stacked-rows",
          label: "IMAGE LANGUAGE",
          rows: [
            { label: "COMPOSITION", body: "One clear silhouette. Let space frame the garment. The eye should land on the line, not the styling." },
            { label: "LIGHT", body: "Soft natural light or diffused studio. Avoid harsh contrast unless it sharpens the line." },
            { label: "MOVEMENT", body: "Small gestures. Fabric caught mid-shift. The garment moves; the silhouette holds." },
            { label: "DETAIL", body: "Shoulder, waist, hem, drape, closure, fabric handle. One detail at a time." },
          ],
        },
        {
          type: "avoid-chips",
          label: "STYLING DIRECTION",
          chips: [
            "ONE PROPORTION DECISION AT A TIME",
            "MINIMAL LAYERING",
            "QUIET SUPPORTING PIECES",
            "CLEAN FOOTWEAR",
            "RESTRAINED ACCESSORIES",
            "LET THE GARMENT CARRY THE VISUAL IDEA",
          ],
          closing: "Over-styling cancels the effect. Every extra element must earn its place or be removed.",
        },
        {
          type: "stacked-rows",
          label: "CASTING + ENERGY",
          rows: [
            { label: "COMPOSURE", body: "Self-possessed. Present but not performing. Confidence through stillness, not attitude." },
            { label: "POSE", body: "Natural stance, small movements. Not overly directed, not stiff. Nothing that reads as power-suit acting." },
            { label: "ENERGY", body: "The woman is aware of herself — not the clothes, not the camera." },
          ],
        },
        {
          type: "avoid-chips",
          label: "SET + ATMOSPHERE",
          chips: [
            "NEUTRAL ROOM",
            "GALLERY-LIKE INTERIOR",
            "STONE / PLASTER / GLASS / WOOD",
            "QUIET HALLWAY",
            "CLEAN STUDIO",
            "SOFT CITY BACKDROP",
            "TRAVEL / INTERIOR TRANSITION SPACES",
          ],
          closing: "The set should support the silhouette. When the set becomes the story, the garment disappears.",
        },
        {
          type: "avoid-chips",
          label: "CREATIVE RISK",
          chips: [
            "TOO CORPORATE",
            "TOO COLD OR EMPTY",
            "OVERLY EDITORIAL POSING",
            "STIFF POWER-SUIT REFERENCES",
            "EXCESSIVE ACCESSORIES",
            "RUNWAY-COPY STYLING",
            "WOMAN DISAPPEARS BEHIND THE CONCEPT",
          ],
          closing: "The risk is making the clothes look like a uniform instead of a decision. Direction should create presence, not erase the person.",
        },
        {
          type: "highlight",
          label: "THE DIRECTION",
          body: "Direct for restraint, not emptiness.\n\nLet the garment hold the frame while the woman holds the presence.",
        },
      ],
    },

    stylist: {
      modules: [
        {
          label: "THE STYLING READ",
          body: "Soft Structure is not about wearing a full tailored look. It is about choosing one piece with shape, then softening everything around it so the outfit feels composed, not rigid.\n\nOne clear silhouette decision. Everything else stays quiet.",
        },
        {
          type: "avoid-chips",
          label: "START WITH ONE ANCHOR",
          chips: [
            "WIDE-LEG TROUSERS",
            "LONGLINE BLAZER",
            "DRAPED MIDI DRESS",
            "STRUCTURED VEST",
            "SOFT TAILORED SKIRT",
            "FLUID TROUSER",
          ],
          closing: "The anchor carries the silhouette. Once it is chosen, every other piece should make it easier to wear — not more complicated.",
        },
        {
          type: "stacked-rows",
          label: "PROPORTION RULES",
          rows: [
            { label: "IF THE BOTTOM IS WIDE", body: "Keep the top clean, tucked, cropped, or close to the body. Avoid volume on both halves." },
            { label: "IF THE BLAZER IS LONG", body: "Keep the base simple. Avoid bulky layers underneath or a heavy hem competing below it." },
            { label: "IF THE DRESS IS DRAPED", body: "Keep shoes and accessories quiet. The drape is the move; everything else supports it." },
            { label: "IF THE VEST IS STRUCTURED", body: "Soften it with fluid fabric, bare arms, or a cleaner lower half. The contrast makes it work." },
          ],
        },
        {
          type: "prototype-cards",
          label: "HOW TO STYLE IT",
          cards: [
            { label: "FOR WORK", body: "Longline blazer, fluid trouser, clean shoe, minimal jewellery. Let the silhouette create authority — not stiffness." },
            { label: "FOR DINNER", body: "Draped midi, soft shoulder, low heel, one refined accessory. Composed, not dressed up." },
            { label: "FOR TRAVEL / DAY", body: "Wide-leg trouser, soft knit or clean tee, clean flat or polished sneaker. Relaxed without becoming casual." },
            { label: "FOR MODEST / ELEGANT DRESSING", body: "Long lines, covered shapes, fluid layers. One structured element anchors the look without adding volume." },
          ],
        },
        {
          type: "avoid-chips",
          label: "WHAT TO PAIR IT WITH",
          chips: [
            "CLEAN TANKS",
            "FINE KNITS",
            "NARROW SHIRTS",
            "SOFT BLOUSES",
            "POINTED FLATS",
            "LOW HEELS",
            "MINIMAL SANDALS",
            "STRUCTURED QUIET BAGS",
            "RESTRAINED JEWELLERY",
          ],
          closing: "Every supporting piece should simplify the outfit, not compete with the anchor.",
        },
        {
          type: "avoid-chips",
          label: "STYLING RISK",
          chips: [
            "TOO MANY OVERSIZED PIECES AT ONCE",
            "HEAVY LAYERING",
            "OVERLY CORPORATE STYLING",
            "TOO MANY STATEMENT ACCESSORIES",
            "STIFF SHOES WITH STIFF TAILORING",
            "MAKING IT LOOK LIKE A SUIT COSTUME",
            "LOSING THE BODY COMPLETELY",
          ],
          closing: "The direction loses its effect when every piece tries to make the same point.",
        },
        {
          type: "stacked-rows",
          label: "THE FORMULA",
          rows: [
            { label: "THE PRINCIPLE", body: "One anchor + one softening piece + one clean shoe + restrained accessories." },
            { label: "WIDE TROUSER", body: "Fine knit or soft blouse + pointed flat or minimal sandal." },
            { label: "LONGLINE BLAZER", body: "Fluid trouser or dress beneath + minimal sandal or clean heel." },
            { label: "DRAPED MIDI DRESS", body: "Low heel or minimal sandal + restrained bag + soft outer layer if needed." },
            { label: "STRUCTURED VEST", body: "Soft trouser or skirt + quiet jewellery, bare arms where appropriate." },
          ],
        },
        {
          type: "stacked-rows",
          label: "THE MIRROR TEST",
          rows: [
            { label: "DOES ONE PIECE CLEARLY LEAD THE OUTFIT?", body: "The anchor should be obvious. Everything else should support it." },
            { label: "CAN YOU SEE THE BODY OR THE LINE UNDER THE VOLUME?", body: "Soft Structure should not swallow the person wearing it." },
            { label: "DOES IT FEEL COMPOSED WITHOUT LOOKING STIFF?", body: "If the outfit feels too formal, soften one element." },
          ],
        },
        {
          type: "highlight",
          label: "THE STYLING DECISION",
          body: "Style one clear shape. Let everything else stay quiet.",
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
          type: "structured-code",
          label: "THE DESIGN CODE",
          intro: "The Victoria Beckham Pre SS26 collection shows a tailored piece reading more deliberate when its counterpart is fluid — not when it matches itself.",
          principle: "Authority comes from proportion and line, not from matching or rigidity.",
          designMove: "Cut one clear structural gesture per garment — a longline, a defined shoulder, a fluid trouser break — and let it carry the piece alone.",
          avoid: "Matching-set logic, stiff interfacings, overbuilt shoulders, and any construction that only reads when styled with its pair.",
        },
        {
          type: "product-brief",
          label: "THE PRODUCT TRANSLATION",
          categories: [
            "Longline blazer",
            "Wide-leg fluid trouser",
            "Structured waistcoat",
            "Cropped tailored jacket",
            "Narrow tailored skirt",
          ],
          fabricHolds: [
            "Structured crepe",
            "Dry-hand twill",
            "Wool suiting with body",
            "Ponte with weight",
          ],
          fabricMoves: [
            "Fluid viscose",
            "Washed linen",
            "Lightweight silk",
            "Drapey wool blend",
          ],
          proofLine: "Each piece must prove it functions as a standalone anchor — readable with denim, a slip, or a knit, without needing its matching counterpart.",
        },
        {
          type: "decision-grid",
          label: "DESIGN DECISIONS",
          decisions: [
            { label: "SHOULDER", body: "Softened but defined. No hard pad. The shoulder line should hold without imposing." },
            { label: "HEM", body: "Clean and weighted. Longline hems must fall true; cropped hems must sit at a deliberate point on the body, not float." },
            { label: "WAIST", body: "Suppression through cut, not construction. No boning, no heavy internal shaping. The waist reads through proportion against what sits below." },
            { label: "SEAM", body: "One vertical line carries the garment. Princess seams or a clean centre line — not layered darts competing for structure." },
            { label: "FABRIC", body: "Choose body or movement. A structured piece needs a fabric that holds its line across wears; a fluid piece needs weight to drape, not collapse." },
            { label: "LENGTH", body: "Length creates the proportion argument. Longline must clear the hip with intention; cropped must sit high enough to contrast a wide leg." },
          ],
        },
        {
          type: "avoid-chips",
          label: "WHAT NOT TO COPY",
          chips: [
            "MATCHING SUIT LOGIC",
            "HARD SHOULDER PADS",
            "STIFF FUSED FRONTS",
            "NOVELTY LAPELS",
            "SEASONAL SUIT COLOURS",
            "OVERBUILT WAIST SEAMING",
          ],
          closing: "The value is not in recreating the Victoria Beckham silhouette. It is in extracting the construction principle: one tailored piece must hold its line alone, without its pair.",
        },
        {
          type: "prototype-cards",
          label: "PROTOTYPE BRIEF",
          cards: [
            { label: "LONGLINE BLAZER", body: "Softened shoulder, clean single-breasted front, hem clearing mid-thigh. Must read finished worn open over a slip or a T-shirt." },
            { label: "FLUID WIDE-LEG TROUSER", body: "Weighted drape from the hip, clean break at the shoe. Must hold its line without pressing, and read tailored without heels." },
            { label: "STRUCTURED WAISTCOAT", body: "Cut as a top layer, not as a suit component. Clean armhole, defined but unfussed waist, hem sitting at hip bone." },
            { label: "CROPPED TAILORED JACKET", body: "High hem with a deliberate stop point. Shoulder softened, sleeve clean, designed to sit against a wide-leg or fluid bottom." },
          ],
        },
        {
          type: "checklist",
          label: "FIT TEST",
          items: [
            "Does the garment read considered when worn without its matching counterpart?",
            "Does the fabric hold its line across a full day without collapsing or stiffening?",
            "Is there one clear structural gesture, or are shoulder, waist, and hem all competing?",
            "Does the piece work against denim, a slip, and a knit — not just tailored bottoms?",
            "Does the proportion argument still read without heels or runway styling?",
            "Would this piece survive past its first season on cut alone?",
          ],
        },
        {
          type: "highlight",
          label: "THE DECISION",
          body: "The Victoria Beckham Pre SS26 collection is the direction, not the brief. It shows that a tailored piece reads more deliberate when paired with something fluid — not when every piece matches.\n\nThe design problem is not how to make a blazer or a trouser. It is how to construct a single tailored piece that functions as an anchor on its own — through proportion, fabric weight, and one clear line — across denim, a slip dress, and a soft knit. Not as half of a suit.",
        },
      ],
    },

    buyer: {
      modules: [
        {
          label: "THE COMMERCIAL READ",
          body: "Modern Tailoring is a wardrobe-utility trend. Its commercial appeal is in pieces that read deliberate without requiring a new wardrobe to support them — one tailored anchor that lifts what the customer already owns.\n\nThe rising signals — longline blazers, waistcoats as top layers, fluid trousers, tailored separates — point to individual pieces with strong cross-outfit value. The fading signals — matched sets, stiff fabric, trousers that only work with heels — are the versions with a short sell-through window and limited versatility.\n\nnAia's read is that the depth opportunity sits in separates, not suits. A customer buying a longline blazer is buying a tool that functions against denim, a skirt, and a slip dress. A customer buying a matching suit is buying one outfit.",
        },
        {
          type: "assortment-cards",
          label: "THE ASSORTMENT ROLE",
          cards: [
            { label: "CORE WARDROBE", items: "Longline blazers · fluid wide-leg trousers · tailored separates", note: "High repeat value. Strongest depth opportunity." },
            { label: "ELEVATED OCCASION", items: "Waistcoats as top layers · structured blazers for evening · column-ready tailored trousers", note: "Buy selectively. Works best with strong styling context and clear proportion play." },
            { label: "STATEMENT BUY", items: "One proportion-led tailored piece only", note: "Use as a directional signal, not a volume play." },
          ],
        },
        {
          type: "decision-grid",
          label: "BUYING DECISIONS",
          decisions: [
            { label: "CATEGORY", body: "Prioritise longline blazers, fluid trousers, and waistcoats over matching suiting or novelty tailored tops." },
            { label: "PRICE TIER", body: "Invest at mid-to-upper tier on anchor pieces where fabric and cut justify the spend. Keep entry-price tailoring shallow — it rarely holds its line." },
            { label: "FABRIC", body: "Choose fabrics with body and movement. Avoid anything stiff, papery, or too seasonal to carry across more than one drop." },
            { label: "COLOUR", body: "Anchor depth in neutrals that work as separates. Treat seasonal colour as a shallow test, not a core buy." },
            { label: "MERCHANDISING", body: "Merchandise jackets and trousers as separates from the outset. Do not present as suits unless the pieces are genuinely versatile apart." },
            { label: "TIMING", body: "Works best as a transitional wardrobe update carried across the full season, not a peak-only statement." },
          ],
        },
        {
          type: "avoid-chips",
          label: "RISK CHECK",
          chips: [
            "MATCHING SUITS IN SEASONAL COLOUR",
            "STIFF FABRIC WITH NO MOVEMENT",
            "TROUSERS THAT ONLY WORK WITH HEELS",
            "NOVELTY TAILORED TOPS",
            "FASHION-FORWARD CUTS THAT DATE FAST",
            "OVER-DESIGNED WAISTCOATS",
          ],
          closing: "The risk is not that the direction is too niche. The risk is buying versions that only function in one context and cannot earn their place across the customer's wardrobe.",
        },
        {
          type: "stacked-rows",
          label: "COMMERCIAL CONFIDENCE",
          rows: [
            { label: "HIGH CONFIDENCE", body: "Longline blazers, fluid wide-leg trousers, tailored separates in neutrals.", sub: "High repeat value; easy wardrobe integration across work, dinner, and travel." },
            { label: "MEDIUM CONFIDENCE", body: "Waistcoats as top layers, structured evening blazers, cropped tailored jackets.", sub: "Commercially useful, but more dependent on customer lifestyle, styling context, and price point." },
            { label: "LOW CONFIDENCE", body: "Matching suits in seasonal colour, fashion-forward tailored cuts, stiff-fabric novelty pieces.", sub: "Low repeat value; higher risk of looking over-designed or too occasion-specific." },
          ],
        },
        {
          type: "stacked-rows",
          label: "DEPTH RECOMMENDATION",
          rows: [
            { label: "BUY DEEPER", body: "Longline blazers, fluid wide-leg trousers, and tailored separates in neutral fabrics with body and movement.", sub: "Anchor pieces with three or more styling use cases." },
            { label: "TEST LIGHTLY", body: "Waistcoats worn as top layers, structured evening blazers, and cropped tailored jackets where the use case is more proportion-specific.", sub: "Commercially valid but needs styling context to sell." },
            { label: "HOLD OFF", body: "Matching suits in seasonal colour, stiff fabrications, and fashion-forward tailored cuts.", sub: "Short lifespan and low repeat value." },
          ],
        },
        {
          type: "highlight",
          label: "THE DECISION",
          body: "Buy the anchor, not the suit.\n\nFor a buyer, Modern Tailoring is strongest in separates — individual pieces with clear proportion integrity that earn their place across work, travel, and dinner. Depth belongs on what the customer reaches for across three or more outfits, not on matching sets that only function together.",
        },
      ],
    },

    marketer: {
      modules: [
        {
          label: "THE CULTURAL TENSION",
          body: "Customers want to look pulled together across a week that moves between work, dinner, travel, and unstructured days. They do not want to change outfits three times to get there, and they do not want to look like they are dressed for a boardroom when they are not in one.\n\nModern Tailoring resolves this by treating the tailored piece as an anchor, not a uniform. One well-cut blazer, waistcoat, or trouser sets the register — a softer counterpart makes it wearable. The customer gets composure without formality, and one garment stretches across contexts that used to require separate wardrobes.",
        },
        {
          type: "highlight",
          label: "THE MESSAGE",
          body: "Modern Tailoring is not about wearing a suit. It is about one tailored piece changing the feeling of everything worn with it.",
        },
        {
          type: "prototype-cards",
          label: "CAMPAIGN ANGLES",
          cards: [
            { label: "ONE ANCHOR DRESSING", body: "One tailored piece defines the outfit; everything else stays soft and familiar. The look is resolved by a single decision, not by matching." },
            { label: "COMPOSED, NOT CORPORATE", body: "Tailoring read through ease — a blazer over a slip, a waistcoat with denim, trousers with a knit. Polish without the office signal." },
            { label: "THE PROPORTION EDIT", body: "Longline against narrow, cropped against wide, structured against fluid. The contrast between two pieces is the styling — no accessorising required." },
            { label: "SEPARATES OVER SUITS", body: "Position the jacket and the trouser as independent wardrobe tools that work across denim, skirts, and dresses. The matching set is the fading signal." },
            { label: "STYLE THE ONE YOU OWN", body: "The blazer or waistcoat already in the wardrobe reads modern when worn open, layered loose, or paired with something relaxed. The update is the styling shift, not the purchase." },
          ],
        },
        {
          type: "stacked-rows",
          label: "VISUAL DIRECTION",
          rows: [
            { label: "COMPOSITION", body: "One tailored piece clearly visible against one softer piece. Do not stack layers. Let the silhouette read at a glance — the proportion contrast is the frame." },
            { label: "POSE & SETTING", body: "Off-duty settings, not desks. Shot walking, standing, seated on a stool — relaxed body language in a tailored garment. Avoid boardrooms, briefcases, and posed corporate stances." },
            { label: "DETAILS", body: "Close shots of the shoulder line, the hem falling against denim or a slip, the sleeve pushed back, the waistcoat worn open. Fabric movement matters — show drape and hand." },
            { label: "COLOUR", body: "Ink, charcoal, stone, camel, ivory, soft black. Tonal pairings between the tailored piece and its counterpart. No seasonal brights, no full head-to-toe matching." },
          ],
        },
        {
          type: "stacked-rows",
          label: "COPY RULES",
          rows: [
            { label: "SAY", body: "Anchor · counterpart · proportion · fluid · longline · considered · composed · separates · one tailored piece · softened · wearable · changes the feeling" },
            { label: "AVOID", body: "Power suit · boss · workwear · officewear · sharp · commanding · matching set · runway · must-have · statement suit · girl boss · corporate" },
          ],
        },
        {
          type: "avoid-chips",
          label: "CONTENT HOOKS",
          chips: [
            "ONE TAILORED PIECE CHANGES THE FEELING OF EVERYTHING AROUND IT",
            "THE BLAZER YOU ALREADY OWN, WORN A DIFFERENT WAY",
            "COMPOSED, NOT CORPORATE",
            "BUY THE JACKET. BUY THE TROUSER. NOT THE SUIT.",
            "PROPORTION IS THE STYLING",
            "A WAISTCOAT WITH DENIM READS MORE CONSIDERED THAN A FULL SUIT",
            "ONE ANCHOR. ONE SOFT COUNTERPART. THAT IS THE OUTFIT.",
          ],
          closing: "Use these as social captions, email subject lines, or product page openers — each one stands alone without needing a second line.",
        },
        {
          type: "avoid-chips",
          label: "WHAT NOT TO DO",
          chips: [
            "STYLE IT AS A FULL MATCHING SUIT",
            "FRAME AS OFFICEWEAR ONLY",
            "USE POWER-DRESSING LANGUAGE",
            "OVER-LAYER THE CAMPAIGN LOOKS",
            "PUSH A SEASONAL COLOUR SUIT AS THE HERO",
            "TREAT TAILORING AS A TREND MOMENT",
            "SHOW THE JACKET ONLY WITH ITS MATCHING TROUSER",
          ],
          closing: "The direction only works if the tailored piece looks like a tool, not a costume. Over-styling, matching, or corporate framing collapses the whole idea.",
        },
        {
          type: "highlight",
          label: "THE DECISION",
          body: "Brief from the feeling of one considered piece doing the work — not from the suit, not from the office, not from the trend.\n\nOne tailored anchor. One soft counterpart. One deliberate proportion. That is the campaign.",
        },
      ],
    },

    "creative-director": {
      modules: [
        {
          label: "THE CREATIVE READ",
          body: "Modern tailoring is not a suit. It is one deliberate tailored piece — a blazer, a waistcoat, a trouser — treated as an anchor, softened by something fluid beside it. The register is composed, not corporate. The line matters more than the set.\n\nThe visual job is to show the tailored piece doing its work quietly. Not styled into a look. Not staged as a statement. The image must read as a decision already made — a woman wearing tailoring as a tool, not a uniform.",
        },
        {
          label: "THE VISUAL WORLD",
          body: "Quiet rooms with architectural bones. Pale plaster, aged wood, cool concrete, a single window doing the lighting. Daylight through linen. Nothing decorative, nothing loud.\n\nThe garment carries the image. The set holds the silhouette in space and steps back. Proportion is the subject; the room is the frame. If the eye lands on the interior before the line of the jacket, the image has failed.",
        },
        {
          type: "stacked-rows",
          label: "THE IMAGE MUST PROVE",
          rows: [
            { label: "THE TAILORED PIECE READS AS THE ANCHOR", body: "The blazer, waistcoat, or trouser must set the register of the frame. Its line, shoulder, and drape are legible before anything else." },
            { label: "THE CONTRAST DOES THE STYLING", body: "The softer counterpart — a slip, a knit, denim, a fluid trouser — must be visible as a deliberate proportion decision, not a filler piece." },
            { label: "THE WOMAN READS AS COMPOSED, NOT CORPORATE", body: "She wears the tailoring; the tailoring does not wear her. Presence over polish. Ease over performance." },
          ],
        },
        {
          type: "stacked-rows",
          label: "IMAGE LANGUAGE",
          rows: [
            { label: "COMPOSITION", body: "One clear silhouette against negative space. The eye lands on the proportion contrast — long against narrow, structured against fluid — before anything else." },
            { label: "LIGHT", body: "Soft diffused daylight. Directional enough to describe the shoulder line and the drape of the trouser. No hard shadows, no studio flatness." },
            { label: "MOVEMENT", body: "A blazer caught mid-step. A trouser leg in motion. A waistcoat open over a shirt that lifts. The tailored piece holds; the softer piece moves." },
            { label: "DETAIL", body: "Shoulder seam, lapel roll, waistcoat button stance, trouser break, hem meeting shoe. One structural detail at a time." },
          ],
        },
        {
          type: "avoid-chips",
          label: "STYLING DIRECTION",
          chips: [
            "ONE TAILORED PIECE ONLY",
            "AVOID RELYING ON THE FULL MATCHING SET",
            "PROPORTION CONTRAST IS THE STYLING",
            "OPEN THE BLAZER, OPEN THE WAISTCOAT",
            "SOFT COUNTERPART VISIBLE, NEVER HIDDEN",
            "STRIP ACCESSORIES TO ONE",
            "FLAT SHOES OR LOW HEELS — NOT STYLED FOR HEIGHT",
          ],
          closing: "The contrast between the tailored and the fluid is where the direction lives. Anything that collapses that gap — through over-matching, over-layering, or additional styling — works against it.",
        },
        {
          type: "stacked-rows",
          label: "CASTING + ENERGY",
          rows: [
            { label: "COMPOSURE", body: "Self-possessed. She has already decided how she wants to be seen. No searching for the camera, no adjusting the jacket." },
            { label: "POSE", body: "Grounded stance. Weight settled. Hands relaxed — in a pocket, at the side, resting on a lapel. Nothing arranged, nothing posed into shape." },
            { label: "ENERGY", body: "Quiet authority. She is aware of the room, not the lens. The tailoring reads as a tool she uses, not a costume she is wearing." },
          ],
        },
        {
          type: "avoid-chips",
          label: "SET + ATMOSPHERE",
          chips: [
            "PALE PLASTER WALLS",
            "ARCHITECTURAL DOORWAYS",
            "BARE WOODEN FLOORS",
            "A SINGLE TALL WINDOW",
            "LINEN-FILTERED DAYLIGHT",
            "EMPTY CORRIDORS",
            "NEUTRAL STONE OR CONCRETE",
            "MORNING LIGHT, NEVER GOLDEN HOUR",
          ],
          closing: "The room should feel unfurnished, unhurried, and quiet. When the set starts telling a story, the tailoring loses its line.",
        },
        {
          type: "avoid-chips",
          label: "CREATIVE RISK",
          chips: [
            "MATCHING SUITS SHOT AS ONE OUTFIT",
            "CORPORATE OR BOARDROOM FRAMING",
            "STIFF POWER-DRESSING POSES",
            "OVER-STYLED ACCESSORIES",
            "HARD STUDIO LIGHT",
            "FASHION-EDITORIAL AFFECTATION",
            "TROUSERS STYLED ONLY FOR HEELS",
            "TREATING THE JACKET AS A STATEMENT PIECE",
          ],
          closing: "The risk is defaulting to corporate imagery or over-styling into concept. The direction must create composure and let the woman remain the subject.",
        },
        {
          type: "highlight",
          label: "THE DIRECTION",
          body: "Direct for composure, not correctness.\n\nLet the tailored piece anchor the frame while the softer counterpart — and the woman herself — keep it human.",
        },
      ],
    },

    stylist: {
      modules: [
        {
          label: "THE STYLING READ",
          body: "Modern tailoring is not about wearing a suit — it is about letting one tailored piece set the register for everything else. A well-cut blazer, waistcoat, or trouser gives the outfit clarity; a softer counterpart keeps it wearable. The tailored piece is the tool, not the uniform.\n\nChoose one anchor, pair it with something fluid or familiar, and let the proportion difference do the work. The decision is the anchor — the rest of the outfit follows from it.",
        },
        {
          type: "avoid-chips",
          label: "START WITH ONE ANCHOR",
          chips: [
            "LONGLINE BLAZER",
            "WIDE-LEG TROUSER",
            "STRUCTURED WAISTCOAT",
            "FLUID TAILORED TROUSER",
            "CROPPED JACKET",
            "TAILORED MIDI SKIRT",
          ],
          closing: "The anchor sets the proportion and the register. Once it is chosen, everything else should make it easier to wear — not repeat it.",
        },
        {
          type: "stacked-rows",
          label: "PROPORTION RULES",
          rows: [
            { label: "IF THE TROUSER IS WIDE OR FLUID", body: "Keep the top clean, close to the body, or tucked. A cropped jacket, fine knit, or narrow shirt lets the leg line read." },
            { label: "IF THE BLAZER IS LONGLINE", body: "Pair it with a narrower skirt, a slip, or a straighter trouser. Avoid bulky layers underneath or a competing hem below it." },
            { label: "IF THE WAISTCOAT IS THE TOP LAYER", body: "Contrast it with wide-leg denim or a fluid trouser. Keep arms bare or in a soft sleeve — never a heavy shirt underneath." },
            { label: "IF THE PIECE IS STRUCTURED", body: "Soften somewhere else — a draped skirt, a slip, a relaxed knit. The contrast is what makes the tailoring feel modern." },
          ],
        },
        {
          type: "prototype-cards",
          label: "HOW TO STYLE IT",
          cards: [
            { label: "FOR WORK", body: "Tailored trousers with a soft shirt, fine knit, or clean jersey top, finished with a pointed flat or low heel. The tailored trouser gives the outfit its register — the softer top stops it reading as a work uniform." },
            { label: "FOR DINNER", body: "A structured blazer over a slip, draped skirt, or column dress, with a minimal sandal or clean heel. The contrast between the blazer and the soft base is the dressing — nothing else needed." },
            { label: "FOR TRAVEL / DAY", body: "Fluid trousers, a tonal knit, and a longline blazer with a flat or minimal sandal. The longline blazer is what makes the combination feel considered — without it, the same pieces read as a weekend outfit." },
            { label: "FOR MODEST / ELEGANT DRESSING", body: "A longline blazer over a fluid maxi skirt or wide-leg trouser, finished with a minimal flat or low heel. Long, covered lines with one structured anchor — composed and considered without formality." },
          ],
        },
        {
          type: "avoid-chips",
          label: "WHAT TO PAIR IT WITH",
          chips: [
            "FINE KNITS",
            "CLEAN TANKS",
            "SOFT SHIRTS",
            "SLIP DRESSES",
            "DRAPED SKIRTS",
            "WIDE-LEG DENIM",
            "POINTED FLATS",
            "MINIMAL SANDALS",
            "QUIET STRUCTURED BAGS",
            "RESTRAINED JEWELLERY",
          ],
          closing: "The softer pieces exist to make the tailored anchor easier to wear — not to repeat it.",
        },
        {
          type: "avoid-chips",
          label: "STYLING RISK",
          chips: [
            "MATCHING SUIT WORN HEAD TO TOE",
            "STIFF FABRIC WITH NO MOVEMENT",
            "VOLUME ON BOTH HALVES",
            "OVERLY CORPORATE STYLING",
            "TOO MANY STATEMENT ACCESSORIES",
            "HEAVY SHOE WITH HEAVY TAILORING",
            "LAYERING BULK UNDER A LONGLINE JACKET",
            "LOSING THE BODY UNDER THE PROPORTION",
          ],
          closing: "Modern tailoring loses its utility when it reads as a uniform rather than a tool.",
        },
        {
          type: "stacked-rows",
          label: "THE FORMULA",
          rows: [
            { label: "THE PRINCIPLE", body: "One tailored anchor + one fluid or familiar counterpart + one clear proportion contrast + a quiet shoe." },
            { label: "LONGLINE BLAZER", body: "Slip dress, narrow skirt, or straight trouser beneath + minimal sandal or clean heel." },
            { label: "WIDE-LEG TROUSER", body: "Fine knit, clean tank, or narrow shirt + pointed flat or low heel." },
            { label: "STRUCTURED WAISTCOAT", body: "Wide-leg denim or fluid trouser + bare arms or soft sleeve + quiet jewellery." },
            { label: "FLUID TAILORED TROUSER", body: "Tonal knit or soft shirt + longline blazer or open waistcoat + flat sandal." },
          ],
        },
        {
          type: "stacked-rows",
          label: "THE MIRROR TEST",
          rows: [
            { label: "DOES ONE PIECE CLEARLY LEAD THE OUTFIT?", body: "The tailored anchor should be obvious. Everything else should support it, not compete with it." },
            { label: "IS THERE A CLEAR PROPORTION CONTRAST?", body: "One structured shape against one fluid shape. If both halves are matching in weight, the styling reads as a suit — not a decision." },
            { label: "DOES IT FEEL COMPOSED WITHOUT LOOKING CORPORATE?", body: "If it reads stiff or uniform, soften one element — swap the shirt for a knit, the heel for a flat, the matching bottom for denim." },
          ],
        },
        {
          type: "highlight",
          label: "THE STYLING DECISION",
          body: "Treat one tailored piece as the anchor. Let the proportion contrast do the rest.",
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
