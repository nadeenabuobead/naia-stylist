(function () {
  if (window.location.pathname.includes('/pages/stylist')) return;

  const root = document.getElementById("naia-stylist-root");
  if (!root) return;

  const rawImage = root.getAttribute("data-product-image") || "";
  const title = encodeURIComponent(root.getAttribute("data-product-title") || "");
  const id = root.getAttribute("data-product-id") || "";
  const type = encodeURIComponent(root.getAttribute("data-product-type") || "");
  const stylingNotes = encodeURIComponent(root.getAttribute("data-styling-notes") || "");
  const moodMatch = encodeURIComponent(root.getAttribute("data-mood-match") || "");
  const stylingRole = encodeURIComponent(root.getAttribute("data-styling-role") || "");
  const statementLevel = encodeURIComponent(root.getAttribute("data-statement-level") || "");
  const occasion = encodeURIComponent(root.getAttribute("data-occasion") || "");
  const sihouette = encodeURIComponent(root.getAttribute("data-sihouette") || "");

  const APP_URL = "https://naia-stylist.vercel.app";
  const baseUrl = APP_URL + "/stylist";
  
  const isValidImage = rawImage.startsWith("http") || rawImage.startsWith("//");
  const image = encodeURIComponent(rawImage);
  
  var stylistUrl = isValidImage
    ? baseUrl + "?product_image=" + image + "&product_title=" + title + "&product_id=" + id + "&product_type=" + type + "&styling_notes=" + stylingNotes + "&mood_match=" + moodMatch + "&styling_role=" + stylingRole + "&statement_level=" + statementLevel + "&occasion=" + occasion + "&sihouette=" + sihouette
    : baseUrl;

  // ─── Detect logged-in Shopify customer ───
  function getShopifyCustomer() {
    var meta = document.querySelector('meta[name="naia-customer"]');
    if (meta) {
      try { return JSON.parse(meta.getAttribute("content")); } catch (e) {}
    }
    if (window.__st && window.__st.cid) {
      return { id: window.__st.cid };
    }
    return null;
  }

  function authenticateAndRedirect() {
    var customer = getShopifyCustomer();
    
    if (customer && customer.id) {
      fetch(APP_URL + "/api/customer-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyId: String(customer.id),
          email: customer.email || "",
          firstName: customer.firstName || "",
          lastName: customer.lastName || "",
          timestamp: String(Date.now()),
        }),
      })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (data && data.token) {
            var sep = stylistUrl.includes("?") ? "&" : "?";
            stylistUrl += sep + "naia_token=" + encodeURIComponent(data.token);
          }
          window.location.href = stylistUrl;
        })
        .catch(function () {
          window.location.href = stylistUrl;
        });
    } else {
      window.location.href = stylistUrl;
    }
  }

  var button = document.createElement("a");
  button.href = "#";
  button.innerText = "Ask nAia";
  button.style.cssText = "position:fixed;bottom:28px;right:28px;background:#1d1b19;color:#fff;padding:14px 24px;border-radius:999px;font-size:15px;font-weight:600;text-decoration:none;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.2);font-family:Inter,sans-serif;cursor:pointer;";

  button.addEventListener("click", function (e) {
    e.preventDefault();
    authenticateAndRedirect();
  });

  document.body.appendChild(button);
})();
