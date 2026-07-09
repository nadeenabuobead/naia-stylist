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
          type: "structured-code",
          label: "THE DESIGN CODE",
          intro: "Pantone's Spring/Summer 2026 report and Victoria Beckham's SS26 collection point to colour used as a single deliberate note against a quiet foundation, not a full palette shift.",
          principle: "Colour is a construction decision. One accent must earn its place against a base that carries the garment structurally.",
          designMove: "Design the base piece to hold its own without the accent, then engineer one high-visibility surface — a bag panel, a knit body, a shoe upper, a scarf edge — to carry the single colour note.",
          avoid: "Coordinated colourways across multiple pieces, tonal matching between accent and base, and accent placement that competes with a second design gesture on the same garment.",
        },
        {
          type: "product-brief",
          label: "THE PRODUCT TRANSLATION",
          categories: [
            "Base trouser in espresso, washed black, or stone",
            "Fine-gauge accent knit in one saturated colour",
            "Structured bag in deep anchor neutral",
            "Flat leather shoe as accent carrier",
            "Neutral column dress designed to receive an accent",
            "Silk or satin scarf as accent piece",
          ],
          fabricHolds: [
            "Dry-hand cotton twill for base trousers",
            "Compact wool suiting for anchor tailoring",
            "Firm bag leather that holds structure without stiffening",
          ],
          fabricMoves: [
            "Fine merino for accent knitwear",
            "Fluid silk for scarves and accent linings",
            "Soft nappa for accent flats",
          ],
          proofLine: "Each base piece must prove it works without the accent; each accent piece must prove it reads clearly against multiple bases, not just one styled outfit.",
        },
        {
          type: "decision-grid",
          label: "DESIGN DECISIONS",
          decisions: [
            { label: "SHOULDER", body: "On base pieces, keep the shoulder quiet and unremarkable. The garment must not draw attention away from where the accent will land." },
            { label: "HEM", body: "Clean, unbroken hem lines on base pieces. Decorative hems compete with the accent and dilute the single-note logic." },
            { label: "WAIST", body: "Define the waist through cut, not through contrast trim or colour blocking. The base cannot introduce a second colour event." },
            { label: "SEAM", body: "Match thread to fabric on base pieces. Visible topstitching or contrast seams break the quiet foundation the accent depends on." },
            { label: "FABRIC", body: "Choose base fabrics that read as neutral in multiple lights. If the base shifts tone dramatically, the accent relationship becomes unstable." },
            { label: "LENGTH", body: "Length must be resolved without needing colour to explain it. If the proportion only works because of the accent, the piece has failed." },
          ],
        },
        {
          type: "avoid-chips",
          label: "WHAT NOT TO COPY",
          chips: [
            "COORDINATED COLOUR SETS",
            "ACCENT TRIM ON BASE PIECES",
            "TONAL MATCHING TOP-TO-BOTTOM",
            "TWO ACCENT COLOURS IN ONE GARMENT",
            "CONTRAST TOPSTITCHING ON NEUTRALS",
            "SEASONAL SHADE AS FULL-LOOK LOGIC",
          ],
          closing: "The runway shows the accent already resolved. The design work is building the base piece that lets any accent read — not recreating the specific colour pairing shown.",
        },
        {
          type: "prototype-cards",
          label: "PROTOTYPE BRIEF",
          cards: [
            { label: "ESPRESSO TROUSER", body: "Deep brown base in a dry-hand fabric. Must read as warm neutral, not as a colour statement. Should work against white, cream, black, and denim without adjustment." },
            { label: "FINE-GAUGE ACCENT KNIT", body: "One saturated colour, clean neckline, no surface detail. The colour is the entire gesture. Must sit cleanly under a neutral jacket without bulk." },
            { label: "STRUCTURED ANCHOR BAG", body: "Espresso or washed black. Holds shape without hardware statements. Designed to be the accent carrier in one palette and the neutral anchor in another." },
            { label: "COLOUR FLAT", body: "Single accent shade in soft nappa. Unadorned upper. Must read as intentional across a base of denim, stone, or black — not just one look." },
            { label: "SILK ACCENT SCARF", body: "One clear colour, no print, resolved edge. The lowest-commitment accent test: proves whether the base wardrobe can receive a colour note at all." },
          ],
        },
        {
          type: "checklist",
          label: "FIT TEST",
          items: [
            "Does the base piece work without the accent, in three different neutral pairings?",
            "Does the accent read as intentional against the base, or does it only work in the styled photograph?",
            "Is there exactly one colour event in the garment, or has a second crept in through trim, thread, or lining?",
            "Would the accent piece still function against a base it was not designed alongside?",
            "Has the piece been over-resolved — does it need the accent to explain its proportion or cut?",
            "Is the deep anchor neutral genuinely wearable as a warm neutral, or does it behave as a colour?",
          ],
        },
        {
          type: "highlight",
          label: "THE DECISION",
          body: "The reference is a method, not a palette. Pantone's report and Victoria Beckham's SS26 notes describe a discipline of restraint — one accent, one anchor, one quiet base — not a specific colour to reproduce.\n\nFor a designer, Colour Direction is not a shade to source. It is a construction problem: how to build a base piece disciplined enough to receive any accent, and an accent piece resolved enough to read across bases it was never designed against.",
        },
      ],
    },

    buyer: {
      modules: [
        {
          label: "THE COMMERCIAL READ",
          body: "Colour Direction is not a colour trend. It is a colour discipline trend.\n\nIts commercial value is not in selling a seasonal shade. It is in selling the structure a customer needs to make colour work: a considered quiet base, a deep anchor neutral, and one clear accent piece. The rising signals — soft white foundations, deep brown as an anchor, single expressive accessories — all point to lower-volume, higher-intent purchases. The fading signals — buying several bright pieces that only work together, replacing a wardrobe for one seasonal shade — point directly at the assortment mistakes to avoid.\n\nnAia's read is that the depth opportunity sits in the base and the anchor, not the accent. Espresso, soft white, stone, and washed denim are the pieces that earn repeat wear. The accent is where a buyer takes a directional position, but it is a shallow, high-turn position — not a volume play. Buying deep into one seasonal accent shade is the exact mistake this trend warns against.",
        },
        {
          type: "assortment-cards",
          label: "THE ASSORTMENT ROLE",
          cards: [
            { label: "CORE WARDROBE", items: "Soft white shirts · stone and cream trousers · espresso tailoring · washed denim · black knitwear", note: "The quiet base. Highest repeat value. Strongest depth opportunity across the palette." },
            { label: "ELEVATED OCCASION", items: "Deep espresso bags · deep espresso shoes · washed black tailored pieces · deep navy trousers", note: "The anchor layer. Buy with confidence but curate — one strong version outperforms three overlapping options." },
            { label: "STATEMENT BUY", items: "One accent knit · one accent bag · one accent flat · one accent scarf", note: "The accent. Shallow depth, directional intent. Read as a signal, not a volume commitment." },
          ],
        },
        {
          type: "decision-grid",
          label: "BUYING DECISIONS",
          decisions: [
            { label: "CATEGORY", body: "Prioritise base neutrals and anchor pieces — trousers, shirts, bags, shoes — over accent-led novelty tops or accent dresses." },
            { label: "PRICE TIER", body: "Invest at mid-to-upper tier on the anchor (espresso bag, shoe, tailoring). Keep the accent at an accessible tier — it is the highest-turnover, lowest-longevity piece." },
            { label: "FABRIC", body: "Anchor pieces need fabric quality that justifies repeat wear — dense cottons, clean wools, structured leathers. Accents can carry more surface interest (satin, fine knit, coloured leather)." },
            { label: "COLOUR", body: "Build depth in soft white, cream, stone, espresso, washed denim, and black. Espresso is the underused anchor — over-index here versus beige." },
            { label: "MERCHANDISING", body: "Do not merchandise accents in coordinated colour groups. Show one accent piece against a full neutral base — that is how the customer buys it." },
            { label: "TIMING", body: "Land base and anchor early and carry through the season. Introduce accents in shorter, sharper drops — one clear colour note at a time." },
          ],
        },
        {
          type: "avoid-chips",
          label: "RISK CHECK",
          chips: [
            "BUYING DEEP INTO ONE SEASONAL ACCENT SHADE",
            "COORDINATED ACCENT SETS THAT ONLY WORK TOGETHER",
            "OVER-INDEXING BEIGE INSTEAD OF ESPRESSO",
            "TREATING THE ACCENT AS A VOLUME CATEGORY",
            "MULTIPLE COMPETING ACCENTS IN ONE DELIVERY",
            "REPLACING BASE NEUTRALS WITH TRENDING SHADES",
          ],
          closing: "The risk is not that the palette is too quiet. The risk is buying accent depth against a trend whose entire logic is that one accent piece is enough.",
        },
        {
          type: "stacked-rows",
          label: "COMMERCIAL CONFIDENCE",
          rows: [
            { label: "HIGH CONFIDENCE", body: "Soft white shirts, stone and cream trousers, espresso tailoring and accessories, washed denim, black knitwear.", sub: "High repeat value. Works across customer segments and wear occasions." },
            { label: "MEDIUM CONFIDENCE", body: "Deep navy trousers, washed black tailoring, espresso leather bags and shoes at elevated price tier.", sub: "Commercially strong but more dependent on price positioning and customer lifestyle fit." },
            { label: "LOW CONFIDENCE", body: "Full accent garments — coloured dresses, coloured trousers, coloured tailoring bought in depth.", sub: "Low repeat value. High risk of only working within one styling context." },
          ],
        },
        {
          type: "stacked-rows",
          label: "DEPTH RECOMMENDATION",
          rows: [
            { label: "BUY DEEPER", body: "Soft white shirts, cream and stone trousers, espresso tailoring, washed denim, black knitwear.", sub: "The quiet base. These pieces underwrite the entire trend." },
            { label: "TEST LIGHTLY", body: "Espresso bags and shoes, washed black tailored pieces, deep navy trousers at elevated price tiers.", sub: "The anchor. Confident but curated — a single strong option per category." },
            { label: "HOLD OFF", body: "Full accent-colour garments, coordinated accent capsules, and multi-piece bright colour groupings.", sub: "The accent belongs in accessories and single knits, not in depth categories." },
          ],
        },
        {
          type: "highlight",
          label: "THE DECISION",
          body: "Buy the base and the anchor deep. Buy the accent narrow and sharp.\n\nFor a buyer, Colour Direction is a disciplined commercial opportunity: the depth sits in quiet foundations and espresso anchors, and the directional signal sits in one clear accent piece per drop. It is safest when the assortment lets one accent do the work of a whole palette.",
        },
      ],
    },

    marketer: {
      modules: [
        {
          label: "THE CULTURAL TENSION",
          body: "Customers want colour in their wardrobe without the risk of buying into a shade that only works in one context. They want a way to feel current without replacing what already works, and they are tired of seasonal palettes that require three coordinated pieces to make sense.\n\nThe Quiet Base & the Clear Accent resolves this. It reframes colour as a method, not a purchase — one considered accent against a calm foundation does more than a full palette refresh. The wardrobe they already own becomes the base; one piece does the work.",
        },
        {
          type: "highlight",
          label: "THE MESSAGE",
          body: "Colour is not something you buy into. It is one clear decision that changes everything you already own.",
        },
        {
          type: "prototype-cards",
          label: "CAMPAIGN ANGLES",
          cards: [
            { label: "ONE ACCENT, EVERYTHING CHANGES", body: "The campaign spine. One expressive colour note against a quiet base — the accent earns its place by working across multiple existing outfits, not just one." },
            { label: "THE QUIET BASE", body: "Foreground the foundation pieces — soft white, cream, stone, espresso, washed denim, black. The base is not the interesting part. It is the condition for the interesting part." },
            { label: "ESPRESSO AS ANCHOR", body: "Lead with deep brown as the season's most underused neutral. Positioned as a warm alternative where black feels too hard and beige feels too safe." },
            { label: "THE LOWEST-COMMITMENT ENTRY", body: "Introduce colour through the bag, the flat, the scarf. The smallest piece with the highest visibility — the intentional first step before a full accent garment." },
            { label: "CONTRAST OVER COORDINATION", body: "Reject the matched palette. One clear interruption against a calm base reads more considered than any coordinated set. The accent does not need to match anything except the base." },
          ],
        },
        {
          type: "stacked-rows",
          label: "VISUAL DIRECTION",
          rows: [
            { label: "COMPOSITION", body: "One accent per frame. The base is quiet and unfussy so the colour reads instantly. Use negative space — do not crowd the accent with competing detail." },
            { label: "POSE & SETTING", body: "Still, composed, unstyled body language. Neutral interior or soft daylight environments. The setting should not compete with the accent — no colour props, no busy backdrops." },
            { label: "DETAILS", body: "Close shots that isolate the accent piece — the bag against the trouser, the flat against the hem, the knit against a white shirt. Show the placement, not the outfit." },
            { label: "COLOUR", body: "Base palette: soft white, cream, stone, espresso, washed denim, black. One accent per shot — a single saturated or considered colour note. Avoid palette bleed across frames." },
          ],
        },
        {
          type: "stacked-rows",
          label: "COPY RULES",
          rows: [
            { label: "SAY", body: "Quiet base · clear accent · deep anchor · considered · one decision · purposeful · espresso · warm neutral · earns its place · intention" },
            { label: "AVOID", body: "Colour of the season · must-have shade · statement colour · palette refresh · trending hue · bold and bright · colour pop · rainbow · dopamine dressing · runway-inspired" },
          ],
        },
        {
          type: "avoid-chips",
          label: "CONTENT HOOKS",
          chips: [
            "ONE ACCENT. EVERYTHING CHANGES.",
            "THE ACCENT DOES NOT NEED TO MATCH. IT NEEDS TO LAND.",
            "ESPRESSO IS THE NEUTRAL YOU ARE MISSING",
            "START WITH THE BAG. NOT THE OUTFIT.",
            "ONE STRONG NOTE LANDS. TWO COMPETE.",
            "THE BASE IS ALREADY IN YOUR WARDROBE",
            "COLOUR WITH A DEFINED ROLE",
          ],
          closing: "Use these as social captions, email subject lines, or product description openers. Each one works alone.",
        },
        {
          type: "avoid-chips",
          label: "WHAT NOT TO DO",
          chips: [
            "SELL IT AS A SEASONAL SHADE",
            "STYLE THREE COORDINATED COLOURS IN ONE LOOK",
            "OVER-MATCH THE ACCENT TO THE BASE",
            "FRAME IT AS A FULL WARDROBE REFRESH",
            "LEAD WITH RUNWAY LANGUAGE",
            "CROWD THE ACCENT WITH COMPETING DETAIL",
            "IGNORE ESPRESSO AS THE ANCHOR STORY",
          ],
          closing: "The direction works because it feels disciplined. Over-styling or over-coordinating the accent erases the effect it was meant to create.",
        },
        {
          type: "highlight",
          label: "THE DECISION",
          body: "Brief from the feeling of one considered accent doing the work the outfit needed.\n\nOne quiet base. One deep anchor. One clear accent. Colour with intention — not colour as a purchase.",
        },
      ],
    },

    "creative-director": {
      modules: [
        {
          label: "THE CREATIVE READ",
          body: "Colour Direction is not a palette story. It is a study in restraint — a quiet base built to hold, and one clear accent placed to change the temperature of the whole frame.\n\nThe visual job is not to celebrate the accent colour. It is to show the discipline of the base that lets the accent read as a decision.",
        },
        {
          label: "THE VISUAL WORLD",
          body: "Pale plaster walls. Warm concrete. Bleached wood floors. Soft north light held long across a quiet room.\n\nThe set must recede so the base can breathe and the accent can land. Fabric weight, the depth of the anchor neutral, and the single note of colour carry the image. Nothing else competes for the eye.",
        },
        {
          type: "stacked-rows",
          label: "THE IMAGE MUST PROVE",
          rows: [
            { label: "THE BASE HOLDS THE FRAME", body: "The quiet foundation — cream, stone, espresso, washed denim, black — must read as chosen, not default." },
            { label: "THE ACCENT LANDS ONCE", body: "One clear colour note, placed deliberately, that shifts the mood of the whole look without shouting." },
            { label: "THE CONTRAST FEELS INTENTIONAL", body: "The accent should meet the base as a decision, not as a coordinated match." },
          ],
        },
        {
          type: "stacked-rows",
          label: "IMAGE LANGUAGE",
          rows: [
            { label: "COMPOSITION", body: "One silhouette, one accent point. The eye should travel from the calm base to the single note of colour and rest there." },
            { label: "LIGHT", body: "Diffused daylight, warm-neutral. Enough softness to keep the base quiet, enough clarity to let the accent read true." },
            { label: "MOVEMENT", body: "Stillness with intention. A scarf caught, a bag held, a shoe mid-step — the accent revealed through gesture, not staging." },
            { label: "DETAIL", body: "Fabric handle of the base. Depth of the anchor neutral. The exact tone of the accent. One note at a time." },
          ],
        },
        {
          type: "avoid-chips",
          label: "STYLING DIRECTION",
          chips: [
            "ONE ACCENT PER FRAME",
            "NO TONAL MATCHING ACROSS ACCESSORIES",
            "ANCHOR THE BASE IN A DEEP NEUTRAL",
            "PLACE THE ACCENT DELIBERATELY",
            "LET THE BASE STAY QUIET",
            "NO COMPETING COLOUR NOTES",
            "NO SEASONAL SHADE STACKING",
          ],
          closing: "The accent only works because the base lets it. Every added colour cancels the decision the image is meant to prove.",
        },
        {
          type: "stacked-rows",
          label: "CASTING + ENERGY",
          rows: [
            { label: "COMPOSURE", body: "Assured. The woman wears the accent as a decision already made — not a moment of experimentation caught on camera." },
            { label: "POSE", body: "Grounded, unhurried. The body holds the base; a hand, a step, or a turn reveals the accent." },
            { label: "ENERGY", body: "Quiet certainty. She is the reason the colour reads — not the other way around." },
          ],
        },
        {
          type: "avoid-chips",
          label: "SET + ATMOSPHERE",
          chips: [
            "PLASTER WALLS",
            "WARM CONCRETE",
            "BLEACHED WOOD",
            "SOFT NORTH LIGHT",
            "NEUTRAL ARCHITECTURE",
            "NEGATIVE SPACE",
            "MUTED SHADOW",
            "UNDRESSED ROOMS",
          ],
          closing: "The set should never echo the accent. When the room agrees with the colour, the discipline disappears.",
        },
        {
          type: "avoid-chips",
          label: "CREATIVE RISK",
          chips: [
            "TWO COMPETING ACCENTS",
            "COORDINATED COLOUR STORY",
            "BASE THAT READS AS BEIGE-BY-DEFAULT",
            "ACCENT USED AS COSTUME",
            "OVER-STYLED PROP MOMENTS",
            "SATURATED BACKDROP",
            "TONAL MATCHING HEAD TO TOE",
            "TREND-SHADE OVERKILL",
          ],
          closing: "The risk is turning a method into a mood board. Direction should reveal the discipline of one accent, not the excitement of many.",
        },
        {
          type: "highlight",
          label: "THE DIRECTION",
          body: "Direct for discipline, not decoration.\n\nLet the quiet base hold the frame while a single accent changes the temperature of everything around it.",
        },
      ],
    },

    stylist: {
      modules: [
        {
          label: "THE STYLING READ",
          body: "This trend is not about buying a colour. It is about deciding where colour goes in an outfit you already own. A quiet base — soft white, cream, stone, espresso, washed denim, or black — is what lets a single accent land as intentional rather than accidental. The base is the condition; the accent is the move.\n\nThe styling principle: one clear colour decision, positioned deliberately. One accent note. The base holds it.",
        },
        {
          type: "avoid-chips",
          label: "START WITH ONE ANCHOR",
          chips: [
            "ESPRESSO TROUSER",
            "CREAM KNIT",
            "SOFT WHITE SHIRT",
            "WASHED DENIM",
            "STONE TAILORED SKIRT",
            "WASHED BLACK DRESS",
            "DEEP NAVY BLAZER",
          ],
          closing: "The anchor's job is to disappear enough that the accent can speak. Once the base is chosen, every other piece should hold the calm — not add to it.",
        },
        {
          type: "stacked-rows",
          label: "PROPORTION RULES",
          rows: [
            { label: "IF THE BASE IS FULLY NEUTRAL", body: "Place the accent on one piece only — a bag, flat, scarf, or knit. Two accents will read as an outfit trying to coordinate." },
            { label: "IF THE ACCENT IS ON THE TOP HALF", body: "Keep the lower half quiet and the shoe neutral. Colour near the face reads casual; let the base ground it." },
            { label: "IF THE ACCENT IS A BAG OR SHOE", body: "Let the rest of the outfit stay fully composed in the base palette. Accessory-level colour reads most intentional against pure neutral." },
            { label: "IF THE ANCHOR IS ESPRESSO", body: "Treat it as a warm neutral, not a colour. Pair with cream, stone, or soft white — avoid matching browns that flatten the depth." },
          ],
        },
        {
          type: "prototype-cards",
          label: "HOW TO STYLE IT",
          cards: [
            { label: "FOR WORK", body: "Cream shirt, espresso trouser, quiet leather flat, and one accent — a coloured scarf, fine knit, or bag. Keep jewellery restrained. Let the colour do the talking — not the tailoring." },
            { label: "FOR DINNER", body: "A neutral column — soft black or stone — with one satin or leather piece in a clear accent shade. Bag, shoe, or belt. Composed, not coordinated." },
            { label: "FOR TRAVEL / DAY", body: "Washed denim, soft white tee or shirt, espresso flat or loafer, and one expressive knit or bag in the accent. Effortless without becoming beige." },
            { label: "FOR MODEST DRESSING", body: "A long stone or cream layer over a neutral base, with the accent introduced through the inner top, scarf, bag, or shoe. Coverage stays quiet; colour becomes the signature." },
          ],
        },
        {
          type: "avoid-chips",
          label: "WHAT TO PAIR IT WITH",
          chips: [
            "SOFT WHITE SHIRTS",
            "FINE CREAM KNITS",
            "STONE TROUSERS",
            "WASHED DENIM",
            "ESPRESSO FLATS",
            "NEUTRAL LOAFERS",
            "QUIET LEATHER BAGS",
            "MINIMAL JEWELLERY",
            "PLAIN SILK SCARVES",
            "CLEAN TAILORED JACKETS",
          ],
          closing: "Every supporting piece must hold the base steady so the accent can land. If two pieces are competing for attention, the accent has already lost.",
        },
        {
          type: "avoid-chips",
          label: "STYLING RISK",
          chips: [
            "TWO ACCENT COLOURS AT ONCE",
            "MATCHING BAG AND SHOE TO THE ACCENT",
            "BUYING A FULL SEASONAL PALETTE",
            "USING BEIGE WHERE ESPRESSO WOULD WORK HARDER",
            "OVER-COORDINATED HEAD-TO-TOE COLOUR",
            "ACCENT PIECES THAT ONLY WORK TOGETHER",
            "TREATING BLACK AS THE DEFAULT ANCHOR",
          ],
          closing: "The direction fails when colour becomes a theme instead of a note. One accent earns its place; three cancel each other out.",
        },
        {
          type: "stacked-rows",
          label: "THE FORMULA",
          rows: [
            { label: "THE PRINCIPLE", body: "One quiet base + one deep anchor + one clear accent. Nothing else fights for attention." },
            { label: "ESPRESSO TROUSER", body: "Soft white shirt + cream knit or accent bag + quiet leather flat." },
            { label: "CREAM COLUMN", body: "Cream knit and stone trouser + one accent shoe, scarf, or bag + restrained jewellery." },
            { label: "WASHED DENIM BASE", body: "White tee or shirt + espresso loafer + one expressive knit or bag in the accent." },
            { label: "WASHED BLACK DRESS", body: "Espresso or accent-leather bag + clean low heel + no competing jewellery." },
          ],
        },
        {
          type: "stacked-rows",
          label: "THE MIRROR TEST",
          rows: [
            { label: "IS THERE ONLY ONE ACCENT IN THE OUTFIT?", body: "Count the colour notes. If more than one piece is trying to be the accent, remove one." },
            { label: "DOES THE BASE FEEL CALM ENOUGH TO CARRY IT?", body: "The base should recede. If the neutrals are competing — mismatched whites, clashing browns — the accent cannot read." },
            { label: "WOULD THIS ACCENT WORK WITH THREE OTHER OUTFITS YOU OWN?", body: "If the answer is no, it is a costume piece, not a wardrobe accent. Rethink before committing." },
          ],
        },
        {
          type: "highlight",
          label: "THE STYLING DECISION",
          body: "Choose one accent. Let the base stay quiet. That is the whole method.",
        },
      ],
    },

  },
};
