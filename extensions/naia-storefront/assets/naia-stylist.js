(function () {
  const root = document.getElementById("naia-stylist-root");
  if (!root) return;

  const image = encodeURIComponent(root.getAttribute("data-product-image") || "");
  const title = encodeURIComponent(root.getAttribute("data-product-title") || "");
  const id = root.getAttribute("data-product-id") || "";
  const type = encodeURIComponent(root.getAttribute("data-product-type") || "");

  const iframe = document.createElement("iframe");
  iframe.src = `https://souls-accidents-anyway-bodies.trycloudflare.com/stylist?product_image=${image}&product_title=${title}&product_id=${id}&product_type=${type}`;

  iframe.style.width = "100%";
  iframe.style.height = "900px";
  iframe.style.border = "none";
  iframe.style.borderRadius = "16px";

  root.appendChild(iframe);
})();