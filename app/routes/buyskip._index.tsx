import { useLoaderData, useFetcher, Link } from "react-router";
import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { useState } from "react";
import prisma from "../db.server";

const CLOUDINARY_CLOUD = "diybves1z";
const CLOUDINARY_PRESET = "kqfhwrpq";

const CATEGORIES = ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS", "ACCESSORIES", "JEWELRY", "OTHER"];
const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver", "Multicolor"];
const OCCASIONS = ["Casual", "Work", "Dinner", "Party", "Formal", "Date", "Weekend", "Travel"];
const SEASONS = ["Spring", "Summer", "Fall", "Winter", "All Season"];
const PATTERNS = ["Solid", "Stripes", "Floral", "Plaid", "Animal Print", "Geometric", "Abstract", "Other"];

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Use guest customer for now (same as dashboard)
    const customer = await prisma.customer.findFirst({
      where: { shopifyCustomerId: "guest" },
      include: { closetItems: { orderBy: { createdAt: "desc" } } }
    });
    
    if (!customer) return data({ items: [], authenticated: false });
    
    return data({ items: customer.closetItems, authenticated: true });
  } catch (err: any) {
    console.error("Closet loader error:", err);
    return data({ items: [], authenticated: false });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    // Use guest customer for now
    const customer = await prisma.customer.findFirst({
      where: { shopifyCustomerId: "guest" }
    });
    
    if (!customer) return data({ error: "Not authenticated" }, { status: 401 });
    
    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    if (intent === "add") {
      const name = formData.get("name") as string;
      const category = formData.get("category") as string;
      const imageUrl = formData.get("imageUrl") as string;
      const primaryColor = formData.get("primaryColor") as string;
      const pattern = formData.get("pattern") as string;
      const brand = formData.get("brand") as string;
      const occasions = JSON.parse(formData.get("occasions") as string || "[]");
      const seasons = JSON.parse(formData.get("seasons") as string || "[]");

      if (!name || !category || !imageUrl) return data({ error: "Name and category required" }, { status: 400 });

      await prisma.closetItem.create({
        data: {
          customerId: customer.id,
          name: name,
          category,
          imageUrl: imageUrl || "",
          primaryColor: primaryColor || null,
          pattern: pattern || null,
          brand: brand || null,
          occasions: occasions.length > 0 ? occasions : null,
          seasons: seasons.length > 0 ? seasons : null,
        },
      });
      return data({ success: true });
    }

    if (intent === "delete") {
      const itemId = formData.get("itemId") as string;
      await prisma.closetItem.delete({ where: { id: itemId } });
      return data({ success: true });
    }

    return data({ error: "Unknown intent" }, { status: 400 });
  } catch (err: any) {
    console.error("Closet action error:", err);
    return data({ error: err.message }, { status: 500 });
  }
}

export default function BuySkip() {
  const { items } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [uploading, setUploading] = useState(false);
  
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("TOPS");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newOccasions, setNewOccasions] = useState<string[]>([]);
  const [newSeasons, setNewSeasons] = useState<string[]>([]);

  const filtered = activeCategory === "ALL" ? items : items.filter((i: any) => i.category === activeCategory);

  const uploadToCloudinary = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_PRESET);
    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setNewImageUrl(data.secure_url);
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
    }
  };

  const toggleOccasion = (occ: string) => {
    setNewOccasions(prev => prev.includes(occ) ? prev.filter(o => o !== occ) : [...prev, occ]);
  };

  const toggleSeason = (s: string) => {
    setNewSeasons(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleAdd = () => {
    if (!newName) return;
    fetcher.submit(
      {
        intent: "add",
        name: newName,
        category: newCategory,
        imageUrl: newImageUrl,
        primaryColor: newColor,
        pattern: newPattern,
        brand: newBrand,
        occasions: JSON.stringify(newOccasions),
        seasons: JSON.stringify(newSeasons),
      },
      { method: "post" }
    );
    setNewName(""); setNewImageUrl(""); setNewColor(""); setNewPattern("");
    setNewBrand(""); setNewOccasions([]); setNewSeasons([]);
    setShowAddForm(false);
  };

  const btnStyle = (active: boolean) => ({
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: active ? 600 : 400,
    border: active ? "1px solid rgba(59,5,16,0.2)" : "1px solid rgba(59,5,16,0.08)",
    cursor: "pointer",
    background: active ? "rgba(139,32,53,0.08)" : "rgba(255,255,255,0.5)",
    color: active ? "#8b2035" : "#7a6f6a",
    fontFamily: "'Cormorant Garamond',serif",
    fontStyle: "italic",
    transition: "all 0.2s",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      
      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "60px 40px" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px" }}>
          <div>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(48px,6vw,72px)", fontWeight: 900, lineHeight: 1, marginBottom: "12px" }}>
              Buy or Skip
            </h1>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#7a6f6a" }}>
              Upload, save, and style your pieces with nAia.
            </p>
          </div>
          <Link to="/" style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none" }}>
            ← DASHBOARD
          </Link>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "40px" }}>
          <div style={{ background: "rgba(255,255,255,0.5)", padding: "24px", border: "1px solid rgba(59,5,16,0.06)" }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "48px", fontWeight: 900 }}>{items.length}</div>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a" }}>TOTAL PIECES</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.5)", padding: "24px", border: "1px solid rgba(59,5,16,0.06)" }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "48px", fontWeight: 900 }}>{new Set(items.map((i: any) => i.category)).size}</div>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a" }}>CATEGORIES</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.5)", padding: "24px", border: "1px solid rgba(59,5,16,0.06)" }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "48px", fontWeight: 900 }}>{new Set(items.map((i: any) => i.brand).filter(Boolean)).size}</div>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a" }}>BRANDS</div>
          </div>
        </div>

        {/* Toggle Add Form Button */}
        {!showAddForm && (
          <button onClick={() => setShowAddForm(true)} style={{ width: "100%", padding: "20px", background: "#221516", color: "#f4f4f1", border: "none", marginBottom: "40px", cursor: "pointer", fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic" }}>
            + Add a Piece
          </button>
        )}

        {/* Add Form */}
        {showAddForm && (
          <div style={{ background: "rgba(255,255,255,0.8)", padding: "40px", marginBottom: "40px", border: "1px solid rgba(59,5,16,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h3 style={{ fontFamily: "'Playfair Display',serif", fontSize: "24px", fontWeight: 700 }}>Add to Wardrobe</h3>
              <button onClick={() => setShowAddForm(false)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", color: "#7a6f6a" }}>Cancel</button>
            </div>

            {/* Photo upload */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>PHOTO</div>
              <label style={{ display: "block", border: "1px dashed rgba(59,5,16,0.2)", padding: "40px", textAlign: "center", cursor: "pointer", background: "rgba(255,255,255,0.5)" }}>
                {newImageUrl ? (
                  <img src={newImageUrl} alt="preview" style={{ maxHeight: "200px", objectFit: "cover" }} />
                ) : uploading ? (
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>Uploading...</span>
                ) : (
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>Click to upload photo</span>
                )}
                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadToCloudinary(e.target.files[0])} style={{ display: "none" }} />
              </label>
            </div>

            {/* Name */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>NAME *</div>
              <input type="text" placeholder="e.g. Black silk blazer" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: "100%", padding: "14px", border: "1px solid rgba(59,5,16,0.1)", fontSize: "16px", fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", boxSizing: "border-box", background: "rgba(255,255,255,0.7)" }} />
            </div>

            {/* Category */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>CATEGORY *</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {CATEGORIES.map(c => (
                  <button key={c} onClick={() => setNewCategory(c)} style={btnStyle(newCategory === c)}>
                    {c.charAt(0) + c.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Color */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>COLOR</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)} style={btnStyle(newColor === c)}>{c}</button>
                ))}
              </div>
            </div>

            {/* Pattern */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>PATTERN</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {PATTERNS.map(p => (
                  <button key={p} onClick={() => setNewPattern(p)} style={btnStyle(newPattern === p)}>{p}</button>
                ))}
              </div>
            </div>

            {/* Occasions */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>OCCASIONS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {OCCASIONS.map(o => (
                  <button key={o} onClick={() => toggleOccasion(o)} style={btnStyle(newOccasions.includes(o))}>{o}</button>
                ))}
              </div>
            </div>

            {/* Seasons */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>SEASON</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {SEASONS.map(s => (
                  <button key={s} onClick={() => toggleSeason(s)} style={btnStyle(newSeasons.includes(s))}>{s}</button>
                ))}
              </div>
            </div>

            {/* Brand */}
            <div style={{ marginBottom: "32px" }}>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "12px" }}>BRAND (OPTIONAL)</div>
              <input type="text" placeholder="Brand name" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} style={{ width: "100%", padding: "14px", border: "1px solid rgba(59,5,16,0.1)", fontSize: "16px", fontFamily: "'Cormorant Garamond',serif", fontStyle: "italic", boxSizing: "border-box", background: "rgba(255,255,255,0.7)" }} />
            </div>

            <button onClick={handleAdd} disabled={!newName || !newImageUrl || uploading} style={{ width: "100%", padding: "16px", background: newName ? "#8b2035" : "#d4cfc9", color: "#f4f4f1", border: "none", fontSize: "14px", letterSpacing: "2px", textTransform: "uppercase", cursor: newName ? "pointer" : "default", fontFamily: "'Space Mono',monospace" }}>
              {uploading ? "Uploading..." : "Add to Wardrobe"}
            </button>
          </div>
        )}

        {/* Category filter */}
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "12px", marginBottom: "24px" }}>
          {["ALL", ...CATEGORIES].map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)} style={{ ...btnStyle(activeCategory === cat), whiteSpace: "nowrap", flexShrink: 0 }}>
              {cat === "ALL" ? "All" : cat.charAt(0) + cat.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "24px" }}>
          {filtered.length} {filtered.length === 1 ? "piece" : "pieces"}
        </p>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 40px", background: "rgba(255,255,255,0.3)", border: "1px solid rgba(59,5,16,0.06)" }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "64px", marginBottom: "20px" }}>◇</div>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "32px" }}>
              No pieces yet in this category
            </p>
            <button onClick={() => setShowAddForm(true)} style={{ padding: "16px 32px", background: "#221516", color: "#f4f4f1", border: "none", fontSize: "12px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer", fontFamily: "'Space Mono',monospace" }}>
              Add Your First Piece
            </button>
          </div>
        )}

        {/* Items grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "24px" }}>
          {filtered.map((item: any) => (
            <div key={item.id} style={{ background: "rgba(255,255,255,0.5)", border: "1px solid rgba(59,5,16,0.06)", overflow: "hidden", position: "relative" }}>
              <div style={{ aspectRatio: "1", background: "#f5f2ee", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.itemName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: "64px", opacity: 0.2 }}>◇</span>
                )}
              </div>
              <div style={{ padding: "20px" }}>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "8px" }}>
                  {item.category}
                </div>
                <p style={{ fontFamily: "'Playfair Display',serif", fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
                  {item.itemName}
                </p>
                {item.color && (
                  <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "14px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "4px" }}>
                    {item.color}{item.pattern ? ` · ${item.pattern}` : ""}
                  </p>
                )}
                {item.brand && (
                  <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "14px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "4px" }}>
                    {item.brand}
                  </p>
                )}
                {item.occasions?.length > 0 && (
                  <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "12px", color: "#7a6f6a", marginTop: "8px" }}>
                    {item.occasions.slice(0, 2).join(", ")}
                  </p>
                )}
              </div>
              <button 
                onClick={() => fetcher.submit({ intent: "delete", itemId: item.id }, { method: "post" })} 
                style={{ position: "absolute", top: "12px", right: "12px", background: "rgba(34,21,22,0.8)", color: "#f4f4f1", border: "none", borderRadius: "50%", width: "32px", height: "32px", cursor: "pointer", fontSize: "18px", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{ marginTop: "60px", textAlign: "center" }}>
          <Link to="/quick-style" style={{ display: "inline-block", padding: "20px 40px", background: "#8b2035", color: "#f4f4f1", textDecoration: "none", fontSize: "14px", letterSpacing: "2px", textTransform: "uppercase", fontFamily: "'Space Mono',monospace" }}>
            Style Me →
          </Link>
        </div>
      </div>
    </div>
  );
}
