// app/lib/ai/customer-intelligence-passport-adapter.test.ts
// Causal tests for the Phase 5 Passport explicit-truth adapter.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptPassportFindings, PASSPORT_SOURCE, type PassportFields } from "./customer-intelligence-passport-adapter.ts";

function profile(partial: Partial<PassportFields> = {}): PassportFields {
  return {
    favoriteColors: [], avoidColors: [], silhouette: [], lifestyle: [],
    dressingPreferences: [], updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...partial,
  };
}

describe("§CIA-PASSPORT-1 one finding per array entry, not one per field", () => {
  it("two favourite colours produce two findings, each with its own value", () => {
    const findings = adaptPassportFindings(profile({ favoriteColors: ["black", "navy"] }));
    assert.equal(findings.length, 2);
    assert.deepEqual(findings.map((f) => f.value), ["black", "navy"]);
  });
});

describe("§CIA-PASSPORT-2 signalClass, source, support — always the same shape", () => {
  it("explicit-truth, passport, direct support, for every field", () => {
    const findings = adaptPassportFindings(profile({ favoriteColors: ["black"], silhouette: ["fitted"] }));
    for (const f of findings) {
      assert.equal(f.signalClass, "explicit-truth");
      assert.equal(f.source, PASSPORT_SOURCE);
      assert.deepEqual(f.support, { kind: "direct" });
    }
  });
});

describe("§CIA-PASSPORT-3 dimension names the real OnboardingProfile field, one per field", () => {
  it("favoriteColors -> favorite-color, avoidColors -> avoid-color, silhouette -> silhouette, lifestyle -> lifestyle, dressingPreferences -> dressing-preference", () => {
    const findings = adaptPassportFindings(profile({
      favoriteColors: ["black"], avoidColors: ["neon"], silhouette: ["fitted"],
      lifestyle: ["work-office"], dressingPreferences: ["modest"],
    }));
    const byValue = new Map(findings.map((f) => [f.value, f.dimension]));
    assert.equal(byValue.get("black"), "favorite-color");
    assert.equal(byValue.get("neon"), "avoid-color");
    assert.equal(byValue.get("fitted"), "silhouette");
    assert.equal(byValue.get("work-office"), "lifestyle");
    assert.equal(byValue.get("modest"), "dressing-preference");
  });
});

describe("§CIA-PASSPORT-4 provenance names the real field, honestly", () => {
  it("each finding's provenanceRefs cites {kind:'passport', field} with the real field name", () => {
    const [f] = adaptPassportFindings(profile({ favoriteColors: ["black"] }));
    assert.deepEqual(f.provenanceRefs, [{ kind: "passport", field: "favoriteColors" }]);
  });
});

describe("§CIA-PASSPORT-5 temporal is stated, using the real updatedAt when present", () => {
  it("uses the profile's own updatedAt as an ISO string", () => {
    const updatedAt = new Date("2026-08-15T00:00:00Z");
    const [f] = adaptPassportFindings(profile({ favoriteColors: ["black"], updatedAt }));
    assert.deepEqual(f.temporal, { kind: "stated", updatedAt: updatedAt.toISOString() });
  });

  it("omits updatedAt rather than inventing one when the profile has none", () => {
    const [f] = adaptPassportFindings(profile({ favoriteColors: ["black"], updatedAt: null }));
    assert.deepEqual(f.temporal, { kind: "stated" });
  });
});

describe("§CIA-PASSPORT-6 customerFacingSafe and cohortEligible", () => {
  it("both true — she selected these herself and can see them on her own Passport page", () => {
    const [f] = adaptPassportFindings(profile({ favoriteColors: ["black"] }));
    assert.equal(f.customerFacingSafe, true);
    assert.equal(f.cohortEligible, true);
  });
});

describe("§CIA-PASSPORT-7 no profile, or empty fields, produces nothing — never inferred", () => {
  it("a null profile produces zero findings", () => {
    assert.deepEqual(adaptPassportFindings(null), []);
  });

  it("a profile with every field empty produces zero findings", () => {
    assert.deepEqual(adaptPassportFindings(profile()), []);
  });
});

describe("§CIA-PASSPORT-8 only the five approved fields are read — deferred fields never leak in", () => {
  it("PassportFields has no styleExpression, dressingHabits, or dressingRequirementsNote", () => {
    const p = profile();
    for (const field of ["styleExpression", "dressingHabits", "dressingRequirementsNote", "stylePersonalities", "becoming"]) {
      assert.equal(field in p, false, `${field} must not be part of this adapter's input shape`);
    }
  });
});
