// app/routes/api.health.test.ts
// Behavioral test for the Phase 1 liveness endpoint — calls the real
// loader() with a synthetic Request, no DI needed since it has zero
// dependencies (no DB, no provider, no session).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loader } from "./api.health.tsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, "api.health.tsx"), "utf8");

describe("GET /api/health", () => {
  it("returns 200 with a minimal { status: \"ok\" } body", async () => {
    const response = await loader({ request: new Request("http://localhost/api/health") } as any);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { status: "ok" });
  });

  it("sets Cache-Control: no-store", async () => {
    const response = await loader({ request: new Request("http://localhost/api/health") } as any);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });

  it("the response body has no fields beyond the documented minimal shape", async () => {
    const response = await loader({ request: new Request("http://localhost/api/health") } as any);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ["status"]);
  });
});

describe("api.health.tsx — stays a pure liveness check (guards against scope creep)", () => {
  it("does not import prisma/db.server (no DB dependency)", () => {
    assert.ok(!SRC.includes("db.server"), "a DB import here would make liveness depend on DB health — out of scope for this endpoint");
    assert.ok(!/\bprisma\b/i.test(SRC));
  });

  it("does not reference process.env (no config/secret exposure risk)", () => {
    assert.ok(!SRC.includes("process.env"));
  });

  it("exports no action() — GET-only, no state-changing behavior", () => {
    assert.ok(!/export\s+(async\s+)?function\s+action\b/.test(SRC));
  });
});
