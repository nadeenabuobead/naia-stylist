// app/routes/my-naia.what-naia-notices.test.tsx
//
// V1 UX restructure — "What nAia Is Noticing" moved into Style Passport
// (/passport#noticing). This route must still exist (old links/bookmarks
// should not 404) but only redirects now, rather than duplicating the UI.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer: vi.fn(),
}));

import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loader } from "./my-naia.what-naia-notices";

describe("my-naia.what-naia-notices loader — redirect-only", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires the normal authenticated session before redirecting", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockResolvedValueOnce({ id: "c1" } as any);
    try {
      await loader({ request: new Request("http://localhost/my-naia/what-naia-notices"), params: {}, context: {} } as any);
      throw new Error("expected loader to throw a redirect");
    } catch (thrown) {
      expect(requireCurrentNaiaCustomer).toHaveBeenCalledOnce();
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(302);
      expect((thrown as Response).headers.get("Location")).toBe("/passport#noticing");
    }
  });

  it("propagates the login redirect when no session exists, rather than redirecting to Passport", async () => {
    vi.mocked(requireCurrentNaiaCustomer).mockImplementationOnce(() => {
      throw new Response(null, {
        status: 302,
        headers: { Location: "/auth/shopify/login?return_to=%2Fmy-naia%2Fwhat-naia-notices" },
      });
    });
    await expect(
      loader({ request: new Request("http://localhost/my-naia/what-naia-notices"), params: {}, context: {} } as any),
    ).rejects.toBeInstanceOf(Response);
  });
});
