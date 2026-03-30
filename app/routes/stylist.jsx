import { useEffect, useMemo, useState } from "react";

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

    if (lower === "shift" || lower === "shift:" || lower.startsWith("shift:")) {
      currentSection = "shift";
      const afterColon = line.split(":").slice(1).join(":").trim();
      if (afterColon) sections.shift = afterColon;
      continue;
    }

    if (line.startsWith("-")) {
      const cleaned = line.replace(/^-+\s*/, "").trim();
      if (currentSection === "outfitDirection") sections.outfitDirection.push(cleaned);
      if (currentSection === "whyThisWorks") sections.whyThisWorks.push(cleaned);
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
function getStorefrontPiece() {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);

  let image = params.get("product_image") || "";
  let title = params.get("product_title") || "";
  let id = params.get("product_id") || "";
  let type = params.get("product_type") || "";
  let stylingNotes = params.get("styling_notes") || "";
  let moodMatch = params.get("mood_match") || "";
  let stylingRole = params.get("styling_role") || "";
  let statementLevel = params.get("statement_level") || "";
  let occasion = params.get("occasion") || "";
  let sihouette = params.get("sihouette") || "";

  try { image = decodeURIComponent(image); } catch {}
  try { title = decodeURIComponent(title); } catch {}
  try { type = decodeURIComponent(type); } catch {}
  try { stylingNotes = decodeURIComponent(stylingNotes); } catch {}
  try { moodMatch = decodeURIComponent(moodMatch); } catch {}
  try { stylingRole = decodeURIComponent(stylingRole); } catch {}
  try { statementLevel = decodeURIComponent(statementLevel); } catch {}
  try { occasion = decodeURIComponent(occasion); } catch {}
  try { sihouette = decodeURIComponent(sihouette); } catch {}

  if (image.startsWith("//")) image = "https:" + image;
  if (image && !image.startsWith("http")) image = "https://" + image;

  if (!image || !image.startsWith("http")) return null;

  return {
    id: id || "storefront-piece",
    name: title || "Selected nAia Piece",
    image,
    altText: title || "Selected nAia Piece",
    category: type || "",
    stylingNotes,
    moodMatch,
    stylingRole,
    statementLevel,
    occasion,
    sihouette,
  };
}


export default function Stylist() {
  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("top");
  const [itemImage, setItemImage] = useState("");
  const [closet, setCloset] = useState([]);
  const [stylingResult, setStylingResult] = useState("");
  const [selectedClosetItemId, setSelectedClosetItemId] = useState(null);
  const [mood, setMood] = useState("");
  const [feeling, setFeeling] = useState("");
  const [event, setEvent] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentNaiaPiece, setCurrentNaiaPiece] = useState(null);

  useEffect(() => {
    const storefrontPiece = getStorefrontPiece();
    if (storefrontPiece) {
      setCurrentNaiaPiece(storefrontPiece);
    }
  }, []);

  useEffect(() => {
    const savedCloset = localStorage.getItem("naia-storefront-closet-v1");
    if (savedCloset) {
      try {
        setCloset(JSON.parse(savedCloset));
      } catch (e) {
        console.error("Failed to parse saved closet:", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("naia-storefront-closet-v1", JSON.stringify(closet));
  }, [closet]);

  const selectedClosetItem = useMemo(() => {
    return closet.find((item) => item.id === selectedClosetItemId) || null;
  }, [closet, selectedClosetItemId]);

  const parsedResult = useMemo(() => parseStylingResult(stylingResult), [stylingResult]);

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
      image: itemImage || "",
    };

    setCloset([...closet, newItem]);
    setItemName("");
    setItemCategory("top");
    setItemImage("");
  };

  const removeItem = (id) => {
    if (selectedClosetItemId === id) setSelectedClosetItemId(null);
    setCloset(closet.filter((item) => item.id !== id));
  };

  const callAI = async ({ outfit, closetItem, naiaPiece }) => {
    setLoading(true);
    setStylingResult("");

    try {
      const res = await fetch("/api/style", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "selected_naia_piece",
          outfit,
          mood,
          feeling,
          event,
          closetItem,
          naiaPiece,
          recommendedPieces: naiaPiece?.name ? [naiaPiece.name] : [],
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

  const styleWithCurrentNaiaPiece = () => {
    if (!currentNaiaPiece) {
      setStylingResult("No nAia piece was found from the storefront.");
      return;
    }

    if (!selectedClosetItem) {
      setStylingResult("Choose a closet piece first.");
      return;
    }

    const outfit = `${selectedClosetItem.name} from your closet paired with ${currentNaiaPiece.name} from nAia`;

    callAI({
      outfit,
      closetItem: selectedClosetItem,
      naiaPiece: currentNaiaPiece,
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
    background: "#eee7df",
  };

  const closetInfoStyle = {
    padding: "14px",
  };

  const productCardStyle = {
    borderRadius: "20px",
    overflow: "hidden",
    background: "#f8f4ee",
    border: "1px solid #e4dacd",
  };

  const productImageStyle = {
    width: "100%",
    height: "420px",
    objectFit: "cover",
    display: "block",
    background: "#eee7df",
  };

  const productBodyStyle = {
    padding: "14px",
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

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
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
                    {piece.image ? (
                      <img src={piece.image} alt={piece.name} style={closetImageStyle} />
                    ) : (
                      <div style={closetImageStyle} />
                    )}

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

        
            {currentNaiaPiece && (
  <div style={{ ...cardStyle, marginTop: "24px" }}>
    <h2 style={sectionTitleStyle}>Selected nAia Piece</h2>
    <p style={sectionSubtitleStyle}>The nAia piece you selected to style.</p>
    <div style={{ maxWidth: "380px" }}>
      <div style={productCardStyle}>
        {currentNaiaPiece?.image ? (
          <img
            src={currentNaiaPiece.image}
            alt={currentNaiaPiece.altText || "Selected nAia Piece"}
            style={productImageStyle}
          />
        ) : (
          <div style={productImageStyle} />
        )}

        <div style={productBodyStyle}>
          <div style={{ fontWeight: 600, marginBottom: "6px", fontSize: "18px" }}>
            {currentNaiaPiece?.name || "Selected nAia Piece"}
          </div>
          <div style={{ color: "#74695f", fontSize: "14px", marginBottom: "12px" }}>
            {currentNaiaPiece?.category || ""}
          </div>
          <button onClick={styleWithCurrentNaiaPiece} style={primaryButtonStyle}>
            Style this piece
          </button>
        </div>
      </div>
    </div>
  </div>
)}

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
                nAia
              </div>
              <p style={{ margin: 0, fontSize: "18px", lineHeight: 1.6 }}>
                {currentNaiaPiece?.name || "No storefront piece found"}
              </p>
            </div>
          </div>

          <div style={resultCardStyle}>
            <div style={resultTitleStyle}>Stylist Note</div>

            {loading ? (
              <p style={fallbackTextStyle}>Styling your look...</p>
            ) : !stylingResult ? (
              <p style={fallbackTextStyle}>
                Choose a closet item first, then click Style this piece.
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