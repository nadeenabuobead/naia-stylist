import { useState } from "react";
import type { LinksFunction } from "react-router";
import { Link } from "react-router";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { PublicNav, PublicFooter } from "~/components/PublicLayout";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

type Filter = "all" | "tops" | "bottoms" | "dresses" | "outerwear";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Shop All" },
  { key: "tops", label: "Tops" },
  { key: "bottoms", label: "Bottoms" },
  { key: "dresses", label: "Dresses" },
  { key: "outerwear", label: "Outerwear" },
];

type Piece = { id: string; src: string; n: string; t: string; p: string; note: string; cat: Filter };

const pieces: Piece[] = [
  { id: "archive-crewneck",      src: "/nadine/sweater.png",  n: "01", t: "Becoming Alive",       p: "AED —", note: "merino · hand-screened", cat: "tops" },
  { id: "print-collar-shirt",    src: "/nadine/shirt.png",    n: "02", t: "Becoming Real",         p: "AED —", note: "silk poplin",            cat: "tops" },
  { id: "asymmetric-blazer",     src: "/nadine/blazer.png",   n: "03", t: "Becoming Fragmented",   p: "AED —", note: "wool · split lapel",     cat: "outerwear" },
  { id: "split-memory-coat",     src: "/nadine/coat.png",     n: "04", t: "Becoming Grounded",     p: "AED —", note: "double-face cashmere",   cat: "outerwear" },
  { id: "shawl-kimono",          src: "/nadine/kimono.png",   n: "05", t: "Becoming Unfiltered",   p: "AED —", note: "raw silk · obi tie",     cat: "outerwear" },
  { id: "leather-drape-dress",   src: "/nadine/dress.png",    n: "06", t: "Becoming Rooted",       p: "AED —", note: "nappa · bias cut",       cat: "dresses" },
  { id: "belt-corset-skirt",     src: "/nadine/skirt.png",    n: "07", t: "Becoming Seen",         p: "AED —", note: "denim · corseted",       cat: "bottoms" },
  { id: "split-waist-denim",     src: "/nadine/denim.png",    n: "08", t: "Becoming Whole",        p: "AED —", note: "selvedge · rust wash",   cat: "bottoms" },
  { id: "chiffon-overlay-trouser", src: "/nadine/trouser.png",n: "09", t: "Becoming Clear",        p: "AED —", note: "wool + chiffon",         cat: "bottoms" },
  { id: "corset-memory-gown",    src: "/nadine/print-memory.png", n: "10", t: "Becoming Her",     p: "AED —", note: "linen · printed sash",   cat: "dresses" },
];

const tryOnEligible = new Set(["archive-crewneck", "asymmetric-blazer", "leather-drape-dress", "shawl-kimono", "corset-memory-gown"]);

const sec = { maxWidth: "100rem", margin: "0 auto", padding: "0 1.25rem" };

export default function CollectionPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = pieces.filter((p) => filter === "all" || p.cat === filter);
  const first = visible.slice(0, 5);
  const rest = visible.slice(5);

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)" }}>
      <PublicNav tone="light" />

      {/* HERO */}
      <section style={{ ...sec, paddingTop: "5rem", paddingBottom: "2.5rem" }}>
        <div style={{ paddingTop: "2rem" }}>
          <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>Chapter I · FW'26</div>
          <h1 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1.5rem", fontSize: "clamp(3.5rem, 12vw, 10rem)", lineHeight: 0.88 }}>
            BECOMING<span style={{ color: "var(--lipstick)" }}>.</span>
          </h1>
          <p style={{ marginTop: "2rem", maxWidth: "42rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            Eleven pieces shaped by original artwork, considered construction and the way clothing becomes personal through the woman who wears it.
          </p>
        </div>
      </section>

      {/* FILTERS */}
      <section style={{ borderTop: "1px solid var(--fg-12)", borderBottom: "1px solid var(--fg-12)" }}>
        <div style={{ ...sec }}>
          <nav
            aria-label="Collection filters"
            style={{ display: "flex", gap: "2rem", overflowX: "auto", padding: "1.25rem 0" }}
          >
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                style={{
                  position: "relative",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0 0 0.5rem",
                  fontSize: "0.72rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.34em",
                  color: filter === f.key ? "var(--fg)" : "var(--fg-50)",
                  fontFamily: "var(--ff-display)",
                  whiteSpace: "nowrap",
                }}
              >
                {f.label}
                {filter === f.key && (
                  <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "1px", background: "var(--lipstick)" }} />
                )}
              </button>
            ))}
          </nav>
        </div>
      </section>

      {/* PRODUCT GRID — first batch */}
      <section style={{ ...sec, paddingTop: "3.5rem", paddingBottom: "5rem" }}>
        <ProductGrid items={first} />
      </section>

      {/* EDITORIAL BREAK */}
      {rest.length > 0 && (
        <section style={{ background: "var(--fg)", color: "var(--bg)" }}>
          <div style={{ ...sec, padding: "6rem 1.25rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(22rem, 100%), 1fr))", gap: "2.5rem 5rem", alignItems: "end" }}>
              <div>
                <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "rgba(255,248,240,0.55)" }}>The Story Continues</div>
                <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1.5rem", fontSize: "clamp(2.5rem, 6vw, 5rem)", lineHeight: 0.92 }}>
                  ONE ARTWORK.
                  <br />
                  ELEVEN <span style={{ fontStyle: "italic", color: "var(--lipstick)" }}>interpretations</span><span style={{ color: "var(--lipstick)" }}>.</span>
                </h2>
              </div>
              <div>
                <p style={{ maxWidth: "24rem", fontSize: "1rem", lineHeight: 1.75, color: "rgba(255,248,240,0.7)" }}>
                  Each piece carries a different fragment of Chapter I.
                </p>
                <Link
                  to="/art-story"
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem", marginTop: "2rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--bg)", textDecoration: "none", borderBottom: "1px solid rgba(255,248,240,0.6)", paddingBottom: "0.25rem", fontFamily: "var(--ff-display)" }}
                >
                  Discover the Art Story ↗
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* PRODUCT GRID — remainder */}
      {rest.length > 0 && (
        <section style={{ ...sec, paddingTop: "5rem", paddingBottom: "6rem" }}>
          <ProductGrid items={rest} />
        </section>
      )}

      {visible.length === 0 && (
        <section style={{ ...sec, paddingTop: "6rem", paddingBottom: "6rem", textAlign: "center" }}>
          <p style={{ fontStyle: "italic", color: "var(--fg-60)", fontSize: "1.15rem", fontFamily: "var(--ff-display)" }}>
            No pieces in this category yet.
          </p>
        </section>
      )}

      <PublicFooter />
    </main>
  );
}

function ProductGrid({ items }: { items: Piece[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(22rem, 100%), 1fr))",
        gap: "3.5rem 2.5rem",
      }}
    >
      {items.map((piece) => (
        <ProductCard key={piece.id} piece={piece} />
      ))}
    </div>
  );
}

function ProductCard({ piece }: { piece: Piece }) {
  const canTryOn = tryOnEligible.has(piece.id);
  return (
    <article style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          position: "relative",
          aspectRatio: "4/5",
          overflow: "hidden",
          background: "color-mix(in oklab, var(--bg) 92%, white)",
        }}
      >
        <img
          src={piece.src}
          alt={piece.t}
          loading="lazy"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            padding: "8%",
          }}
        />
        {canTryOn && (
          <span
            style={{
              position: "absolute",
              left: "0.5rem",
              top: "0.5rem",
              border: "1px solid rgba(255,255,255,0.7)",
              background: "rgba(0,0,0,0.25)",
              padding: "0.25rem 0.5rem",
              fontSize: "0.55rem",
              textTransform: "uppercase",
              letterSpacing: "0.28em",
              color: "white",
              backdropFilter: "blur(4px)",
            }}
          >
            try on
          </span>
        )}
      </div>
      <div style={{ marginTop: "1.5rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1.25rem" }}>
        <div>
          <h3
            style={{
              fontFamily: "var(--ff-display)",
              fontWeight: 300,
              fontSize: "1.25rem",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--fg)",
            }}
          >
            {piece.t}<span style={{ color: "var(--lipstick)" }}>.</span>
          </h3>
          <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
            <span style={{ fontSize: "0.85rem", letterSpacing: "0.14em", color: "var(--fg-75)" }}>{piece.p}</span>
            {canTryOn && (
              <>
                <span style={{ color: "var(--fg-25)" }}>·</span>
                <span style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.32em", color: "var(--fg-55)" }}>Try On</span>
              </>
            )}
          </div>
          <div style={{ marginTop: "0.25rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.2em", color: "var(--fg-45)" }}>{piece.note}</div>
        </div>
      </div>
    </article>
  );
}
