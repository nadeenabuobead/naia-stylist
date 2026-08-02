// naia-collection-try-on.js — Phase 4A7
// Discreet try-on badge for NADINE collection product cards.
// Queries intelligence API by handle; shows "Try It On Me" only when
// devTryOnEnabled && tryOnEligible. Reuses the same panel as the product block.
// No FASHN calls. Fail-closed on unknown products.
(function () {
  "use strict";

  // Support multiple cards on one page — each card has a unique root id.
  var allRoots = document.querySelectorAll(".naia-cc-root");
  if (!allRoots.length) return;

  var appUrl = "";
  var overlayEl = null;

  function closeTryOnPanel() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
    document.body.style.overflow = "";
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeTryOnPanel();
  });

  function openTryOnPanel(data) {
    closeTryOnPanel();
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(34,21,22,.55);z-index:9000;display:flex;justify-content:flex-end;";
    overlay.addEventListener("click", closeTryOnPanel);

    var panel = document.createElement("div");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Virtual Try-On");
    panel.style.cssText = "width:min(420px,100vw);height:100%;background:#f4f4f1;display:flex;flex-direction:column;overflow-y:auto;box-shadow:-8px 0 32px rgba(34,21,22,.12);";
    panel.addEventListener("click", function (e) { e.stopPropagation(); });

    var header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid rgba(59,5,16,.08);flex-shrink:0;";

    var headerLabel = document.createElement("span");
    headerLabel.style.cssText = "font-family:'Space Mono','Courier New',monospace;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#8b2035;";
    headerLabel.innerHTML = "Virtual Try-On" +
      ' <span style="display:inline-block;padding:2px 6px;background:#8b2035;color:#f4f4f1;font-size:7px;letter-spacing:2px;text-transform:uppercase;margin-left:6px;vertical-align:middle;">dev</span>';

    var closeBtn = document.createElement("button");
    closeBtn.style.cssText = "background:none;border:none;cursor:pointer;font-size:20px;color:#7a6f6a;line-height:1;padding:4px;";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", closeTryOnPanel);

    header.appendChild(headerLabel);
    header.appendChild(closeBtn);

    var body = document.createElement("div");
    body.style.cssText = "padding:28px 24px;flex:1;";
    var title = esc(data.nadinaTitle || data.productHandle || "this piece");
    var DISCLAIMER = "A visual preview generated from your photo. Fit, scale and fabric behaviour may differ in person.";

    if (!data.hasModel) {
      body.innerHTML =
        '<div class="naia-panel-title">Set up your nAia Model first.</div>' +
        '<p class="naia-panel-body">To see yourself in a piece, you need a full-body photo and virtual try-on consent on your nAia Model.</p>' +
        '<a href="' + esc(appUrl) + '/my-naia-model" class="naia-panel-cta">Set Up My nAia Model &rarr;</a>';
    } else if (data.fixtureUrl) {
      var proxyUrl = "/apps/naia-stylist" + data.fixtureUrl;
      body.innerHTML =
        '<div class="naia-panel-title">You in ' + title + '</div>' +
        '<img src="' + esc(proxyUrl) + '" alt="Virtual try-on result for ' + title + '" class="naia-panel-img" />' +
        '<p class="naia-panel-disclaimer">' + esc(DISCLAIMER) + '</p>';
    } else {
      body.innerHTML =
        '<div class="naia-panel-title">Not available for this piece.</div>' +
        '<p class="naia-panel-body">Virtual preview isn\'t available for this piece yet. More pieces are on their way.</p>';
    }

    panel.appendChild(header);
    panel.appendChild(body);
    overlay.appendChild(panel);
    overlayEl = overlay;
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    panel.setAttribute("tabindex", "-1");
    panel.focus();
  }

  function initCard(cardRoot) {
    var handle = cardRoot.getAttribute("data-product-handle");
    if (!handle) return;
    appUrl = (cardRoot.getAttribute("data-app-url") || "https://naia-stylist.vercel.app").replace(/\/$/, "");

    fetch("/apps/naia-stylist/api/nadine-product-intelligence?handle=" + encodeURIComponent(handle))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.devTryOnEnabled || !data.tryOnEligible) return;
        data.productHandle = handle;

        var btn = document.createElement("button");
        btn.className = "naia-cc-tryon-btn";
        btn.setAttribute("aria-label", "Virtual try-on for " + handle);
        btn.innerHTML =
          '<span class="naia-cc-tryon-label">Try It On Me</span>' +
          '<span class="naia-cc-tryon-sub">Dev preview</span>';
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          openTryOnPanel(data);
        });
        cardRoot.appendChild(btn);
      })
      .catch(function () {});
  }

  for (var i = 0; i < allRoots.length; i++) {
    initCard(allRoots[i]);
  }

  function esc(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
