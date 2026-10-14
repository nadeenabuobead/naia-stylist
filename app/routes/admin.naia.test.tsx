// app/routes/admin.naia.test.tsx
//
// nAia Admin navigation cleanup for launch — the shell previously listed
// development-phase placeholders (StyleMe QA / Phase 4, Feedback / Phase 5,
// Usage / Phase 5) that were never clickable and have no registered route.
// The launch nav is exactly Closet Intelligence + Customers.

import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  const mockNavLink = ({ to, children, className }: { to: string; children: unknown; className?: (p: { isActive: boolean }) => string }) =>
    createElement("a", { href: to, className: typeof className === "function" ? className({ isActive: false }) : className }, children as any);
  return {
    ...actual,
    NavLink: mockNavLink,
    Outlet: () => null,
    useNavigation: () => ({ state: "idle" }),
    UNSAFE_withComponentProps: (Component: any) => Component,
  };
});

import React from "react";
import NaiaAdminWorkspace from "./admin.naia";

describe("nAia Admin navigation — launch cleanup", () => {
  it("renders exactly Closet Intelligence and Customers — no development-phase placeholders", () => {
    const html = renderToString(React.createElement(NaiaAdminWorkspace));
    const navMarkup = html.slice(0, html.indexOf("<style>"));
    expect(navMarkup).toContain("Closet Intelligence");
    expect(navMarkup).toContain(">Customers<");
    for (const removed of ["StyleMe QA", "Feedback", "Usage", "Phase 4", "Phase 5", "Coming in", "Coming soon"]) {
      expect(navMarkup).not.toContain(removed);
    }
  });

  it("links to the real registered routes", () => {
    const html = renderToString(React.createElement(NaiaAdminWorkspace));
    expect(html).toContain('href="/admin/naia/closet"');
    expect(html).toContain('href="/admin/naia/customers"');
  });

  it("renders no disabled/non-clickable nav items — every item is a real link", () => {
    const html = renderToString(React.createElement(NaiaAdminWorkspace));
    const navMarkup = html.slice(0, html.indexOf("<style>"));
    expect(navMarkup).not.toContain("aria-disabled");
    expect(html).not.toContain("naia-admin-nav__link--disabled");
  });

  it("the nav has exactly two items — no duplicates, no leftovers", () => {
    const html = renderToString(React.createElement(NaiaAdminWorkspace));
    const linkCount = (html.match(/<a href="\/admin\/naia\//g) || []).length;
    expect(linkCount).toBe(2);
  });

  it("removed the now-dead disabled/soon CSS rules tied to the removed placeholder items", () => {
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "admin.naia.tsx"), "utf8");
    expect(src).not.toMatch(/naia-admin-nav__link--disabled/);
    expect(src).not.toMatch(/naia-admin-nav__soon/);
  });
});
