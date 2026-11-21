// app/db.server.test.ts
//
// Pure unit tests for the idempotent query-param append used to build the
// pooled datasource URL — never imports db.server.js's default export,
// which constructs the real singleton PrismaClient at module load. Testing
// appendQueryParamIfMissing directly exercises the exact logic
// NAIA_DATABASE_URL is built with, without needing a live database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendQueryParamIfMissing } from "./db.server.js";

describe("appendQueryParamIfMissing", () => {
  it("appends with a leading ? when the URL has no existing query string", () => {
    const url = appendQueryParamIfMissing("postgres://host:5432/db", "pgbouncer", "true");
    assert.equal(url, "postgres://host:5432/db?pgbouncer=true");
  });

  it("appends with & when the URL already has a query string", () => {
    const url = appendQueryParamIfMissing("postgres://host:5432/db?sslmode=require", "pgbouncer", "true");
    assert.equal(url, "postgres://host:5432/db?sslmode=require&pgbouncer=true");
  });

  it("is idempotent — never double-appends a param already present", () => {
    const url = appendQueryParamIfMissing("postgres://host:5432/db?pgbouncer=true", "pgbouncer", "true");
    assert.equal(url, "postgres://host:5432/db?pgbouncer=true");
  });

  it("leaves an explicit pgbouncer=false alone rather than overriding it", () => {
    const url = appendQueryParamIfMissing("postgres://host:5432/db?pgbouncer=false", "pgbouncer", "true");
    assert.equal(url, "postgres://host:5432/db?pgbouncer=false");
  });

  it("chains cleanly with a second independent param append", () => {
    const withLimit = appendQueryParamIfMissing("postgres://host:5432/db", "connection_limit", "2");
    const withBoth = appendQueryParamIfMissing(withLimit, "pgbouncer", "true");
    assert.equal(withBoth, "postgres://host:5432/db?connection_limit=2&pgbouncer=true");
  });

  it("does not disturb an already-present connection_limit when appending pgbouncer", () => {
    const withLimit = appendQueryParamIfMissing("postgres://host:5432/db?connection_limit=2", "connection_limit", "2");
    const withBoth = appendQueryParamIfMissing(withLimit, "pgbouncer", "true");
    assert.equal(withBoth, "postgres://host:5432/db?connection_limit=2&pgbouncer=true");
  });

  it("handles an empty base URL without throwing", () => {
    const url = appendQueryParamIfMissing("", "pgbouncer", "true");
    assert.equal(url, "?pgbouncer=true");
  });
});
