// app/routes/staging.full-look-vto-test.tsx
//
// STAGING-ONLY, MOCK-ONLY test harness for sequential full-look VTO.
//
// NOT REGISTERED in app/routes.ts — this module exists and is covered by
// staging.full-look-vto-test.test.ts (loader/action invoked directly), but
// there is no route() entry wiring this path into the app yet. That is a
// deliberate, separate step: adding it to routes.ts is "connecting this to
// the live application," which is explicitly a later, separately-approved
// action, not this one.
//
// WHAT THIS DOES: reuses the production WI pairing engine
// (loadWardrobeIntelligence) to find the one specific, already visually
// confirmed Work-register combination — EXPECTED_WORK_GARMENT_NAMES below —
// among whatever candidates the engine currently ranks, re-verifies
// ownership of every garment (resolveOwnedWiGarments), checks every
// non-photo production VTO gate that applies (see "PROTECTIONS" below),
// then runs it through the job-tracked sequential chain
// (poc-job-tracked-full-look-chain.server.ts, Stage 2B) — the real
// VirtualTryOnJob lifecycle (cooldown, Serializable active-job lock, a
// race-safe single-attempt reservation) wrapped around each step's FASHN
// interaction, which is still only ever reached through a mock in every
// test in this project.
//
// WHY A NAMED COMBINATION, NOT "WHATEVER RANKS #1": the WI pairing engine
// re-ranks on every load as the Closet/Passport change. Taking
// bestByRegister.work[0] unconditionally would silently swap in a different
// outfit than the one a human visually confirmed, defeating the point of a
// "controlled" test. This route instead searches every current Work
// candidate for the one whose three garments match that exact, named set —
// and fails closed (expected_combination_not_found) if it isn't there
// today, rather than substituting a different combination.
//
// PROTECTIONS — what reuses the real production gates today vs. what is
// deferred until private-photo access is separately approved:
//   REUSED NOW (none of these touch an image/photo byte):
//     - Ownership: resolveOwnedWiGarments, same as api.wi-style-this.tsx.
//     - Category eligibility: isVtoCategoryAllowed per garment, same
//       function api.trigger-tryon.tsx calls before ever letting a garment
//       near VTO (rejects ACTIVEWEAR/SWIMWEAR/LOUNGEWEAR/OTHER/unknown).
//     - nAia Model readiness: computeModelReadinessFromRecord
//       (hasFullBodyPhoto, then isReadyForTryOn) — the same two-step check
//       and the same two distinct error messages api.trigger-tryon.tsx uses.
//     - Body photo moderation: bodyModerationStatus === "APPROVED", read
//       from the DB record already loaded for readiness — the same gate
//       submitTryOnJob enforces before any provider call.
//     - Per-generation consent freshness: a client-stamped
//       virtualTryOnConsentAt must be within MAX_CONSENT_AGE_MS (15
//       minutes), exactly api.trigger-tryon.tsx's own window and
//       constant — not a bare "consent=yes" checkbox standing in for it.
//       The checkbox is additionally required as a second, explicit
//       "I agree to this one-off test" signal; it does not replace the
//       timestamp check.
//     - Per-garment image resolution + suitability screening (2026-11-02):
//       resolveClosetAnchor resolves each garment's real, ownership-scoped
//       signed Cloudinary URL (the exact function api.wi-style-this.tsx and
//       api.trigger-tryon.tsx's closet path both already use); FASHN never
//       sees it since the chain call below is still fully mocked (see
//       createMockFashnFetch) — the URL is built, not fetched, by this step.
//       screenGarmentSuitability then runs the real, unmocked production
//       image-based AI screen (api.trigger-tryon.tsx's own suitability gate
//       for the closet source) against that URL. A missing/unresolvable
//       image or a non-PASS screening result fails the whole set closed —
//       never a silent skip, never a placeholder substituted in. This is
//       the one gate in this route that, when it actually RUNS against a
//       real account, does read real Closet garment image bytes (via the
//       AI vision call inside screenGarmentSuitability) — unlike every
//       other gate above, which only reads DB fields. It has only ever been
//       exercised here against mocked images/mocked services; see
//       staging.full-look-vto-test.test.ts.
//   DEFERRED (requires Sara's actual nAia Model body photo):
//     - Everything behind the remaining SWAP POINT below (the real model
//       photo) and the real FASHN call itself.
//     - A verified, explicitly-approved execution-time allowance for the
//       real run — see poc-job-tracked-full-look-chain.server.ts's "Issue 3"
//       section. No maxDuration/functions config exists anywhere in this
//       repo today, and a worst-case 3-step real chain (~270s) would exceed
//       Vercel's default function timeout. NOT resolved here — reported,
//       not assumed away, and nothing in this codebase changes it.
//   PARTIALLY ADDRESSED (2026-11-03, Stage 2A): a quota pre-check now runs
//   before any image is resolved — see hasQuotaRoomForFullLookChain below.
//   It is deliberately NOT routed through checkEntitlement/getEffectiveVtoLimit
//   (isolated from the pre-existing, unresolved VTO_MONTHLY_LIMIT_OVERRIDE
//   scoping bug flagged elsewhere in this project) and is enforced regardless
//   of ENTITLEMENT_ENFORCEMENT.
//   ADDRESSED (2026-11-03, Stage 2B): the chain now runs through
//   runJobTrackedFullLookChain (poc-job-tracked-full-look-chain.server.ts)
//   instead of the DB-free orchestrator — real VirtualTryOnJob rows, the
//   real Serializable active-job lock, a race-safe single-attempt
//   reservation keyed off the existing idempotencyKey unique constraint
//   (not a count query), and correct per-step cooldown placement (checked
//   once, before step 1 — checking it before every step would self-block
//   the chain on its own just-completed prior step; see that file's own
//   header for why). Multi-credit accounting falls out of this for free:
//   up to 3 real job rows, one per genuinely attempted step, is exactly
//   what the existing quota-counting queries already count correctly.
//
// AUTH / AUTHORIZATION / CSRF: identity comes only from
// getCurrentNaiaCustomer(request) — the real session cookie
// (naia-session.server.ts sets it HttpOnly; Secure; SameSite=Lax). customerId
// is never read from the request body or form. The page's <Form method="post">
// submits same-origin; SameSite=Lax already stops the session cookie from
// being attached to a cross-site POST, which is the same baseline every other
// same-origin mutating route in this app (e.g. api.wi-style-this.tsx) relies
// on instead of a separate CSRF token. Authorization is the staging+allowlist
// gate below, re-checked on every request (loader AND action independently —
// there is no shared "already authorized" state), plus ownership
// re-verification repeated inside the action rather than trusted from the
// loader's earlier result.
//
// IMPOSSIBLE IN PRODUCTION EVEN IF ACCIDENTALLY REGISTERED: the gate checks
// process.env.NAIA_PROJECT_VARIANT with strict equality against the literal
// string "staging" — never VERCEL_ENV (which is "production" on both the
// real production project and a promoted staging deployment, so it cannot
// tell them apart — see api.staging-full-look-vto.tsx's own comment on
// exactly this). Unset, "production", "preview", or any other value all
// fail closed. See GT.16 in the test file, which sets
// NAIA_PROJECT_VARIANT="production" explicitly (not merely absent) with a
// matching allowlist, and still gets 404.
//
// WHAT THIS DOES NOT DO (by construction, not by omission):
//   - GET never touches FASHN, a model photo, or a garment image. It only
//     reads garment name/category/subcategory metadata and a boolean
//     nAia Model readiness flag. Opening this page spends nothing.
//   - POST (the only way anything generates) uses a MOCK model image —
//     synthetic data: URL, never Sara's real nAia Model photo. That one
//     remaining call site is marked "SWAP POINT" below; it is not touched
//     here. Garment "product images" are now real, ownership-verified,
//     screened Closet image URLs (2026-11-02) — see the per-garment
//     resolution block above.
//   - The FASHN call itself is fully mocked (createMockFashnFetch) — no
//     real network request to api.fashn.ai happens from this route today,
//     regardless of how real the garment image URLs passed into it are.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, useActionData, useLoaderData } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { isVtoCategoryAllowed } from "~/lib/ai/closet-eligibility";
import { resolveClosetAnchor } from "~/lib/ai/styleme-anchor.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import {
  resolveExpectedWorkCombination,
  sortForDisplay,
  hasQuotaRoomForFullLookChain,
  MAX_CONSENT_AGE_MS,
} from "~/lib/ai/full-look-work-combination.server";
import {
  runJobTrackedFullLookChain,
  type JobTrackedChainGarmentInput,
} from "~/lib/ai/poc-job-tracked-full-look-chain.server";
import type { RunTryOnOptions } from "~/lib/ai/fashn-try-on.server";
import type { VirtualTryOnConsent } from "~/lib/ai/virtual-try-on.types";

// resolveExpectedWorkCombination, sortForDisplay, hasQuotaRoomForFullLookChain,
// and MAX_CONSENT_AGE_MS used to be defined AND exported directly from this
// route file. Moved to full-look-work-combination.server.ts (2026-11-03) and
// deliberately NOT re-exported here: exporting a function that transitively
// imports a `.server.ts` module from a ROUTE file broke the production
// build — React Router only strips server-only code from loader/action/
// middleware/headers, not arbitrary named exports, so a stray non-route
// export with a server-only dependency fails the build even though nothing
// in this specific route ever rendered a client component. Any other
// consumer (e.g. staging.full-look-vto-real.tsx) imports these directly
// from full-look-work-combination.server.ts, not from this file.

// ── Gate ──────────────────────────────────────────────────────────────────────

interface GateableCustomer {
  id: string;
  shopifyCustomerId?: string | null;
}

export function isAuthorizedStagingTestAccount(customer: GateableCustomer): boolean {
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") return false;
  const allowlist = (process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return false;
  return allowlist.includes(customer.shopifyCustomerId ?? "") || allowlist.includes(customer.id);
}

function notFound(): never {
  throw new Response("Not Found", { status: 404 });
}

// ── Loader — metadata + readiness only, zero generation, zero cost ──────────

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer || !isAuthorizedStagingTestAccount(customer)) notFound();

  const outcome = await resolveExpectedWorkCombination(customer.id);
  if (!outcome.ok) {
    return data({ ok: false as const, reason: outcome.reason });
  }

  const naiaModel = await loadNaiaModel(customer.id);
  const modelReady = naiaModel ? computeModelReadinessFromRecord(naiaModel).isReadyForTryOn : false;

  return data({
    ok: true as const,
    reason: outcome.reason,
    modelReady,
    garments: sortForDisplay(outcome.garments).map((g) => ({
      closetItemId: g.closetItemId,
      name: g.name,
      category: g.category,
      slot: g.slot,
    })),
  });
}

// ── Mock FASHN fetch — local to this test harness only ──────────────────────
// Mirrors the two-request shape runFashnTryOn makes (POST /v1/run, then GET
// /v1/status/{id}) with synthetic, always-valid-pattern data URLs. No real
// network call. failAtStepIndex lets the test flow (and this route's own
// automated tests) exercise partial-failure handling without ever touching
// a real FASHN credential or endpoint.
//
// MOCK_RESULT_IMAGE_DATA_URL (2026-11-03): a genuinely rendered PNG (400x500,
// generated with this project's own `canvas` dependency, not hand-computed)
// showing "MOCK TEST RESULT / Not a real AI-generated try-on" on a dashed-
// border card — unmistakably a test artifact at a glance. PNG specifically,
// not SVG: this value also becomes the NEXT step's modelImageDataUrl input
// inside runJobTrackedFullLookChain (currentModelImage = result.outputDataUrl),
// and runFashnTryOn's own isValidModelImageDataUrl only accepts
// jpeg/jpg/png/webp (fashn-try-on.server.ts) — an SVG attempt here failed
// step 2 onward with step_failed/INVALID_MODEL_IMAGE, caught by this file's
// own full-chain tests before ever reaching a real browser.
// Verified before use, not assumed: 1) `file`/`xxd` confirm genuine PNG
// bytes, 2) matches isValidModelImageDataUrl's own regex exactly,
// 3) actually rendered in a real browser tab via a local static server and
// visually confirmed legible.
// The ORIGINAL value (`bW9ja291dHB1dCR7c3RlcEluZGV4fQ==`) decoded to the
// literal text "mockoutput${stepIndex}" — a template-literal interpolation
// that was base64-encoded as plain text instead of ever being evaluated, so
// the browser received ASCII text under a PNG data: URL and rendered a
// broken-image icon. No test caught this because every existing assertion
// checked only the `data:image/png;base64,` prefix, never whether the
// payload actually decodes to a real image — see GT.49 in the test file,
// which does, by checking real image bytes/structure instead of a prefix.

const MOCK_RESULT_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAZAAAAH0CAYAAAAT2nuAAAAABmJLR0QA/wD/AP+gvaeTAAAgAElEQVR4nO3deXhMVwMG8Heyb7InsghJSAiR2HeK2ndqaVG0amtpqy3Kp6WqraKUKqWtUq2tsW+xU1uQIMS+ZJV93yfJzHx/pEbG3GSSUyrk/T2P5zF3OXNmksx7z7nnnJHlpsWrQEREVEF6z7sCRET0YmKAEBGREAYIEREJYYAQEZEQA6mN0/w6/OuCF139u1zHiT4Xy2f5LJ/ls/z/rnypc9gCISIiIQwQIiISItmFRUREVVNFusXYAiEiIiEMECIiEiKTWsqktCZMee/cExHRi6kin/9sgRARkRAGCBERCWGAEBGREAYIEREJkZwHwpvlRESkC1sgREQkhAFCRERCGCBERCSEAUJEREIYIEREJERyKRMiIiJd2AIhIiIhDBAiIhLCACEiIiGSM9G5nDsREenCFggREQlhgBARkRAGCBERCWGAEBGREAYIEREJkRyFRUREVVNFRuGyBUJEREIYIEREJIQBQkREQhggREQkhAFCRERCGCBERCSEAUJEREIk54Fw1V0iItKFLRAiIhLCACEiIiEMECIiEsIAISIiIQwQIiISIstNi1c970oQEdGLhy0QIiISwgAhIiIhDBAiIhIiORO9It9IRUREVRNbIEREJIQBQkREQhggREQkhAFCRERCGCBERCREchQWERFVTRUZhcsWCBERCWGAEBGREAYIEREJYYAQEZEQBggREQlhgBARkRAGCBERCZGcB8JVd4mISBe2QIiISAgDhIiIhDBAiIhICAOEiIiEMECIiEiILDctXvW8K0FERC8etkCIiEgIA4SIiIQwQIiISIjkTPSKfCMVERFVTWyBEBGREAYIEREJYYAQEZEQBggREQlhgBARkRDJUVhERFQ1VWQULlsgREQkhAFCRERCGCBERCSEAUJEREIYIEREJIQBQkREQhggREQkRHIeCFfdJSIiXdgCISIiIQwQIiISwgAhIiIhDBAiIhLCACEiIiGy3LR41fOuBBERvXjYAiEiIiEMECIiEsIAISIiIZIz0SvyjVRERFQ1sQVCRERCGCBERCSEAUJEREIYIEREJIQBQkREQiRHYRERUdVUkVG4bIEQEZEQBggREQlhgBARkRAGCBERCWGAEBGREAYIEREJYYAQEZEQyXkgXHWXiIh0YQuEiIiEMECIiEgIA4SIiIQwQIiISAgDhIiIhMhy0+JVz7sSRET04mELhIiIhDBAiIhICAOEiIiESM5Er8g3UhERUdXEFggREQlhgBARkRAGCBERCWGAEBGREAYIEREJkRyFRUREVVNFRuGyBUJEREIYIEREJIQBQkREQhggREQkhAFCRERCGCBERCSEAUJEREIk54Fw1V0iItKFLRAiIhLCACEiIiEMECIiEsIAISIiIQwQIiISIstNi1c970oQEdGLhy0QIiISwgAhIiIhDBAiIhIiORO9It9IRUREVRNbIEREJIQBQkREQhggREQkhAFCRERCGCBERCREchQWERFVTRUZhcsWCBERCWGAEBGREAYIEREJYYAQEZEQBggREQlhgBARkRAGCBERCZGcB8JVd4mISBe2QIiISAgDhIiIhDBAiIhICAOEiIiEMECIiEiILDctXvW8K0FERC8etkCIiEgIA4SIiIQwQIiISIjkTPSKfCMVERFVTWyBEBGREAYIEREJYYAQEZEQBggREQlhgBARkRDJUVhERFQ1VWQULlsgREQkhAFCRERCGCBERCSEAUJEREIYIEREJIQBQkREQhggREQkRHIeCFfdJSIiXdgCISIiIQwQIiISwgAhIiIhDBAiIhLCACEiIiGy3LR41fOuBBERvXjYAiEiIiEMECIiEsIAISIiIZIz0SvyjVRERFQ1sQVCRERCGCBERCSEAUJEREIYIEREJIQBQkREQiRHYRERUdVUkVG4bIEQEZEQBggREQlhgBARkRAGCBERCWGAEBGREAYIEREJ4TDepyg/KwuZKWnIzciEgYEhTK2qwcapOvQM9J931UgHlUqFjIQk5GVmQVGkgKmlBX92T1leRhay0tJQkJsPQ1NjWDnaw8Tc/HlXi/4FyQB5UVfdPfbrH0h9GK+13dLeFt3efbvU826fOY9rR09J7uvz8bswMTcr9dzc9Eyc2bQN146dQvzdB1AplRr7jUxN4NHYD80H9IJft46Q6VWs0RcRGobQwGO4d+ESslJSkZeZBQtra5jbWsOtoQ8adGwL79YtYGBkWGoZF7bvQ1TYTfVjW1cndB47stTjM5NTcHjVOqhUml9W6Va/LloO7quzztePncLN0+fL8epKp2+gj4GzpgIAEsIjcWrDX8JlebVoAv8enSX3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uktERLqwBUJEREIYIEREJIQBQkREQhggREQkhAFCRERCZLlp8arnXQkiInrxsAVCRERCGCBERCSEAUJEREIkZ6JX5BupiIioamILhIiIhDBAiIhICAOEiIiEMECIiEgIA4SIiIRIjsIiIqKqqSKjcNkCISIiIQwQIiISwgAhIiIhDBAiIhLCACEiIiEMECIiEsIAISIiIZLzQLjqLhER6cIWCBERCWGAEBGREAYIEREJYYAQEZEQBggREQmR5abFq553JYiI6MXDFggREQlhgBARkRAGCBERCZGciV6Rb6QiIqKqiS0QIiISwgAhIiIhDBAiIhLCACEiIiEMECIi0JO05AAAAtJJREFUEiI5CouIiKqmiozCZQuEiIiEMECIiEgIA4SIiIQwQIiISAgDhIiIhDBAiIhICAOEiIiESM4D4aq7RESkC1sgREQkhAFCRERCGCBERCSEAUJEREIYIEREJESWmxavet6VICKiFw9bIEREJIQBQkREQhggREQkRHImekW+kYqIiKomtkCIiEgIA4SIiIQwQIiISAgDhIiIhDBAiIhIiOQoLCIiqpoqMgqXLRAiIhLCACEiIiEMECIiEsIAISIiIQwQIiISwgAhIiIhDBAiIhIiOQ+Eq+4SEZEubIEQEZEQBggREQlhgBARkRAGCBERCWGAEBGREFluWrzqeVeCiIhePGyBEBGREAYIEREJYYAQEZEQyZnoFflGKiIiqprYAiEiIiEMECIiEsIAISIiIQwQIiISwgAhIiIhkqOwiIioaqrIKFy2QIiISAgDhIiIhDBAiIhICAOEiIiEMECIiEgIA4SIiIQwQIiISIjkPBCuuktERLqwBUJEREIYIEREJIQBQkREQhggREQkhAFCRERCZLlp8arnXQkiInrxsAVCRERCGCBERCSEAUJEREIkZ6JX5BupiIioamILhIiIhDBAiIhICAOEiIiEMECIiEgIA4SIiIRIjsIiIqKqqSKjcNkCISIiIQwQIiISwgAhIiIhDBAiIhLCACEiIiEMECIiEsIAISIiIZLzQLjqLhER6cIWCBERCWGAEBGREAYIEREJYYAQEZEQBggREQmR5abFq553JYiI6MXDFggREQlhgBARkRAGCBERCZGciV6Rb6QiIqKqiS0QIiISwgAhIiIhDBAiIhLCACEiIiEMECIiEiI5CouIiKqmiozCrVCATPPrUO6hvKVVQheWz/JZPstn+ZWz/CexC4uIiIQwQIiISAgDhIiIhDBAiIhICAOEiIiE8AuliIhICFsgREQkhAFCRERCGCBERCSEAUJEREL+D8QvZdHi5sgFAAAAAElFTkSuQmCC";

function createMockFashnFetch(failAtStepIndex: number | null): RunTryOnOptions {
  let stepIndex = -1;
  const _fetch = (async (url: string | URL | Request) => {
    const u = url.toString();
    if (u.includes("/v1/run")) {
      stepIndex += 1;
      return new Response(JSON.stringify({ id: `mock-pred-${stepIndex}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/v1/status/")) {
      if (failAtStepIndex !== null && stepIndex === failAtStepIndex) {
        return new Response(JSON.stringify({ status: "failed", error: "simulated failure" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ status: "completed", output: [MOCK_RESULT_IMAGE_DATA_URL] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected mock fetch to ${u}`);
  }) as typeof fetch;
  return { _fetch, _sleep: () => Promise.resolve(), _getApiKey: () => "mock-key" };
}

const MOCK_MODEL_IMAGE_DATA_URL = "data:image/png;base64,bW9ja21vZGVsaW1hZ2U=";
// SWAP POINT (model photo): going real means replacing the constant above
// with downloadModelPhotoAsDataUrl(naiaModel.bodyPublicId, naiaModel.bodyFormat,
// naiaModel.deliveryType) from fashn-tryon-service.server.ts — not done here.

// MAX_CONSENT_AGE_MS and hasQuotaRoomForFullLookChain now live in
// full-look-work-combination.server.ts (imported above) — see that file's
// header and this route's own earlier comment for why they moved out of
// this route file instead of being re-exported from it.

// ── Action — the only way anything "generates" ───────────────────────────────
// Every branch below returns the same shape (ActionResult) so a consumer
// (this file's own tests, the page component) never has to guess which
// optional fields a given failure reason carries.

interface ActionStepResult {
  label: string;
  slot: string;
  ok: boolean;
}

type ActionResult =
  | { ok: true; mock: true; creditsUsed: number; steps: ActionStepResult[]; finalImageDataUrl: string }
  | { ok: false; reason: string; mock?: true; creditsUsed?: number; failedStepIndex?: number; steps?: ActionStepResult[] };

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer || !isAuthorizedStagingTestAccount(customer)) notFound();

  const form = await request.formData();

  // ── Explicit human confirmation — additive, not a substitute for the
  // freshness check below. ────────────────────────────────────────────────
  if (form.get("consent") !== "yes") {
    return data({ ok: false, reason: "consent_required" } as ActionResult, { status: 400 });
  }

  // ── Per-generation consent freshness — same MAX_CONSENT_AGE_MS window as
  // api.trigger-tryon.tsx, driven by a timestamp the client stamps at
  // submit time (see onSubmit in the component below), not a static value. ─
  const rawConsentAt = form.get("virtualTryOnConsentAt");
  if (typeof rawConsentAt !== "string" || rawConsentAt.length === 0) {
    return data({ ok: false, reason: "consent_required" } as ActionResult, { status: 400 });
  }
  const consentAt = new Date(rawConsentAt);
  if (isNaN(consentAt.getTime())) {
    return data({ ok: false, reason: "consent_required" } as ActionResult, { status: 400 });
  }
  const consentAgeMs = Date.now() - consentAt.getTime();
  if (consentAgeMs < 0 || consentAgeMs > MAX_CONSENT_AGE_MS) {
    return data({ ok: false, reason: "consent_expired" } as ActionResult, { status: 400 });
  }

  // ── Re-resolved independently of the loader — defense in depth, same
  // convention as every other mutating action in this codebase. ───────────
  const outcome = await resolveExpectedWorkCombination(customer.id);
  if (!outcome.ok) {
    return data({ ok: false, reason: outcome.reason } as ActionResult, { status: 400 });
  }

  // ── nAia Model readiness — re-checked here, not trusted from the loader's
  // earlier (possibly stale) read. Same two-step distinction
  // api.trigger-tryon.tsx makes. ───────────────────────────────────────────
  const naiaModel = await loadNaiaModel(customer.id);
  if (!naiaModel) {
    return data({ ok: false, reason: "model_not_configured" } as ActionResult, { status: 400 });
  }
  const readiness = computeModelReadinessFromRecord(naiaModel);
  if (!readiness.hasFullBodyPhoto || !readiness.isReadyForTryOn) {
    return data({ ok: false, reason: "model_not_ready" } as ActionResult, { status: 400 });
  }

  // ── Body photo moderation — same gate submitTryOnJob enforces before any
  // provider call. A DB field read, not a photo access. ────────────────────
  if (naiaModel.bodyModerationStatus !== "APPROVED") {
    return data({ ok: false, reason: "model_not_moderated" } as ActionResult, { status: 400 });
  }

  // ── Per-garment category eligibility — same function
  // api.trigger-tryon.tsx calls before any closet garment reaches VTO. ─────
  const ineligible = outcome.garments.find((g) => !isVtoCategoryAllowed(g.category, g.subcategory));
  if (ineligible) {
    return data({ ok: false, reason: "garment_not_eligible" } as ActionResult, { status: 400 });
  }

  // ── Quota pre-check — the request must not start unless there is room for
  // the whole 3-step chain. See the large comment on hasQuotaRoomForFullLookChain
  // above for the policy, isolation from VTO_MONTHLY_LIMIT_OVERRIDE, and the
  // explicit non-atomicity caveat. No customer-identifying or numeric detail
  // is exposed in the response — just a flat, safe reason code. ───────────
  const hasQuotaRoom = await hasQuotaRoomForFullLookChain(customer);
  if (!hasQuotaRoom) {
    return data({ ok: false, reason: "quota_insufficient_for_full_look" } as ActionResult, { status: 400 });
  }

  // ── Per-garment image resolution + suitability screening — real, not a
  // placeholder. resolveClosetAnchor re-verifies ownership AGAIN (defense
  // in depth, same as every other check in this action) and returns the
  // garment's real signed Cloudinary URL; screenGarmentSuitability then runs
  // the real production AI screen against it. Each garment is resolved and
  // screened individually, and ANY failure fails the whole set closed —
  // never a silent skip, never a placeholder substituted in its place. ────
  const resolvedImageUrlById = new Map<string, string>();
  for (const g of outcome.garments) {
    const anchor = await resolveClosetAnchor(customer.id, g.closetItemId);
    if (!anchor || !anchor.imageUrl) {
      return data({ ok: false, reason: "garment_image_unavailable" } as ActionResult, { status: 400 });
    }
    const suitability = await screenGarmentSuitability(anchor.imageUrl, { declaredCategory: g.category });
    if (suitability.status !== "PASS") {
      return data({ ok: false, reason: "garment_not_suitable" } as ActionResult, { status: 400 });
    }
    resolvedImageUrlById.set(g.closetItemId, anchor.imageUrl);
  }

  const consent: VirtualTryOnConsent = {
    virtualTryOnConsent: true,
    policyVersion: "1.0-staging-test",
    consentedAt: consentAt.toISOString(),
  };

  const ordered = sortForDisplay(outcome.garments);
  const garments: JobTrackedChainGarmentInput[] = ordered.map((g) => ({
    label: g.name ?? g.closetItemId,
    category: g.category,
    subcategory: g.subcategory,
    productImageUrl: resolvedImageUrlById.get(g.closetItemId)!,
  }));

  // Test-harness-only knob — lets this route's own tests (and only this
  // route's own tests) exercise partial-failure handling. Has no effect
  // unless the staging+allowlist gate above already passed.
  const rawFailAt = form.get("__simulateFailureAtStep");
  const failAtStepIndex = typeof rawFailAt === "string" && rawFailAt !== "" ? Number(rawFailAt) : null;

  // ── Stage 2B: job-tracked chain execution — see
  // poc-job-tracked-full-look-chain.server.ts for the full design (cooldown
  // checked once, the race-safe single-attempt reservation, and the
  // still-unresolved execution-timeout caveat for the real run). ──────────
  //
  // reservationScope (2026-11-03): this route is mock-only, zero real FASHN
  // calls, zero billing risk — so, unlike a future real/billable caller, it
  // should NOT be limited to one permanent attempt ever. Passing the
  // per-submission consent timestamp here means each distinct, deliberate
  // submission claims its own reservation instead of colliding with a prior
  // one, so authorised staging QA can repeat this test without a manual
  // database deletion each time. See JobTrackedChainArgs.reservationScope's
  // own comment for why this is opt-in and changes nothing for any caller
  // that omits it.
  const report = await runJobTrackedFullLookChain(
    {
      customerId: customer.id,
      naiaModelId: naiaModel.id,
      bodyPublicId: naiaModel.bodyPublicId,
      initialModelImageDataUrl: MOCK_MODEL_IMAGE_DATA_URL,
      garments,
      consent,
      reservationScope: consent.consentedAt,
    },
    createMockFashnFetch(failAtStepIndex),
  );

  if (report.ok) {
    return data({
      ok: true,
      mock: true,
      creditsUsed: report.creditsUsed,
      steps: report.steps.map((s, i) => ({ label: s.label, slot: ordered[i]?.slot ?? "unknown", ok: s.ok })),
      finalImageDataUrl: report.finalImageDataUrl,
    } as ActionResult);
  }

  return data({
    ok: false,
    mock: true,
    reason: report.reason,
    creditsUsed: report.creditsUsed,
    failedStepIndex: report.failedStepIndex,
    steps: report.steps.map((s, i) => ({ label: s.label, slot: ordered[i]?.slot ?? "unknown", ok: s.ok })),
  } as ActionResult, { status: 400 });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StagingFullLookVtoTest() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (!loaderData.ok) {
    return <p>Could not find the expected Work combination: {loaderData.reason}</p>;
  }

  return (
    <div>
      <p style={{ fontWeight: "bold" }}>
        MOCK TEST — no real photo, no real FASHN call, no credits spent.
      </p>
      <h1>Full-Look VTO staging test — Work</h1>
      <p>{loaderData.reason}</p>
      <ol>
        {loaderData.garments.map((g) => (
          <li key={g.closetItemId}>{g.name ?? g.closetItemId} — {g.category} ({g.slot})</li>
        ))}
      </ol>
      <p>nAia Model ready: {loaderData.modelReady ? "yes" : "no"}</p>

      <Form
        method="post"
        onSubmit={(e) => {
          // Stamped fresh at the moment of submit, same as the real client
          // flow — never a value left sitting in the DOM from page load.
          const input = e.currentTarget.elements.namedItem("virtualTryOnConsentAt") as HTMLInputElement | null;
          if (input) input.value = new Date().toISOString();
        }}
      >
        <input type="hidden" name="virtualTryOnConsentAt" value="" />
        <label>
          <input type="checkbox" name="consent" value="yes" required /> I consent to this one staging test.
        </label>
        <button type="submit">Generate mock full-look preview</button>
      </Form>

      {actionData && actionData.ok && (
        <div>
          <p>Mock chain complete — {actionData.creditsUsed} mock credit(s) used.</p>
          <img src={actionData.finalImageDataUrl} alt="Mock full-look result" />
        </div>
      )}
      {actionData && !actionData.ok && (
        <div>
          <p>Failed: {actionData.reason}</p>
          {actionData.steps && (
            <ul>
              {actionData.steps.map((s, i) => (
                <li key={i}>{s.label} — {s.ok ? "ok" : "FAILED"}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
