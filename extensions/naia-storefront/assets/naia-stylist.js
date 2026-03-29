(function () {
  // Don't run on the stylist page
  if (window.location.pathname.includes('/pages/stylist')) return;

  // Only show on product pages
  if (!window.location.pathname.includes('/products/')) return;

  const root = document.getElementById("naia-stylist-root");
  if (!root) return;

  const image = encodeURIComponent(root.getAttribute("data-product-image") || "");
  const title = encodeURIComponent(root.getAttribute("data-product-title") || "");
  const id = root.getAttribute("data-product-id") || "";
  const type = encodeURIComponent(root.getAttribute("data-product-type") || "");

  const stylistUrl = `https://naia-stylist.vercel.app/stylist?product_image=${image}&product_title=${title}&product_id=${id}&product_type=${type}`;

  // Create floating button
  const button = document.createElement("a");
  button.href = stylistUrl;
  button.innerText = "Ask nAia";
  button.style.cssText = `
    position: fixed;
    bottom: 28px;
    right: 28px;
    background: #1d1b19;
    color: #fff;
    padding: 14px 24px;
    border-radius: 999px;
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
    z-index: 9999;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    font-family: Inter, sans-serif;
  `;

  document.body.appendChild(button);
})();