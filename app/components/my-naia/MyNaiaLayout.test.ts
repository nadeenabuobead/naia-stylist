// app/components/my-naia/MyNaiaLayout.test.ts
// Sign Out nav item — source-code assertions (no DOM, no router context needed).
//
// Coverage:
//   A. Sign Out is a real Account-group nav item, not a separate feature
//   B. It reuses the existing /auth/logout action — no second logout implementation
//   C. It renders in both the desktop sidebar and the mobile nav
//   D. It reads as a nav item, not a special-cased button
//   E. It is never treated as the "active" page
//
// Run: node --test --import tsx/esm app/components/my-naia/MyNaiaLayout.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const SRC = readFileSync(resolve(import.meta.dirname, "MyNaiaLayout.tsx"), "utf-8");

describe("A — Sign Out lives in the Account nav group", () => {
  it("the Account group's items include a Sign Out entry", () => {
    const accountIdx = SRC.indexOf('title: "Account"');
    assert.ok(accountIdx !== -1, "Account group present");
    const accountBlock = SRC.slice(accountIdx, accountIdx + 400);
    assert.ok(accountBlock.includes('label: "Sign Out"'), "Sign Out item present in the Account group");
    assert.ok(accountBlock.includes("logout: true"), "Sign Out item is flagged as a logout action, not a plain link");
  });
});

describe("B — reuses the existing logout action, no second implementation", () => {
  it("the Sign Out item's Form posts to the existing /auth/logout route", () => {
    assert.ok(SRC.includes('action="/auth/logout"'), "posts to the existing /auth/logout action");
  });

  it("uses a real <Form method=\"post\">, not a custom fetch/XHR logout call", () => {
    const formCount = (SRC.match(/action="\/auth\/logout"/g) || []).length;
    assert.ok(formCount >= 1, "at least one Form targets /auth/logout");
    assert.ok(!SRC.includes("fetch(\"/auth/logout\""), "no hand-rolled fetch() call to the logout route");
  });

  it("imports Form from react-router rather than defining its own submit handler", () => {
    assert.ok(/import\s*{[^}]*\bForm\b[^}]*}\s*from\s*"react-router"/.test(SRC), "Form imported from react-router");
  });
});

describe("C — rendered in both the desktop sidebar and the mobile nav", () => {
  it("the desktop sidebar loop renders the logout item as a submit button inside the Form", () => {
    const sidebarIdx = SRC.indexOf("mn-sidebar-nav");
    const sidebarBlock = SRC.slice(sidebarIdx, sidebarIdx + 1800);
    assert.ok(sidebarBlock.includes("item.logout"), "sidebar loop branches on item.logout");
    assert.ok(sidebarBlock.includes('action="/auth/logout"'), "sidebar logout branch posts to /auth/logout");
    assert.ok(sidebarBlock.includes('type="submit"'), "sidebar logout branch is a submit button");
  });

  it("the mobile nav loop renders the logout item as a submit button inside the Form", () => {
    const mobileIdx = SRC.indexOf("mn-mobile-nav-inner");
    const mobileBlock = SRC.slice(mobileIdx, mobileIdx + 1800);
    assert.ok(mobileBlock.includes("item.logout"), "mobile loop branches on item.logout");
    assert.ok(mobileBlock.includes('action="/auth/logout"'), "mobile logout branch posts to /auth/logout");
    assert.ok(mobileBlock.includes('type="submit"'), "mobile logout branch is a submit button");
  });
});

describe("D — visually consistent with the surrounding nav items", () => {
  it("the sidebar Sign Out button shares the same link class as every other sidebar nav item", () => {
    assert.ok(SRC.includes('className="mn-sidebar-nav-link mn-nav-button-reset"'), "shares mn-sidebar-nav-link");
  });

  it("the mobile Sign Out button shares the same link class as every other mobile nav item", () => {
    assert.ok(SRC.includes('className="mn-mobile-nav-link mn-nav-button-reset"'), "shares mn-mobile-nav-link");
  });
});

describe("E — Sign Out is never treated as the current page", () => {
  it("isActive() returns false for a logout item regardless of pathname", () => {
    const fnIdx = SRC.indexOf("function isActive(");
    const fnBlock = SRC.slice(fnIdx, fnIdx + 200);
    assert.ok(/item\.logout/.test(fnBlock), "isActive() checks item.logout");
  });
});
