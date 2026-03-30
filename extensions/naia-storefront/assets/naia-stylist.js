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

  const baseUrl = "https://naia-stylist.vercel.app/stylist";
  
  const isValidImage = rawImage.startsWith("http") || rawImage.startsWith("//");
  const image = encodeURIComponent(rawImage);
  
  const stylistUrl = isValidImage
    ? `${baseUrl}?product_image=${image}&product_title=${title}&product_id=${id}&product_type=${type}&styling_notes=${stylingNotes}&mood_match=${moodMatch}&styling_role=${stylingRole}&statement_level=${statementLevel}&occasion=${occasion}&sihouette=${sihouette}`
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