// app/lib/api-rate-limit-sql.test.ts
// Separate from api-rate-limit.test.ts: this exercises the REAL
// _incrementCounter against a mocked ~/db.server, confirming the atomic
// upsert is actually invoked as a single $queryRaw call — the decision
// logic in api-rate-limit.test.ts uses the injectable fake instead, by
// design, to test that logic independent of the SQL shape.
//
// Run: npx vitest run app/lib/api-rate-limit-sql.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: { $queryRaw: vi.fn() },
}));

import prisma from "~/db.server";
import { _incrementCounter } from "./api-rate-limit.server";

beforeEach(() => vi.clearAllMocks());

describe("_incrementCounter — real atomic-upsert call", () => {
  it("issues exactly one $queryRaw call and returns its count", async () => {
    ((prisma as any).$queryRaw as any).mockResolvedValue([{ count: 4 }]);
    const result = await _incrementCounter("cust_a", "test-route", new Date(0));
    expect((prisma as any).$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ count: 4 });
  });

  it("the templated SQL contains ON CONFLICT ... DO UPDATE, not a separate select-then-write", async () => {
    ((prisma as any).$queryRaw as any).mockResolvedValue([{ count: 1 }]);
    await _incrementCounter("cust_a", "test-route", new Date(0));
    const callArgs = ((prisma as any).$queryRaw as any).mock.calls[0];
    const sqlStrings = callArgs[0]; // tagged-template strings array
    const fullSql = sqlStrings.join("?");
    expect(fullSql).toMatch(/ON CONFLICT/i);
    expect(fullSql).toMatch(/DO UPDATE/i);
  });
});
