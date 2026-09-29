# StyleMe integration boundary

Written during the branch reconciliation on `fix/styleme-authoritative-reconcile`.
It records what StyleMe keeps, what it must stop owning, and what it is waiting for —
so the Garment Intelligence, Passport and Taste workstreams can plug in without
StyleMe being rebuilt a second time.

Nothing in this file is a decision about another workstream's design. Where a
question belongs to someone else, it is stated as a dependency, not an answer.

---

## 1. What stays authoritative in StyleMe

These are the product's actual styling opinion. They are not garment truth and do
not belong anywhere else.

| Area | Where it lives |
|---|---|
| The T1–T6 decision hierarchy and its comparator | `styleme-result.server.ts` — `CandidateRankKey`, `compareCandidateRankKeys` |
| Session requirements and their precedence | `compareCandidateRankKeys` + the pre-rank hard gates |
| Anchor handling and anchor eligibility | `styleme-profile-gate.ts` — `evaluateAnchorEligibility`; `styleme-anchor.server.ts` |
| Candidate construction (A–E) | `styleme-result.server.ts` — `buildNaiaOutfitCandidates` |
| Complete-outfit assembly and architecture | `selectAdditionalClosetGarments`, `passesAnchorIntegrityGate`, `buildCompletionLayer` |
| Outfit-level balance and coherence | `evaluateCompleteOutfit`, statement/layering post-assembly passes |
| Bounded model selection | `callClaudeForNaiaSelection` + the `isTiedAtT1T4` eligibility guard |
| Regeneration semantics | `result.tsx` regenerate branch + `translateIntentionsToEngineSignals` |
| Session vocabulary (state, intention, fit/comfort) | `app/lib/styleme/session-vocabulary.ts` |
| Wording, grounding rules, explanations | `STYLEME_WORDING_SYSTEM_PROMPT` and rules 8–27 |
| Outcomes and provenance | `api.styleme-outcome.tsx`, `StyleMeOutcome` |

---

## 2. What StyleMe should stop owning

Each of these is garment truth that StyleMe currently re-derives locally. When the
shared resolver lands, the listed code is deleted, not adapted.

### 2.1 Occasion normalisation — **blocking**

Two vocabularies are used interchangeably. The UI answer is normalised by
`REV3_OCCASION_MAP` before storage, so a session only ever carries the canonical
form; but `GarmentStyleMeProfile.occasionFit` is keyed on the UI form, and its keys
are validated against `OCCASION_IDS` in `styleme-garment-profile.vocab.ts`.

| Session stores (canonical) | Garment profile is keyed on (UI) | Overlap |
|---|---|---|
| `everyday`, `work`, `dinner`, `family`, `travel`, `active` | same | yes |
| `date-night` | `date` | **no** |
| `special-event` | `event` | **no** |
| `girls-night` | `night-out` | **no** |
| `not-sure` | — | **no** |

For Date, Event and Night out this silently disables approved garment truth:
an approved `"No"` stops excluding, the register gate returns early so activewear
is admitted, and T1 falls back to legacy `occasions[]` tags.

**Fixed in this branch** (session-side tables only, because they are keyed on what
StyleMe itself stores and needed no garment-vocabulary decision):

- `OCCASION_FORMALITY_TARGET` — `styleme-result.server.ts`
- `_OCCASION_MAX_RANK` — `styleme-anchor.server.ts` *(already corrected by the systemic QA pass)*

**Deferred — Garment Intelligence owns these.** Every call site below looks up the
garment side with a session-side key, and cannot be corrected in isolation:

| Call site | File |
|---|---|
| `passesProfileOccasionGate` | `styleme-profile-gate.ts` |
| `passesProfileRegisterGate` | `styleme-profile-gate.ts` |
| `passesRegisterCoherenceWithAnchor` | `styleme-profile-gate.ts` |
| `getProfileOccasionTier` | `styleme-profile-gate.ts` |
| `OCCASION_REGISTER_RANGE` | `styleme-profile-gate.ts` |
| `styleMeSessionRegister` | `wardrobe-needs.ts` |
| `OCCASION_IDS` + `occasionFit` validation | `styleme-garment-profile.vocab.ts`, `styleme-garment-profile.server.ts` |

Why not half-fix it: `passesProfileRegisterGate` interleaves
`OCCASION_REGISTER_RANGE[sessionOccasion]` (session side) with
`profile.occasionFit[sessionOccasion]` (garment side). The `occasionFit` lookup is
the escape hatch that lets an approved `Strong` override a blanket register block.
Repairing the range keys alone would start blocking garments a human explicitly
approved, with no way for the approval to speak. Both sides must move together.

**What StyleMe needs:** one canonical occasion ID set, and `occasionFit` keyed on it
(with a migration for existing approved profiles). StyleMe then deletes
`OCCASION_REGISTER_RANGE` and `SESSION_OCCASION_TO_CLOSET_TOKENS` and calls the
shared resolver.

### 2.2 Coverage from metadata value, not metadata presence

`outfitCoverageScore` (`styleme-result.server.ts`) counts a piece as covering when
`sleeveLength != null || necklineCoverage != null || shoulderCoverage === true`.
A sleeveless top with `sleeveLength: "sleeveless"` and `necklineCoverage: "low"`
therefore scores as full coverage. This is the legacy fallback for
`feel-less-exposed`, so an unreviewed Closet can return a revealing outfit the
engine believes satisfies the request.

**Deferred** — coverage semantics are garment truth. StyleMe should consume a
resolved `coversArms` / `coversNeckline` / `coversShoulders` rather than
interpreting raw fields. Not duplicated here.

### 2.3 Colour family

StyleMe has two colour paths that do not agree: `COLOR_VOCAB_MAP` in
`styleme-recommendation.ts` (NADINE catalogue), and raw lowercase string comparison
in `scoreClosetItemForSession` (`styleme-anchor.server.ts`, favourite `+2` /
avoid `−4`). Closet colours are never normalised.

**Deferred.** StyleMe should read a resolved colour family off `ResolvedGarment` and
delete both paths. No new vocabulary was introduced here.

### 2.4 Pairwise compatibility

StyleMe's only pairing signal is `outfitCoherenceScore` — the fraction of piece
pairs sharing any style tag. `naturalPairings`, `intentionalMix` and
`avoidInStyleMe` are loaded onto every approved profile and consumed by nothing
(`PAIRING_GUIDANCE_STATUS = "deferred"`).

**Deferred to the shared `canPair` contract.** No competing implementation was
built in this branch. StyleMe keeps whole-outfit architecture; pairwise
compatibility becomes an input to T6.

### 2.5 Sportswear / functional crossover

Enforced only via `dressRegister === "athletic"`, which requires an approved
profile *and* is unreachable for three occasions (see 2.1). `closetItemToSlot`
maps `ACTIVEWEAR` into ordinary slots with no functional marker.

**Deferred** — functional context is garment truth.

### 2.6 Closet resolution and the 50-item cap

`loadAllClosetItemsForEngine` and `autoSelectClosetAnchor` both cap at
`take: 50`, ordered `createdAt DESC`.

- **Why it exists:** no documented reason in the code. It predates garment
  intelligence and reads as a prompt-size / query-cost guard from when the whole
  Closet was passed to a model.
- **What it affects:** anchor auto-selection, candidate construction, every
  additional-garment slot, and result directions. Beyond 50 garments StyleMe styles
  from a recency window and says nothing about it.
- **Is removing it safe?** Not unilaterally. The engine is O(items × slots) with
  nested exploration in Candidate E, and Wardrobe Intelligence reads the full Closet
  — so the two features can already disagree about what the customer owns.
- **Not replaced with another arbitrary limit in this branch.** The future
  `ResolvedGarment` query should return the full Closet with resolution already
  applied; the cap is then deleted rather than retuned. Proposed separately.

---

## 3. Passport boundary

StyleMe must not build a second Passport precedence implementation. One resolver
already exists and is correct: `scoringArchetypesFor` (`styleme-anchor.server.ts`)
returns `styleDirectionArchetypes` when present and only then falls back to
`stylePersonalities`.

| Field | Role in StyleMe today | Note |
|---|---|---|
| `styleDirections` | **ranking input** — T5 via projected archetypes | correct Rev 7 path |
| `stylePersonalities` | **legacy** — fallback only | one stale read remains: `buildSessionFingerprint` (`styleme-recommendation.ts`) hashes it directly; tie-break determinism only |
| `styleExpression` | **contextual** — prompt only | zero numeric weight by design |
| `explorationLevel` | **contextual** — prompt only | |
| `dressingPreferences` | **hard constraint** | non-compensable at item + anchor level; compensable at outfit level |
| `avoidColors` | **ambiguous** | `−4` item penalty, and the prompt says outright it is "not a hard exclusion". Whether it should be hard is a product decision the canonical Passport workstream owns — **not decided here** |
| `firmNoColors` | **hard constraint, NADINE path only** | `checkHardExclusions` in `styleme-recommendation.ts`; no Closet-side equivalent exists |
| `fitPreferences`, `fitConcerns` | **contextual** — prompt only | no gate, no score |
| `preferredCoverage`, `coveragePreferences` | **contextual** — prompt only | the computational coverage path is `dressingPreferences` |
| `desiredFeelings`, `desiredImpression`, `becoming`, `styleSupport` | **contextual** — prompt only | |
| `successfulOutfitGives`, `currentGoal` | **contextual** — prompt only | |
| `lifestyle` | **contextual** — prompt only + fingerprint | |
| `silhouette`, `structure`, `bodyFocusAreas`, `bodyAvoidAreas` | **contextual** — prompt only | |
| `gender` | **contextual** — finishing layer only | explicitly zero engine influence |

**T5 is the ceiling.** Passport refines between outfits that are already valid for
today. It must never override T1–T3. The bounded-model guard enforces the same rule
on the wording side: the model may only choose among candidates tied through T1–T4,
and prompt rule 11 states the precedence explicitly.

---

## 4. Learning and outcomes

The evidence rule holds in code today and must be preserved:

> suggested ≠ worn · generated ≠ preference · explicit feedback can become evidence

**What StyleMe already writes correctly**

| Event | Model | Becomes evidence |
|---|---|---|
| Look generated | `OutfitSuggestion` | **no** — correct |
| Wore it / Changed something / Didn't wear | `StyleMeOutcome` | yes, `STYLEME_OUTCOME` strength 0.8 |
| In-session review | `PostOutfitReview` | yes, `POST_OUTFIT_REVIEW` strength 0.7 |

`extractStyleMeEvidence` is called only from the outcome POST handler, after a
successful save. A generated result cannot become positive preference evidence.

**Orphaned evidence — written, never read by anything that learns**

| Signal | Model | Read by |
|---|---|---|
| love / okay / not-for-me | `RecommendationFeedback` | `feedback-signal`, `journey-context` — never Taste, never WI |
| Saved look | `SavedLook` | WI appearance counts only; no Taste evidence |
| Adjust Vibe | `StylingSession.parentSessionId` | nothing — the adjustment delta is discarded |
| New Look, Same Vibe | — | nothing — a rejection signal with no record |

**Not wired back.** StyleMe does not read `StyleTendency` and this branch does not
change that. When the shared Taste contract is authoritative, confirmed tendencies
should enter at **T5**, and negative tendencies should suppress candidates — with
explicit Passport answers always winning, exactly as the selfie colour signal
already does in `buildEphemeralContextSignals`.

One asymmetry to resolve when that happens: WI reads only `StyleMeOutcome`, Taste
reads outcomes + reviews, Trend evidence reads only reviews, and nothing reads
`RecommendationFeedback` into taste at all.

---

## 5. The `ResolvedGarment` consumer boundary

StyleMe should consume `ResolvedGarment[]` and a pairwise compatibility contract.
It should not implement either.

**Fields StyleMe consumes today** (everything on `ClosetAnchorInput`, which is the
shape `ResolvedGarment` needs to satisfy):

- **Identity / slot** — `id`, `name`, `category`, `subcategory`; resolved slot
  (today: `closetItemToSlot` + approved `exactSlot` via `resolveProfileSlot`)
- **Register** — `formality`, `occasions[]`, `dressRegister`, `occasionFit`
- **Coverage / fit** — `sleeveLength`, `necklineCoverage`, `shoulderCoverage`,
  `hemLength`, `topLength`, `midriffExposed`, `fitProfile`, `waistShape`, `waistComfort`
- **Construction / character** — `construction`, `silhouetteCharacter`,
  `fabricBehaviour`, `visualWeight`, `stylingEffort`, `layeringBehaviour`,
  `statementLevel`, `outfitFunction`
- **Intention** — `intentionPotentials` (16 keys; **absence ≠ None**)
- **Presentation** — `colors`, `primaryColor`, `material`, `pattern`, `imageUrl`
- **Customer relationship** — `garmentRelationships` (closed 8-value set)

**Requirements StyleMe places on the resolver**

1. **Absence must stay distinguishable from a decision.** A missing
   `intentionPotentials` key means "not reviewed", never "None". Same for unknown
   coverage metadata, which fails open everywhere in this engine.
2. **Admin-correction precedence must be applied before StyleMe sees the garment.**
   StyleMe currently reads `styleMeProfile.profileStatus === "approved"` itself;
   it should receive already-resolved truth.
3. **One occasion vocabulary**, canonical, on both session and garment sides.
4. **Resolved colour family**, not raw strings.
5. **A functional/sportswear marker** that does not depend on an approved profile.
6. **The full Closet**, so the 50-item cap can be deleted rather than retuned.

**A note on external garments.** `AnchorInput` is a closed two-member union
(`NadineAnchorInput | ClosetAnchorInput`), so StyleMe can only style owned pieces.
A future "style this before you buy" path needs a third member carrying the fields
above plus a provenance discriminator — and one rule: a hypothetical garment may
anchor a look but must never count as owned inventory for WI or Taste. Out of scope
for this branch; recorded so the contract is designed with it in mind.

---

## 6. Intention taxonomy — 16 defined, 12 live

The taxonomy expansion is **recovered and contracted, but not activated.**
`STYLEME_TAXONOMY_16_ACTIVE` in `session-vocabulary.ts` is `false`, so the Step 2
questionnaire offers the original twelve. Everything else — the sixteen IDs, the
labels, `GarmentStyleMeProfile.intentionPotentials`, the admin review surfacing —
is in place and unchanged.

**Why it is gated.** `wardrobe-intelligence.server.ts` sets
`intentionsSource = "curated"` only when *every* intention in its list is
human-reviewed, and three sites gate on that (`wardrobe-intelligence.ts:915`,
`wardrobe-needs.ts:1180` and `:1237`). Every profile approved before the expansion
was reviewed against twelve intentions and carries no key for the four new ones.
The moment WI's list becomes sixteen, those profiles demote to `"derived"` and
"What your Closet supports best" empties — for wardrobes that genuinely *were*
reviewed. Curated evidence lost silently.

This has not fired yet only because WI reads a **separate** twelve-item
`ALL_INTENTIONS` in `app/lib/admin/garment-intelligence-v1.server.ts`. The two
lists are duplicates, and the obvious tidy-up — point one at the other — is exactly
the change that fires the bug.

**Semantics StyleMe must consume, not reimplement.** Garment Intelligence commit
`9a1c31e` holds them: key absence means "not reviewed", a stored `"none"` means a
human looked and decided none, and a legacy profile is *complete for the taxonomy
it was authored under* rather than partial. It exposes `intentionIsReviewed()`,
`intentionStrength()` (null ≠ "none") and `hasReviewedIntentionEvidence()` — the
gate WI should use in place of `intentionsFullyReviewed`. StyleMe does not copy
any of this.

### Intended integration order

| # | Step | Owner | Gate |
|---|---|---|---|
| 1 | `9a1c31e` review-semantics contract lands on trunk | Garment Intelligence | already committed on their branch |
| 2 | **D6** — WI stops gating on all-or-nothing review and calls `hasReviewedIntentionEvidence()`; `ALL_INTENTIONS` is retired in favour of the shared vocabulary | Wardrobe Intelligence | must land **at or before** step 4 |
| 3 | Reviewers rate the four new intentions on the Closet (the admin filter from `d76edd9` exists for exactly this) | product | not a code gate, but an empty taxonomy helps nobody |
| 4 | Flip `STYLEME_TAXONOMY_16_ACTIVE` to `true` | StyleMe | one constant, no other change |

Steps 1–2 may land together. Step 4 must not precede step 2.

### Two Garment Intelligence integration patches are NOT yet takeable

`8eb7158` (occasion matching) and `444660c` (coverage by value, not presence) are
labelled for StyleMe cherry-picking and both were attempted here. Both were backed
out: `8eb7158` imports `~/lib/garment/vocabulary` and `444660c` imports
`~/lib/garment/coverage`, and `app/lib/garment/` does not exist outside the Garment
Intelligence worktree. They are correct patches with a hard dependency on the
foundation module — take them in the same merge as `app/lib/garment/`, not before.

`444660c` is the fix for the coverage defect described in §2.2; that deferral is
now tracked upstream rather than open-ended.
