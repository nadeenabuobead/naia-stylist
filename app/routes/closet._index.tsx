// app/routes/closet._index.tsx
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { useState, useEffect, useRef } from "react";
import { getCustomerId } from "~/lib/auth.server";
import { prisma } from "~/lib/prisma.server";

const CLOUDINARY_CLOUD = "diybves1z";
const CLOUDINARY_PRESET = "kqfhwrpq";

const CATEGORIES = ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS", "ACCESSORIES", "JEWELRY", "OTHER"];
const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver", "Multicolor"];
const OCCASIONS = ["Casual", "Work", "Dinner", "Party", "Formal", "Date", "Weekend", "Travel"];
const SEASONS = ["Spring", "Summer", "Fall", "Winter", "All Season"];
const PATTERNS = ["Solid", "Stripes", "Floral", "Plaid", "Animal Print", "Geometric", "Abstract", "Other"];

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const customerId = await getCustomerId(request);
    if (!customerId) return data({ items: [], authenticated: false });
    const items = await prisma.closetItem.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });
    return data({ items, authenticated: true });
  } catch (err: any) {
    console.error("Closet loader error:", err);
    return data({ items: [], authenticated: false });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const customerId = await getCustomerId(request);
    if (!customerId) return data({ error: "Not authenticated" }, { status: 401 });
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

      if (!name || !category) return data({ error: "Name and category required" }, { status: 400 });

      const item = await prisma.closetItem.create({
        data: {
          customerId,
          name,
          category: category as any,
          imageUrl: imageUrl || "",
          primaryColor: primaryColor || null,
          pattern: pattern || null,
          brand: brand || null,
          occasions: occasions,
          seasons: seasons,
        },
      });
      return data({ item, success: true });
    }

    if (intent === "delete") {
      const itemId = formData.get("itemId") as string;
      await prisma.closetItem.delete({ where: { id: itemId, customerId } });
      return data({ success: true });
    }

    return data({ error: "Invalid intent" }, { status: 400 });
  } catch (err: any) {
    console.error("Closet action error:", err);
    return data({ error: err?.message }, { status: 500 });
  }
}

function WardrobeInsights({ items }: { items: any[] }) {
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [loadingAI, setLoadingAI] = useState(false);

  useEffect(() => {
    if (items.length < 3) return;
    setLoadingAI(true);
    const token = sessionStorage.getItem("naia_token") || "";
fetch(`/api/wardrobe-insights?naia_token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => { if (d.insights) setAiInsights(d.insights); })
      .catch(() => {})
      .finally(() => setLoadingAI(false));
  }, []);

  if (items.length < 3) return null;

  const catCount: Record<string, number> = {};
  const occasionCount: Record<string, number> = {};
  for (const item of items) {
    catCount[item.category] = (catCount[item.category] || 0) + 1;
    if (item.occasions?.length) {
      for (const occ of item.occasions) occasionCount[occ] = (occasionCount[occ] || 0) + 1;
    }
  }
  const topOccasions = Object.entries(occasionCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topCategory = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];

  const s = {
    section: { marginBottom: "20px" } as const,
    label: { fontSize: "11px", letterSpacing: "0.18em", textTransform: "uppercase" as const, color: "#8a7f75", marginBottom: "10px" },
    tag: (bg: string, color: string) => ({ display: "inline-block", padding: "6px 12px", background: bg, color, borderRadius: "2px", fontSize: "13px", marginRight: "8px", marginBottom: "8px" }),
  };

  return (
    <div style={{ padding: "20px", background: "#faf9f7", borderRadius: "4px", marginBottom: "24px", border: "1px solid #e8e4df" }}>
      <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "#8a7f75", marginBottom: "20px" }}>Wardrobe Insights</div>

      {loadingAI && <p style={{ fontSize: "13px", color: "#8a7f75", fontStyle: "italic" }}>Analysing your wardrobe...</p>}

      {aiInsights && (
        <>
          {/* Style personality */}
          <div style={s.section}>
            <div style={s.label}>Your Style Personality</div>
            <div style={{ fontSize: "20px", fontStyle: "italic", color: "#1a1816" }}>{aiInsights.stylePersonality}</div>
            <div style={{ fontSize: "13px", color: "#8a7f75", marginTop: "4px" }}>{aiInsights.styleDescription}</div>
          </div>

          {/* Dominant colors */}
          {aiInsights.dominantColors?.length > 0 && (
            <div style={s.section}>
              <div style={s.label}>Your Color Story</div>
              <div>{aiInsights.dominantColors.map((c: string) => <span key={c} style={s.tag("#eee9e2", "#1a1816")}>{c}</span>)}</div>
            </div>
          )}

          {/* Too much of */}
          {aiInsights.tooMuchOf?.length > 0 && (
            <div style={s.section}>
              <div style={s.label}>You Have Too Much Of</div>
              {aiInsights.tooMuchOf.map((t: string, i: number) => (
                <div key={i} style={{ fontSize: "13px", fontStyle: "italic", color: "#1a1816", marginBottom: "4px" }}>· {t}</div>
              ))}
            </div>
          )}

          {/* Repeats */}
          {aiInsights.repeats?.length > 0 && (
            <div style={s.section}>
              <div style={s.label}>What You Repeat</div>
              {aiInsights.repeats.map((r: string, i: number) => (
                <div key={i} style={{ fontSize: "13px", fontStyle: "italic", color: "#1a1816", marginBottom: "4px" }}>· {r}</div>
              ))}
            </div>
          )}

          {/* Missing pieces */}
          {aiInsights.missingPieces?.length > 0 && (
            <div style={s.section}>
              <div style={s.label}>Missing From Your Wardrobe</div>
              {aiInsights.missingPieces.map((m: string, i: number) => (
                <div key={i} style={{ fontSize: "13px", color: "#c5553a", fontStyle: "italic", marginBottom: "4px" }}>· {m}</div>
              ))}
            </div>
          )}

          {/* Buy next */}
          {aiInsights.buyNext && (
            <div style={s.section}>
              <div style={s.label}>Buy Next</div>
              <div style={{ padding: "12px 16px", background: "#1a1816", color: "#f5f2ee", borderRadius: "2px", fontSize: "14px", fontStyle: "italic" }}>
                ✦ {aiInsights.buyNext}
              </div>
            </div>
          )}
        </>
      )}

      {/* Static insights */}
      {topOccasions.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>You Dress Most For</div>
          <div>{topOccasions.map(([occ, count]) => <span key={occ} style={s.tag("#1a1816", "#f5f2ee")}>{occ} ({count})</span>)}</div>
        </div>
      )}

      {topCategory && (
        <div style={s.section}>
          <div style={s.label}>Your Go-To Category</div>
          <div style={{ fontSize: "14px", fontStyle: "italic", color: "#1a1816" }}>
            {topCategory[0].charAt(0) + topCategory[0].slice(1).toLowerCase()} — {topCategory[1]} pieces
          </div>
        </div>
      )}
    </div>
  );
}
export default function ClosetPage() {
  const { items, authenticated } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const fetcher = useFetcher();
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Form state
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("TOPS");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newOccasions, setNewOccasions] = useState<string[]>([]);
  const [newSeasons, setNewSeasons] = useState<string[]>([]);

  useEffect(() => {
    const urlToken = searchParams.get("naia_token");
    if (urlToken) sessionStorage.setItem("naia_token", urlToken);
  }, []);

  const filtered = activeCategory === "ALL" ? items : items.filter((i: any) => i.category === activeCategory);

  const uploadToCloudinary = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", CLOUDINARY_PRESET);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setNewImageUrl(data.secure_url);
    } catch (err) {
      console.error("Upload failed:", err);
    }
    setUploading(false);
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
    padding: "6px 14px",
    borderRadius: "2px",
    fontSize: "12px",
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
    background: active ? "#1a1816" : "#eee9e2",
    color: active ? "white" : "#8a7f75",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
  });

  if (!authenticated) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
        <div style={{ textAlign: "center", maxWidth: "24rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>👗</div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>My Closet</h1>
          <p style={{ color: "#8a7f75", marginBottom: "1.5rem" }}>Log in to your account on naiabynadine.com to access your closet.</p>
          <a href="https://naiabynadine.com/account/login" style={{ padding: "0.75rem 1.5rem", background: "#1a1816", color: "white", borderRadius: "2px", textDecoration: "none", fontWeight: 500 }}>Log In</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#faf9f7", fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
      <header style={{ padding: "1rem 1.5rem", background: "white", borderBottom: "1px solid #e8e4df", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: "36rem", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="https://naia-stylist.vercel.app/stylist" style={{ color: "#8a7f75", textDecoration: "none", fontSize: "13px", letterSpacing: "0.1em" }}>← Back</a>
          <div style={{ fontSize: "13px", letterSpacing: "0.2em", textTransform: "uppercase" }}>My Closet</div>
          <button onClick={() => setShowAddForm(!showAddForm)} style={{ fontSize: "13px", color: "#1a1816", background: "none", border: "none", cursor: "pointer", letterSpacing: "0.1em" }}>+ Add</button>
        </div>
      </header>

      <main style={{ padding: "1.5rem", maxWidth: "36rem", margin: "0 auto" }}>

        {/* Add Form */}
        {showAddForm && (
          <div style={{ background: "white", borderRadius: "4px", padding: "1.5rem", marginBottom: "1.5rem", border: "1px solid #e8e4df" }}>
            <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "#8a7f75", marginBottom: "1.5rem" }}>Add a piece</div>

            {/* Photo upload */}
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "13px", color: "#8a7f75", marginBottom: "8px" }}>Photo</div>
              <label style={{ display: "block", border: "1px dashed #d4cfc9", borderRadius: "4px", padding: "1rem", textAlign: "center", cursor: "pointer", background: newImageUrl ? "transparent" : "#faf9f7" }}>
                {newImageUrl ? (
                  <img src={newImageUrl} alt="preview" style={{ maxHeight: "160px", borderRadius: "4px", objectFit: "cover" }} />
                ) : uploading ? (
                  <span style={{ fontSize: "13px", color: "#8a7f75" }}>Uploading...</span>
                ) : (
                  <span style={{ fontSize: "13px", color: "#8a7f75" }}>Tap to upload photo</span>
                )}
                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadToCloudinary(e.target.files[0])} style={{ display: "none" }} />
              </label>
            </div>

            {/* Name */}
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "13px", color: "#8a7f75", marginBottom: "8px" }}>Name *</div>
              <input type="text" placeholder="e.g. Black blazer" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: "100%", padding: "10px", border: "1px solid #e8e4df", borderRadius: "2px", fontSize: "14px", fontFamily: '"Cormorant Garamond", Georgia, serif', boxSizing: "border-box" as const, background: "#faf9f7" }} />
            </div>

            {/* Category */}
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "13px", color: "#8a7f75", marginBottom: "8px" }}>Category *</div>
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "8px" }}>
                {CATEGORIES.map(c => (
                  <button key={c} onClick={() => setNewCategory(c)} style={btnStyle(newCategory === c)}>
                    {c.charAt(0) + c.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Color */}
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "13px", color: "#8a7f75", marginBottom: "8px" }}>Primary Color</div>
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "8px" }}>
                {COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)} style={btnStyle(newColor === c)}>{c}</button>
                ))}
              </div>
            </div>

            {/* Pattern */}
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "13px", color: "#8a7f75", marginBottom: "8px" }}>Pattern</div>
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "8px" }}>
                {PATTERNS.map(p => (
                  <button key={p} onClick={() => setNewPattern(p)} style={btnStyle(newPattern === p)}>{p}</button>
                ))}
              </div>
            </div>

            {/* Occasions */}
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "13px", color: "#8a7f75", marginBottom: "8px" }}>Occasions</div>
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "8px" }}>
                {OCCASIONS.map(o => (
                  <button key={o} onClick={() => toggleOccasion(o)} style={btnStyle(newOccasions.includes(o))}>{o}</button>
                ))}
              </div>
            </div>

            {/* Seasons */}
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "13px", color: "#8a7f75", marginBottom: "8px" }}>Season</div>
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "8px" }}>
                {SEASONS.map(s => (
                  <button key={s} onClick={() => toggleSeason(s)} style={btnStyle(newSeasons.includes(s))}>{s}</button>
                ))}
              </div>
            </div>

            {/* Brand */}
            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ fontSize: "13px", color: "#8a7f75", marginBottom: "8px" }}>Brand (optional)</div>
              <input type="text" placeholder="e.g. Zara, H&M, nAia" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} style={{ width: "100%", padding: "10px", border: "1px solid #e8e4df", borderRadius: "2px", fontSize: "14px", fontFamily: '"Cormorant Garamond", Georgia, serif', boxSizing: "border-box" as const, background: "#faf9f7" }} />
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button onClick={handleAdd} disabled={!newName || uploading} style={{ flex: 1, padding: "12px", background: newName ? "#1a1816" : "#d4cfc9", color: "white", border: "none", borderRadius: "2px", fontSize: "13px", letterSpacing: "0.15em", textTransform: "uppercase" as const, cursor: newName ? "pointer" : "default", fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
                {uploading ? "Uploading..." : "Add to Closet"}
              </button>
              <button onClick={() => setShowAddForm(false)} style={{ padding: "12px 20px", background: "transparent", color: "#8a7f75", border: "1px solid #e8e4df", borderRadius: "2px", cursor: "pointer", fontFamily: '"Cormorant Garamond", Georgia, serif' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Insights toggle */}
        {items.length >= 3 && (
          <button onClick={() => setShowInsights(!showInsights)} style={{ width: "100%", padding: "12px", background: "white", border: "1px solid #e8e4df", borderRadius: "4px", marginBottom: "1rem", fontSize: "13px", letterSpacing: "0.15em", textTransform: "uppercase" as const, cursor: "pointer", color: "#1a1816", fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
            {showInsights ? "Hide" : "View"} Wardrobe Insights
          </button>
        )}

        {showInsights && <WardrobeInsights items={items} />}

        {/* Category filter */}
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "8px", marginBottom: "1rem" }}>
          {["ALL", ...CATEGORIES].map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)} style={{ ...btnStyle(activeCategory === cat), whiteSpace: "nowrap" as const, padding: "6px 14px" }}>
              {cat === "ALL" ? "All" : cat.charAt(0) + cat.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <p style={{ fontSize: "13px", color: "#8a7f75", marginBottom: "1rem" }}>{filtered.length} {filtered.length === 1 ? "piece" : "pieces"}</p>

        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>👗</div>
            <p style={{ color: "#8a7f75", marginBottom: "1rem", fontStyle: "italic" }}>No pieces yet in this category</p>
            <button onClick={() => setShowAddForm(true)} style={{ padding: "12px 28px", background: "#1a1816", color: "white", border: "none", borderRadius: "2px", fontSize: "13px", letterSpacing: "0.15em", textTransform: "uppercase" as const, cursor: "pointer", fontFamily: '"Cormorant Garamond", Georgia, serif' }}>Add Your First Piece</button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
          {filtered.map((item: any) => (
            <div key={item.id} style={{ background: "white", borderRadius: "4px", overflow: "hidden", position: "relative", border: "1px solid #e8e4df" }}>
              <div style={{ aspectRatio: "1", background: "#f5f2ee", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: "2.5rem" }}>👗</span>}
              </div>
              <div style={{ padding: "10px" }}>
                <p style={{ fontWeight: 500, fontSize: "14px", marginBottom: "4px", margin: "0 0 4px" }}>{item.name}</p>
                <p style={{ fontSize: "12px", color: "#8a7f75", margin: "0 0 4px" }}>{item.category.charAt(0) + item.category.slice(1).toLowerCase()}</p>
                {item.primaryColor && <p style={{ fontSize: "11px", color: "#8a7f75", margin: 0 }}>{item.primaryColor}{item.pattern ? ` · ${item.pattern}` : ""}</p>}
                {item.occasions?.length > 0 && <p style={{ fontSize: "11px", color: "#8a7f75", margin: "2px 0 0" }}>{item.occasions.slice(0, 2).join(", ")}</p>}
              </div>
              <button onClick={() => fetcher.submit({ intent: "delete", itemId: item.id }, { method: "post" })} style={{ position: "absolute", top: "8px", right: "8px", background: "rgba(0,0,0,0.5)", color: "white", border: "none", borderRadius: "50%", width: "24px", height: "24px", cursor: "pointer", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "2rem", textAlign: "center" }}>
          <a href="https://naia-stylist.vercel.app/stylist" style={{ padding: "12px 28px", background: "#1a1816", color: "white", borderRadius: "2px", textDecoration: "none", fontSize: "13px", letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
            ✦ Style Me
          </a>
        </div>
      </main>
    </div>
  );
}
