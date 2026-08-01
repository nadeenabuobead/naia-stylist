import { useState, useMemo } from "react";
import { useLoaderData, useFetcher, Link, useSearchParams } from "react-router";
import { data, redirect, type LinksFunction, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import naiaStyles from "~/styles/naia-design-system.css?url";
import prisma from "../db.server";
import { requireCurrentNaiaCustomer, getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { assessClosetEligibility, CLOSET_ELIGIBILITY_DISPLAY, type ClosetTryOnEligibility } from "~/lib/ai/closet-eligibility";
import { runStageBAssessment } from "~/lib/ai/closet-eligibility.server";
import { emitClosetItemAdded, recordJourneyEventAwaited } from "~/lib/ai/journey-events.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const CATEGORIES = ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS", "ACCESSORIES", "JEWELRY", "OTHER"];
const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver", "Multicolor"];
const OCCASIONS = ["Casual", "Work", "Dinner", "Party", "Formal", "Date", "Weekend", "Travel"];
const SEASONS = ["Spring", "Summer", "Fall", "Winter", "All Season"];
const PATTERNS = ["Solid", "Stripes", "Floral", "Plaid", "Animal Print", "Geometric", "Abstract", "Other"];

const GENERAL_PHOTO_TIPS = [
  "Photograph one item only",
  "Use a plain, contrasting background",
  "Use bright, even lighting",
  "Keep the image sharp and in focus",
  "Make sure the entire item is visible",
  "Do not crop any important part",
  "Avoid hands, people, clutter or other items covering it",
];

const CATEGORY_PHOTO_TIPS: Record<string, { title: string; tips: string[] }> = {
  TOPS:      { title: "For clothing", tips: ["Lay it flat or hang it straight", "Show the full neckline, sleeves, waist and hem", "Do not fold or bunch the garment"] },
  BOTTOMS:   { title: "For clothing", tips: ["Lay it flat or hang it straight", "Show the full waistband and hem", "Do not fold or bunch the garment"] },
  DRESSES:   { title: "For clothing", tips: ["Hang or lay fully flat", "Show the full neckline, sleeves, waist and hem", "Do not fold or bunch the garment"] },
  OUTERWEAR: { title: "For clothing", tips: ["Lay flat or hang straight", "Show the full collar, sleeves and hem", "Do not fold or bunch the garment"] },
  SHOES:     { title: "For shoes", tips: ["Show the full pair", "Keep both shoes visible and unobstructed", "Do not photograph while worn", "Use a clear side or three-quarter view"] },
  BAGS:      { title: "For bags", tips: ["Show the complete bag", "Keep handles and straps fully visible", "Use a front or three-quarter view", "Remove anything covering its shape"] },
};

// ── Eligibility status label / hint ────────────────────────────────────────

function eligibilityStatus(elig: ClosetTryOnEligibility | null, hint: string | null) {
  if (!elig) return null;
  const display = CLOSET_ELIGIBILITY_DISPLAY[elig];
  const isNeeds = elig === "needs-clearer-photo";
  return { label: display.label, hint: hint || display.fallbackHint, isNeeds };
}

// ── Meta / loader / action (unchanged from prior implementation) ─────────────

export function meta() {
  return [{ title: "Digital Closet | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const customer = await prisma.customer.findUnique({
    where: { id: naiaCustomer.id },
    include: { closetItems: { orderBy: { createdAt: "desc" } } },
  });
  if (!customer) return redirect("/auth/shopify/login");
  return data({ items: customer.closetItems });
}

export async function action({ request }: ActionFunctionArgs) {
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) {
    return data({ error: "Not authenticated" }, { status: 401 });
  }
  const customer = await prisma.customer.findUnique({ where: { id: naiaCustomer.id } });
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
    const imageWidth  = formData.get("imageWidth")  ? Number(formData.get("imageWidth"))  : undefined;
    const imageHeight = formData.get("imageHeight") ? Number(formData.get("imageHeight")) : undefined;
    const imageFormat = (formData.get("imageFormat") as string | null) ?? undefined;
    const imageBytes  = formData.get("imageBytes")  ? Number(formData.get("imageBytes"))  : undefined;

    if (!name || !category || !imageUrl) return data({ error: "Name and category required" }, { status: 400 });

    const stageA = assessClosetEligibility({
      prismaCategory: category,
      width: imageWidth,
      height: imageHeight,
      format: imageFormat,
      bytes: imageBytes,
    });

    const newItem = await prisma.closetItem.create({
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
        tryOnEligibility: stageA.eligible,
        tryOnAssessedAt: new Date(stageA.assessedAt),
        tryOnCustomerHint: stageA.customerHint,
        tryOnInternalNote: stageA.internalNote,
      },
    });

    try {
      await recordJourneyEventAwaited(
        emitClosetItemAdded({
          customerId: customer.id,
          closetItemId: newItem.id,
          category: newItem.category,
          tryOnEligibility: newItem.tryOnEligibility ?? null,
        }),
        `closet_item_added:${newItem.id}:v1`,
      );
    } catch { /* event emission never blocks the response */ }

    if (stageA.eligible === "pending-assessment" && imageUrl) {
      await runStageBAssessment(
        newItem.id,
        imageUrl,
        stageA.category,
        async (id, fields) => {
          await prisma.closetItem.update({ where: { id }, data: fields });
        },
      );
    }

    return data({ success: true });
  }

  if (intent === "delete") {
    const itemId = formData.get("itemId") as string;
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

// ── Component ────────────────────────────────────────────────────────────────

export default function Closet() {
  const { items } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [searchParams] = useSearchParams();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Upload form state
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
  const [imgMeta, setImgMeta] = useState<{ width?: number; height?: number; format?: string; bytes?: number }>({});

  // URL-based filter (filter=needs-photo)
  const urlFilter = searchParams.get("filter");
  const needsPhotoOnly = urlFilter === "needs-photo";

  // Filtered items
  const filtered = useMemo(() => {
    return items.filter((i: any) => {
      if (needsPhotoOnly && i.tryOnEligibility !== "needs-clearer-photo") return false;
      if (activeCategory !== "ALL" && i.category !== activeCategory) return false;
      if (searchQuery && !((i.name ?? "").toLowerCase().includes(searchQuery.toLowerCase()))) return false;
      return true;
    });
  }, [items, needsPhotoOnly, activeCategory, searchQuery]);

  async function uploadToCloudinary(file: File) {
    setUploading(true);
    setUploadError(null);

    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Image must be smaller than 5 MB.");
      setUploading(false);
      return;
    }

    try {
      const sigRes = await fetch("/api/cloudinary-signature", { credentials: "same-origin" });
      if (!sigRes.ok) {
        const errData = await sigRes.json().catch(() => ({} as any));
        setUploadError((errData as any).error || "Upload service unavailable. Please try again.");
        setUploading(false);
        return;
      }
      const sig = await sigRes.json() as any;

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
      setImgMeta({
        width:  cloudData.width  ?? undefined,
        height: cloudData.height ?? undefined,
        format: cloudData.format ?? undefined,
        bytes:  cloudData.bytes  ?? undefined,
      });
    } catch {
      setUploadError("Upload failed. Please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  function toggleOccasion(o: string) {
    setNewOccasions(prev => prev.includes(o) ? prev.filter(x => x !== o) : [...prev, o]);
  }
  function toggleSeason(s: string) {
    setNewSeasons(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  function handleAdd() {
    if (!newName) return;
    fetcher.submit(
      {
        intent: "add", name: newName, category: newCategory, imageUrl: newImageUrl,
        primaryColor: newColor, pattern: newPattern, brand: newBrand,
        occasions: JSON.stringify(newOccasions), seasons: JSON.stringify(newSeasons),
        ...(imgMeta.width  !== undefined && { imageWidth:  String(imgMeta.width)  }),
        ...(imgMeta.height !== undefined && { imageHeight: String(imgMeta.height) }),
        ...(imgMeta.format !== undefined && { imageFormat: imgMeta.format         }),
        ...(imgMeta.bytes  !== undefined && { imageBytes:  String(imgMeta.bytes)  }),
      },
      { method: "post" }
    );
    setNewName(""); setNewImageUrl(""); setNewColor(""); setNewPattern(""); setNewBrand("");
    setNewOccasions([]); setNewSeasons([]); setImgMeta({});
    setShowAddForm(false);
  }

  const editingItem = editingId ? items.find((i: any) => i.id === editingId) : null;

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      {/* Section shell */}
      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Digital Closet</div>
        <h1 className="sp-shell-title">Your Digital Closet</h1>
        <p className="sp-shell-desc">
          A private inventory of the pieces you already own — used to style new nAia picks with your
          existing wardrobe. Add one clothing item, shoe pair or bag at a time.
        </p>
      </div>

      {/* State note for needs-photo filter */}
      {needsPhotoOnly && (
        <div className="dc-state-note" style={{ marginBottom: "24px" }}>
          Showing items with a clearer-photo request.{" "}
          <Link to="/closet">Show all items</Link>.
        </div>
      )}

      {/* Upload CTAs */}
      <div className="sp-actions" style={{ marginBottom: "32px" }}>
        <button type="button" className="sp-btn-primary" onClick={() => setShowAddForm(true)}>
          Upload Item
        </button>
        <button type="button" className="sp-btn-outline" onClick={() => setShowAddForm(true)}>
          Take a Photo
        </button>
      </div>

      {/* Filter + search row */}
      <div className="dc-filter-row" style={{ marginBottom: "24px" }}>
        <div className="dc-filter-pills">
          {["ALL", ...CATEGORIES].map(cat => (
            <button
              key={cat}
              type="button"
              className={`dc-filter-pill${activeCategory === cat ? " dc-filter-pill--active" : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat === "ALL" ? "All" : cat.charAt(0) + cat.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <label className="dc-search-wrap">
          <span>Search</span>
          <input
            type="text"
            className="dc-search-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Ivory trouser…"
          />
        </label>
      </div>

      {/* Item list */}
      {filtered.length === 0 ? (
        <div className="dc-empty">
          <p className="dc-empty-text">
            {items.length === 0
              ? "Your closet is empty. Upload your first piece to get started."
              : "No items match this view."}
          </p>
          {items.length === 0 && (
            <button type="button" className="sp-btn-primary" onClick={() => setShowAddForm(true)}>
              Upload Your First Piece
            </button>
          )}
        </div>
      ) : (
        <ul className="dc-list">
          {filtered.map((item: any) => {
            const elig = eligibilityStatus(item.tryOnEligibility, item.tryOnCustomerHint);
            return (
              <li key={item.id} className="dc-item">
                {/* Thumbnail */}
                <div className="dc-thumb">
                  {item.imageUrl
                    ? <img src={item.imageUrl} alt={item.name} />
                    : <span aria-hidden style={{ fontSize: "32px", opacity: 0.18, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>◇</span>
                  }
                </div>

                {/* Details */}
                <div className="dc-item-body">
                  <div className="dc-item-cat">{item.category.charAt(0) + item.category.slice(1).toLowerCase()}</div>
                  <div className="dc-item-name">{item.name}</div>
                  {elig && (
                    <>
                      <div className={`dc-item-status${elig.isNeeds ? " dc-item-status--needs" : ""}`}>
                        {elig.label}
                      </div>
                      {elig.isNeeds && elig.hint && (
                        <p className="dc-item-reason">{elig.hint}</p>
                      )}
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="dc-item-actions">
                  {elig?.isNeeds && (
                    <button type="button" className="dc-action dc-action--accent" onClick={() => setShowAddForm(true)}>
                      Retake Photo
                    </button>
                  )}
                  <button type="button" className="dc-action" onClick={() => setEditingId(item.id)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="dc-action"
                    onClick={() => fetcher.submit({ intent: "delete", itemId: item.id }, { method: "post" })}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Add Item modal ─────────────────────────────────────────────────── */}
      {showAddForm && (
        <div className="dc-modal-overlay" role="dialog" aria-modal="true" aria-label="Add item to closet">
          <div className="dc-modal">
            <div className="dc-modal-eyebrow">Digital Closet</div>
            <h2 className="dc-modal-title">Add to Your Closet</h2>

            <div style={{ marginTop: "24px" }}>
              {/* Photo guide */}
              <div className="dc-guide">
                <div className="dc-guide-header">Photo guide</div>
                <div className="dc-guide-cols">
                  <div>
                    <div className="dc-guide-col-label">General</div>
                    <ul className="dc-guide-tips">
                      {GENERAL_PHOTO_TIPS.map((tip, i) => <li key={i}>{tip}</li>)}
                    </ul>
                  </div>
                  {CATEGORY_PHOTO_TIPS[newCategory] && (
                    <div>
                      <div className="dc-guide-col-label">{CATEGORY_PHOTO_TIPS[newCategory].title}</div>
                      <ul className="dc-guide-tips">
                        {CATEGORY_PHOTO_TIPS[newCategory].tips.map((tip, i) => <li key={i}>{tip}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="dc-guide-examples">
                  <div className="dc-guide-ex good">
                    <div className="dc-guide-ex-mark">✓</div>
                    <div className="dc-guide-ex-text">Single item · plain background · fully visible · well lit</div>
                  </div>
                  <div className="dc-guide-ex avoid">
                    <div className="dc-guide-ex-mark">✗</div>
                    <div className="dc-guide-ex-text">Multiple items or cluttered background</div>
                  </div>
                  <div className="dc-guide-ex avoid">
                    <div className="dc-guide-ex-mark">✗</div>
                    <div className="dc-guide-ex-text">Item cropped, blurry or poorly lit</div>
                  </div>
                </div>
              </div>

              {/* Photo upload */}
              <div className="dc-form-row">
                <label className="dc-form-label">Photo</label>
                <label className="dc-upload-box">
                  {newImageUrl
                    ? <img src={newImageUrl} alt="preview" style={{ maxHeight: "180px", objectFit: "cover", margin: "0 auto", display: "block" }} />
                    : uploading
                      ? <span className="dc-upload-hint">Uploading…</span>
                      : <span className="dc-upload-hint">Click to upload photo</span>
                  }
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => e.target.files?.[0] && uploadToCloudinary(e.target.files[0])}
                    style={{ display: "none" }}
                  />
                </label>
                <p className="dc-upload-notice">
                  Upload photos of clothing items only. Do not upload selfies, face photos, mirror photos, body scans, or personal images.
                </p>
                {uploadError && <p className="dc-upload-error">{uploadError}</p>}
              </div>

              {/* Name */}
              <div className="dc-form-row">
                <label className="dc-form-label">Name *</label>
                <input
                  className="dc-form-input"
                  type="text"
                  placeholder="e.g. Black silk blazer"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </div>

              {/* Category */}
              <div className="dc-form-row">
                <label className="dc-form-label">Category *</label>
                <div className="dc-form-pills">
                  {CATEGORIES.map(c => (
                    <button key={c} type="button"
                      className={`dc-form-pill${newCategory === c ? " dc-form-pill--on" : ""}`}
                      onClick={() => setNewCategory(c)}>
                      {c.charAt(0) + c.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color */}
              <div className="dc-form-row">
                <label className="dc-form-label">Color</label>
                <div className="dc-form-pills">
                  {COLORS.map(c => (
                    <button key={c} type="button"
                      className={`dc-form-pill${newColor === c ? " dc-form-pill--on" : ""}`}
                      onClick={() => setNewColor(c)}>{c}</button>
                  ))}
                </div>
              </div>

              {/* Pattern */}
              <div className="dc-form-row">
                <label className="dc-form-label">Pattern</label>
                <div className="dc-form-pills">
                  {PATTERNS.map(p => (
                    <button key={p} type="button"
                      className={`dc-form-pill${newPattern === p ? " dc-form-pill--on" : ""}`}
                      onClick={() => setNewPattern(p)}>{p}</button>
                  ))}
                </div>
              </div>

              {/* Occasions */}
              <div className="dc-form-row">
                <label className="dc-form-label">Occasions</label>
                <div className="dc-form-pills">
                  {OCCASIONS.map(o => (
                    <button key={o} type="button"
                      className={`dc-form-pill${newOccasions.includes(o) ? " dc-form-pill--on" : ""}`}
                      onClick={() => toggleOccasion(o)}>{o}</button>
                  ))}
                </div>
              </div>

              {/* Season */}
              <div className="dc-form-row">
                <label className="dc-form-label">Season</label>
                <div className="dc-form-pills">
                  {SEASONS.map(s => (
                    <button key={s} type="button"
                      className={`dc-form-pill${newSeasons.includes(s) ? " dc-form-pill--on" : ""}`}
                      onClick={() => toggleSeason(s)}>{s}</button>
                  ))}
                </div>
              </div>

              {/* Brand */}
              <div className="dc-form-row">
                <label className="dc-form-label">Brand (optional)</label>
                <input
                  className="dc-form-input"
                  type="text"
                  placeholder="Brand name"
                  value={newBrand}
                  onChange={e => setNewBrand(e.target.value)}
                />
              </div>
            </div>

            <div className="dc-modal-actions">
              <button type="button" className="sp-btn-ghost" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button
                type="button"
                className="sp-btn-primary"
                onClick={handleAdd}
                disabled={!newName || !newImageUrl || uploading}
              >
                {uploading ? "Uploading…" : "Add to Closet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit modal (UI-only — no edit endpoint yet) ─────────────────────── */}
      {editingItem && (
        <div className="dc-modal-overlay" role="dialog" aria-modal="true" aria-label="Edit closet item">
          <div className="dc-modal">
            <div className="dc-modal-eyebrow">Edit Item</div>
            <h2 className="dc-modal-title">{editingItem.name}</h2>
            <p className="dc-modal-desc">
              To update this item, delete it and re-upload with the correct details.
            </p>
            <div className="dc-modal-actions">
              <button type="button" className="sp-btn-ghost" onClick={() => setEditingId(null)}>Close</button>
              <button
                type="button"
                className="sp-btn-outline"
                onClick={() => {
                  setEditingId(null);
                  fetcher.submit({ intent: "delete", itemId: editingItem.id }, { method: "post" });
                }}
              >
                Delete Item
              </button>
            </div>
          </div>
        </div>
      )}
    </MyNaiaLayout>
  );
}
