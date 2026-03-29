import { useEffect, useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  let admin;

try {
  const auth = await authenticate.admin(request);
  admin = auth.admin;
} catch (e) {
  return { products: [] };
}

  const response = await admin.graphql(`
    #graphql
    query GetNaiaProducts {
      products(first: 20, query: "status:active") {
        edges {
          node {
            id
            title
            handle
            productType
            tags
            featuredImage {
              url
              altText
            }
          }
        }
      }
    }
  `);

  const data = await response.json();

  const products =
    data?.data?.products?.edges?.map(({ node }) => ({
      id: node.id,
      name: node.title,
      handle: node.handle,
      category: mapProductCategory(node),
      image:
        node.featuredImage?.url ||
        "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
      altText: node.featuredImage?.altText || node.title,
      tags: (node.tags || []).map((tag) => tag.toLowerCase()),
      productType: (node.productType || "").toLowerCase(),
    })) || [];

  return { products };
}

function mapProductCategory(product) {
  const text = [
    product.title || "",
    product.productType || "",
    ...(product.tags || []),
  ]
    .join(" ")
    .toLowerCase();

  if (
    text.includes("blazer") ||
    text.includes("jacket") ||
    text.includes("coat") ||
    text.includes("outerwear")
  ) {
    return "outerwear";
  }

  if (
    text.includes("skirt") ||
    text.includes("pant") ||
    text.includes("trouser") ||
    text.includes("jean") ||
    text.includes("bottom")
  ) {
    return "bottom";
  }

  if (text.includes("dress")) {
    return "dress";
  }

  return "top";
}

function parseStylingResult(text) {
  if (!text) return null;

  const sections = {
    feelingNow: "",
    feelingNext: "",
    outfitDirection: [],
    whyThisWorks: [],
    shift: "",
    fallback: "",
  };

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let currentSection = "";

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.startsWith("you’re feeling:") || lower.startsWith("you're feeling:")) {
      sections.feelingNow = line.split(":").slice(1).join(":").trim();
      currentSection = "";
      continue;
    }

    if (lower.startsWith("you want to feel:")) {
      sections.feelingNext = line.split(":").slice(1).join(":").trim();
      currentSection = "";
      continue;
    }

    if (lower === "your outfit direction") {
      currentSection = "outfitDirection";
      continue;
    }

    if (lower === "why this works") {
      currentSection = "whyThisWorks";
      continue;
    }

   if (
  lower === "shift" ||
  lower === "shift:" ||
  lower.startsWith("shift:")
) {
  currentSection = "shift";

  const afterColon = line.split(":").slice(1).join(":").trim();
  if (afterColon) {
    sections.shift = afterColon;
  }

  continue;
}

    if (line.startsWith("-")) {
      const cleaned = line.replace(/^-+\s*/, "").trim();
      if (currentSection === "outfitDirection") {
        sections.outfitDirection.push(cleaned);
      } else if (currentSection === "whyThisWorks") {
        sections.whyThisWorks.push(cleaned);
      }
      continue;
    }

    if (currentSection === "shift") {
      sections.shift = sections.shift ? `${sections.shift} ${line}` : line;
      continue;
    }

    sections.fallback += `${sections.fallback ? "\n" : ""}${line}`;
  }

  return sections;
}

function getFeelingKeywordMap() {
  return {
    calm: ["soft", "fluid", "drape", "ease", "gentle", "minimal", "ivory", "cream"],
    grounded: ["tailored", "structured", "clean", "neutral", "balanced", "black", "brown", "trouser", "blazer"],
    powerful: ["sculpt", "corset", "structured", "sharp", "tailored", "blazer", "black", "statement"],
    clear: ["clean", "minimal", "sharp", "tailored", "crisp", "sleek"],
    soft: ["drape", "soft", "fluid", "skirt", "ivory", "cream", "romantic"],
    bold: ["statement", "contrast", "sculpt", "sharp", "dramatic", "black"],
    feminine: ["soft", "drape", "skirt", "ivory", "silk", "romantic"],
    confident: ["tailored", "structured", "corset", "blazer", "sharp", "black"],
  };
}

function getEventKeywordMap() {
  return {
    casual: ["soft", "minimal", "ease", "relaxed"],
    dinner: ["sleek", "tailored", "drape", "elevated"],
    party: ["statement", "bold", "dramatic", "sculpt"],
    formal: ["tailored", "structured", "clean", "elegant"],
    wedding: ["soft", "elegant", "romantic", "fluid"],
  };
}

function getCompatibleCategories(category) {
  if (category === "top") return ["bottom", "outerwear"];
  if (category === "bottom") return ["top", "outerwear"];
  if (category === "outerwear") return ["top", "bottom", "dress"];
  if (category === "dress") return ["outerwear"];
  return ["top", "bottom", "outerwear", "dress"];
}

function scoreProduct(product, closetItem, mood, feeling, eventType) {
  let score = 0;
  const categoryMatches = getCompatibleCategories(closetItem.category);
  const productText = `${product.name} ${product.productType} ${product.tags.join(" ")}`.toLowerCase();
  const moodText = (mood || "").toLowerCase();
  const feelingText = (feeling || "").toLowerCase();
  const eventText = (eventType || "").toLowerCase();
  const keywordMap = getFeelingKeywordMap();
  const eventKeywordMap = getEventKeywordMap();

  if (categoryMatches.includes(product.category)) {
    score += 5;
  }

  if (product.category === closetItem.category && closetItem.category !== "dress") {
    score -= 2;
  }

  const desiredKeywords = keywordMap[feelingText] || [];
  desiredKeywords.forEach((keyword) => {
    if (productText.includes(keyword)) score += 2;
  });

  const currentMoodKeywords = keywordMap[moodText] || [];
  currentMoodKeywords.forEach((keyword) => {
    if (productText.includes(keyword)) score += 1;
  });

  const eventKeywords = eventKeywordMap[eventText] || [];
  eventKeywords.forEach((keyword) => {
    if (productText.includes(keyword)) score += 2;
  });

  if (closetItem.category === "bottom" && product.category === "top") score += 2;
  if (closetItem.category === "top" && product.category === "bottom") score += 2;
  if (closetItem.category === "top" && product.category === "outerwear") score += 1;
  if (closetItem.category === "bottom" && product.category === "outerwear") score += 1;
  if (closetItem.category === "dress" && product.category === "outerwear") score += 3;

  if (productText.includes("blazer") && ["grounded", "powerful", "confident", "clear"].includes(feelingText)) {
    score += 3;
  }

  if (
    (productText.includes("skirt") || productText.includes("drape")) &&
    ["soft", "calm", "feminine"].includes(feelingText)
  ) {
    score += 3;
  }

  if (
    (productText.includes("corset") || productText.includes("sculpt")) &&
    ["powerful", "confident", "bold"].includes(feelingText)
  ) {
    score += 3;
  }

  if (eventText === "party" && (productText.includes("statement") || productText.includes("dramatic"))) {
    score += 3;
  }

  if (eventText === "formal" && (productText.includes("tailored") || productText.includes("structured"))) {
    score += 3;
  }

  if (eventText === "wedding" && (productText.includes("soft") || productText.includes("romantic") || productText.includes("elegant"))) {
    score += 3;
  }

  if (eventText === "dinner" && (productText.includes("sleek") || productText.includes("elevated") || productText.includes("drape"))) {
    score += 3;
  }
if (eventText === "casual") {
  if (product.tags.includes("event_casual")) score += 6;
  else score -= 3;
}

if (eventText === "dinner") {
  if (product.tags.includes("event_dinner")) score += 6;
}

if (eventText === "party") {
  if (product.tags.includes("event_party")) score += 6;
}

if (eventText === "formal") {
  if (product.tags.includes("event_formal")) score += 6;
}

if (eventText === "wedding") {
  if (product.tags.includes("event_wedding")) score += 6;
}
  return score;
}

export default function Index() {
  const params =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : null;

const imageFromStore = params?.get("image");

  const storefrontProduct =
    typeof window !== "undefined" ? window.naiaProduct : null;

  const data = useLoaderData() || {};
  const loaderProducts = data.products || [];

  const products =
    storefrontProduct
      ? [
          {
            id: storefrontProduct.id,
            name: storefrontProduct.title,
            image: storefrontProduct.image,
            category: storefrontProduct.type?.toLowerCase() || "top",
            tags: storefrontProduct.tags || [],
          },
        ]
      : loaderProducts;

  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("top");
  const [itemImage, setItemImage] = useState("");
  const [closet, setCloset] = useState([]);
  const [stylingResult, setStylingResult] = useState("");
  const [selectedNaiaPiece, setSelectedNaiaPiece] = useState(null);
  const [selectedClosetItemId, setSelectedClosetItemId] = useState(null);
  const [mood, setMood] = useState("");
  const [feeling, setFeeling] = useState("");
  const [event, setEvent] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedCloset = localStorage.getItem("naia-closet-v5");
    if (savedCloset) {
      setCloset(JSON.parse(savedCloset));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("naia-closet-v5", JSON.stringify(closet));
  }, [closet]);

  const selectedClosetItem = useMemo(() => {
    return closet.find((item) => item.id === selectedClosetItemId) || null;
  }, [closet, selectedClosetItemId]);

  const parsedResult = useMemo(() => parseStylingResult(stylingResult), [stylingResult]);

  const rankedProducts = useMemo(() => {
    if (!selectedClosetItem) return [];

    return [...products]
      .map((product) => ({
        ...product,
        recommendationScore: scoreProduct(product, selectedClosetItem, mood, feeling, event),
      }))
      .sort((a, b) => b.recommendationScore - a.recommendationScore);
  }, [products, selectedClosetItem, mood, feeling, event]);

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setItemImage(previewUrl);
  };

  const addItem = () => {
    if (!itemName.trim()) return;

    const newItem = {
      id: Date.now(),
      name: itemName,
      category: itemCategory,
      image:
        itemImage ||
        "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
    };

    setCloset([...closet, newItem]);
    setItemName("");
    setItemCategory("top");
    setItemImage("");
  };

  const removeItem = (id) => {
    if (selectedClosetItemId === id) {
      setSelectedClosetItemId(null);
    }
    setCloset(closet.filter((item) => item.id !== id));
  };

  const callAI = async ({
    mode,
    outfit,
    closetItem,
    naiaPiece,
    recommendedPieces = [],
  }) => {
    setLoading(true);
    setStylingResult("");

    try {
      const res = await fetch("/api/style", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
          outfit,
          mood,
          feeling,
          event,
          closetItem,
          naiaPiece,
          recommendedPieces,
          closet: closet.map((item) => ({
            name: item.name,
            category: item.category,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStylingResult(data.error || data.result || "Something went wrong.");
        setLoading(false);
        return;
      }

      setStylingResult(data.result);
    } catch (err) {
      setStylingResult("Something went wrong. Check the terminal for the exact error.");
    }

    setLoading(false);
  };

  const styleCloset = () => {
    if (closet.length === 0) {
      setStylingResult("Add some closet items first.");
      return;
    }

    const chosenItem = selectedClosetItem || closet[0];
    const pairingItem =
      closet.find((item) => item.id !== chosenItem.id && item.category !== chosenItem.category) ||
      closet.find((item) => item.id !== chosenItem.id) ||
      null;

    const outfit = pairingItem
      ? `${chosenItem.name} from your closet paired with ${pairingItem.name} from your closet`
      : `${chosenItem.name} from your closet`;

    callAI({
      mode: "closet",
      outfit,
      closetItem: chosenItem,
      naiaPiece: null,
    });
  };

  const styleWithNaiaPiece = () => {
    if (!selectedClosetItem) {
      setStylingResult("Choose a closet piece first.");
      return;
    }

    if (!selectedNaiaPiece) {
      setStylingResult("Choose a nAia piece first.");
      return;
    }

    const outfit = `${selectedClosetItem.name} from your closet paired with ${selectedNaiaPiece.name} from nAia`;

    callAI({
      mode: "selected_naia_piece",
      outfit,
      closetItem: selectedClosetItem,
      naiaPiece: selectedNaiaPiece,
    });
  };

  const recommendNaiaPieces = () => {
    if (!selectedClosetItem) {
      setStylingResult("Choose a closet piece first so nAia can recommend the best match.");
      return;
    }

    if (rankedProducts.length === 0) {
      setStylingResult("No matching nAia pieces found for that closet item.");
      return;
    }

    const topThree = rankedProducts.slice(0, 3);
    const bestMatch = topThree[0];
    setSelectedNaiaPiece(bestMatch);

    const outfit = `${selectedClosetItem.name} from your closet paired with ${bestMatch.name} from nAia`;

    callAI({
      mode: "recommend_naia_pieces",
      outfit,
      closetItem: selectedClosetItem,
      naiaPiece: bestMatch,
      recommendedPieces: topThree.map((piece) => piece.name),
    });
  };

  const pageStyle = {
    minHeight: "100vh",
    background: "#f6f3ef",
    color: "#1d1b19",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: "40px 24px 80px",
  };

  const containerStyle = {
    maxWidth: "1200px",
    margin: "0 auto",
  };

  const heroStyle = {
    display: "grid",
    gridTemplateColumns: "1.1fr 0.9fr",
    gap: "24px",
    alignItems: "stretch",
    marginBottom: "28px",
  };

  const heroCardStyle = {
    background: "linear-gradient(145deg, #f8f5f1 0%, #efe8df 100%)",
    border: "1px solid #e6ddd2",
    borderRadius: "28px",
    padding: "34px",
    boxShadow: "0 10px 30px rgba(62, 39, 22, 0.06)",
  };

  const heroAsideStyle = {
    background: "#ece6dd",
    border: "1px solid #e0d6c8",
    borderRadius: "28px",
    padding: "28px",
    boxShadow: "0 10px 30px rgba(62, 39, 22, 0.04)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  };

  const eyebrowStyle = {
    fontSize: "12px",
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: "#7b6f63",
    marginBottom: "16px",
    fontWeight: 600,
  };

  const heroTitleStyle = {
    fontSize: "56px",
    lineHeight: 1,
    letterSpacing: "-0.04em",
    margin: "0 0 18px 0",
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: 600,
  };

  const heroTextStyle = {
    fontSize: "18px",
    lineHeight: 1.7,
    color: "#5b5148",
    margin: 0,
    maxWidth: "92%",
  };

  const asideTitleStyle = {
    fontSize: "20px",
    lineHeight: 1.3,
    margin: "0 0 12px 0",
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: 600,
  };

  const asideTextStyle = {
    fontSize: "15px",
    lineHeight: 1.8,
    color: "#5b5148",
    margin: 0,
  };

  const cardStyle = {
    background: "#fbf9f6",
    border: "1px solid #e7dfd5",
    borderRadius: "24px",
    padding: "28px",
    boxShadow: "0 8px 24px rgba(62, 39, 22, 0.04)",
  };

  const sectionTitleStyle = {
    fontSize: "28px",
    lineHeight: 1.1,
    margin: "0 0 8px 0",
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: 600,
  };

  const sectionSubtitleStyle = {
    fontSize: "15px",
    lineHeight: 1.7,
    color: "#6a6159",
    margin: "0 0 20px 0",
  };

  const labelStyle = {
    display: "block",
    marginBottom: "8px",
    fontWeight: 600,
    fontSize: "14px",
    color: "#3d342d",
  };

  const inputStyle = {
    width: "100%",
    padding: "14px 16px",
    borderRadius: "14px",
    border: "1px solid #d8cfc4",
    background: "#fffdfb",
    fontSize: "16px",
    color: "#1d1b19",
    outline: "none",
    boxSizing: "border-box",
  };

  const primaryButtonStyle = {
    padding: "13px 18px",
    borderRadius: "999px",
    border: "none",
    background: "#1d1b19",
    color: "#f7f3ef",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 600,
  };

  const secondaryButtonStyle = {
    padding: "13px 18px",
    borderRadius: "999px",
    border: "1px solid #cdbfb0",
    background: "#fffdfb",
    color: "#3d342d",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 600,
  };

  const selectedButtonStyle = {
    ...secondaryButtonStyle,
    background: "#1d1b19",
    color: "#f7f3ef",
    border: "1px solid #1d1b19",
  };

  const uploaderStyle = {
    border: "1px dashed #d9cfc3",
    borderRadius: "18px",
    background: "#fcfaf7",
    padding: "18px",
    marginBottom: "14px",
  };

  const closetGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "14px",
    marginTop: "18px",
  };

  const closetCardStyle = {
    borderRadius: "18px",
    overflow: "hidden",
    background: "#f4eee7",
    border: "1px solid #e6ddd2",
  };

  const closetImageStyle = {
    width: "100%",
    height: "190px",
    objectFit: "cover",
    display: "block",
  };

  const closetInfoStyle = {
    padding: "14px",
  };

  const productGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "16px",
  };

  const productCardStyle = {
    borderRadius: "20px",
    overflow: "hidden",
    background: "#f8f4ee",
    border: "1px solid #e4dacd",
    cursor: "pointer",
  };

  const productImageStyle = {
    width: "100%",
    height: "220px",
    objectFit: "cover",
    display: "block",
  };

  const productBodyStyle = {
    padding: "14px",
  };

  const chipStyle = {
    display: "inline-block",
    padding: "6px 12px",
    borderRadius: "999px",
    background: "#efe6db",
    color: "#6a5d50",
    fontSize: "12px",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    fontWeight: 600,
    marginBottom: "14px",
  };

  const resultWrapStyle = {
    marginTop: "24px",
    display: "grid",
    gridTemplateColumns: "0.9fr 1.1fr",
    gap: "24px",
    alignItems: "start",
  };

  const resultCardStyle = {
    background: "linear-gradient(180deg, #f9f6f2 0%, #f2ece4 100%)",
    border: "1px solid #e5dccf",
    borderRadius: "28px",
    padding: "28px",
    boxShadow: "0 12px 32px rgba(62, 39, 22, 0.05)",
  };

  const miniCardStyle = {
    background: "#fbf9f6",
    border: "1px solid #e7dfd5",
    borderRadius: "22px",
    padding: "22px",
    boxShadow: "0 8px 24px rgba(62, 39, 22, 0.04)",
  };

  const resultTitleStyle = {
    fontSize: "12px",
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: "#7b6f63",
    marginBottom: "14px",
    fontWeight: 600,
  };

  const bigValueStyle = {
    fontSize: "26px",
    lineHeight: 1.25,
    margin: 0,
    fontFamily: 'Georgia, "Times New Roman", serif',
    color: "#2b2622",
  };

  const bulletListStyle = {
    margin: 0,
    paddingLeft: "18px",
    color: "#3d342d",
    lineHeight: 1.9,
    fontSize: "16px",
  };

  const shiftStyle = {
    margin: 0,
    fontSize: "18px",
    lineHeight: 1.8,
    color: "#2b2622",
    fontFamily: 'Georgia, "Times New Roman", serif',
  };

  const fallbackTextStyle = {
    margin: 0,
    fontSize: "18px",
    lineHeight: 1.9,
    color: "#2b2622",
    whiteSpace: "pre-line",
    fontFamily: 'Georgia, "Times New Roman", serif',
  };

  const shopLinkStyle = {
    ...primaryButtonStyle,
    display: "inline-block",
    textDecoration: "none",
    textAlign: "center",
    marginTop: "12px",
  };

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <div style={heroStyle}>
          <div style={heroCardStyle}>
            <div style={eyebrowStyle}>nAia Stylist</div>
            <h1 style={heroTitleStyle}>Dress for how you need to feel.</h1>
            <p style={heroTextStyle}>
              The recommendation engine now ranks real nAia products by compatibility,
              emotional direction, category fit, and event context.
            </p>
          </div>

          <div style={heroAsideStyle}>
            <div>
              <div style={chipStyle}>Recommendation engine</div>
              <h2 style={asideTitleStyle}>Category + mood + desired feeling + event.</h2>
              <p style={asideTextStyle}>
                Products are scored based on the selected closet item, emotional direction,
                and occasion, then the best real Shopify product is chosen first.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div style={cardStyle}>
            <h2 style={sectionTitleStyle}>My Closet</h2>
            <p style={sectionSubtitleStyle}>
              Add a closet piece, then choose the exact item you want nAia to style around.
            </p>

            <label style={labelStyle}>Piece name</label>
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. black blazer"
              style={{ ...inputStyle, marginBottom: "14px" }}
            />

            <label style={labelStyle}>Category</label>
            <select
              value={itemCategory}
              onChange={(e) => setItemCategory(e.target.value)}
              style={{ ...inputStyle, marginBottom: "14px" }}
            >
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="outerwear">Outerwear</option>
              <option value="dress">Dress</option>
            </select>

            <div style={uploaderStyle}>
              <label style={labelStyle}>Upload image</label>
              <input type="file" accept="image/*" onChange={handleImageUpload} />
            </div>

            <button onClick={addItem} style={primaryButtonStyle}>
              Add to Closet
            </button>

            <div style={closetGridStyle}>
              {closet.map((piece) => {
                const isSelected = selectedClosetItemId === piece.id;

                return (
                  <div key={piece.id} style={closetCardStyle}>
                    <img
  src={piece.image || imageFromStore || "https://via.placeholder.com/300"}
  alt={piece.name}
  style={closetImageStyle}
/>
                    <div style={closetInfoStyle}>
                      <div style={{ fontWeight: 600, marginBottom: "6px" }}>{piece.name}</div>
                      <div style={{ color: "#74695f", fontSize: "14px", marginBottom: "10px" }}>
                        {piece.category}
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          onClick={() => setSelectedClosetItemId(piece.id)}
                          style={isSelected ? selectedButtonStyle : secondaryButtonStyle}
                        >
                          {isSelected ? "Selected" : "Choose item"}
                        </button>
                        <button onClick={() => removeItem(piece.id)} style={secondaryButtonStyle}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={sectionTitleStyle}>Mood + Direction</h2>
            <p style={sectionSubtitleStyle}>
              Tell nAia how the customer feels now, how the outfit should shift them,
              and what kind of event they are dressing for.
            </p>

            <label style={labelStyle}>How are you feeling right now?</label>
            <input
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              placeholder="e.g. overwhelmed, sad, tired"
              style={{ ...inputStyle, marginBottom: "18px" }}
            />

            <label style={labelStyle}>How do you want to feel?</label>
            <input
              value={feeling}
              onChange={(e) => setFeeling(e.target.value)}
              placeholder="e.g. calm, clear, powerful"
              style={{ ...inputStyle, marginBottom: "18px" }}
            />

            <label style={labelStyle}>Event</label>
            <select
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select event</option>
              <option value="casual">Casual</option>
              <option value="dinner">Dinner</option>
              <option value="party">Party</option>
              <option value="formal">Formal</option>
              <option value="wedding">Wedding</option>
            </select>
          </div>
        </div>

        <div style={{ ...cardStyle, marginTop: "24px" }}>
          <h2 style={sectionTitleStyle}>nAia Pieces</h2>
          <p style={sectionSubtitleStyle}>
            These are real Shopify products. The recommender now ranks them before choosing.
          </p>

          <div style={productGridStyle}>
            {rankedProducts.length > 0
              ? rankedProducts.slice(0, 8).map((product) => {
                  const isSelected = selectedNaiaPiece?.id === product.id;

                  return (
                    <div
                      key={product.id}
                      style={{
                        ...productCardStyle,
                        boxShadow: isSelected ? "0 0 0 2px #1d1b19 inset" : "none",
                      }}
                      onClick={() => setSelectedNaiaPiece(product)}
                    >
                      <img src={product.image} alt={product.altText} style={productImageStyle} />
                      <div style={productBodyStyle}>
                        <div style={{ fontWeight: 600, marginBottom: "6px" }}>{product.name}</div>
                        <div style={{ color: "#74695f", fontSize: "14px", marginBottom: "8px" }}>
                          {product.category}
                        </div>
                        <div style={{ color: "#8a7e73", fontSize: "13px", marginBottom: "12px" }}>
                          Match score: {product.recommendationScore}
                        </div>
                        <button style={isSelected ? selectedButtonStyle : secondaryButtonStyle}>
                          {isSelected ? "Selected" : "Choose piece"}
                        </button>
                      </div>
                    </div>
                  );
                })
              : products.map((product) => {
                  const isSelected = selectedNaiaPiece?.id === product.id;

                  return (
                    <div
                      key={product.id}
                      style={{
                        ...productCardStyle,
                        boxShadow: isSelected ? "0 0 0 2px #1d1b19 inset" : "none",
                      }}
                      onClick={() => setSelectedNaiaPiece(product)}
                    >
                      <img src={product.image} alt={product.altText} style={productImageStyle} />
                      <div style={productBodyStyle}>
                        <div style={{ fontWeight: 600, marginBottom: "6px" }}>{product.name}</div>
                        <div style={{ color: "#74695f", fontSize: "14px", marginBottom: "12px" }}>
                          {product.category}
                        </div>
                        <button style={isSelected ? selectedButtonStyle : secondaryButtonStyle}>
                          {isSelected ? "Selected" : "Choose piece"}
                        </button>
                      </div>
                    </div>
                  );
                })}
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "24px" }}>
            <button onClick={styleCloset} style={primaryButtonStyle}>
              Style Selected Closet Piece
            </button>
            <button onClick={styleWithNaiaPiece} style={secondaryButtonStyle}>
              Style with Selected nAia Piece
            </button>
            <button onClick={recommendNaiaPieces} style={secondaryButtonStyle}>
              Recommend Matching nAia Piece
            </button>
          </div>
        </div>

        <div style={resultWrapStyle}>
          <div style={miniCardStyle}>
            <div style={resultTitleStyle}>Selected Pieces</div>
            <div style={{ marginBottom: "18px" }}>
              <div
                style={{
                  color: "#7b6f63",
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  marginBottom: "8px",
                }}
              >
                Closet
              </div>
              <p style={{ margin: 0, fontSize: "18px", lineHeight: 1.6 }}>
                {selectedClosetItem ? selectedClosetItem.name : "No closet piece selected"}
              </p>
            </div>
            <div style={{ marginBottom: "18px" }}>
              <div
                style={{
                  color: "#7b6f63",
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  marginBottom: "8px",
                }}
              >
                nAia
              </div>
              <p style={{ margin: 0, fontSize: "18px", lineHeight: 1.6 }}>
                {selectedNaiaPiece ? selectedNaiaPiece.name : "No nAia piece selected"}
              </p>

              {selectedNaiaPiece?.handle ? (
                <a
                  href={`/products/${selectedNaiaPiece.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  style={shopLinkStyle}
                >
                  Shop this nAia piece
                </a>
              ) : null}
            </div>

            <div>
              <div
                style={{
                  color: "#7b6f63",
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  marginBottom: "8px",
                }}
              >
                Event
              </div>
              <p style={{ margin: 0, fontSize: "18px", lineHeight: 1.6 }}>
                {event || "No event selected"}
              </p>
            </div>
          </div>

          <div style={resultCardStyle}>
            <div style={resultTitleStyle}>Stylist Note</div>

            {loading ? (
              <p style={fallbackTextStyle}>Styling your look...</p>
            ) : !stylingResult ? (
              <p style={fallbackTextStyle}>
                Choose a closet item first, then style it with nAia or ask for the best matching recommendation.
              </p>
            ) : parsedResult &&
              (parsedResult.feelingNow ||
                parsedResult.feelingNext ||
                parsedResult.outfitDirection.length > 0 ||
                parsedResult.whyThisWorks.length > 0 ||
                parsedResult.shift) ? (
              <div style={{ display: "grid", gap: "16px" }}>
                <div style={miniCardStyle}>
                  <div style={resultTitleStyle}>You’re feeling</div>
                  <p style={bigValueStyle}>{parsedResult.feelingNow || "Not specified"}</p>
                </div>

                <div style={miniCardStyle}>
                  <div style={resultTitleStyle}>You want to feel</div>
                  <p style={bigValueStyle}>{parsedResult.feelingNext || "Not specified"}</p>
                </div>

                <div style={miniCardStyle}>
                  <div style={resultTitleStyle}>Your outfit direction</div>
                  <ul style={bulletListStyle}>
                    {parsedResult.outfitDirection.length > 0 ? (
                      parsedResult.outfitDirection.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))
                    ) : (
                      <li>No outfit direction returned.</li>
                    )}
                  </ul>
                </div>

                <div style={miniCardStyle}>
                  <div style={resultTitleStyle}>Why this works</div>
                  <ul style={bulletListStyle}>
                    {parsedResult.whyThisWorks.length > 0 ? (
                      parsedResult.whyThisWorks.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))
                    ) : (
                      <li>No explanation returned.</li>
                    )}
                  </ul>
                </div>

                <div style={miniCardStyle}>
                  <div style={resultTitleStyle}>Shift</div>
                  <p style={shiftStyle}>{parsedResult.shift || "No shift returned."}</p>
                </div>
              </div>
            ) : (
              <p style={fallbackTextStyle}>{stylingResult}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}