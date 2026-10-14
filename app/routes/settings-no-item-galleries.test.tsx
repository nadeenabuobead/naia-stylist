// app/routes/settings-gallery-ux.test.tsx
//
// Settings & Privacy is a privacy/deletion control surface, not a photo
// gallery: it must never render per-item thumbnails, selectors, or
// checkboxes for Closet photos, Buy or Skip images, or VTO previews.
// Individual management belongs on the feature page itself (My Closet, Buy
// or Skip, My nAia Model); Settings only offers a "Go to <feature>" link
// plus a bulk "Remove all" action.

import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  const mockLink = ({ to, children, style, className }: { to: string; children: unknown; style?: object; className?: string }) =>
    createElement("a", { href: to, style, className }, children as any);
  const mockForm = ({ children, ...rest }: { children: unknown }) =>
    createElement("form", rest as any, children as any);
  return {
    ...actual,
    Link: mockLink,
    Form: mockForm,
    useLoaderData: vi.fn(),
    useFetcher: vi.fn(() => ({ submit: vi.fn(), state: "idle", data: undefined })),
    useRevalidator: vi.fn(() => ({ revalidate: vi.fn() })),
    useLocation: vi.fn(() => ({ pathname: "/settings" })),
    UNSAFE_withComponentProps: (c: any) => c,
  };
});

import { useLoaderData } from "react-router";
import Settings from "./settings";
import React from "react";

const BASE_LOADER_DATA = {
  firstName: "Nadine",
  lastName: "Abuobeid",
  email: "nadine@example.com",
  model: { hasFace: false, hasBody: true },
  hasVtoResults: true,
  hasBosImages: true,
  hasClosetPhotos: true,
};

describe("Settings & Privacy — no item galleries, selectors, or per-item thumbnails anywhere", () => {
  it("never renders a photo grid, checkbox, or thumbnail of any kind", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).not.toContain("set-closet-photo-grid");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Choose photos to remove");
    expect(html).not.toContain("Choose images to remove");
  });

  it("My Closet Photos: links out to My Closet for individual management, and offers bulk delete-all here", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).toContain("manage it in My Closet");
    expect(html).toContain('href="/closet"');
    expect(html).toContain("Go to My Closet");
    expect(html).toContain("Remove all Closet photos");
  });

  it("My Closet Photos: hides the bulk delete-all button when there are no Closet photos, but keeps the link", () => {
    (useLoaderData as any).mockReturnValue({ ...BASE_LOADER_DATA, hasClosetPhotos: false });
    const html = renderToString(React.createElement(Settings));
    expect(html).toContain("Go to My Closet");
    expect(html).not.toContain("Remove all Closet photos");
  });

  it("Buy or Skip: links out to Buy or Skip for individual management, and offers bulk delete-all here", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).toContain("manage it in Buy or Skip");
    expect(html).toContain('href="/my-naia/buying-decisions"');
    expect(html).toContain("Go to Buy or Skip");
    expect(html).toContain("Remove all images");
  });

  it("Buy or Skip section is hidden entirely when the customer has no uploaded images", () => {
    (useLoaderData as any).mockReturnValue({ ...BASE_LOADER_DATA, hasBosImages: false });
    const html = renderToString(React.createElement(Settings));
    expect(html).not.toContain("Buy or Skip Uploaded Images");
  });

  it("Virtual Try-On: links out to My nAia Model's preview management, and offers bulk delete-all here", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).toContain("manage it in My nAia Model");
    expect(html).toContain('href="/my-naia-model#try-on-previews"');
    expect(html).toContain("Go to My nAia Model");
    expect(html).toContain("Remove all previews");
  });

  it("My nAia Model keeps a single consolidated 'Remove photo' control — no face/body or individual/bulk distinction for one photo", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).toContain("Remove saved nAia Model photo");
    expect(html).not.toContain("face photo");
    expect(html).not.toContain("Remove all saved nAia Model photos");
  });
});
