// app/routes/settings-gallery-ux.test.tsx
//
// Settings & Privacy's image sections must default to clean controls, not an
// always-visible photo gallery — the gallery only renders once the customer
// explicitly chooses to manage individual photos. Proves the DEFAULT render
// (before any interaction) never leaks a Closet/Buy-or-Skip thumbnail or
// item name, and that the clean-control copy is present instead.

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
  closetPhotos: [
    { id: "closet-1", name: "Cream Wide-Leg Trouser", thumbnailUrl: "https://example.com/closet-1.jpg" },
    { id: "closet-2", name: "Linen Blazer", thumbnailUrl: "https://example.com/closet-2.jpg" },
  ],
  bosPhotos: [
    { id: "bos-1", productName: "Denim Jacket", thumbnailUrl: "https://example.com/bos-1.jpg" },
  ],
};

describe("Settings & Privacy — image sections default to clean controls, not an always-visible gallery", () => {
  it("never renders the Closet photo grid or any Closet item name on the default render", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).not.toContain("set-closet-photo-grid");
    expect(html).not.toContain("Cream Wide-Leg Trouser");
    expect(html).not.toContain("Linen Blazer");
    expect(html).not.toContain("https://example.com/closet-1.jpg");
  });

  it("never renders the Buy or Skip photo grid or any Buy or Skip item name on the default render", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).not.toContain("Denim Jacket");
    expect(html).not.toContain("https://example.com/bos-1.jpg");
  });

  it("shows the clean default controls for Closet photos — choose + remove-all, not thumbnails", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).toContain("Choose photos to remove");
    expect(html).toContain("Remove all photos");
    expect(html).toContain("Go to My Closet");
  });

  it("shows the clean default controls for Buy or Skip images — choose + remove-all, not thumbnails", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).toContain("Choose images to remove");
    expect(html).toContain("Remove all images");
  });

  it("VTO section links out to My nAia Model's preview management instead of duplicating a gallery here", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).toContain("Manage previews");
    expect(html).toContain('href="/my-naia-model#try-on-previews"');
    expect(html).toContain("Delete all previews");
  });

  it("My nAia Model keeps a single-photo control — no individual/bulk distinction for one photo", () => {
    (useLoaderData as any).mockReturnValue(BASE_LOADER_DATA);
    const html = renderToString(React.createElement(Settings));
    expect(html).toContain("Remove saved nAia Model photo");
    expect(html).not.toContain("Choose photos to remove".replace("photos", "model photos"));
  });

  it("hides the Closet choose/remove-all controls when there are no Closet photos, but keeps the link", () => {
    (useLoaderData as any).mockReturnValue({ ...BASE_LOADER_DATA, closetPhotos: [] });
    const html = renderToString(React.createElement(Settings));
    expect(html).not.toContain("Choose photos to remove");
    expect(html).not.toContain("Remove all photos");
    expect(html).toContain("Go to My Closet");
  });

  it("hides the whole Buy or Skip section when the customer has no uploaded images", () => {
    (useLoaderData as any).mockReturnValue({ ...BASE_LOADER_DATA, hasBosImages: false, bosPhotos: [] });
    const html = renderToString(React.createElement(Settings));
    expect(html).not.toContain("Choose images to remove");
    expect(html).not.toContain("Buy or Skip Uploaded Images");
  });
});
