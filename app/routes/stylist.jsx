import { useEffect, useMemo, useState } from "react";

const STYLE_WORDS = [
  "Minimal", "Bold", "Structured", "Fluid", "Editorial",
  "Romantic", "Sharp", "Earthy", "Monochrome", "Layered",
  "Sculptural", "Effortless", "Dramatic", "Refined", "Raw"
];

const BODY_PREFS = [
  "Highlight waist", "Elongate legs", "Balance shoulders",
  "Minimize volume", "Maximize volume", "No preference"
];

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
  try { stylingNotes = decodeURIComponent(stylingNotes); } catch {}
  try { moodMatch = decodeURIComponent(moodMatch); } catch {}
  try { stylingRole = decodeURIComponent(stylingRole); } catch {}
  try { statementLevel = decodeURIComponent(statementLevel); } catch {}
  try { occasion = decodeURIComponent(occasion); } catch {}
  try { sihouette = decodeURIComponent(sihouette); } catch {}
  if (image.startsWith("//")) image = "https:" + image;
  if (image && !image.startsWith("http")) image = "https://" + image;
  if (!image || !image.startsWith("http")) return null;
  return { id, name: title || "Selected nAia Piece", image, altText: title, category: type, stylingNotes, moodMatch, stylingRole, statementLevel, occasion, sihouette };
}

function parseStylingResult(text) {
  if (!text) return null;
  const sections = { feelingNow: "", feelingNext: "", outfitDirection: [], whyThisWorks: [], shift: "", fallback: "" };
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let currentSection = "";
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("you're feeling:") || lower.startsWith("you\u2019re feeling:")) {
      sections.feelingNow = line.split(":").slice(1).join(":").trim();
      currentSection = "";
      continue;
    }
    if (lower.startsWith("you want to feel:")) {
      sections.feelingNext = line.split(":").slice(1).join(":").trim();
      currentSection = "";
      continue;
    }
    if (lower === "your outfit direction") { currentSection = "outfitDirection"; continue; }
    if (lower === "why this works") { currentSection = "whyThisWorks"; continue; }
    if (lower === "shift" || lower.startsWith("shift:")) {
      currentSection = "shift";
      const a = line.split(":").slice(1).join(":").trim();
      if (a) sections.shift = a;
      continue;
    }
    if (line.startsWith("-")) {
      const c = line.replace(/^-+\s*/, "").trim();
      if (currentSection === "outfitDirection") sections.outfitDirection.push(c);
      if (currentSection === "whyThisWorks") sections.whyThisWorks.push(c);
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

export async function loader() {
  return null;
}

export default function Stylist() {
  const [step, setStep] = useState(1);
  const [mood, setMood] = useState("");
  const [feeling, setFeeling] = useState("");
  const [event, setEvent] = useState("");
  const [styleWords, setStyleWords] = useState([]);
  const [bodyPref, setBodyPref] = useState("");
  const [mode, setMode] = useState("");
  const [closet, setCloset] = useState([]);
  const [selectedClosetIds, setSelectedClosetIds] = useState([]);
  const [selectedNaiaPiece, setSelectedNaiaPiece] = useState(null);
  const [naiaProducts, setNaiaProducts] = useState([]);
  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("top");
  const [itemImage, setItemImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [stylingResult, setStylingResult] = useState("");
  const [currentNaiaPiece, setCurrentNaiaPiece] = useState(null);
  const [showAddItem, setShowAddItem] = useState(false);

  useEffect(() => {
    const piece = getStorefrontPiece();
    if (piece) setCurrentNaiaPiece(piece);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("naia-closet-v2");
    if (saved) { try { setCloset(JSON.parse(saved)); } catch {} }
  }, []);

  useEffect(() => {
    localStorage.setItem("naia-closet-v2", JSON.stringify(closet));
  }, [closet]);

  useEffect(() => {
    fetch("/api/naia-products")
      .then(r => r.json())
      .then(d => setNaiaProducts(d.products || []))
      .catch(() => {});
  }, []);

  const selectedClosetItems = useMemo(() =>
    closet.filter(i => selectedClosetIds.includes(i.id)), [closet, selectedClosetIds]);

  const parsedResult = useMemo(() => parseStylingResult(stylingResult), [stylingResult]);

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setItemImage(ev.target.result);
    reader.readAsDataURL(file);
  };

  const addItem = () => {
    if (!itemName.trim()) return;
    setCloset(prev => [...prev, { id: Date.now(), name: itemName, category: itemCategory, image: itemImage }]);
    setItemName("");
    setItemCategory("top");
    setItemImage("");
    setShowAddItem(false);
  };

  const toggleClosetItem = (id) => {
    setSelectedClosetIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleStyleWord = (word) => {
    setStyleWords(prev =>
      prev.includes(word) ? prev.filter(w => w !== word) : prev.length < 3 ? [...prev, word] : prev
    );
  };

  const callAI = async () => {
    setLoading(true);
    setStylingResult("");
    setStep(8);

    const naiaPiece = selectedNaiaPiece || currentNaiaPiece;
    const itemsToStyle = mode === "closet_only" ? closet : selectedClosetItems;
    const outfitParts = [
      ...itemsToStyle.map(i => i.name),
      naiaPiece ? (naiaPiece.name || naiaPiece.title) : null
    ].filter(Boolean);
    const outfit = outfitParts.join(" + ");

    try {
      const res = await fetch("/api/style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          outfit,
          mood,
          feeling,
          event,
          styleWords,
          bodyPref,
          closetItem: itemsToStyle[0] || null,
          closetItems: itemsToStyle,
          naiaPiece: naiaPiece ? {
            name: naiaPiece.name || naiaPiece.title,
            category: naiaPiece.category || naiaPiece.type || "",
            stylingNotes: naiaPiece.stylingNotes || "",
            moodMatch: naiaPiece.moodMatch || "",
            stylingRole: naiaPiece.stylingRole || "",
            statementLevel: naiaPiece.statementLevel || "",
            occasion: naiaPiece.occasion || "",
            sihouette: naiaPiece.sihouette || "",
          } : null,
          closet: closet.map(i => ({ name: i.name, category: i.category })),
        }),
      });
      const data = await res.json();
      setStylingResult(data.result || data.error || "Something went wrong.");
    } catch {
      setStylingResult("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  const resetAll = () => {
    setStep(1);
    setStylingResult("");
    setSelectedClosetIds([]);
    setSelectedNaiaPiece(null);
    setMood("");
    setFeeling("");
    setEvent("");
    setStyleWords([]);
    setBodyPref("");
    setMode("");
  };

  const s = {
    page: { minHeight: "100vh", background: "#f5f2ee", color: "#1a1816", fontFamily: '"Cormorant Garamond", Georgia, serif' },
    container: { maxWidth: "680px", margin: "0 auto", padding: "40px 24px 80px" },
    stepIndicator: { display: "flex", gap: "6px", marginBottom: "40px", justifyContent: "center" },
    dot: (active, done) => ({ width: active ? "24px" : "8px", height: "8px", borderRadius: "4px", background: (done || active) ? "#1a1816" : "#d4cfc9", transition: "all 0.3s" }),
    title: { fontSize: "13px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8a7f75", marginBottom: "12px" },
    bigQ: { fontSize: "32px", lineHeight: 1.2, fontWeight: 400, margin: "0 0 32px", fontStyle: "italic" },
    input: { width: "100%", padding: "16px 0", borderBottom: "1px solid #c8c2bb", background: "transparent", border: "none", borderBottom: "1px solid #c8c2bb", fontSize: "18px", color: "#1a1816", outline: "none", fontFamily: '"Cormorant Garamond", Georgia, serif', boxSizing: "border-box" },
    btn: { padding: "14px 32px", background: "#1a1816", color: "#f5f2ee", border: "none", borderRadius: "2px", fontSize: "13px", letterSpacing: "0.15em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Cormorant Garamond", Georgia, serif' },
    outlineBtn: { padding: "14px 32px", background: "transparent", color: "#1a1816", border: "1px solid #1a1816", borderRadius: "2px", fontSize: "13px", letterSpacing: "0.15em", textTransform: "uppercase", cursor: "pointer", fontFamily: '"Cormorant Garamond", Georgia, serif' },
    chip: (active) => ({ padding: "10px 18px", background: active ? "#1a1816" : "transparent", color: active ? "#f5f2ee" : "#1a1816", border: "1px solid #1a1816", borderRadius: "2px", fontSize: "13px", letterSpacing: "0.1em", cursor: "pointer", transition: "all 0.2s", fontFamily: '"Cormorant Garamond", Georgia, serif' }),
    modeCard: (active) => ({ padding: "24px", border: `1px solid ${active ? "#1a1816" : "#d4cfc9"}`, background: active ? "#1a1816" : "transparent", color: active ? "#f5f2ee" : "#1a1816", cursor: "pointer", marginBottom: "12px", transition: "all 0.2s", borderRadius: "2px" }),
    productGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginTop: "16px" },
    closetGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px", marginTop: "16px" },
    resultLabel: { fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8a7f75", marginBottom: "8px" },
    resultValue: { fontSize: "22px", fontStyle: "italic", lineHeight: 1.4 },
    divider: { borderTop: "1px solid #d4cfc9", margin: "24px 0" },
  };

  const totalSteps = 8;

  return (
    <div style={s.page}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap" rel="stylesheet" />
      <div style={s.container}>
        <div style={s.stepIndicator}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} style={s.dot(step === i + 1, step > i + 1)} />
          ))}
        </div>

        {step === 1 && (
          <div>
            <div style={s.title}>Step 1 of 7</div>
            <p style={s.bigQ}>How are you feeling right now?</p>
            <input style={s.input} placeholder="overwhelmed, tired, excited..." value={mood} onChange={e => setMood(e.target.value)} autoFocus />
            <div style={{ marginTop: "32px" }}>
              <button style={s.btn} onClick={() => mood.trim() && setStep(2)}>Continue</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={s.title}>Step 2 of 7</div>
            <p style={s.bigQ}>How do you want to feel?</p>
            <input style={s.input} placeholder="powerful, calm, seen, soft..." value={feeling} onChange={e => setFeeling(e.target.value)} autoFocus />
            <div style={{ marginTop: "32px", display: "flex", gap: "12px" }}>
              <button style={s.outlineBtn} onClick={() => setStep(1)}>Back</button>
              <button style={s.btn} onClick={() => feeling.trim() && setStep(3)}>Continue</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={s.title}>Step 3 of 7</div>
            <p style={s.bigQ}>What are you dressing for?</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {["Casual", "Dinner", "Party", "Formal", "Wedding", "Work", "Date", "Travel"].map(e => (
                <button key={e} style={s.chip(event === e.toLowerCase())} onClick={() => setEvent(e.toLowerCase())}>{e}</button>
              ))}
            </div>
            <div style={{ marginTop: "32px", display: "flex", gap: "12px" }}>
              <button style={s.outlineBtn} onClick={() => setStep(2)}>Back</button>
              <button style={s.btn} onClick={() => event && setStep(4)}>Continue</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={s.title}>Step 4 of 7</div>
            <p style={s.bigQ}>Pick up to 3 words that describe your style.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {STYLE_WORDS.map(w => (
                <button key={w} style={s.chip(styleWords.includes(w))} onClick={() => toggleStyleWord(w)}>{w}</button>
              ))}
            </div>
            <div style={{ marginTop: "32px", display: "flex", gap: "12px" }}>
              <button style={s.outlineBtn} onClick={() => setStep(3)}>Back</button>
              <button style={s.btn} onClick={() => setStep(5)}>Continue</button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <div style={s.title}>Step 5 of 7</div>
            <p style={s.bigQ}>Any fit or body preferences?</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {BODY_PREFS.map(b => (
                <button key={b} style={s.chip(bodyPref === b)} onClick={() => setBodyPref(b)}>{b}</button>
              ))}
            </div>
            <div style={{ marginTop: "32px", display: "flex", gap: "12px" }}>
              <button style={s.outlineBtn} onClick={() => setStep(4)}>Back</button>
              <button style={s.btn} onClick={() => setStep(6)}>Continue</button>
            </div>
          </div>
        )}

        {step === 6 && (
          <div>
            <div style={s.title}>Step 6 of 7</div>
            <p style={s.bigQ}>What would you like to do?</p>
            <div onClick={() => setMode("closet_naia")} style={s.modeCard(mode === "closet_naia")}>
              <div style={{ fontSize: "17px", fontWeight: 500, marginBottom: "4px" }}>Style my closet piece with a nAia piece</div>
              <div style={{ fontSize: "14px", opacity: 0.7 }}>Pick something you own + a nAia piece and we'll style them together</div>
            </div>
            <div onClick={() => setMode("recommend_naia")} style={s.modeCard(mode === "recommend_naia")}>
              <div style={{ fontSize: "17px", fontWeight: 500, marginBottom: "4px" }}>Recommend a nAia piece for what I own</div>
              <div style={{ fontSize: "14px", opacity: 0.7 }}>Pick something from your closet and we'll find the perfect nAia match</div>
            </div>
            <div onClick={() => setMode("closet_only")} style={s.modeCard(mode === "closet_only")}>
              <div style={{ fontSize: "17px", fontWeight: 500, marginBottom: "4px" }}>Style my closet pieces together</div>
              <div style={{ fontSize: "14px", opacity: 0.7 }}>We'll pick the best combination from your closet based on your mood</div>
            </div>
            <div style={{ marginTop: "24px", display: "flex", gap: "12px" }}>
              <button style={s.outlineBtn} onClick={() => setStep(5)}>Back</button>
              <button style={s.btn} onClick={() => mode && setStep(7)}>Continue</button>
            </div>
          </div>
        )}

        {step === 7 && (
          <div>
            <div style={s.title}>Step 7 of 7</div>
            <p style={s.bigQ}>
              {mode === "closet_only"
                ? "Add your pieces and we'll choose the best combination"
                : mode === "recommend_naia"
                ? "Pick a piece from your closet"
                : "Pick your closet piece + a nAia piece"}
            </p>

            <div style={{ marginBottom: "32px" }}>
              <div style={{ ...s.resultLabel, marginBottom: "12px" }}>Your Closet</div>
              {closet.length === 0 && (
                <p style={{ color: "#8a7f75", fontSize: "15px", marginBottom: "16px" }}>Your closet is empty. Add a piece below.</p>
              )}
              <div style={s.closetGrid}>
                {closet.map(piece => (
                  <div key={piece.id}
                    onClick={() => mode !== "closet_only" && toggleClosetItem(piece.id)}
                    style={{ border: `2px solid ${selectedClosetIds.includes(piece.id) ? "#1a1816" : "#d4cfc9"}`, borderRadius: "2px", overflow: "hidden", cursor: mode !== "closet_only" ? "pointer" : "default" }}>
                    {piece.image
                      ? <img src={piece.image} alt={piece.name} style={{ width: "100%", height: "160px", objectFit: "cover", display: "block" }} />
                      : <div style={{ width: "100%", height: "160px", background: "#e8e4df", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", color: "#8a7f75" }}>{piece.category}</div>
                    }
                    <div style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 500 }}>{piece.name}</div>
                        <div style={{ fontSize: "12px", color: "#8a7f75" }}>{piece.category}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setCloset(prev => prev.filter(i => i.id !== piece.id)); setSelectedClosetIds(prev => prev.filter(i => i !== piece.id)); }}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "#8a7f75", padding: "4px" }}>×</button>
                    </div>
                  </div>
                ))}
              </div>

              {!showAddItem ? (
                <button style={{ ...s.outlineBtn, marginTop: "16px", fontSize: "12px", padding: "10px 20px" }} onClick={() => setShowAddItem(true)}>+ Add piece</button>
              ) : (
                <div style={{ marginTop: "16px", padding: "20px", border: "1px solid #d4cfc9", borderRadius: "2px" }}>
                  <input style={{ ...s.input, marginBottom: "12px" }} placeholder="Piece name (e.g. black blazer)" value={itemName} onChange={e => setItemName(e.target.value)} />
                  <select style={{ ...s.input, marginBottom: "12px" }} value={itemCategory} onChange={e => setItemCategory(e.target.value)}>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="outerwear">Outerwear</option>
                    <option value="dress">Dress</option>
                    <option value="shoes">Shoes</option>
                    <option value="accessory">Accessory</option>
                  </select>
                  <input type="file" accept="image/*" onChange={handleImageUpload} style={{ marginBottom: "12px", fontSize: "13px" }} />
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button style={s.btn} onClick={addItem}>Add</button>
                    <button style={s.outlineBtn} onClick={() => setShowAddItem(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {(mode === "closet_naia") && (
              <div style={{ marginBottom: "32px" }}>
                <div style={{ ...s.resultLabel, marginBottom: "12px" }}>Choose a nAia Piece</div>
                {currentNaiaPiece && (
                  <div onClick={() => setSelectedNaiaPiece(selectedNaiaPiece?.id === currentNaiaPiece.id ? null : currentNaiaPiece)}
                    style={{ display: "flex", gap: "12px", padding: "12px", border: `2px solid ${selectedNaiaPiece?.id === currentNaiaPiece.id ? "#1a1816" : "#d4cfc9"}`, marginBottom: "16px", cursor: "pointer" }}>
                    <img src={currentNaiaPiece.image} alt={currentNaiaPiece.name} style={{ width: "60px", height: "80px", objectFit: "cover", borderRadius: "2px" }} />
                    <div>
                      <div style={{ fontSize: "15px", fontWeight: 500 }}>{currentNaiaPiece.name}</div>
                      <div style={{ fontSize: "12px", color: "#8a7f75" }}>Currently viewing</div>
                    </div>
                  </div>
                )}
                <div style={s.productGrid}>
                  {naiaProducts.map(p => (
                    <div key={p.id} onClick={() => setSelectedNaiaPiece(selectedNaiaPiece?.id === p.id ? null : p)}
                      style={{ border: `2px solid ${selectedNaiaPiece?.id === p.id ? "#1a1816" : "transparent"}`, borderRadius: "2px", cursor: "pointer", overflow: "hidden", position: "relative" }}>
                      <img src={p.image} alt={p.title} style={{ width: "100%", height: "140px", objectFit: "cover", display: "block" }} />
                      <div style={{ padding: "8px", fontSize: "12px", fontWeight: 500 }}>{p.title}</div>
                      {selectedNaiaPiece?.id === p.id && (
                        <div style={{ position: "absolute", top: "8px", right: "8px", background: "#1a1816", color: "#fff", borderRadius: "50%", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px" }}>✓</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: "12px" }}>
              <button style={s.outlineBtn} onClick={() => setStep(6)}>Back</button>
              <button style={s.btn} onClick={callAI}>Style this look</button>
            </div>
          </div>
        )}

        {step === 8 && (
          <div>
            <div style={s.title}>Your Styling</div>
            {loading ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <p style={{ fontSize: "20px", fontStyle: "italic", color: "#8a7f75" }}>Styling your look...</p>
              </div>
            ) : parsedResult && (parsedResult.feelingNow || parsedResult.outfitDirection.length > 0) ? (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "24px" }}>
                  <div>
                    <div style={s.resultLabel}>You're feeling</div>
                    <div style={s.resultValue}>{parsedResult.feelingNow}</div>
                  </div>
                  <div>
                    <div style={s.resultLabel}>You want to feel</div>
                    <div style={s.resultValue}>{parsedResult.feelingNext}</div>
                  </div>
                </div>
                <div style={s.divider} />
                <div style={{ marginBottom: "24px" }}>
                  <div style={s.resultLabel}>Your outfit direction</div>
                  {parsedResult.outfitDirection.map((item, i) => (
                    <p key={i} style={{ fontSize: "17px", lineHeight: 1.7, margin: "0 0 8px", paddingLeft: "16px", borderLeft: "2px solid #d4cfc9" }}>{item}</p>
                  ))}
                </div>
                <div style={s.divider} />
                <div style={{ marginBottom: "24px" }}>
                  <div style={s.resultLabel}>Why this works</div>
                  {parsedResult.whyThisWorks.map((item, i) => (
                    <p key={i} style={{ fontSize: "15px", lineHeight: 1.7, margin: "0 0 6px", color: "#4a4540" }}>{item}</p>
                  ))}
                </div>
                {parsedResult.shift && (
                  <>
                    <div style={s.divider} />
                    <div style={{ marginBottom: "24px" }}>
                      <div style={s.resultLabel}>The shift</div>
                      <p style={{ fontSize: "19px", fontStyle: "italic", lineHeight: 1.6, margin: 0 }}>{parsedResult.shift}</p>
                    </div>
                  </>
                )}
                {mode === "recommend_naia" && naiaProducts.length > 0 && (
                  <>
                    <div style={s.divider} />
                    <div style={s.resultLabel}>Shop nAia pieces</div>
                    <div style={s.productGrid}>
                      {naiaProducts.slice(0, 6).map(p => (
                        <a key={p.id} href={p.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                          <div style={{ border: "1px solid #d4cfc9", borderRadius: "2px", overflow: "hidden" }}>
                            <img src={p.image} alt={p.title} style={{ width: "100%", height: "140px", objectFit: "cover", display: "block" }} />
                            <div style={{ padding: "8px", fontSize: "12px" }}>{p.title}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </>
                )}
                <div style={{ marginTop: "32px" }}>
                  <button style={s.outlineBtn} onClick={resetAll}>Start over</button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: "18px", fontStyle: "italic", whiteSpace: "pre-line", lineHeight: 1.8 }}>{stylingResult}</p>
                <button style={{ ...s.outlineBtn, marginTop: "24px" }} onClick={() => setStep(7)}>Try again</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}