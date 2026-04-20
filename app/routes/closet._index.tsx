// app/routes/closet._index.tsx
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { useState, useEffect } from "react";
import { getCustomerId } from "~/lib/auth.server";
import { prisma } from "~/lib/prisma.server";

const CATEGORIES = ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS", "ACCESSORIES", "JEWELRY", "OTHER"];

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
      if (!name || !category) return data({ error: "Name and category required" }, { status: 400 });
      const item = await prisma.closetItem.create({
        data: { customerId, name, category: category as any, imageUrl: imageUrl || "" },
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

export default function ClosetPage() {
  const { items, authenticated } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const fetcher = useFetcher();
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("TOPS");
  const [newImageUrl, setNewImageUrl] = useState("");

  useEffect(() => {
    const urlToken = searchParams.get("naia_token");
    if (urlToken) sessionStorage.setItem("naia_token", urlToken);
  }, []);

  const filtered = activeCategory === "ALL" ? items : items.filter((i: any) => i.category === activeCategory);

  const handleAdd = () => {
    if (!newName) return;
    fetcher.submit(
      { intent: "add", name: newName, category: newCategory, imageUrl: newImageUrl },
      { method: "post" }
    );
    setNewName("");
    setNewImageUrl("");
    setShowAddForm(false);
  };

  if (!authenticated) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
        <div style={{ textAlign: "center", maxWidth: "24rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>👗</div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>My Closet</h1>
          <p style={{ color: "#888", marginBottom: "1.5rem" }}>Log in to your account on naiabynadine.com to access your closet.</p>
          <a href="https://naiabynadine.com/account/login" style={{ padding: "0.75rem 1.5rem", background: "#c4a0a0", color: "white", borderRadius: "9999px", textDecoration: "none", fontWeight: 500 }}>Log In</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#faf9f7" }}>
      <header style={{ padding: "1rem", background: "white", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: "32rem", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="https://naiabynadine.com/pages/ask-naia" style={{ color: "#888", textDecoration: "none", fontSize: "0.875rem" }}>← Back</a>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 500 }}>My Closet</h1>
          <button onClick={() => setShowAddForm(!showAddForm)} style={{ fontSize: "0.875rem", fontWeight: 500, color: "#c4a0a0", background: "none", border: "none", cursor: "pointer" }}>+ Add</button>
        </div>
      </header>

      <main style={{ padding: "1rem", maxWidth: "32rem", margin: "0 auto" }}>
        {showAddForm && (
          <div style={{ background: "white", borderRadius: "0.75rem", padding: "1rem", marginBottom: "1rem" }}>
            <h3 style={{ fontWeight: 500, marginBottom: "1rem" }}>Add a piece</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <input type="text" placeholder="Item name (e.g. Black blazer)" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ padding: "0.75rem", borderRadius: "0.5rem", border: "1px solid #e5e5e5", fontSize: "0.875rem", width: "100%", boxSizing: "border-box" as const }} />
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} style={{ padding: "0.75rem", borderRadius: "0.5rem", border: "1px solid #e5e5e5", fontSize: "0.875rem", background: "white" }}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
              </select>
              <input type="url" placeholder="Image URL (optional)" value={newImageUrl} onChange={(e) => setNewImageUrl(e.target.value)} style={{ padding: "0.75rem", borderRadius: "0.5rem", border: "1px solid #e5e5e5", fontSize: "0.875rem", width: "100%", boxSizing: "border-box" as const }} />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={handleAdd} disabled={!newName} style={{ flex: 1, padding: "0.75rem", background: "#c4a0a0", color: "white", border: "none", borderRadius: "0.5rem", fontWeight: 500, cursor: "pointer" }}>Add to Closet</button>
                <button onClick={() => setShowAddForm(false)} style={{ padding: "0.75rem 1rem", background: "transparent", color: "#888", border: "1px solid #e5e5e5", borderRadius: "0.5rem", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
          {["ALL", ...CATEGORIES].map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)} style={{ padding: "0.375rem 0.875rem", borderRadius: "9999px", fontSize: "0.75rem", fontWeight: 500, whiteSpace: "nowrap" as const, border: "none", cursor: "pointer", background: activeCategory === cat ? "#2d2d2d" : "white", color: activeCategory === cat ? "white" : "#888" }}>
              {cat.charAt(0) + cat.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <p style={{ fontSize: "0.875rem", color: "#888", marginBottom: "1rem" }}>{filtered.length} {filtered.length === 1 ? "item" : "items"}</p>

        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>👗</div>
            <p style={{ color: "#888", marginBottom: "1rem" }}>No items yet in this category</p>
            <button onClick={() => setShowAddForm(true)} style={{ padding: "0.75rem 1.5rem", background: "#c4a0a0", color: "white", border: "none", borderRadius: "9999px", fontWeight: 500, cursor: "pointer" }}>Add Your First Piece</button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>
          {filtered.map((item: any) => (
            <div key={item.id} style={{ background: "white", borderRadius: "0.75rem", overflow: "hidden", position: "relative" }}>
              <div style={{ aspectRatio: "1", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: "2.5rem" }}>👗</span>}
              </div>
              <div style={{ padding: "0.75rem" }}>
                <p style={{ fontWeight: 500, fontSize: "0.875rem", marginBottom: "0.25rem" }}>{item.name}</p>
                <p style={{ fontSize: "0.75rem", color: "#888" }}>{item.category.charAt(0) + item.category.slice(1).toLowerCase()}</p>
              </div>
              <button onClick={() => fetcher.submit({ intent: "delete", itemId: item.id }, { method: "post" })} style={{ position: "absolute", top: "0.5rem", right: "0.5rem", background: "rgba(0,0,0,0.5)", color: "white", border: "none", borderRadius: "9999px", width: "1.5rem", height: "1.5rem", cursor: "pointer", fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "2rem", textAlign: "center" }}>
          <a href="https://naiabynadine.com/pages/ask-naia" style={{ padding: "0.75rem 1.5rem", background: "#2d2d2d", color: "white", borderRadius: "9999px", textDecoration: "none", fontWeight: 500, fontSize: "0.875rem" }}>
            ✨ Style Me
          </a>
        </div>
      </main>
    </div>
  );
}

