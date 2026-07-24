// SUPERSEDED by Lovable/TanStack (nadine-storefront repo). Canonical version is live at /art-story. Held for rollback — do not delete.
import { useState } from "react";
import type { LinksFunction } from "react-router";
import { Link } from "react-router";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { PublicNav, PublicFooter } from "~/components/PublicLayout";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const sec = { maxWidth: "100rem", margin: "0 auto", padding: "0 1.25rem" };
const secNarrow = { maxWidth: "80rem", margin: "0 auto", padding: "0 1.25rem" };

type ArtPiece = { number: string; title: string; bg: string; lines: string[] };

const ART_PIECES: ArtPiece[] = [
  {
    number: "01",
    title: "The Bone Ground",
    bg: "#efeae0",
    lines: [
      "The quiet foundation of the work. Layers of bone and warm neutral pigment create depth before the darker marks are introduced.",
      "In the collection, this becomes the grounding palette: soft tailoring, neutral bases and space around the printed elements.",
    ],
  },
  {
    number: "02",
    title: "The Digital Fragments",
    bg: "#d4bea5",
    lines: [
      "Pixel-like blocks interrupt the painted surface, introducing rhythm, repetition and visual fracture.",
      "They are translated through cropped print placements, interrupted panels and details that appear differently across each garment.",
    ],
  },
  {
    number: "03",
    title: "Burgundy & Deep Brown",
    bg: "#6B2B3A",
    lines: [
      "Burgundy and deep brown bring weight and warmth to the composition. Their marks cut through the lighter ground without overtaking it.",
      "Across Chapter I, they appear in leather, suede, tailoring and concentrated sections of the original print.",
    ],
  },
  {
    number: "04",
    title: "The Black Scribbles",
    bg: "#2A1E17",
    lines: [
      "Loose black lines create movement across the more controlled geometry of the work.",
      "Their energy is carried into drape, crossover construction, asymmetric details and fluid printed layers.",
    ],
  },
  {
    number: "05",
    title: "The Vertical Structure",
    bg: "#b5a698",
    lines: [
      "Long marks introduce direction and restraint, holding the more fragmented elements together.",
      "They become straight trouser lines, elongated panels, seams and silhouettes that create a clear vertical pull.",
    ],
  },
  {
    number: "06",
    title: "The Circles",
    bg: "#c07c5e",
    lines: [
      "Repeated circles introduce rhythm and return within the composition.",
      "They reappear through buttons, curved details, repeated print placements and points of focus across the collection.",
    ],
  },
];

export default function ArtStoryPage() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)" }}>
      <PublicNav tone="light" />

      {/* HERO */}
      <section style={{ ...sec, paddingTop: "5rem", paddingBottom: "2.5rem" }}>
        <div style={{ paddingTop: "2rem" }}>
          <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>art story · fw'26</div>
          <h1 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1.5rem", fontSize: "clamp(3rem, 10vw, 9rem)", lineHeight: 0.88 }}>
            PAINTED, THEN
            <br />
            <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>REBUILT.</span>
          </h1>
        </div>
      </section>

      {/* PRINT IS THE SEED — image + text */}
      <section style={{ ...sec, padding: "2rem 1.25rem 4rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(22rem, 100%), 1fr))", gap: "3rem 5rem", alignItems: "center" }}>
          <figure
            style={{
              margin: 0,
              aspectRatio: "3/4",
              overflow: "hidden",
              background: "#efeae0",
              boxShadow: "0 30px 80px -20px rgba(60,30,15,0.45)",
            }}
          >
            <img
              src="/nadine/print-memory.png"
              alt="Original artwork — NADINE FW'26"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </figure>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1 }}>THE PRINT IS THE SEED.</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              <p>Before it became fabric, it was an original hand-painted work in bone, rust, burgundy and black.</p>
              <p>The composition was scanned, separated, mirrored and rebuilt—allowing each mark to move differently across fabric, silhouette and form.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FRAGMENTED BECOMING — dark */}
      <section style={{ background: "var(--fg)", color: "var(--bg)" }}>
        <div style={{ ...secNarrow, padding: "6rem 1.25rem" }}>
          <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "rgba(255,248,240,0.55)" }}>chapter 1</div>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1rem", fontSize: "clamp(2.5rem, 6vw, 4.5rem)", lineHeight: 0.95 }}>
            FRAGMENTED <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>BECOMING.</span>
          </h2>
          <div style={{ marginTop: "3rem", maxWidth: "42rem", display: "flex", flexDirection: "column", gap: "1.5rem", color: "rgba(255,248,240,0.75)", lineHeight: 1.75, fontSize: "1rem" }}>
            <p>Chapter I begins with a composition made from contrast: quiet ground, interrupted geometry, loose movement and controlled structure.</p>
            <p>Each visual element became part of the collection's design language—from colour placement and print scale to drape, tailoring and asymmetric construction.</p>
          </div>
        </div>
      </section>

      {/* PIECES EXPLORER */}
      <PiecesExplorer />

      {/* ONE ARTWORK. ELEVEN INTERPRETATIONS. — dark */}
      <section style={{ background: "var(--fg)", color: "var(--bg)" }}>
        <div style={{ ...secNarrow, padding: "6rem 1.25rem" }}>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2.5rem, 6vw, 4.5rem)", lineHeight: 0.95 }}>
            ONE ARTWORK.
            <br />
            <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>eleven</span> INTERPRETATIONS.
          </h2>
          <div style={{ marginTop: "2.5rem", maxWidth: "42rem", display: "flex", flexDirection: "column", gap: "1.5rem", color: "rgba(255,248,240,0.75)", lineHeight: 1.75, fontSize: "1rem" }}>
            <p>The artwork was scanned, separated, mirrored and rebuilt across cotton, chiffon, vegan leather and printed microsuede.</p>
            <p>Each piece carries a different part of the original composition—through print, texture, drape or construction. No two interpretations hold the artwork in exactly the same way.</p>
          </div>
          <div style={{ marginTop: "3rem" }}>
            <Link
              to="/naia-collection"
              style={{ display: "inline-block", borderRadius: "9999px", padding: "1rem 2rem", background: "var(--bg)", color: "var(--fg)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", textDecoration: "none", fontFamily: "var(--ff-display)" }}
            >
              Explore Chapter I
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

function PiecesExplorer() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const active = ART_PIECES[activeIdx];

  return (
    <section style={{ ...sec, padding: "4rem 1.25rem" }}>
      {/* Desktop — 3 columns: sidebar nav | text | image placeholder */}
      <div
        className="art-desktop"
        style={{ display: "grid", gap: "3.5rem", gridTemplateColumns: "minmax(0,260px) minmax(0,1fr) minmax(0,1fr)" }}
      >
        <nav style={{ display: "flex", flexDirection: "column" }}>
          {ART_PIECES.map((p, i) => {
            const isActive = i === activeIdx;
            return (
              <button
                key={p.number}
                type="button"
                onClick={() => setActiveIdx(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "1rem 0",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid var(--fg-15)",
                  cursor: "pointer",
                  color: isActive ? "var(--fg)" : "var(--fg-55)",
                }}
              >
                <span style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "1.125rem" }}>{p.title}</span>
                <span
                  style={{
                    marginLeft: "0.75rem",
                    flexShrink: 0,
                    width: "0.625rem",
                    height: "0.625rem",
                    border: "1px solid var(--fg-60)",
                    background: isActive ? "var(--fg)" : "transparent",
                  }}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </nav>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
          <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>{active.number}</div>
          <h3 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(1.5rem, 3vw, 3rem)", lineHeight: 1 }}>{active.title}</h3>
          {active.lines.map((line) => <p key={line}>{line}</p>)}
        </div>

        <div
          style={{
            aspectRatio: "1",
            background: active.bg,
            display: "flex",
            alignItems: "flex-end",
            padding: "1.5rem",
          }}
        >
          <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: active.bg === "#2A1E17" || active.bg === "#6B2B3A" ? "rgba(255,255,255,0.4)" : "rgba(42,30,23,0.4)" }}>
            artwork detail · {active.number}
          </span>
        </div>
      </div>

      {/* Mobile — accordion */}
      <div
        className="art-mobile"
        style={{ borderTop: "1px solid var(--fg-15)", borderBottom: "1px solid var(--fg-15)" }}
      >
        {ART_PIECES.map((p, i) => {
          const isOpen = openIdx === i;
          return (
            <div key={p.number} style={{ borderBottom: "1px solid var(--fg-15)" }}>
              <button
                type="button"
                onClick={() => setOpenIdx(isOpen ? null : i)}
                aria-expanded={isOpen}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem",
                  padding: "1.25rem 0",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ display: "flex", alignItems: "baseline", gap: "1rem" }}>
                  <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)", flexShrink: 0 }}>{p.number}</span>
                  <span style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "1.25rem" }}>{p.title}</span>
                </span>
                <span style={{ flexShrink: 0, color: "var(--lipstick)", fontSize: "1.25rem", transform: isOpen ? "rotate(45deg)" : "none", transition: "transform 0.2s" }} aria-hidden="true">+</span>
              </button>
              {isOpen && (
                <div style={{ paddingBottom: "2rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  <div style={{ aspectRatio: "16/9", background: p.bg }} />
                  <h3 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "1.5rem" }}>{p.title}</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem", fontSize: "0.95rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
                    {p.lines.map((line) => <p key={line}>{line}</p>)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        @media (min-width: 1024px) {
          .art-desktop { display: grid !important; }
          .art-mobile { display: none !important; }
        }
        @media (max-width: 1023px) {
          .art-desktop { display: none !important; }
          .art-mobile { display: block !important; }
        }
      `}</style>
    </section>
  );
}
