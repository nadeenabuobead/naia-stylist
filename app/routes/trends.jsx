import { useState } from "react";
import { Link } from "react-router";
import naiaStyles from "../styles/naia-design-system.css?url";
import { PublicNav, PublicFooter } from "../components/PublicLayout";

export const links = () => [{ rel: "stylesheet", href: naiaStyles }];

const CATEGORIES = ["all", "silhouette", "colour", "material", "styling", "print", "wardrobe"];

const reports = [
  { n: "01", slug: "the-return-of-the-shoulder", cat: "silhouette", title: "the return of the shoulder", excerpt: "Tailoring is widening again — softly. Rounded, sculptural shoulders replace the sharp revival of last season.", date: "fw'26 · vol. 03", read: "6 min read", tint: "#efeae0" },
  { n: "02", slug: "rust-bone-and-ember", cat: "colour", title: "rust, bone, and ember", excerpt: "Earth palettes are deepening. Rust holds steady, bone replaces ivory, and ember red absorbs the lipstick gesture.", date: "fw'26 · vol. 03", read: "5 min read", tint: "#e6dccb" },
  { n: "03", slug: "leather-softened", cat: "material", title: "leather, softened", excerpt: "Heavy leather gives way to washed nappa and brushed suede — fabrications that drape instead of armour.", date: "fw'26 · vol. 02", read: "4 min read", tint: "#d9c9b5" },
  { n: "04", slug: "the-undone-tuck", cat: "styling", title: "the undone tuck", excerpt: "The half-tuck is quieting into something more deliberate: an intentional looseness at the waist that reads composed, not careless.", date: "fw'26 · vol. 02", read: "4 min read", tint: "#efe6d7" },
  { n: "05", slug: "hand-painted-scanned", cat: "print", title: "hand-painted, scanned", excerpt: "Studio-painted prints are eclipsing digital-native graphics. The brush is the new pixel.", date: "fw'26 · vol. 01", read: "5 min read", tint: "#e2d3bf" },
  { n: "06", slug: "the-one-perfect-coat", cat: "wardrobe", title: "the one perfect coat", excerpt: "Shoppers are buying less but longer. Capsule loyalty is rising, and the search for a single, resolved outerwear piece is now a stated intent.", date: "fw'26 · vol. 01", read: "6 min read", tint: "#ede2cf" },
];

const sec = { maxWidth: "100rem", margin: "0 auto", padding: "0 1.25rem" };

export default function TrendReportsPage() {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? reports : reports.filter((r) => r.cat === filter);

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)" }}>
      <PublicNav tone="light" />

      {/* HERO */}
      <section style={{ ...sec, paddingTop: "5rem", paddingBottom: "2.5rem" }}>
        <div style={{ paddingTop: "2rem", display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "1.5rem" }}>
          <div>
            <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>current edit · fw'26</div>
            <h1 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1.5rem", fontSize: "clamp(3.5rem, 10vw, 9rem)", lineHeight: 0.88 }}>
              trend<br />
              <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>reports.</span>
            </h1>
          </div>
          <div style={{ maxWidth: "24rem" }}>
            <p style={{ fontStyle: "italic", color: "var(--fg-75)", fontSize: "1.1rem", lineHeight: 1.65, fontFamily: "var(--ff-editorial)" }}>
              Seasonal intelligence on the silhouettes, colours, materials and styling shifts worth paying attention to — and how to make them work in real life.
            </p>
            <div style={{ marginTop: "1.5rem", fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.32em", color: "var(--fg-55)" }}>
              curated by nadine. personalised by <span style={{ color: "var(--lipstick)" }}>nAia</span>.
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED REPORT */}
      <section style={{ ...sec, paddingBottom: "4rem" }}>
        <div style={{ position: "relative", overflow: "hidden", background: "#efeae0" }}>
          <span aria-hidden="true" style={{ fontFamily: "var(--ff-display)", fontWeight: 200, pointerEvents: "none", position: "absolute", right: "-1.5rem", top: "-4rem", fontSize: "clamp(10rem, 20vw, 22rem)", lineHeight: 1, color: "rgba(42,30,23,0.05)", userSelect: "none" }}>00</span>
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(22rem, 100%), 1fr))", gap: "2.5rem", padding: "3.5rem 2rem" }}>
            <div>
              <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>latest report</div>
              <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1.5rem", fontSize: "clamp(2.5rem, 6vw, 4.5rem)", lineHeight: 0.95 }}>
                soft<br />structure.
              </h2>
              <p style={{ marginTop: "2rem", maxWidth: "30rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
                Tailoring remains present, but the way it is worn is becoming quieter, softer and easier to integrate into real wardrobes.
              </p>
              <div style={{ marginTop: "2.5rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem" }}>
                <Link to="/trends/soft-structure" style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem", border: "1px solid rgba(42,30,23,0.8)", borderRadius: "9999px", padding: "0.75rem 1.5rem", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg)", textDecoration: "none", fontFamily: "var(--ff-display)" }}>
                  read the report →
                </Link>
                <Link to="/my-naia/trend-edits" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--lipstick)", textDecoration: "none", fontFamily: "var(--ff-display)" }}>
                  make it personal ↗
                </Link>
              </div>
              <div style={{ marginTop: "2.5rem", display: "flex", flexWrap: "wrap", gap: "1.5rem", fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>
                <span>silhouette · styling</span><span>fw'26 · vol. 03</span><span>8 min read</span>
              </div>
            </div>
            <div style={{ position: "relative", minHeight: "22rem", background: "#d9c9b5" }}>
              <span style={{ position: "absolute", inset: "1.5rem", border: "1px solid rgba(42,30,23,0.1)" }} aria-hidden="true" />
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", padding: "2rem" }}>
                <span style={{ fontStyle: "italic", color: "rgba(42,30,23,0.6)", fontSize: "0.875rem", fontFamily: "var(--ff-editorial)" }}>editorial artwork · fw'26</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FILTERS */}
      <section style={{ ...sec }}>
        <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--fg-15)", paddingBottom: "1rem" }}>
          <div style={{ display: "flex", gap: "1.5rem", overflowX: "auto", flexShrink: 1 }}>
            {CATEGORIES.map((c) => (
              <button key={c} type="button" onClick={() => setFilter(c)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0.25rem 0", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.3em", color: filter === c ? "var(--lipstick)" : "var(--fg-55)", borderBottom: filter === c ? "1px solid var(--lipstick)" : "1px solid transparent", fontFamily: "var(--ff-display)", whiteSpace: "nowrap" }}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* REPORT GRID */}
      <section style={{ ...sec, paddingTop: "3rem", paddingBottom: "4rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(22rem, 100%), 1fr))", gap: "1.25rem" }}>
          {filtered.map((r) => (
            <Link key={r.n} to={`/trends/${r.slug}`} style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", aspectRatio: "4/5", overflow: "hidden", background: r.tint, padding: "1.5rem", textDecoration: "none", color: "var(--fg)" }}>
              <span aria-hidden="true" style={{ fontFamily: "var(--ff-display)", fontWeight: 200, position: "absolute", right: "-1rem", top: "-2rem", fontSize: "clamp(8rem, 12vw, 12rem)", lineHeight: 1, color: "rgba(42,30,23,0.06)", pointerEvents: "none", userSelect: "none" }}>{r.n}</span>
              <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-60)" }}>
                <span style={{ display: "inline-block", width: "0.375rem", height: "0.375rem", borderRadius: "50%", background: "var(--lipstick)" }} />{r.cat}
              </div>
              <div style={{ position: "relative", zIndex: 1 }}>
                <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(1.6rem, 3vw, 2.25rem)", lineHeight: 1.1 }}>{r.title}</h2>
                <p style={{ marginTop: "1rem", fontSize: "0.875rem", lineHeight: 1.6, color: "var(--fg-70)" }}>{r.excerpt}</p>
                <div style={{ marginTop: "1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>
                  <span>{r.date} · {r.read}</span>
                  <span style={{ fontSize: "1rem", color: "var(--fg-50)" }}>↗</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* FASHION INTELLIGENCE */}
      <section style={{ ...sec, paddingBottom: "5rem" }}>
        <div style={{ borderTop: "1px solid var(--fg-15)", paddingTop: "3rem" }}>
          <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>fashion intelligence</div>
          <div style={{ marginTop: "1.5rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(22rem, 100%), 1fr))", gap: "2.5rem", alignItems: "end" }}>
            <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2rem, 5vw, 3.75rem)", lineHeight: 0.95 }}>
              the new way<br />we get <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>dressed.</span>
            </h2>
            <div>
              <p style={{ maxWidth: "30rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
                Discovery is shifting from filter-based shopping to conversational styling. Women want a point of view — not a grid. A quieter reflection on how the wardrobe itself is being rethought.
              </p>
              <Link to="/trends/soft-structure" style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem", marginTop: "2rem", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-80)", textDecoration: "none", borderBottom: "1px solid var(--fg-30)", paddingBottom: "0.25rem", fontFamily: "var(--ff-display)" }}>
                read the report ↗
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* PERSONAL TREND EDIT */}
      <section style={{ background: "#2a1e17", color: "var(--bg)" }}>
        <div style={{ maxWidth: "100rem", margin: "0 auto", padding: "5rem 1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(24rem, 100%), 1fr))", gap: "3.5rem" }}>
            <div>
              <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "rgba(255,248,240,0.55)" }}>personal trend edit</div>
              <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1.5rem", fontSize: "clamp(2.5rem, 6vw, 4.5rem)", lineHeight: 0.9 }}>
                make the<br />report <span style={{ fontStyle: "italic", color: "#e8c9a8", fontFamily: "var(--ff-editorial)" }}>yours.</span>
              </h2>
              <p style={{ marginTop: "2rem", maxWidth: "30rem", fontSize: "1rem", lineHeight: 1.75, color: "rgba(255,248,240,0.75)" }}>
                The public report explains the shift. Your Personal Trend Edit considers your Style Passport, Closet, saved pieces, previous choices and what you already own — then shows what is relevant to you, what to skip, and how to wear it.
              </p>
              <div style={{ marginTop: "2.5rem" }}>
                <Link to="/my-naia/trend-edits" style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem", border: "1px solid rgba(255,248,240,0.8)", borderRadius: "9999px", padding: "0.75rem 1.5rem", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--bg)", textDecoration: "none", fontFamily: "var(--ff-display)" }}>
                  create my trend edit →
                </Link>
                <p style={{ marginTop: "1.5rem", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.22em", color: "rgba(255,248,240,0.5)" }}>
                  the public trend reports remain free to read.
                </p>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "rgba(255,248,240,0.1)" }}>
              {[
                { k: "you already own", v: "matched from your closet" },
                { k: "you've saved", v: "pulled from wishlist" },
                { k: "you've chosen before", v: "read from order history" },
                { k: "your style dna says", v: "from your style passport" },
              ].map((e) => (
                <div key={e.k} style={{ background: "#2a1e17", padding: "1.5rem 2rem" }}>
                  <div style={{ fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "#e8c9a8" }}>{e.k}</div>
                  <div style={{ marginTop: "0.75rem", fontStyle: "italic", color: "rgba(255,248,240,0.7)", fontFamily: "var(--ff-editorial)" }}>{e.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
