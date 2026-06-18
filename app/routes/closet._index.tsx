import { useLoaderData, useFetcher, Link } from "react-router";
import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { useState } from "react";
import prisma from "../db.server";
import { getProxyCustomerId } from "~/lib/auth.server";

const CATEGORIES = ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS", "ACCESSORIES", "JEWELRY", "OTHER"];
const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver", "Multicolor"];
const OCCASIONS = ["Casual", "Work", "Dinner", "Party", "Formal", "Date", "Weekend", "Travel"];
const SEASONS = ["Spring", "Summer", "Fall", "Winter", "All Season"];
const PATTERNS = ["Solid", "Stripes", "Floral", "Plaid", "Animal Print", "Geometric", "Abstract", "Other"];

export async function loader({ request }: LoaderFunctionArgs) {
  // authenticate.public.appProxy (called inside getProxyCustomerId) throws a 400 Response
  // for any direct Vercel access or tampered HMAC — React Router surfaces it to the client.
  const customerId = await getProxyCustomerId(request);

  const url = new URL(request.url);
  const shopifyCustomerId = url.searchParams.get("logged_in_customer_id") ?? "";
  const rawPathPrefix = url.searchParams.get("path_prefix");
  const proxyPathPrefix: string | null =
    typeof rawPathPrefix === "string" &&
    /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(rawPathPrefix)
      ? rawPathPrefix
      : null;

  if (!shopifyCustomerId) {
    return data({ items: [], authState: "logged_out" as const, proxyPathPrefix });
  }
  if (!customerId) {
    // Shopify-authenticated but no nAia Customer record yet.
    return data({ items: [], authState: "no_profile" as const, proxyPathPrefix });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { closetItems: { orderBy: { createdAt: "desc" } } },
  });
  if (!customer) return data({ items: [], authState: "no_profile" as const, proxyPathPrefix });
  return data({ items: customer.closetItems, authState: "authenticated" as const, proxyPathPrefix });
}

export async function action({ request }: ActionFunctionArgs) {
  // Let the 400 throw propagate for non-App-Proxy requests.
  const customerId = await getProxyCustomerId(request);
  if (!customerId) {
    return data({ error: "Not authenticated" }, { status: 401 });
  }
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return data({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add") {
    const name = formData.get("name") as string;
    const category = formData.get("category") as string;
    const imageUrl = formData.get("imageUrl") as string;
    const primaryColor = formData.get("primaryColor") as string;
    const pattern = formData.get("pattern") as string;
    const brand = formData.get("brand") as string;
    const occasions = JSON.parse((formData.get("occasions") as string) || "[]");
    const seasons = JSON.parse((formData.get("seasons") as string) || "[]");
    if (!name || !category || !imageUrl) return data({ error: "Name and category required" }, { status: 400 });
    await prisma.closetItem.create({
      data: {
        customerId: customer.id,
        name,
        category,
        imageUrl,
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
    // deleteMany with both id and customerId prevents cross-customer deletion.
    const deleted = await prisma.closetItem.deleteMany({
      where: { id: itemId, customerId: customer.id },
    });
    if (deleted.count === 0) {
      return data({ error: "Item not found" }, { status: 403 });
    }
    return data({ success: true });
  }

  return data({ error: "Unknown intent" }, { status: 400 });
}

const css = `
  :root{--cream:#f4f4f1;--warm:#e1dbd7;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .cl-wrap{max-width:1200px;margin:0 auto;padding:60px 40px}
  .cl-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .cl-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .cl-topbar-link{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);text-decoration:none}
  .cl-headline{font-family:var(--ff-display);font-size:clamp(40px,5vw,64px);font-weight:900;line-height:1;margin-bottom:12px}
  .cl-sub{font-family:var(--ff-mono);font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:40px}
  .cl-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:40px}
  .cl-stat{background:rgba(255,255,255,0.5);padding:24px;border:1px solid rgba(59,5,16,.06)}
  .cl-stat-num{font-family:var(--ff-display);font-size:48px;font-weight:900;color:var(--deep)}
  .cl-stat-label{font-family:var(--ff-mono);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
  .cl-add-btn{width:100%;padding:18px;background:#8b2035;color:var(--cream);border:none;margin-bottom:40px;cursor:pointer;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase}
  .cl-form{background:rgba(255,255,255,0.8);padding:40px;margin-bottom:40px;border:1px solid rgba(59,5,16,.06)}
  .cl-form-title{font-family:var(--ff-display);font-size:28px;font-weight:900;font-style:italic;margin-bottom:24px}
  .cl-label{font-family:var(--ff-mono);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:12px}
  .cl-input{width:100%;padding:14px;border:1px solid rgba(59,5,16,.1);font-size:16px;font-family:var(--ff-body);font-style:italic;background:rgba(255,255,255,0.7);color:var(--deep);outline:none}
  .cl-input:focus{border-color:var(--deep)}
  .cl-pills{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}
  .cl-pill{padding:10px 18px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;background:transparent;transition:all .2s}
  .cl-pill:hover{border-color:var(--deep)}
  .cl-pill.on{background:#8b2035;color:var(--cream)}
  .cl-upload-box{border:1px dashed rgba(59,5,16,.2);padding:40px;text-align:center;cursor:pointer;background:rgba(255,255,255,0.5);margin-bottom:8px;display:block}
  .cl-upload-hint{font-family:var(--ff-body);font-size:16px;font-style:italic;color:var(--muted)}
  .cl-upload-notice{font-family:var(--ff-mono);font-size:8px;letter-spacing:1px;line-height:1.6;color:var(--muted);margin-bottom:16px}
  .cl-upload-error{font-family:var(--ff-mono);font-size:9px;letter-spacing:1px;color:#8b2035;margin-bottom:16px}
  .cl-submit{width:100%;padding:16px;background:#8b2035;color:var(--cream);border:none;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;cursor:pointer}
  .cl-submit:disabled{opacity:.3;cursor:not-allowed}
  .cl-filters{display:flex;gap:8px;overflow-x:auto;padding-bottom:12px;margin-bottom:24px}
  .cl-filter{padding:10px 18px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;background:transparent;white-space:nowrap;transition:all .2s;flex-shrink:0}
  .cl-filter.on{background:#8b2035;color:var(--cream)}
  .cl-count{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:24px}
  .cl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:24px}
  .cl-card{background:rgba(255,255,255,0.5);border:1px solid rgba(59,5,16,.06);overflow:hidden;position:relative}
  .cl-card-img{aspect-ratio:1;background:#f5f2ee;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .cl-card-img img{width:100%;height:100%;object-fit:cover}
  .cl-card-body{padding:20px}
  .cl-card-cat{font-family:var(--ff-mono);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .cl-card-name{font-family:var(--ff-display);font-size:18px;font-weight:700;color:var(--deep);margin-bottom:6px}
  .cl-card-meta{font-family:var(--ff-mono);font-size:9px;letter-spacing:1px;color:var(--muted);text-transform:uppercase}
  .cl-delete{position:absolute;top:12px;right:12px;background:rgba(34,21,22,0.8);color:var(--cream);border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;line-height:1}
  .cl-empty{text-align:center;padding:80px 40px;background:rgba(255,255,255,0.3);border:1px solid rgba(59,5,16,.06)}
  .cl-empty-icon{font-family:var(--ff-display);font-size:64px;color:var(--deep);opacity:.2;margin-bottom:20px}
  .cl-empty-text{font-family:var(--ff-body);font-size:20px;font-style:italic;color:var(--muted);margin-bottom:32px}
  .cl-cta{margin-top:60px;text-align:center}
  .cl-cta a{display:inline-block;padding:16px 40px;background:var(--deep);color:var(--cream);text-decoration:none;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase}
`;

const FONTS = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap";

export default function Closet() {
  const { items, authState, proxyPathPrefix } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  // All hooks must be declared unconditionally before any early returns.
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("TOPS");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newOccasions, setNewOccasions] = useState<string[]>([]);
  const [newSeasons, setNewSeasons] = useState<string[]>([]);

  if (authState === "logged_out") {
    return (
      <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
        <style>{css}</style>
        <link href={FONTS} rel="stylesheet" />
        <div className="cl-topbar">
          <div className="cl-topbar-logo">nAia</div>
        </div>
        <div style={{ maxWidth: "600px", margin: "0 auto", padding: "120px 40px", textAlign: "center" }}>
          <h1 style={{ fontFamily: "var(--ff-display)", fontSize: "clamp(28px,4vw,42px)", fontWeight: 900, fontStyle: "italic", color: "var(--deep)", marginBottom: "16px" }}>
            My Pieces
          </h1>
          <p style={{ fontFamily: "var(--ff-body)", fontSize: "18px", fontStyle: "italic", color: "var(--muted)", marginBottom: "40px" }}>
            Sign in to view your pieces.
          </p>
          <a
            href="/account/login"
            style={{ display: "inline-block", padding: "16px 40px", background: "#8b2035", color: "#f4f4f1", textDecoration: "none", fontFamily: "var(--ff-mono)", fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase" }}
          >
            SIGN IN
          </a>
        </div>
      </div>
    );
  }

  if (authState === "no_profile") {
    return (
      <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
        <style>{css}</style>
        <link href={FONTS} rel="stylesheet" />
        <div className="cl-topbar">
          <div className="cl-topbar-logo">nAia</div>
        </div>
        <div style={{ maxWidth: "600px", margin: "0 auto", padding: "120px 40px", textAlign: "center" }}>
          <h1 style={{ fontFamily: "var(--ff-display)", fontSize: "clamp(28px,4vw,42px)", fontWeight: 900, fontStyle: "italic", color: "var(--deep)", marginBottom: "16px" }}>
            My Pieces
          </h1>
          <p style={{ fontFamily: "var(--ff-body)", fontSize: "18px", fontStyle: "italic", color: "var(--muted)" }}>
            Complete your Style Profile to start building your edit.
          </p>
        </div>
      </div>
    );
  }

  // authState === "authenticated"
  const filtered = activeCategory === "ALL" ? items : items.filter((i: any) => i.category === activeCategory);

  const uploadToCloudinary = async (file: File) => {
    setUploading(true);
    setUploadError(null);

    // Client-side pre-check only. IMPORTANT: the authoritative 5 MB limit must be
    // configured in the signed Cloudinary upload preset before deployment — the client
    // check can be bypassed and Cloudinary will accept the file if the preset has no limit.
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Image must be smaller than 5 MB.");
      setUploading(false);
      return;
    }

    if (!proxyPathPrefix) {
      setUploadError("Upload is unavailable in this context. Please try again from the store.");
      setUploading(false);
      return;
    }

    try {
      // Step 1: get a short-lived signed upload token from the server.
      // Path prefix comes from the Shopify App Proxy signed params; never hardcoded.
      const sigRes = await fetch(`${proxyPathPrefix}/api/cloudinary-signature`);
      if (!sigRes.ok) {
        const errData = await sigRes.json().catch(() => ({} as any));
        setUploadError((errData as any).error || "Upload service unavailable. Please try again.");
        setUploading(false);
        return;
      }
      const sig = await sigRes.json() as any;

      // Step 2: upload directly to Cloudinary using the signed payload.
      // asset_folder and allowed_formats are server-controlled; the browser cannot override them.
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", sig.apiKey);
      form.append("timestamp", String(sig.timestamp));
      form.append("signature", sig.signature);
      form.append("asset_folder", sig.assetFolder);
      form.append("upload_preset", sig.uploadPreset);
      form.append("allowed_formats", sig.allowedFormats);

      const cloudRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        { method: "POST", body: form }
      );
      if (!cloudRes.ok) {
        const errData = await cloudRes.json().catch(() => ({} as any));
        setUploadError((errData as any).error?.message || "Upload failed. Please try again.");
        setUploading(false);
        return;
      }
      const cloudData = await cloudRes.json() as any;
      setNewImageUrl(cloudData.secure_url);
    } catch {
      setUploadError("Upload failed. Please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const toggleOccasion = (o: string) => setNewOccasions(prev => prev.includes(o) ? prev.filter(x => x !== o) : [...prev, o]);
  const toggleSeason = (s: string) => setNewSeasons(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const handleAdd = () => {
    if (!newName) return;
    fetcher.submit(
      { intent: "add", name: newName, category: newCategory, imageUrl: newImageUrl, primaryColor: newColor, pattern: newPattern, brand: newBrand, occasions: JSON.stringify(newOccasions), seasons: JSON.stringify(newSeasons) },
      { method: "post" }
    );
    setNewName(""); setNewImageUrl(""); setNewColor(""); setNewPattern(""); setNewBrand(""); setNewOccasions([]); setNewSeasons([]);
    setShowAddForm(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <style>{css}</style>
      <link href={FONTS} rel="stylesheet" />

      <div className="cl-topbar">
        <div className="cl-topbar-logo">nAia</div>
        <Link to="/" className="cl-topbar-link">← Dashboard</Link>
      </div>

      <div className="cl-wrap">
        <h1 className="cl-headline">Digital Wardrobe</h1>
        <p className="cl-sub">Upload, save, and style your pieces</p>

        <div className="cl-stats">
          <div className="cl-stat">
            <div className="cl-stat-num">{items.length}</div>
            <div className="cl-stat-label">Total Pieces</div>
          </div>
          <div className="cl-stat">
            <div className="cl-stat-num">{new Set(items.map((i: any) => i.category)).size}</div>
            <div className="cl-stat-label">Categories</div>
          </div>
          <div className="cl-stat">
            <div className="cl-stat-num">{new Set(items.map((i: any) => i.brand).filter(Boolean)).size}</div>
            <div className="cl-stat-label">Brands</div>
          </div>
        </div>

        {!showAddForm && (
          <button className="cl-add-btn" onClick={() => setShowAddForm(true)}>+ Add a Piece</button>
        )}

        {showAddForm && (
          <div className="cl-form">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h3 className="cl-form-title">Add to Wardrobe</h3>
              <button onClick={() => setShowAddForm(false)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--ff-mono)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--muted)" }}>Cancel</button>
            </div>

            <div className="cl-label">Photo</div>
            <label className="cl-upload-box">
              {newImageUrl
                ? <img src={newImageUrl} alt="preview" style={{ maxHeight: "200px", objectFit: "cover" }} />
                : uploading
                  ? <span className="cl-upload-hint">Uploading...</span>
                  : <span className="cl-upload-hint">Click to upload photo</span>
              }
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && uploadToCloudinary(e.target.files[0])}
                style={{ display: "none" }}
              />
            </label>
            <p className="cl-upload-notice">
              Upload photos of clothing items only. Please do not upload selfies, face photos, mirror photos, body scans, or personal images.
            </p>
            {uploadError && <p className="cl-upload-error">{uploadError}</p>}

            <div className="cl-label">Name *</div>
            <input className="cl-input" type="text" placeholder="e.g. Black silk blazer" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ marginBottom: "24px" }} />

            <div className="cl-label">Category *</div>
            <div className="cl-pills">
              {CATEGORIES.map(c => <button key={c} onClick={() => setNewCategory(c)} className={`cl-pill${newCategory === c ? " on" : ""}`}>{c.charAt(0) + c.slice(1).toLowerCase()}</button>)}
            </div>

            <div className="cl-label">Color</div>
            <div className="cl-pills">
              {COLORS.map(c => <button key={c} onClick={() => setNewColor(c)} className={`cl-pill${newColor === c ? " on" : ""}`}>{c}</button>)}
            </div>

            <div className="cl-label">Pattern</div>
            <div className="cl-pills">
              {PATTERNS.map(p => <button key={p} onClick={() => setNewPattern(p)} className={`cl-pill${newPattern === p ? " on" : ""}`}>{p}</button>)}
            </div>

            <div className="cl-label">Occasions</div>
            <div className="cl-pills">
              {OCCASIONS.map(o => <button key={o} onClick={() => toggleOccasion(o)} className={`cl-pill${newOccasions.includes(o) ? " on" : ""}`}>{o}</button>)}
            </div>

            <div className="cl-label">Season</div>
            <div className="cl-pills">
              {SEASONS.map(s => <button key={s} onClick={() => toggleSeason(s)} className={`cl-pill${newSeasons.includes(s) ? " on" : ""}`}>{s}</button>)}
            </div>

            <div className="cl-label">Brand (optional)</div>
            <input className="cl-input" type="text" placeholder="Brand name" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} style={{ marginBottom: "32px" }} />

            <button className="cl-submit" onClick={handleAdd} disabled={!newName || !newImageUrl || uploading}>
              {uploading ? "Uploading..." : "Add to Wardrobe"}
            </button>
          </div>
        )}

        <div className="cl-filters">
          {["ALL", ...CATEGORIES].map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)} className={`cl-filter${activeCategory === cat ? " on" : ""}`}>
              {cat === "ALL" ? "All" : cat.charAt(0) + cat.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <p className="cl-count">{filtered.length} {filtered.length === 1 ? "piece" : "pieces"}</p>

        {filtered.length === 0 && (
          <div className="cl-empty">
            <div className="cl-empty-icon">◇</div>
            <p className="cl-empty-text">No pieces yet in this category</p>
            <button onClick={() => setShowAddForm(true)} className="cl-add-btn" style={{ width: "auto", display: "inline-block", marginBottom: 0 }}>Add Your First Piece</button>
          </div>
        )}

        <div className="cl-grid">
          {filtered.map((item: any) => (
            <div key={item.id} className="cl-card">
              <div className="cl-card-img">
                {item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <span style={{ fontSize: "64px", opacity: 0.2 }}>◇</span>}
              </div>
              <div className="cl-card-body">
                <div className="cl-card-cat">{item.category}</div>
                <div className="cl-card-name">{item.name}</div>
                {(item.primaryColor || item.pattern) && (
                  <div className="cl-card-meta">{[item.primaryColor, item.pattern].filter(Boolean).join(" · ")}</div>
                )}
                {item.brand && <div className="cl-card-meta" style={{ marginTop: "4px" }}>{item.brand}</div>}
                {item.occasions?.length > 0 && <div className="cl-card-meta" style={{ marginTop: "4px" }}>{item.occasions.slice(0, 2).join(", ")}</div>}
              </div>
              <button className="cl-delete" onClick={() => fetcher.submit({ intent: "delete", itemId: item.id }, { method: "post" })}>×</button>
            </div>
          ))}
        </div>

        <div className="cl-cta">
          <Link to="/quick-style">Style Me →</Link>
        </div>
      </div>
    </div>
  );
}
