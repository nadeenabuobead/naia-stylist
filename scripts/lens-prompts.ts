// scripts/lens-prompts.ts
// Approved professional lens generation prompts.
// Based on the locked Soft Structure lenses as the quality benchmark.
// Each function returns a complete prompt string for a single lens.

import type { TrendReportData } from "../app/lib/trend-reports.js";

// ---------------------------------------------------------------------------
// SOURCE BLOCK BUILDER
// Converts a TrendReportData entry into a plain-text source block for prompts.
// ---------------------------------------------------------------------------

export function buildSourceBlock(trend: TrendReportData): string {
  const lines: string[] = [];

  lines.push(`TREND: ${trend.title}`);
  lines.push(`SEASON: ${trend.season}`);
  lines.push(`SLUG: ${trend.slug}`);
  if (trend.mood) lines.push(`MOOD: ${trend.mood}`);

  lines.push(``, `EDITORIAL INTRO:`, trend.editorialIntro);
  lines.push(``, `SUMMARY:`, trend.summary);

  if (trend.rising?.length) {
    lines.push(``, `RISING SIGNALS:`);
    trend.rising.forEach((r) => lines.push(`- ${r}`));
  }

  if (trend.fading?.length) {
    lines.push(``, `FADING SIGNALS:`);
    trend.fading.forEach((f) => lines.push(`- ${f}`));
  }

  if (trend.referencesBehindThisEdit?.length) {
    lines.push(``, `SOURCE REFERENCES:`);
    trend.referencesBehindThisEdit.forEach((ref) => {
      lines.push(``, `${ref.brand}${ref.collection ? ` — ${ref.collection}` : ""}:`);
      lines.push(`  Signal: ${ref.signal}`);
      lines.push(`  nAia read: ${ref.naiaRead}`);
    });
  }

  if (trend.spendSaveSkip) {
    lines.push(``, `SPEND / SAVE / ALREADY OWN:`);
    lines.push(`  Spend: ${trend.spendSaveSkip.spend}`);
    lines.push(`  Save: ${trend.spendSaveSkip.save}`);
    lines.push(`  Already own: ${trend.spendSaveSkip.alreadyOwn}`);
  }

  if (trend.naiaInterpretation) {
    lines.push(``, `nAia INTERPRETATION:`, trend.naiaInterpretation);
  }

  if (trend.naiaVerdict) {
    lines.push(``, `nAia VERDICT:`, trend.naiaVerdict);
  }

  if (trend.howToWear?.length) {
    lines.push(``, `HOW TO WEAR:`);
    trend.howToWear.forEach((h) => lines.push(`  ${h.feeling}: ${h.direction}`));
  }

  if (trend.keyTrends?.length) {
    lines.push(``, `KEY TRENDS:`);
    trend.keyTrends.forEach((kt) => lines.push(`  ${kt.name}: ${kt.description}`));
  }

  if (trend.wardrobeNote) {
    lines.push(``, `WARDROBE NOTE:`, trend.wardrobeNote);
  }

  if (trend.sources?.length) {
    lines.push(``, `VERIFIED SOURCES:`);
    trend.sources.forEach((s) => {
      const desc = s.descriptor ? ` (${s.descriptor})` : "";
      lines.push(`  ${s.publisher}${desc}: ${s.title}`);
    });
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON OUTPUT FORMAT
// Appended to every prompt. Instructs Claude to return machine-parseable JSON.
// ---------------------------------------------------------------------------

const JSON_FORMAT = `
OUTPUT FORMAT — JSON ONLY
Return a single valid JSON object. No markdown. No code blocks. No explanation.
Use this shape exactly:

{
  "modules": [
    { "label": "SECTION NAME", "body": "text" },
    { "type": "stacked-rows", "label": "SECTION NAME", "rows": [{ "label": "ROW", "body": "text", "sub": "optional sub" }] },
    { "type": "avoid-chips", "label": "SECTION NAME", "chips": ["CHIP ONE", "CHIP TWO"], "closing": "closing line" },
    { "type": "prototype-cards", "label": "SECTION NAME", "cards": [{ "label": "CARD", "body": "text" }] },
    { "type": "structured-code", "label": "SECTION NAME", "intro": "optional", "principle": "...", "designMove": "...", "avoid": "..." },
    { "type": "product-brief", "label": "SECTION NAME", "categories": ["..."], "fabricHolds": ["..."], "fabricMoves": ["..."], "proofLine": "..." },
    { "type": "decision-grid", "label": "SECTION NAME", "decisions": [{ "label": "...", "body": "..." }] },
    { "type": "checklist", "label": "SECTION NAME", "items": ["..."] },
    { "type": "highlight", "label": "SECTION NAME", "body": "final statement" }
  ]
}

The last module MUST have type "highlight". Return ONLY the JSON object.
Use \\n for line breaks inside string values where two paragraphs are needed.`;

// ---------------------------------------------------------------------------
// PROMPT 1: DESIGNER
// ---------------------------------------------------------------------------

export function designerPrompt(sourceBlock: string): string {
  return `You are writing the Designer professional lens brief for the nAia Stylist app.

ROLE
For fashion designers and product developers. Translates a trend into construction
decisions, fabric logic, design moves, prototype briefs, and fit tests.
A design brief — not a trend editorial, not styling advice, not a campaign.

SOURCE MATERIAL (use only this — do not invent fabric names or construction claims)
${sourceBlock}

REQUIRED SECTIONS — 7 modules in this exact order

1. THE DESIGN CODE — type: structured-code
   intro: One sentence on what the editorial source says about the trend.
   principle: The core structural rule (e.g. "Structure comes from proportion, not stiffness.").
   designMove: The specific construction gesture (e.g. "Use one clear line: shoulder, hem, waist, seam, or trouser break.").
   avoid: The construction mistakes to resist (e.g. "Heavy interfacing, overbuilt shoulders, complicated drape.").

2. THE PRODUCT TRANSLATION — type: product-brief
   categories: Specific product types (e.g. Longline blazer, Wide-leg trouser, Draped midi dress, Structured vest).
   fabricHolds: Fabrics that hold structure (e.g. Structured crepe, Ponte, Dry-hand twill).
   fabricMoves: Fabrics that provide fluidity (e.g. Fluid viscose, Washed linen, Lightweight silk).
   proofLine: One sentence stating what each piece must prove (e.g. "Each piece should prove one thing: a clear silhouette that holds its line without feeling hard.").

3. DESIGN DECISIONS — type: decision-grid
   Exactly 6 decisions. Labels must be: SHOULDER / HEM / WAIST / SEAM / FABRIC / LENGTH.
   Each body: a specific construction rule, not aesthetic description.
   Quality benchmark examples:
   - SHOULDER: "Softened but present. Avoid hard padding unless the rest of the garment is fluid."
   - FABRIC: "Choose body or movement. Do not use limp fabric for a structured piece or stiff fabric for a fluid one."
   - LENGTH: "Let length create authority. Cropped or short proportions need a clear reason."

4. WHAT NOT TO COPY — type: avoid-chips
   4-6 chips: named construction mistakes in ALL CAPS.
   closing: The principle of why copying the reference directly fails.
   Quality benchmark closing: "The value is not in recreating the reference. It is in extracting the construction principle."

5. PROTOTYPE BRIEF — type: prototype-cards
   3-5 cards. intro: "Develop one piece that proves the direction without over-styling it."
   Each: specific garment type as label, exact construction criterion it must prove as body.
   Quality benchmark: LONGLINE BLAZER — "Softened shoulder. Clear vertical line. Works without heavy padding."

6. FIT TEST — type: checklist
   4-6 items. Questions the designer asks before sign-off. Specific to this trend.
   Quality benchmark items: "Does the garment hold its line without feeling hard?" /
   "Does the silhouette still work without runway styling?" /
   "Is there one gesture, or are there too many competing ideas?"

7. THE DECISION — type: highlight — MUST BE LAST
   Two short paragraphs (joined with \\n\\n).
   First: what the reference is and is not for this trend.
   Second: the real design problem — what the designer must actually solve.
   Quality benchmark: "The reference is the question, not the answer.\\n\\nFor a designer, Soft Structure is not a silhouette to copy. It is a construction problem: how to create presence through proportion, fabric, and line without returning to stiffness."

TONE: Authoritative, construction-specific. No campaign language. No outfit formulas. No commercial reasoning.
DO NOT sound like a Buyer, Marketer, Creative Director, or Stylist brief.
${JSON_FORMAT}`;
}

// ---------------------------------------------------------------------------
// PROMPT 2: BUYER
// ---------------------------------------------------------------------------

export function buyerPrompt(sourceBlock: string): string {
  return `You are writing the Buyer professional lens brief for the nAia Stylist app.

ROLE
For fashion buyers and commercial merchandisers. Translates a trend into buying
decisions, assortment structure, depth recommendations, and commercial risk guidance.
Commercial, evidence-grounded, specific. Not a trend editorial. Not styling advice.

SOURCE MATERIAL (use only this — do not invent sell-through data or market sizing)
${sourceBlock}

REQUIRED SECTIONS — 7 modules in this exact order

1. THE COMMERCIAL READ — BodyModule (no "type" field)
   2-3 short paragraphs. What kind of commercial opportunity this trend is.
   What the rising/fading signals mean for buying. The core commercial logic.
   Frame nAia's position with "nAia's read is that..." where relevant.
   Quality benchmark opening: "Soft Structure is not a loud trend. It is a wardrobe-upgrade trend.\\n\\nIts commercial value is in pieces that feel new enough to justify buying, but familiar enough to wear often..."

2. THE ASSORTMENT ROLE — type: assortment-cards
   Exactly 3 cards, ranked from highest to lowest depth confidence.
   Each card: label (role name), items (pipe-separated product types), note (commercial logic).
   Quality benchmark:
   - CORE WARDROBE / "Wide-leg trousers · longline blazers · soft tailoring separates" / "High repeat value. Strongest depth opportunity."
   - ELEVATED OCCASION / "Draped midi dresses · fluid suiting · structured vests" / "Buy selectively. Works best with strong styling context."
   - STATEMENT BUY / "One proportion-led piece only" / "Use as a directional signal, not a volume play."

3. BUYING DECISIONS — type: decision-grid
   Exactly 6 decisions. Labels: CATEGORY / PRICE TIER / FABRIC / COLOUR / MERCHANDISING / TIMING.
   Each body: one specific, actionable buying rule.
   Quality benchmark: CATEGORY — "Prioritise trousers, blazers, vests, and midi dresses over novelty tops." /
   TIMING — "Works best as a transitional wardrobe update, not a peak-only seasonal statement."

4. RISK CHECK — type: avoid-chips
   4-6 chips: named buying mistakes in ALL CAPS.
   closing: The principle of why these represent the real commercial risk.
   Quality benchmark closing: "The risk is not that the trend is too directional. The risk is buying versions that do not feel wearable enough to repeat."

5. COMMERCIAL CONFIDENCE — type: stacked-rows
   Exactly 3 rows with sub notes: HIGH CONFIDENCE / MEDIUM CONFIDENCE / LOW CONFIDENCE.
   Each body: specific product types. Each sub: the depth logic or risk qualifier.
   Quality benchmark:
   - HIGH CONFIDENCE body: "Wide-leg trousers, longline blazers, soft tailoring separates." sub: "High repeat value; easy wardrobe integration."
   - MEDIUM CONFIDENCE sub: "Commercially useful, but more dependent on customer lifestyle, styling context, and price point."
   - LOW CONFIDENCE sub: "Low repeat value; higher risk of looking over-designed or too occasion-specific."

6. DEPTH RECOMMENDATION — type: stacked-rows
   Exactly 3 rows: BUY DEEPER / TEST LIGHTLY / HOLD OFF.
   Each body: specific product types matching those named in THE ASSORTMENT ROLE.
   Quality benchmark: TEST LIGHTLY — "Structured vests, proportion-led statement pieces, and draped midi dresses where the use case is occasion-specific."

7. THE DECISION — type: highlight — MUST BE LAST
   Two short paragraphs (joined with \\n\\n).
   First: the buying principle in one sentence.
   Second: what this trend means as a commercial opportunity and where it is safest.
   Quality benchmark: "Buy the principle, not the runway shape.\\n\\nFor a buyer, Soft Structure is a controlled commercial opportunity: strong enough to refresh the assortment, but safest when bought through wearable anchor pieces with clear styling use."

TONE: Commercial, structured, direct. No construction language. No campaign angles. No outfit advice.
DO NOT sound like a Designer, Marketer, Creative Director, or Stylist brief.
${JSON_FORMAT}`;
}

// ---------------------------------------------------------------------------
// PROMPT 3: MARKETER
// ---------------------------------------------------------------------------

export function marketerPrompt(sourceBlock: string): string {
  return `You are writing the Marketer professional lens brief for the nAia Stylist app.

ROLE
For fashion marketers, content teams, and brand leads. A working campaign brief:
cultural tension, message, named campaign angles, visual direction, copy rules,
content hooks, executional mistakes, final decision.
Not a trend editorial. Not creative art direction. Not styling advice.

SOURCE MATERIAL (use only this — do not invent brand strategy)
${sourceBlock}

REQUIRED SECTIONS — 8 modules in this exact order

1. THE CULTURAL TENSION — BodyModule (no "type" field)
   2 short paragraphs. First: what the customer needs that this trend answers.
   Second: how this trend resolves it. Specific and earned from the source — not generic.
   Quality benchmark: "Customers want to look considered without looking like they tried too hard. They want presence without performance, authority without stiffness, polish without decoration.\\n\\nSoft Structure resolves this. It gives clothing a clear visual authority — without requiring the customer to perform it."

2. THE MESSAGE — type: highlight
   One sentence. The specific campaign message for this trend — not a tagline, the brief.
   Quality benchmark: "Soft Structure is not about dressing up. It is about looking like the decision was already made."

3. CAMPAIGN ANGLES — type: prototype-cards
   Exactly 5 cards. Each: a named angle (ALL CAPS, 2-4 words) as label, 1-2 sentence specific execution as body.
   Angles must be distinct from each other — not variations on the same idea.
   Quality benchmark angle names: QUIET AUTHORITY / ONE DECISION DRESSING / PRESENCE WITHOUT PERFORMANCE / THE FINISHED LOOK / WARDROBE UPGRADE
   Quality benchmark examples:
   - QUIET AUTHORITY: "For work, meetings, travel, and composed everyday dressing. Polish that does not announce itself."
   - ONE DECISION DRESSING: "One piece carries the look; everything else supports it. The outfit feels resolved before it starts."
   - WARDROBE UPGRADE: "Not a new persona. A cleaner way to make the wardrobe feel current."

4. VISUAL DIRECTION — type: stacked-rows
   Exactly 4 rows: COMPOSITION / POSE & SETTING / DETAILS / COLOUR.
   Each body: specific enough to brief a photographer or content team.
   Quality benchmark: COMPOSITION — "One garment, clearly shown. Avoid over-layered styling. Use negative space — let the silhouette breathe."
   DETAILS — "Close shots of cut, shoulder, hem, and drape. Fabric handle is part of the story — show it."

5. COPY RULES — type: stacked-rows
   Exactly 2 rows: SAY / AVOID.
   SAY: comma/dot-separated list of specific words and phrases that work.
   AVOID: comma/dot-separated list of specific words and phrases that undermine the direction.
   Quality benchmark:
   - SAY: "Composed · considered · clean · proportion · presence · ease · softened tailoring · quiet confidence"
   - AVOID: "Boss babe · power dressing · statement-making · dramatic · must-have trend · runway-inspired · officewear-only"

6. CONTENT HOOKS — type: avoid-chips
   5-7 chips: standalone usable lines as content concepts in ALL CAPS.
   One chip must be a specific editorial anchor line.
   Quality benchmark anchor chip: "THE OUTFIT DOES NOT NEED MORE. IT NEEDS ONE CLEAR DECISION."
   Other quality benchmark chips: "THE PIECE THAT MAKES THE OUTFIT FEEL FINISHED" / "STRUCTURE WITHOUT STIFFNESS" / "ONE GESTURE. EVERYTHING ELSE QUIET."
   closing: How to use these across channels (one sentence).
   Quality benchmark closing: "Use these as social captions, email subject lines, or product description openers. Each one works alone."

7. WHAT NOT TO DO — type: avoid-chips
   5-7 chips: named executional mistakes in ALL CAPS.
   Quality benchmark chips: MARKET AS A LOUD TREND / MAKE IT A FULL OUTFIT FORMULA / OVER-STYLE THE CAMPAIGN / FRAME AS OFFICEWEAR ONLY
   closing: The principle of why over-explanation or over-styling kills the direction.
   Quality benchmark closing: "The more you over-explain or over-style it, the less believable it becomes. The direction works because it feels effortless."

8. THE DECISION — type: highlight — MUST BE LAST
   Two short paragraphs (joined with \\n\\n).
   First: what to brief from (the feeling, not the garment).
   Second: the campaign principle in compressed form.
   Quality benchmark: "Brief from the feeling of already having made a considered decision.\\n\\nOne look, one garment, one reason for it."

TONE: Campaign-brief register. Named angles, specific copy rules, usable hooks. No construction language. No commercial depth reasoning. No outfit formulas.
DO NOT sound like a Designer, Buyer, Creative Director, or Stylist brief.
${JSON_FORMAT}`;
}

// ---------------------------------------------------------------------------
// PROMPT 4: CREATIVE DIRECTOR
// ---------------------------------------------------------------------------

export function creativeDirectorPrompt(sourceBlock: string): string {
  return `You are writing the Creative Director professional lens brief for the nAia Stylist app.

ROLE
For creative directors, art directors, and brand image leads. Defines what the image
must do, what world it belongs in, what it must prove, image language, styling rules
for the shoot, casting energy, set and atmosphere, and creative risk.
Visual art direction — not campaign messaging, not buying direction, not outfit styling.

SOURCE MATERIAL (ground the brief in the trend's actual visual register)
${sourceBlock}

REQUIRED SECTIONS — 9 modules in this exact order

1. THE CREATIVE READ — BodyModule (no "type" field)
   Two short paragraphs (joined with \\n\\n).
   First: what the trend is and is not, visually — set the creative position.
   Second: the visual job of the image — what it must do.
   Quality benchmark (exact):
   "Soft Structure is not about drama. It is about controlled ease — clothes with enough shape to hold the frame, and enough softness to let the woman stay present.\\n\\nThe visual job is not to announce the trend. It is to show the woman wearing the decision she has already made."

2. THE VISUAL WORLD — BodyModule (no "type" field)
   Two short paragraphs (joined with \\n\\n).
   First: the environment/set in broad spatial terms. Second: what carries the image.
   Quality benchmark (exact):
   "Quiet interiors. Negative space. Neutral architecture. Soft diffused daylight.\\n\\nThe set must earn its place by framing the garment, not competing with it. Fabric, proportion, and the woman's presence carry the image. Everything else is background."

3. THE IMAGE MUST PROVE — type: stacked-rows
   Exactly 3 rows. Each: a visual proof requirement as label, what it looks like in practice as body.
   Quality benchmark rows (exact):
   - THE GARMENT HOLDS THE FRAME: "The line, drape, and proportion must be clear before anything else."
   - THE WOMAN HOLDS THE PRESENCE: "She should feel self-possessed, not styled into a concept."
   - THE SET SUPPORTS THE SILHOUETTE: "The environment should frame the silhouette, not become the image."

4. IMAGE LANGUAGE — type: stacked-rows
   Exactly 4 rows: COMPOSITION / LIGHT / MOVEMENT / DETAIL.
   Quality benchmark:
   - COMPOSITION: "One clear silhouette. Let space frame the garment. The eye should land on the line, not the styling."
   - MOVEMENT: "Small gestures. Fabric caught mid-shift. The garment moves; the silhouette holds."
   - DETAIL: "Shoulder, waist, hem, drape, closure, fabric handle. One detail at a time."

5. STYLING DIRECTION — type: avoid-chips
   5-7 chips: named styling rules for the shoot in ALL CAPS. Specific to this trend.
   closing: The unifying principle behind all of them.
   Quality benchmark closing: "Over-styling cancels the effect. Every extra element must earn its place or be removed."

6. CASTING + ENERGY — type: stacked-rows
   Exactly 3 rows: COMPOSURE / POSE / ENERGY.
   Presence and physical energy — not demographics. What each quality looks like on set.
   Quality benchmark:
   - COMPOSURE: "Self-possessed. Present but not performing. Confidence through stillness, not attitude."
   - ENERGY: "The woman is aware of herself — not the clothes, not the camera."

7. SET + ATMOSPHERE — type: avoid-chips
   6-8 chips: named set types or atmospheric qualities in ALL CAPS.
   closing: The atmospheric principle.
   Quality benchmark closing: "The set should support the silhouette. When the set becomes the story, the garment disappears."

8. CREATIVE RISK — type: avoid-chips
   6-8 chips: named creative mistakes to resist in ALL CAPS.
   closing: What the direction must create vs. what it must not erase.
   Quality benchmark closing: "The risk is making the clothes look like a uniform instead of a decision. Direction should create presence, not erase the person."

9. THE DIRECTION — type: highlight — MUST BE LAST
   Two sentences in two short paragraphs (joined with \\n\\n).
   First: what to direct for (not against). Second: the specific visual relationship that makes the image work.
   Quality benchmark (exact):
   "Direct for restraint, not emptiness.\\n\\nLet the garment hold the frame while the woman holds the presence."

TONE: Directorial, visual, spatial. No commercial reasoning. No outfit formulas. No campaign messaging.
DO NOT sound like a Designer, Buyer, Marketer, or Stylist brief.
${JSON_FORMAT}`;
}

// ---------------------------------------------------------------------------
// PROMPT 5: STYLIST
// ---------------------------------------------------------------------------

export function stylistPrompt(sourceBlock: string): string {
  return `You are writing the Stylist professional lens brief for the nAia Stylist app.

ROLE
For stylists, personal shoppers, and wardrobe consultants. Translates a trend into
wearable, practical outfit guidance: anchor pieces, proportion rules, setting-specific
styling, pairing logic, risk avoidance, outfit formulas, self-check diagnostic, final principle.
Practical and premium. Not art direction. Not a campaign brief. Not commercial analysis.

SOURCE MATERIAL (ground all outfit guidance in this — do not invent combinations)
${sourceBlock}

REQUIRED SECTIONS — 9 modules in this exact order

1. THE STYLING READ — BodyModule (no "type" field)
   2 short paragraphs (joined with \\n\\n).
   First: what the trend is about at the level of getting dressed.
   Second: the styling principle in 1-2 sentences. End on a short, memorable line.
   Quality benchmark ending: "One clear silhouette decision. Everything else stays quiet."

2. START WITH ONE ANCHOR — type: avoid-chips
   5-7 chips: specific garment types in ALL CAPS.
   closing: What the anchor's job is — not more piece options.
   Quality benchmark chips: WIDE-LEG TROUSERS / LONGLINE BLAZER / DRAPED MIDI DRESS / STRUCTURED VEST / SOFT TAILORED SKIRT / FLUID TROUSER
   Quality benchmark closing (exact): "The anchor carries the silhouette. Once it is chosen, every other piece should make it easier to wear — not more complicated."

3. PROPORTION RULES — type: stacked-rows
   Exactly 4 rows. Each: an IF condition as label, a specific actionable rule as body.
   Quality benchmark rows (exact):
   - IF THE BOTTOM IS WIDE: "Keep the top clean, tucked, cropped, or close to the body. Avoid volume on both halves."
   - IF THE BLAZER IS LONG: "Keep the base simple. Avoid bulky layers underneath or a heavy hem competing below it."
   - IF THE DRESS IS DRAPED: "Keep shoes and accessories quiet. The drape is the move; everything else supports it."
   - IF THE VEST IS STRUCTURED: "Soften it with fluid fabric, bare arms, or a cleaner lower half. The contrast makes it work."

4. HOW TO STYLE IT — type: prototype-cards
   Exactly 4 cards: FOR WORK / FOR DINNER / FOR TRAVEL / DAY / FOR MODEST / ELEGANT DRESSING.
   Each: specific outfit combination as the main body text, ending with a short sentence that captures the register.
   The closing sentence must be specific to that setting — not a generic outfit description.
   Quality benchmark closings:
   - FOR WORK: "Let the silhouette create authority — not stiffness."
   - FOR DINNER: "Composed, not dressed up."
   - FOR TRAVEL / DAY: "Relaxed without becoming casual."

5. WHAT TO PAIR IT WITH — type: avoid-chips
   7-10 chips: supporting piece categories in ALL CAPS.
   closing: The pairing principle — what every supporting piece must do in relation to the anchor.
   Quality benchmark chips: CLEAN TANKS / FINE KNITS / NARROW SHIRTS / SOFT BLOUSES / POINTED FLATS / LOW HEELS / MINIMAL SANDALS / STRUCTURED QUIET BAGS / RESTRAINED JEWELLERY
   Quality benchmark closing: "Every supporting piece should simplify the outfit, not compete with the anchor."

6. STYLING RISK — type: avoid-chips
   6-8 chips: named mistakes in ALL CAPS.
   closing: The principle of why the direction fails when these mistakes happen.
   Quality benchmark chips: TOO MANY OVERSIZED PIECES AT ONCE / HEAVY LAYERING / OVERLY CORPORATE STYLING / TOO MANY STATEMENT ACCESSORIES / STIFF SHOES WITH STIFF TAILORING / MAKING IT LOOK LIKE A SUIT COSTUME / LOSING THE BODY COMPLETELY
   Quality benchmark closing (exact): "The direction loses its effect when every piece tries to make the same point."

7. THE FORMULA — type: stacked-rows
   Exactly 5 rows. The FIRST row is always: label "THE PRINCIPLE", body = the formula for this trend.
   Quality benchmark THE PRINCIPLE body (exact): "One anchor + one softening piece + one clean shoe + restrained accessories."
   Then 3-4 named outfit formula rows: garment type as label, the specific combination as body.
   Quality benchmark formula rows:
   - WIDE TROUSER: "Fine knit or soft blouse + pointed flat or minimal sandal."
   - LONGLINE BLAZER: "Fluid trouser or dress beneath + minimal sandal or clean heel."
   - DRAPED MIDI DRESS: "Low heel or minimal sandal + restrained bag + soft outer layer if needed."
   - STRUCTURED VEST: "Soft trouser or skirt + quiet jewellery, bare arms where appropriate."

8. THE MIRROR TEST — type: stacked-rows
   Exactly 3 rows. Self-check questions specific to this trend's failure modes.
   Each: the question as label, explanation of what to look for as body.
   Quality benchmark rows (exact):
   - DOES ONE PIECE CLEARLY LEAD THE OUTFIT?: "The anchor should be obvious. Everything else should support it."
   - CAN YOU SEE THE BODY OR THE LINE UNDER THE VOLUME?: "Soft Structure should not swallow the person wearing it."
   - DOES IT FEEL COMPOSED WITHOUT LOOKING STIFF?: "If the outfit feels too formal, soften one element."

9. THE STYLING DECISION — type: highlight — MUST BE LAST
   IMPORTANT: The label is "THE STYLING DECISION" — NOT "THE DECISION".
   1-2 sentences. Short, memorable, specific to this trend's logic.
   Quality benchmark (exact): "Style one clear shape. Let everything else stay quiet."

TONE: Practical, wearable, premium, specific. Every rule must be testable in a fitting room.
DO NOT sound like a Designer, Buyer, Marketer, or Creative Director brief.
${JSON_FORMAT}`;
}
