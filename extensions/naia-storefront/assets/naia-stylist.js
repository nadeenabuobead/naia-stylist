(function () {
  if (window.location.pathname.includes('/pages/stylist')) return;

  const root = document.getElementById("naia-stylist-root");
  if (!root) return;

  const rawImage = root.getAttribute("data-product-image") || "";
  const title = encodeURIComponent(root.getAttribute("data-product-title") || "");
  const id = root.getAttribute("data-product-id") || "";
  const type = encodeURIComponent(root.getAttribute("data-product-type") || "");

  const baseUrl = "https://naia-stylist.vercel.app/stylist";
  
  // Only pass product data if we have a real image URL
  const isValidImage = rawImage.startsWith("http") || rawImage.startsWith("//");
  const image = encodeURIComponent(rawImage);
  
  const stylistUrl = isValidImage
    ? `${baseUrl}?product_image=${image}&product_title=${title}&product_id=${id}&product_type=${type}`
    : baseUrl;

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