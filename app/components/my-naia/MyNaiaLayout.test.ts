// app/components/my-naia/MyNaiaLayout.test.ts
// Sign Out nav item — source-code assertions (no DOM, no router context needed).
//
// Coverage:
//   A. Sign Out is a real Account-group nav item, not a separate feature
//   B. It reuses the existing /auth/logout action — no second logout implementation
//   C. It renders in both the desktop sidebar and the mobile nav
//   D. It reads as a nav item, not a special-cased button
//   E. It is never treated as the "active" page
//   F. Typography — the Sign Out <button> computes identically to the <Link>
//      items around it (regression coverage for a real bug: a button's own
//      browser default can override inherited font-family/text-transform/
//      letter-spacing even when a <Link> in the same spot renders correctly)
//
// Run: node --test --import tsx/esm app/components/my-naia/MyNaiaLayout.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const SRC = readFileSync(resolve(import.meta.dirname, "MyNaiaLayout.tsx"), "utf-8");
const CSS_PATH = resolve(import.meta.dirname, "../../styles/naia-design-system.css");
const CSS = readFileSync(CSS_PATH, "utf-8");

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

describe("G — Sign Out performs a real full-document submission, not a client-side transition", () => {
  // Root cause of a live blank-page regression: auth.shopify.login.tsx
  // (the page Sign Out's /auth/logout redirects into) returns a complete,
  // terminal HTML document containing the inline script that actually
  // launches the Shopify OAuth redirect — not React Router loader data, and
  // the route has no component to render loader data into even if it were.
  // That only works for a genuine top-level browser document request. A
  // plain client-managed <Form> (React Router's Single Fetch data router)
  // instead follows the logout action's redirect with its own internal
  // loader fetch, gets back that raw HTML where it expects structured route
  // data, and has nothing to render — a blank page, with the inline script
  // (and therefore the Shopify redirect) never executing at all.
  // reloadDocument forces a true browser-level form submission for both the
  // POST to /auth/logout and the GET it redirects into, so the browser
  // actually loads and parses that HTML as a document.

  it("both Sign Out Forms set reloadDocument — every /auth/logout submission is a real document navigation", () => {
    const formTags = SRC.match(/<Form\s+method="post"\s+action="\/auth\/logout"[^>]*>/g) ?? [];
    assert.ok(formTags.length >= 2, "expected both the sidebar and mobile Sign Out Forms");
    for (const tag of formTags) {
      assert.ok(/\breloadDocument\b/.test(tag), `Sign Out Form must set reloadDocument: ${tag}`);
    }
  });

  it("reloadDocument sits alongside the unchanged method/action — the fix adds a prop, it does not replace the existing submission target", () => {
    // 2026-11-12: onSubmit={signOutThenSubmit} (the Clerk sign-out fix, see
    // fix/stripe-clerk-phase1-security) now sits between reloadDocument and
    // style= — allow any attributes there, but reloadDocument must still be
    // present immediately after action="/auth/logout", unchanged.
    assert.match(SRC, /<Form\s+method="post"\s+action="\/auth\/logout"\s+reloadDocument\s/);
  });
});

describe("H — Sign Out actually ends the Clerk session, not just the legacy cookie (2026-11-12 fix)", () => {
  // Prior to this fix, /auth/logout's own action only ever cleared the
  // legacy NaiaSession/__naia_tok cookie and attempted Shopify OIDC
  // provider logout — there was no call anywhere in the codebase to end a
  // Clerk session (confirmed by the Stripe & Clerk audit: zero useClerk/
  // SignOutButton/.signOut( matches anywhere in app/). Since
  // requireCurrentNaiaCustomer resolves identity from Clerk's own session
  // cookie (see clerk-session.server.ts), not __naia_tok, a customer could
  // click "Sign Out" and remain fully logged in via Clerk.
  //
  // Composed with clerk-session.test.ts's existing, passing proof that "no
  // Clerk session" makes requireCurrentNaiaCustomer redirect to /sign-in —
  // this test (signOut() is actually called) plus that one (no session =
  // denied) together demonstrate the full claim: Sign Out now makes
  // previously-protected routes genuinely inaccessible. A true end-to-end
  // check (call Clerk's real Frontend API, then hit a live protected route)
  // is out of scope here — no live Clerk credentials exist in this phase.

  it("imports useClerk from @clerk/react-router", () => {
    assert.match(SRC, /import\s*\{[^}]*\buseClerk\b[^}]*\}\s*from\s*"@clerk\/react-router"/);
  });

  it("calls useClerk() inside the component to get signOut", () => {
    assert.match(SRC, /const\s*\{\s*signOut\s*\}\s*=\s*useClerk\(\)/);
  });

  it("both Sign Out Forms wire onSubmit to the sign-out handler, not a bare submit", () => {
    const formTags = SRC.match(/<Form\s+method="post"\s+action="\/auth\/logout"[^>]*>/g) ?? [];
    assert.ok(formTags.length >= 2, "expected both the sidebar and mobile Sign Out Forms");
    for (const tag of formTags) {
      assert.ok(/onSubmit=\{signOutThenSubmit\}/.test(tag), `Sign Out Form must wire onSubmit: ${tag}`);
    }
  });

  it("the handler awaits signOut() before submitting the form — Clerk ends the session before the legacy POST fires", () => {
    const fnIdx = SRC.indexOf("function signOutThenSubmit(");
    assert.ok(fnIdx !== -1, "signOutThenSubmit defined");
    const fnBody = SRC.slice(fnIdx, SRC.indexOf("\n  }", fnIdx));
    const signOutIdx = fnBody.indexOf("await signOut()");
    const submitIdx = fnBody.indexOf("form.submit()");
    assert.ok(signOutIdx !== -1, "awaits signOut()");
    assert.ok(submitIdx !== -1, "calls form.submit()");
    assert.ok(signOutIdx < submitIdx, "signOut() must be awaited before form.submit() — not fired in parallel");
  });

  it("calls preventDefault before anything else, so the native form submission never races the async signOut", () => {
    const fnIdx = SRC.indexOf("function signOutThenSubmit(");
    const fnBody = SRC.slice(fnIdx, SRC.indexOf("\n  }", fnIdx));
    const preventIdx = fnBody.indexOf("preventDefault()");
    const signOutIdx = fnBody.indexOf("await signOut()");
    assert.ok(preventIdx !== -1 && preventIdx < signOutIdx, "preventDefault() runs before the async signOut() call");
  });

  it("form.submit() is used, not requestSubmit() or a second dispatched submit event — avoids recursing back into onSubmit", () => {
    const fnIdx = SRC.indexOf("function signOutThenSubmit(");
    const fnBody = SRC.slice(fnIdx, SRC.indexOf("\n  }", fnIdx));
    assert.ok(fnBody.includes("form.submit()"), "uses the native, event-bypassing form.submit()");
    assert.ok(!fnBody.includes("requestSubmit"), "requestSubmit() would re-fire the submit event and recurse");
  });

  it("a Clerk signOut() failure is caught and never blocks the legacy local sign-out from still running", () => {
    const fnIdx = SRC.indexOf("function signOutThenSubmit(");
    const fnBody = SRC.slice(fnIdx, SRC.indexOf("\n  }", fnIdx));
    const tryIdx = fnBody.indexOf("try {");
    const catchIdx = fnBody.indexOf("} catch");
    const submitIdx = fnBody.indexOf("form.submit()");
    assert.ok(tryIdx !== -1 && catchIdx !== -1 && tryIdx < catchIdx, "signOut() call is wrapped in try/catch");
    assert.ok(submitIdx > catchIdx, "form.submit() runs after the catch block, regardless of whether signOut() threw");
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

describe("F — Sign Out button typography matches the surrounding nav links", () => {
  it(".mn-sidebar-nav-link declares its own typography — not just inherited from .mn-sidebar-nav", () => {
    const ruleIdx = CSS.indexOf(".mn-sidebar-nav-link {");
    assert.ok(ruleIdx !== -1, ".mn-sidebar-nav-link rule present");
    const rule = CSS.slice(ruleIdx, CSS.indexOf("}", ruleIdx));
    for (const prop of ["font-size", "text-transform", "letter-spacing", "color"]) {
      assert.ok(rule.includes(prop), `.mn-sidebar-nav-link declares ${prop} directly (a <button> sharing this class can't rely on inheriting it from the <ol>)`);
    }
  });

  it(".mn-nav-button-reset never uses the `font` shorthand", () => {
    const ruleIdx = CSS.indexOf(".mn-nav-button-reset {");
    assert.ok(ruleIdx !== -1, ".mn-nav-button-reset rule present");
    const rule = CSS.slice(ruleIdx, CSS.indexOf("}", ruleIdx));
    assert.ok(!/(?<!-)font\s*:/.test(rule), "no `font:` shorthand — it would reset font-size/line-height to inherit at equal specificity and clobber .mn-mobile-nav-link's own explicit font-size");
  });

  it(".mn-nav-button-reset resets font-family specifically, since buttons get their own browser default", () => {
    const ruleIdx = CSS.indexOf(".mn-nav-button-reset {");
    const rule = CSS.slice(ruleIdx, CSS.indexOf("}", ruleIdx));
    assert.ok(rule.includes("font-family: inherit") || rule.includes("font-family:inherit"), "font-family explicitly reset to inherit");
  });

  it(".mn-mobile-nav-link's own font-size rule is not overridden later for buttons sharing the class", () => {
    const linkIdx = CSS.indexOf(".mn-mobile-nav-link {");
    const linkRule = CSS.slice(linkIdx, CSS.indexOf("}", linkIdx));
    assert.ok(linkRule.includes("font-size"), ".mn-mobile-nav-link declares font-size directly");
  });
});

describe("I — footer dead links (2026-11-13 cleanup) render as honest pending text, not silent `#` links", () => {
  // Root issue: Accessibility, Cookie Preferences, Wishlist, Instagram,
  // TikTok, and Press all rendered as a clickable-looking <a href="#">
  // that goes nowhere — exactly the problem Privacy Policy/Terms of
  // Service were already fixed for (Priority 5, 2026-10-19). This closes
  // the same gap for the remaining six, reusing the identical mechanism —
  // no new rendering code, only data.

  const PREVIOUSLY_DEAD = ["Accessibility", "Cookie Preferences", "Wishlist", "Instagram", "TikTok", "Press"];
  const ALREADY_PENDING = ["Privacy Policy", "Terms of Service"];

  function footerLinkEntry(label: string): string {
    // FOOTER_COLS entries are one-liners of the form { label: "X", href: "#", ... }
    const re = new RegExp(`\\{\\s*label:\\s*"${label}"[^}]*\\}`);
    const match = SRC.match(re);
    assert.ok(match, `FOOTER_COLS entry found for "${label}"`);
    return match![0];
  }

  for (const label of PREVIOUSLY_DEAD) {
    it(`"${label}" is now marked pending: true`, () => {
      assert.match(footerLinkEntry(label), /pending:\s*true/, `"${label}" should carry pending: true`);
    });
  }

  for (const label of ALREADY_PENDING) {
    it(`"${label}" is still pending: true — unchanged regression guard`, () => {
      assert.match(footerLinkEntry(label), /pending:\s*true/, `"${label}" must remain pending: true`);
    });
  }

  it("a real, working link (\"My nAia\") is untouched — not accidentally marked pending", () => {
    assert.doesNotMatch(footerLinkEntry("My nAia"), /pending/, '"My nAia" must stay a plain working link');
  });

  it("every pending footer entry still carries href=\"#\" — pending marks intent, it doesn't remove the placeholder href", () => {
    for (const label of [...PREVIOUSLY_DEAD, ...ALREADY_PENDING]) {
      assert.match(footerLinkEntry(label), /href:\s*"#"/, `"${label}" should still have href: "#"`);
    }
  });

  it("the render logic's pending branch is unchanged — no new rendering code was added for this fix", () => {
    const occurrences = (SRC.match(/"pending" in l && l\.pending/g) || []).length;
    assert.strictEqual(occurrences, 2, "exactly the existing desktop + mobile pending branches, nothing new added");
  });
});

describe("J — follow-up (same day): Instagram/TikTok/Press drop the unverifiable \"coming soon\" claim", () => {
  // Root issue: reusing the exact "— coming soon" copy for social/press
  // links asserted something this codebase has no way to verify — that a
  // live Instagram/TikTok/press presence is actually imminent. This adds
  // one small, generic mechanism (an optional per-link `suffix`) so the
  // non-clickable treatment can be kept — same opacity, same cursor, same
  // "this isn't a working link" signal — without the implied promise.
  // Privacy Policy/Terms of Service/Accessibility/Cookie Preferences/
  // Wishlist are all genuinely planned work, confirmed by real code/
  // compliance need elsewhere, so they keep the default "coming soon".

  function footerLinkEntry(label: string): string {
    const re = new RegExp(`\\{\\s*label:\\s*"${label}"[^}]*\\}`);
    const match = SRC.match(re);
    assert.ok(match, `FOOTER_COLS entry found for "${label}"`);
    return match![0];
  }

  for (const label of ["Instagram", "TikTok", "Press"]) {
    it(`"${label}" opts out of the "coming soon" claim via suffix: ""`, () => {
      assert.match(footerLinkEntry(label), /suffix:\s*""/, `"${label}" should carry suffix: ""`);
    });
  }

  for (const label of ["Privacy Policy", "Terms of Service", "Accessibility", "Cookie Preferences", "Wishlist"]) {
    it(`"${label}" has no suffix override — still defaults to "coming soon"`, () => {
      assert.doesNotMatch(footerLinkEntry(label), /suffix:/, `"${label}" should not carry an explicit suffix`);
    });
  }

  it("footerPendingSuffix() defaults to the existing \"— coming soon\" copy when no suffix is given", () => {
    const fnIdx = SRC.indexOf("function footerPendingSuffix(");
    assert.ok(fnIdx !== -1, "footerPendingSuffix defined");
    const fnBody = SRC.slice(fnIdx, SRC.indexOf("\n}", fnIdx));
    assert.match(fnBody, /:\s*"—\s*coming soon"/, "falls back to the original copy, unchanged, for every pre-existing pending item");
  });

  it("footerPendingSuffix() returns null (no <em>, no claim) for an empty suffix", () => {
    const fnIdx = SRC.indexOf("function footerPendingSuffix(");
    const fnBody = SRC.slice(fnIdx, SRC.indexOf("\n}", fnIdx));
    assert.match(fnBody, /return\s+suffix\s*\?\s*suffix\s*:\s*null/, "an empty string suffix renders nothing, not a fallback promise");
  });

  it("no hardcoded \"— coming soon\" literal remains in either render block — both now compute it via footerPendingSuffix()", () => {
    assert.ok(!/\{l\.label\}\s*<em[^>]*>—\s*coming soon<\/em>/.test(SRC), "no leftover hardcoded JSX copy");
  });

  it("both the desktop grid and the mobile accordion call footerPendingSuffix()", () => {
    const desktopIdx = SRC.indexOf("mn-footer-grid");
    const mobileIdx = SRC.indexOf("mn-footer-accordion-list");
    assert.ok(desktopIdx !== -1 && mobileIdx !== -1, "both footer sections present");
    const desktopBlock = SRC.slice(desktopIdx, mobileIdx);
    const mobileBlock = SRC.slice(mobileIdx, mobileIdx + 1200);
    assert.ok(desktopBlock.includes("footerPendingSuffix("), "desktop grid uses the shared helper");
    assert.ok(mobileBlock.includes("footerPendingSuffix("), "mobile accordion uses the shared helper");
  });
});

describe("K — footer accordion button is programmatically associated with the panel it controls (2026-11-15 a11y fix)", () => {
  // The mobile nav trigger already does this correctly (aria-expanded +
  // aria-controls pointing at a real id on the revealed panel). The
  // footer accordion button had aria-expanded alone — a screen reader
  // announces "expanded/collapsed" with no indication of WHICH content
  // that refers to. Matches the existing mn-mobile-nav pattern exactly,
  // no new convention introduced.

  it("the accordion button's aria-controls matches a real id on its own revealed <ul>, derived from the same column title", () => {
    const btnIdx = SRC.indexOf("mn-footer-accordion-btn");
    const btnBlock = SRC.slice(btnIdx, SRC.indexOf("</button>", btnIdx));
    const controlsMatch = btnBlock.match(/aria-controls=\{`([^`]+)`\}/);
    assert.ok(controlsMatch, "button has an aria-controls expression");
    assert.match(controlsMatch![1], /\$\{col\.title\.replace\(\/\\s\+\/g, "-"\)\}$/, "derived from col.title, same slug rule as the id below");

    const ulIdx = SRC.indexOf('<ul className="mn-footer-accordion-list"');
    const ulTag = SRC.slice(ulIdx, SRC.indexOf(">", ulIdx) + 1);
    assert.match(ulTag, /id=\{`[^`]+\$\{col\.title\.replace\(\/\\s\+\/g, "-"\)\}`\}/, "the <ul> carries a matching id built from the same expression");
  });

  it("the id/aria-controls prefix is identical on both sides — not just both present", () => {
    const btnIdx = SRC.indexOf("mn-footer-accordion-btn");
    const btnBlock = SRC.slice(btnIdx, SRC.indexOf("</button>", btnIdx));
    const controlsValue = btnBlock.match(/aria-controls=\{`([^`]+)`\}/)![1];

    const ulIdx = SRC.indexOf('<ul className="mn-footer-accordion-list"');
    const ulTag = SRC.slice(ulIdx, SRC.indexOf(">", ulIdx) + 1);
    const idValue = ulTag.match(/id=\{`([^`]+)`\}/)![1];

    assert.strictEqual(controlsValue, idValue, "aria-controls and id must be built from the exact same template, or they can silently drift apart");
  });

  it("mirrors the mobile nav trigger's own existing aria-expanded + aria-controls pattern — not a new one-off convention", () => {
    const triggerIdx = SRC.indexOf("mn-mobile-menu-btn");
    const triggerBlock = SRC.slice(triggerIdx, SRC.indexOf("</button>", triggerIdx));
    assert.ok(triggerBlock.includes("aria-controls=\"mn-mobile-nav\""), "the existing trigger this fix is modeled on still has its own aria-controls");
  });
});
