// naia-product-block.js — Phase 4A4 / Phase 4A7 try-on upgrade
// NADINE product-page intelligence widget + dev virtual try-on panel.
// Product intelligence fetched via Shopify app proxy (/apps/naia-stylist/api/...).
// Shopify adds logged_in_customer_id server-side; no JWT or localStorage auth.
// No FASHN calls. No photo uploads. Fail-closed on unknown products.
(function () {
  "use strict";

  var root = document.getElementById("naia-product-block");
  if (!root) return;

  var productId = root.getAttribute("data-product-id");
  var appUrl = (root.getAttribute("data-app-url") || "https://naia-stylist.vercel.app").replace(/\/$/, "");

  if (!productId || !/^\d+$/.test(productId)) return;

  root.innerHTML = '<div class="naia-pb-loading" aria-live="polite" aria-label="Loading product intelligence">Reading the room&hellip;</div>';

  // ── Fetch intelligence via Shopify app proxy ──────────────────────────────────

  function fetchIntelligence(onResult) {
    fetch("/apps/naia-stylist/api/nadine-product-intelligence?productId=" + encodeURIComponent(productId))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { onResult(data); })
      .catch(function () { onResult(null); });
  }

  // ── Verdict helpers ───────────────────────────────────────────────────────────

  var VERDICT_LABELS = {
    "strong-match":           "Strong match",
    "good-match-with-caveat": "Good match",
    "not-best-addition":      "Not the best addition right now",
    "insufficient-evidence":  "Not enough information yet",
  };

  var VERDICT_DOT_CLASS = {
    "strong-match":           "strong-match",
    "good-match-with-caveat": "good-match",
    "not-best-addition":      "not-best",
    "insufficient-evidence":  "insufficient",
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  function render(data) {
    if (!data || !data.resolved) {
      root.innerHTML = "";
      return;
    }

    var isAuthenticated = !!data.authenticated;
    var html = "";

    html += '<p class="naia-pb-title">' + esc(data.nadinaTitle) + '</p>';
    html += '<p class="naia-pb-role">' + esc(data.stylingRole) + '</p>';

    if (data.occasionTags && data.occasionTags.length > 0) {
      html += '<div class="naia-pb-occasions" role="list" aria-label="Occasion tags">';
      for (var i = 0; i < Math.min(data.occasionTags.length, 4); i++) {
        html += '<span class="naia-pb-tag" role="listitem">' + esc(data.occasionTags[i]) + '</span>';
      }
      html += '</div>';
    }

    html += '<hr class="naia-pb-divider" aria-hidden="true">';

    if (isAuthenticated && data.assessment) {
      var a = data.assessment;
      var verdictLabel = VERDICT_LABELS[a.verdict] || a.verdict;
      var dotClass = VERDICT_DOT_CLASS[a.verdict] || "insufficient";

      html += '<div class="naia-pb-assessment" role="region" aria-label="Personal style assessment">';
      html += '<div class="naia-pb-verdict">';
      html += '<span class="naia-pb-verdict-dot ' + dotClass + '" aria-hidden="true"></span>';
      html += esc(verdictLabel);
      html += '</div>';
      html += '<p class="naia-pb-explanation">' + esc(a.explanation) + '</p>';

      if (a.positiveEvidence && a.positiveEvidence.length > 0) {
        html += '<ul class="naia-pb-evidence-list" aria-label="Why it works">';
        for (var j = 0; j < a.positiveEvidence.length; j++) {
          html += '<li>' + esc(a.positiveEvidence[j]) + '</li>';
        }
        html += '</ul>';
      }

      if (a.caveats && a.caveats.length > 0) {
        html += '<ul class="naia-pb-caveat-list" aria-label="Things to consider">';
        for (var k = 0; k < a.caveats.length; k++) {
          html += '<li>' + esc(a.caveats[k].text) + '</li>';
        }
        html += '</ul>';
      }

      html += '</div>';

      if (typeof data.wardrobeCompatibilityCount === "number") {
        html += '<p class="naia-pb-wardrobe">';
        if (data.wardrobeCompatibilityCount > 0) {
          html += '<strong>' + data.wardrobeCompatibilityCount + '</strong> piece' +
            (data.wardrobeCompatibilityCount === 1 ? '' : 's') +
            ' in your wardrobe pair well with this.';
        } else {
          html += 'Nothing in your wardrobe pairs with this yet.';
        }
        html += '</p>';
      }
    } else if (!isAuthenticated) {
      html += '<div class="naia-pb-guest" role="note">';
      html += 'Sign in to your nAia account to see how this piece fits your style profile.';
      html += '</div>';
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    html += '<div class="naia-pb-actions">';

    // Style Me button
    html += '<button class="naia-pb-btn naia-pb-btn-primary" data-action="styleme" aria-label="Style Me with ' + esc(data.nadinaTitle) + '">';
    html += 'Style Me with this piece';
    html += '</button>';

    // Virtual try-on button — dev-active, inactive, or message
    if (data.devTryOnEnabled && data.tryOnEligible) {
      html += '<button class="naia-pb-btn naia-pb-btn-tryon" data-action="tryon" aria-label="Try ' + esc(data.nadinaTitle) + ' on me">';
      html += 'Try It On Me';
      if (data.devTryOnEnabled) {
        html += '<span class="naia-pb-tryon-sub">Dev preview</span>';
      }
      html += '</button>';
    } else if (data.tryOnEligible) {
      // Eligible but feature flag off — keep passive coming-soon state
      var ts = data.tryOnStatus;
      if (ts) {
        html += '<button class="naia-pb-btn naia-pb-btn-inactive" disabled aria-disabled="true">';
        html += esc(ts.label);
        if (ts.sublabel) {
          html += '<span class="naia-pb-tryon-sub">' + esc(ts.sublabel) + '</span>';
        }
        html += '</button>';
      }
    } else if (data.resolved && !data.tryOnEligible) {
      // Not eligible (not-eligible or pending outcome) — show message
      html += '<p class="naia-pb-tryon-unavailable">Virtual preview is not available for this piece yet.</p>';
    }

    html += '</div>';

    root.innerHTML = html;

    // Bind Style Me action
    var styleMeBtn = root.querySelector('[data-action="styleme"]');
    if (styleMeBtn) {
      styleMeBtn.addEventListener("click", function () {
        var form = document.createElement("form");
        form.method = "POST";
        form.action = appUrl + "/api/styleme-handoff";
        var input = document.createElement("input");
        input.type = "hidden";
        input.name = "handle";
        input.value = esc(data.v8Handle);
        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
      });
    }

    // Bind try-on action
    var tryOnBtn = root.querySelector('[data-action="tryon"]');
    if (tryOnBtn) {
      tryOnBtn.addEventListener("click", function () {
        openTryOnPanel(data);
      });
    }
  }

  // ── Vanilla JS Try-On Panel ───────────────────────────────────────────────────
  // Self-contained drawer that lives on the Shopify storefront (no React).
  // States: setup-required | has-result | not-available

  var panelEl = null;
  var overlayEl = null;

  function buildPanel(data) {
    // Overlay
    var overlay = document.createElement("div");
    overlay.id = "naia-tryon-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(34,21,22,.55);z-index:9000;display:flex;justify-content:flex-end;";
    overlay.addEventListener("click", closeTryOnPanel);

    // Panel drawer
    var panel = document.createElement("div");
    panel.id = "naia-tryon-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Virtual Try-On");
    panel.style.cssText = "width:min(420px,100vw);height:100%;background:#f4f4f1;display:flex;flex-direction:column;overflow-y:auto;box-shadow:-8px 0 32px rgba(34,21,22,.12);";
    panel.addEventListener("click", function (e) { e.stopPropagation(); });

    // Header
    var header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid rgba(59,5,16,.08);flex-shrink:0;";

    var headerLabel = document.createElement("span");
    headerLabel.style.cssText = "font-family:'Space Mono','Courier New',monospace;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#8b2035;";
    headerLabel.innerHTML = "Virtual Try-On";
    if (data.devTryOnEnabled) {
      headerLabel.innerHTML += ' <span style="display:inline-block;padding:2px 6px;background:#8b2035;color:#f4f4f1;font-size:7px;letter-spacing:2px;text-transform:uppercase;margin-left:6px;vertical-align:middle;">dev</span>';
    }

    var closeBtn = document.createElement("button");
    closeBtn.style.cssText = "background:none;border:none;cursor:pointer;font-size:20px;color:#7a6f6a;line-height:1;padding:4px;";
    closeBtn.setAttribute("aria-label", "Close virtual try-on");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", closeTryOnPanel);

    header.appendChild(headerLabel);
    header.appendChild(closeBtn);

    // Body
    var body = document.createElement("div");
    body.style.cssText = "padding:28px 24px;flex:1;";
    body.innerHTML = buildPanelBody(data);

    panel.appendChild(header);
    panel.appendChild(body);
    overlay.appendChild(panel);

    return { overlay: overlay, panel: panel };
  }

  function buildPanelBody(data) {
    var title = esc(data.nadinaTitle || "this piece");
    var DISCLAIMER = "A visual preview generated from your photo. Fit, scale and fabric behaviour may differ in person.";

    // State: no model set up
    if (!data.hasModel) {
      return '<div class="naia-panel-title">Set up your nAia Model first.</div>' +
        '<p class="naia-panel-body">To see yourself in a piece, you need a full-body photo and virtual try-on consent on your nAia Model.</p>' +
        '<a href="' + esc(appUrl) + '/my-naia-model" class="naia-panel-cta">Set Up My nAia Model &rarr;</a>';
    }

    // State: has fixture result
    if (data.fixtureUrl) {
      var proxyUrl = "/apps/naia-stylist" + data.fixtureUrl;
      return '<div class="naia-panel-title">You in ' + title + '</div>' +
        '<img src="' + esc(proxyUrl) + '" alt="Virtual try-on result for ' + title + '" class="naia-panel-img" />' +
        '<p class="naia-panel-disclaimer">' + esc(DISCLAIMER) + '</p>';
    }

    // State: eligible but no result stored, or not eligible
    return '<div class="naia-panel-title">Not available for this piece.</div>' +
      '<p class="naia-panel-body">Virtual preview isn\'t available for this piece yet. More pieces are on their way.</p>';
  }

  function openTryOnPanel(data) {
    closeTryOnPanel(); // close any existing panel first
    var built = buildPanel(data);
    overlayEl = built.overlay;
    panelEl = built.panel;
    document.body.appendChild(overlayEl);
    document.body.style.overflow = "hidden";
    // Trap focus in panel
    panelEl.setAttribute("tabindex", "-1");
    panelEl.focus();
  }

  function closeTryOnPanel() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
    panelEl = null;
    document.body.style.overflow = "";
  }

  // Close on Escape
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeTryOnPanel();
  });

  // ── XSS guard ─────────────────────────────────────────────────────────────────

  function esc(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ── Entry point ───────────────────────────────────────────────────────────────

  fetchIntelligence(function (data) {
    render(data);
  });
})();
