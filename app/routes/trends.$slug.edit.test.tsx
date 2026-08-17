import { describe, it, expect } from "vitest";
import { loader } from "./trends.$slug.edit";

// React Router's redirect() returns a Response — it does not throw.
describe("trends/:slug/edit — backward-compat redirect", () => {
  it("redirects 301 to /trends/my-edits/:slug", async () => {
    const slug = "spring-2026-soft-structure";
    const response = await loader({
      request: new Request(`http://localhost/trends/${slug}/edit`),
      params: { slug },
      context: {},
    }) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`/trends/my-edits/${slug}`);
  });

  it("preserves the slug in the redirect target", async () => {
    const slug = "modern-tailoring-spring-2026";
    const response = await loader({
      request: new Request(`http://localhost/trends/${slug}/edit`),
      params: { slug },
      context: {},
    }) as Response;

    expect(response.headers.get("Location")).toBe(`/trends/my-edits/${slug}`);
  });
});
