// app/routes/style-me/nadine-handoff-rev3.test.ts
//
// NADINE product handoff → canonical Rev 3 consolidation.
//
// The regression this file exists to prevent: the handoff used to store the
// clicked product in styleMeNadineAnchorHandle and then redirect to
// /style-me/mood, whose action unset that very key. The customer's chosen
// product was destroyed one step later and the engine silently auto-picked a
// different piece. Every "must not clear" test below guards that failure mode.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getSession, commitSession } from "~/lib/session.server";
import {
  readNadineHandoff,
  isValidNadineHandle,
  hasStrandedLegacySession,
  clearLegacyQuestionnaireKeys,
  STYLEME_HANDOFF_ORIGIN_KEY,
  HANDOFF_ORIGIN_NADINE_PDP,
  HANDOFF_ENTRY_PATH,
  CANONICAL_STYLEME_ENTRY,
  LEGACY_QUESTIONNAIRE_KEYS,
} from "~/lib/styleme/handoff";
import { LOCKED_CATALOGUE_HANDLES } from "~/lib/ai/naia-product-media";
import { HANDOFF_RESOLVABLE_HANDLES } from "~/lib/styleme/handoff";
import { resolveActionAnchor } from "~/lib/ai/styleme-anchor.server";
import { action as handoffAction } from "~/routes/api.styleme-handoff";
import { loader as moodLoader } from "~/routes/style-me/mood";
import { loader as feelingLoader } from "~/routes/style-me/feeling";
import { loader as comfortLoader } from "~/routes/style-me/comfort";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (f: string) => readFileSync(join(__dirname, f), "utf8");

const REAL_HANDLE = HANDOFF_RESOLVABLE_HANDLES[0];
const STOREFRONT_ORIGIN = "https://naiabynadine.com";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function newSession(entries: Record<string, unknown> = {}) {
  const session = await getSession();
  for (const [k, v] of Object.entries(entries)) session.set(k, v);
  return session;
}

/** Serialises a session to a Cookie header so a loader can read it back. */
async function cookieFor(entries: Record<string, unknown>): Promise<string> {
  const session = await newSession(entries);
  const setCookie = await commitSession(session);
  return setCookie.split(";")[0];
}

/** Reads the session a Response handed back via Set-Cookie. */
async function sessionFromResponse(res: Response) {
  const setCookie = res.headers.get("Set-Cookie");
  return getSession(setCookie ? setCookie.split(";")[0] : null);
}

function handoffRequest(handle: string | null, origin = STOREFRONT_ORIGIN, cookie?: string) {
  const body = new FormData();
  if (handle !== null) body.set("handle", handle);
  const headers: Record<string, string> = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  return new Request("https://app.test/api/styleme-handoff", { method: "POST", body, headers });
}

// ── 1. The handoff stores the exact clicked product ──────────────────────────

describe("NH.1 — /api/styleme-handoff stores the exact NADINE handle", () => {
  it("stores the clicked handle verbatim in styleMeNadineAnchorHandle", async () => {
    const res = (await handoffAction({
      request: handoffRequest(REAL_HANDLE),
      params: {}, context: {} as never,
    } as never)) as Response;
    const session = await sessionFromResponse(res);
    assert.equal(session.get("styleMeNadineAnchorHandle"), REAL_HANDLE);
  });

  it("stamps handoff provenance so the source lock can recognise it later", async () => {
    const res = (await handoffAction({
      request: handoffRequest(REAL_HANDLE), params: {}, context: {} as never,
    } as never)) as Response;
    const session = await sessionFromResponse(res);
    assert.equal(session.get(STYLEME_HANDOFF_ORIGIN_KEY), HANDOFF_ORIGIN_NADINE_PDP);
    assert.equal(session.get("styleMeSource"), "naia-piece");
    assert.equal(session.get("styleMeMode"), "nadine");
  });

  it("every resolvable catalogue handle round-trips", async () => {
    for (const handle of HANDOFF_RESOLVABLE_HANDLES) {
      const res = (await handoffAction({
        request: handoffRequest(handle), params: {}, context: {} as never,
      } as never)) as Response;
      const session = await sessionFromResponse(res);
      assert.equal(session.get("styleMeNadineAnchorHandle"), handle);
    }
  });
});

// ── 2. The handoff enters the canonical Rev 3 questionnaire ──────────────────

describe("NH.2 — /api/styleme-handoff redirects to /style-me/state", () => {
  it("redirects to the canonical Rev 3 entry, not the legacy questionnaire", async () => {
    const res = (await handoffAction({
      request: handoffRequest(REAL_HANDLE), params: {}, context: {} as never,
    } as never)) as Response;
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), "/style-me/state");
    assert.equal(HANDOFF_ENTRY_PATH, "/style-me/state");
  });

  it("never routes through /style-me, whose session reset would destroy the anchor", () => {
    const handoffSrc = readFileSync(join(__dirname, "../api.styleme-handoff.tsx"), "utf8");
    assert.ok(!/redirect\(\s*"\/style-me"\s*\)/.test(handoffSrc));
    assert.ok(!handoffSrc.includes("clearStyleMeSession"));
  });

  it("does not redirect into the retired legacy questionnaire", () => {
    const handoffSrc = readFileSync(join(__dirname, "../api.styleme-handoff.tsx"), "utf8");
    for (const legacy of ["/style-me/mood", "/style-me/feeling", "/style-me/comfort"]) {
      assert.ok(!handoffSrc.includes(legacy), `handoff must not target ${legacy}`);
    }
  });
});

// ── 3. No canonical step may clear the handoff state ─────────────────────────
// This is the exact defect that broke the old flow: mood.tsx called
// session.unset("styleMeNadineAnchorHandle") on submit.

describe("NH.3 — canonical Rev 3 steps never clear the handoff state", () => {
  const PROTECTED_KEYS = [
    "styleMeNadineAnchorHandle",
    "styleMeMode",
    "styleMeSource",
    STYLEME_HANDOFF_ORIGIN_KEY,
  ];
  const STEPS = ["state.tsx", "intention.tsx", "physical-need.tsx", "occasion.tsx"] as const;

  for (const step of STEPS) {
    const stepSrc = src(step);
    for (const key of PROTECTED_KEYS) {
      it(`${step} never unsets ${key}`, () => {
        assert.ok(
          !stepSrc.includes(`unset("${key}")`),
          `${step} must not unset ${key} — that destroys the NADINE handoff anchor`,
        );
      });
    }
    it(`${step} writes only its own question's keys`, () => {
      const unsets = [...stepSrc.matchAll(/session\.unset\("([^"]+)"\)/g)].map((m) => m[1]);
      for (const key of unsets) {
        assert.ok(
          !PROTECTED_KEYS.includes(key),
          `${step} unsets protected key ${key}`,
        );
      }
    });
  }
});

// ── 4. The source lock: closet-only by default, handoff is the one exception ─

describe("NH.4 — Rev 3 source lock stays closed for ordinary sessions", () => {
  it("an ordinary Rev 3 session is not a handoff", async () => {
    const session = await newSession({ styleMeState: "feel-good", styleMeSource: "my-closet" });
    assert.equal(readNadineHandoff(session), null);
  });

  it("a Rev 3 session that merely carries source=naia-piece is not a handoff", async () => {
    const session = await newSession({ styleMeState: "feel-good", styleMeSource: "naia-piece" });
    assert.equal(readNadineHandoff(session), null, "source alone must not unlock the lock");
  });

  it("source.tsx still forces ordinary Rev 3 sessions to my-closet + naia", () => {
    const sourceSrc = src("source.tsx");
    assert.ok(sourceSrc.includes('if (isRev3 && source !== "my-closet")'));
    assert.ok(sourceSrc.includes('session.set("styleMeSource", "my-closet")'));
    assert.ok(sourceSrc.includes('session.set("styleMeMode", "naia")'));
  });

  it("the handoff exception is evaluated before the closet-only force", () => {
    const sourceSrc = src("source.tsx");
    const exceptionAt = sourceSrc.indexOf("const nadineHandoff = isRev3 ? readNadineHandoff(session)");
    const forceAt = sourceSrc.indexOf('if (isRev3 && source !== "my-closet")');
    assert.ok(exceptionAt > -1 && forceAt > -1);
    assert.ok(exceptionAt < forceAt, "the exception must be checked before the lock fires");
  });
});

describe("NH.5 — a verified NADINE handoff is exempt from the source lock", () => {
  it("provenance stamp + valid handle unlocks", async () => {
    const session = await newSession({
      styleMeState: "feel-good",
      [STYLEME_HANDOFF_ORIGIN_KEY]: HANDOFF_ORIGIN_NADINE_PDP,
      styleMeNadineAnchorHandle: REAL_HANDLE,
    });
    assert.deepEqual(readNadineHandoff(session), { handle: REAL_HANDLE });
  });

  it("the exempt session keeps naia-piece + nadine and skips the anchor screens", () => {
    const sourceSrc = src("source.tsx");
    const block = sourceSrc.slice(
      sourceSrc.indexOf("if (nadineHandoff) {"),
      sourceSrc.indexOf('if (isRev3 && source !== "my-closet")'),
    );
    assert.ok(block.includes('session.set("styleMeSource", "naia-piece")'));
    assert.ok(block.includes('session.set("styleMeMode", "nadine")'));
    assert.ok(block.includes('redirect("/style-me/result"'));
  });
});

// ── 6. A forged or stale handle can never mint an anchor ─────────────────────

describe("NH.6 — invalid or missing handles cannot create a fake anchor", () => {
  const FORGED = ["../../etc/passwd", "not-a-real-product", "", "DOUBLE-TOP", "double-top "];

  for (const handle of FORGED) {
    it(`rejects forged handle ${JSON.stringify(handle)} at the validator`, () => {
      assert.equal(isValidNadineHandle(handle), false);
    });

    it(`a session carrying ${JSON.stringify(handle)} is not treated as a handoff`, async () => {
      const session = await newSession({
        styleMeState: "feel-good",
        [STYLEME_HANDOFF_ORIGIN_KEY]: HANDOFF_ORIGIN_NADINE_PDP,
        styleMeNadineAnchorHandle: handle,
      });
      assert.equal(readNadineHandoff(session), null, "stale/forged handle must fail closed");
    });

    it(`resolveActionAnchor refuses to build an anchor from ${JSON.stringify(handle)}`, async () => {
      const result = await resolveActionAnchor("naia-piece", "cust_1", handle, null);
      if (handle === "") {
        // Empty string is falsy — the engine treats it as "no handle" and auto-selects.
        assert.equal(result.ok, true);
        assert.equal(result.ok && result.anchor, null);
      } else {
        assert.equal(result.ok, false, "unknown handle must not resolve to a product");
      }
    });
  }

  it("the handoff route rejects a forged handle without stamping provenance", async () => {
    const res = (await handoffAction({
      request: handoffRequest("not-a-real-product"), params: {}, context: {} as never,
    } as never)) as Response;
    assert.equal(res.headers.get("Location"), CANONICAL_STYLEME_ENTRY);
    assert.equal(res.headers.get("Set-Cookie"), null, "no session may be written for a bad handle");
  });

  it("a missing handle is rejected the same way", async () => {
    const res = (await handoffAction({
      request: handoffRequest(null), params: {}, context: {} as never,
    } as never)) as Response;
    assert.equal(res.headers.get("Location"), CANONICAL_STYLEME_ENTRY);
  });

  it("the storefront origin guard is unchanged", async () => {
    const res = (await handoffAction({
      request: handoffRequest(REAL_HANDLE, "https://evil.example"), params: {}, context: {} as never,
    } as never)) as Response;
    assert.equal(res.status, 403);
  });
});

// ── 7. The result resolves the exact product the customer clicked ────────────

describe("NH.7 — the result resolves the originally clicked NADINE product", () => {
  it("resolveActionAnchor returns an anchor for the stored handle", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust_1", REAL_HANDLE, null);
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.anchor, "a real handle must resolve to a real anchor");
  });

  it("each accepted handle resolves to its own distinct product", async () => {
    const seen = new Set<string>();
    for (const handle of HANDOFF_RESOLVABLE_HANDLES) {
      const result = await resolveActionAnchor("naia-piece", "cust_1", handle, null);
      assert.equal(result.ok, true, `${handle} must resolve`);
      const anchor = result.ok ? result.anchor : null;
      assert.ok(anchor, `${handle} must produce an anchor`);
      const identity = JSON.stringify(anchor);
      assert.equal(seen.has(identity), false, `${handle} must not collide with another product`);
      seen.add(identity);
    }
    assert.equal(seen.size, HANDOFF_RESOLVABLE_HANDLES.length);
  });

  it("a handle the storefront allows but the catalogue cannot resolve is rejected at the door", async () => {
    // LOCKED_CATALOGUE_HANDLES is broader than the live catalogue. Accepting an
    // unresolvable handle would dead-end the customer at the result page.
    const unresolvable = LOCKED_CATALOGUE_HANDLES.filter(
      (h) => !(HANDOFF_RESOLVABLE_HANDLES as readonly string[]).includes(h),
    );
    for (const handle of unresolvable) {
      assert.equal(isValidNadineHandle(handle), false, `${handle} is not resolvable and must be refused`);
      const res = (await handoffAction({
        request: handoffRequest(handle), params: {}, context: {} as never,
      } as never)) as Response;
      assert.equal(res.headers.get("Set-Cookie"), null, `${handle} must not stamp an anchor`);
      assert.equal(res.headers.get("Location"), CANONICAL_STYLEME_ENTRY);
    }
  });

  it("every handle the handoff accepts can actually be resolved into an anchor", async () => {
    for (const handle of HANDOFF_RESOLVABLE_HANDLES) {
      assert.equal(isValidNadineHandle(handle), true);
      const result = await resolveActionAnchor("naia-piece", "cust_1", handle, null);
      assert.equal(result.ok, true, `${handle} passed validation but cannot be resolved`);
      assert.ok(result.ok && result.anchor);
    }
  });

  it("the handoff session shape maps to styleFrom NAIA, which carries the handle through", () => {
    const resultSrc = src("result.tsx");
    assert.ok(resultSrc.includes('source === "naia-piece" ? "NAIA"'));
    assert.ok(resultSrc.includes("resolveActionAnchor("));
    assert.ok(resultSrc.includes("nadineAnchorHandle"));
  });
});

// ── 8. Legacy URLs transition safely ─────────────────────────────────────────

describe("NH.8 — legacy questionnaire URLs transition to canonical Rev 3", () => {
  const LEGACY = [
    ["mood", moodLoader],
    ["feeling", feelingLoader],
    ["comfort", comfortLoader],
  ] as const;

  for (const [name, loader] of LEGACY) {
    it(`/style-me/${name} redirects to ${CANONICAL_STYLEME_ENTRY}`, async () => {
      const res = (await loader({
        request: new Request(`https://app.test/style-me/${name}`),
        params: {}, context: {} as never,
      } as never)) as Response;
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("Location"), CANONICAL_STYLEME_ENTRY);
    });

    it(`/style-me/${name} drops stranded legacy answers rather than reinterpreting them`, async () => {
      const cookie = await cookieFor({
        styleMeMood: "overwhelmed",
        styleMeFeelings: ["more-powerful"],
        styleMeBodyNeeds: ["structured"],
        styleMePractical: ["long-day"],
      });
      const res = (await loader({
        request: new Request(`https://app.test/style-me/${name}`, { headers: { Cookie: cookie } }),
        params: {}, context: {} as never,
      } as never)) as Response;
      const session = await sessionFromResponse(res);
      for (const key of LEGACY_QUESTIONNAIRE_KEYS) {
        assert.equal(session.get(key), undefined, `${key} must not survive the transition`);
      }
    });

    it(`/style-me/${name} preserves a NADINE handoff anchor across the transition`, async () => {
      const cookie = await cookieFor({
        styleMeMood: "overwhelmed",
        styleMeFeelings: ["more-powerful"],
        styleMeNadineAnchorHandle: REAL_HANDLE,
        styleMeMode: "nadine",
        styleMeSource: "naia-piece",
        [STYLEME_HANDOFF_ORIGIN_KEY]: HANDOFF_ORIGIN_NADINE_PDP,
      });
      const res = (await loader({
        request: new Request(`https://app.test/style-me/${name}`, { headers: { Cookie: cookie } }),
        params: {}, context: {} as never,
      } as never)) as Response;
      const session = await sessionFromResponse(res);
      assert.equal(session.get("styleMeNadineAnchorHandle"), REAL_HANDLE);
      assert.equal(session.get(STYLEME_HANDOFF_ORIGIN_KEY), HANDOFF_ORIGIN_NADINE_PDP);
      assert.equal(session.get("styleMeMode"), "nadine");
    });

    it(`/style-me/${name} keeps vocabulary-compatible occasion answers`, async () => {
      const cookie = await cookieFor({
        styleMeMood: "overwhelmed",
        styleMeFeelings: ["more-powerful"],
        styleMeOccasion: "work",
        styleMeFormalityConditional: "formality-polished",
      });
      const res = (await loader({
        request: new Request(`https://app.test/style-me/${name}`, { headers: { Cookie: cookie } }),
        params: {}, context: {} as never,
      } as never)) as Response;
      const session = await sessionFromResponse(res);
      assert.equal(session.get("styleMeOccasion"), "work");
      assert.equal(session.get("styleMeFormalityConditional"), "formality-polished");
    });

    it(`/style-me/${name} no longer renders a questionnaire`, () => {
      const legacySrc = src(`${name}.tsx`);
      assert.ok(!legacySrc.includes("export default function"), "must not render a step UI");
      assert.ok(legacySrc.includes("COMPATIBILITY REDIRECT"));
    });
  }

  it("no legacy emotional value is mapped onto a Rev 3 intention", () => {
    const handoffSrc = readFileSync(
      join(__dirname, "../../lib/styleme/handoff.ts"), "utf8",
    );
    for (const legacyId of ["overwhelmed", "more-powerful", "adventurous", "romantic", "need-reset"]) {
      assert.ok(
        !handoffSrc.includes(`"${legacyId}"`),
        `handoff.ts must not fabricate a mapping for legacy value ${legacyId}`,
      );
    }
  });

  it("hasStrandedLegacySession only fires for legacy-without-Rev3", async () => {
    assert.equal(hasStrandedLegacySession(await newSession({ styleMeMood: "tired" })), true);
    assert.equal(hasStrandedLegacySession(await newSession({ styleMeFeelings: ["softer"] })), true);
    assert.equal(
      hasStrandedLegacySession(await newSession({ styleMeMood: "tired", styleMeState: "feel-good" })),
      false,
      "a Rev 3 session is never treated as stranded",
    );
    assert.equal(hasStrandedLegacySession(await newSession({})), false);
  });

  it("clearLegacyQuestionnaireKeys leaves shared/provenance keys alone", async () => {
    const session = await newSession({
      styleMeMood: "tired",
      styleMeBodyNeeds: ["structured"],
      styleMeOccasion: "work",
      styleMeNadineAnchorHandle: REAL_HANDLE,
      styleMeMode: "nadine",
      styleMeSource: "naia-piece",
      styleMeClosetAnchorId: "ci_1",
      [STYLEME_HANDOFF_ORIGIN_KEY]: HANDOFF_ORIGIN_NADINE_PDP,
    });
    clearLegacyQuestionnaireKeys(session);
    assert.equal(session.get("styleMeMood"), undefined);
    assert.equal(session.get("styleMeBodyNeeds"), undefined);
    assert.equal(session.get("styleMeOccasion"), "work");
    assert.equal(session.get("styleMeNadineAnchorHandle"), REAL_HANDLE);
    assert.equal(session.get("styleMeMode"), "nadine");
    assert.equal(session.get("styleMeSource"), "naia-piece");
    assert.equal(session.get("styleMeClosetAnchorId"), "ci_1");
    assert.equal(session.get(STYLEME_HANDOFF_ORIGIN_KEY), HANDOFF_ORIGIN_NADINE_PDP);
  });
});

// ── 9. No fallback routes a customer back into the legacy questionnaire ──────

describe("NH.9 — every fallback leads to canonical Rev 3", () => {
  const FLOW_ROUTES = ["occasion.tsx", "source.tsx", "result.tsx"] as const;

  for (const route of FLOW_ROUTES) {
    it(`${route} never redirects to a legacy questionnaire step`, () => {
      const routeSrc = src(route);
      for (const legacy of ["/style-me/mood", "/style-me/feeling", "/style-me/comfort"]) {
        assert.ok(
          !new RegExp(`redirect\\(\\s*"${legacy}"`).test(routeSrc),
          `${route} must not redirect to ${legacy}`,
        );
      }
    });
  }

  it("Adjust Vibe always re-enters at State, including for a legacy session", () => {
    const resultSrc = src("result.tsx");
    assert.ok(!resultSrc.includes('const entryPoint = isRev3 ? "/style-me/state" : "/style-me/mood"'));
    const adjustBlock = resultSrc.slice(
      resultSrc.indexOf('cookieSession.set("styleMeAdjustVibe", "true")'),
      resultSrc.indexOf('if (intent === "generate")'),
    );
    assert.ok(adjustBlock.includes("CANONICAL_STYLEME_ENTRY"));
  });

  it("the occasion Back button targets the canonical Fit/Comfort step", () => {
    const occasionSrc = src("occasion.tsx");
    assert.ok(occasionSrc.includes('const backTo = "/style-me/physical-need"'));
    assert.ok(!occasionSrc.includes('"/style-me/comfort"'));
  });

  it("the canonical entry constant is /style-me/state", () => {
    assert.equal(CANONICAL_STYLEME_ENTRY, "/style-me/state");
  });
});

// ── 10. One questionnaire vocabulary ─────────────────────────────────────────

describe("NH.10 — the handoff uses only the canonical Rev 3 vocabulary", () => {
  it("no canonical step imports legacy mood/feeling vocabulary", () => {
    for (const step of ["state.tsx", "intention.tsx", "physical-need.tsx"]) {
      const stepSrc = src(step);
      assert.ok(stepSrc.includes("~/lib/styleme/session-vocabulary"));
      assert.ok(!stepSrc.includes("styleMeMood"));
      assert.ok(!stepSrc.includes("styleMeFeelings"));
    }
  });

  it("no canonical step imports anything from quick-style", () => {
    for (const step of ["state.tsx", "intention.tsx", "physical-need.tsx", "occasion.tsx", "source.tsx", "result.tsx"]) {
      const stepSrc = src(step);
      assert.ok(!/from\s+["'][^"']*quick-style/.test(stepSrc), `${step} must not import from quick-style`);
      assert.ok(!stepSrc.includes("/quick-style"), `${step} must not link to quick-style`);
    }
  });

  it("quick-style is marked as non-canonical", () => {
    const qs = readFileSync(join(__dirname, "../quick-style/_index.tsx"), "utf8");
    assert.ok(qs.includes("NOT CANONICAL STYLEME"));
  });
});
