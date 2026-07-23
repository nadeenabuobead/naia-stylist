import type { LinksFunction, MetaFunction } from "react-router";
import { Link } from "react-router";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { PublicNav, PublicFooter } from "~/components/PublicLayout";
import { ScribbleUnderline } from "~/components/ScribbleUnderline";

export const meta: MetaFunction = () => [
  { title: "NADINE — Fashion That Reads You" },
  { name: "description", content: "NADINE — an AI-powered editorial fashion brand. Virtual try-on, AI styling, digital wardrobes, emotional personalization." },
];

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const marquee = [
  "EVERY BODY HAS A STORY TO TELL",
  "PAINTED BY INSTINCT",
  "FROM CANVAS TO CLOTH",
  "CUT WITH INTENTION",
  "MADE TO BE REMEMBERED",
];

const carouselProducts: { name: string; price: string; tryOn?: boolean }[] = [
  { name: "Becoming Alive",       price: "AED 2,150", tryOn: true },
  { name: "Becoming Real",        price: "AED 1,890" },
  { name: "Becoming Fragmented",  price: "AED 3,420", tryOn: true },
  { name: "Becoming Grounded",    price: "AED 2,680" },
  { name: "Becoming Unfiltered",  price: "AED 1,980" },
  { name: "Becoming Rooted",      price: "AED 4,120" },
  { name: "Becoming Seen",        price: "AED 2,340", tryOn: true },
  { name: "Becoming Whole",       price: "AED 3,760" },
  { name: "Becoming Clear",       price: "AED 1,750" },
  { name: "Becoming Her",         price: "AED 5,240", tryOn: true },
  { name: "Becoming Defined",     price: "AED 2,890" },
];

// Piece cutouts — all available locally in /public/nadine/
// modelSrc provided only where a local file exists (naia-look-01/02)
const pieceSrcs: { src: string; modelSrc?: string }[] = [
  { src: "/nadine/sweater.png" },
  { src: "/nadine/shirt.png" },
  { src: "/nadine/blazer.png" },
  { src: "/nadine/coat.png" },
  { src: "/nadine/kimono.png" },
  { src: "/nadine/dress.png" },
  { src: "/nadine/skirt.png" },
  { src: "/nadine/denim.png",         modelSrc: "/nadine/naia-look-01.jpg" },
  { src: "/nadine/trouser.png",       modelSrc: "/nadine/naia-look-02.jpg" },
  { src: "/nadine/look-morph-end.png" },
];

export default function Index() {
  return (
    <main style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "var(--bg)", color: "var(--fg)" }}>
      <style>{`
        @keyframes ticker {
          from { transform: translateX(0%); }
          to   { transform: translateX(-50%); }
        }
        .naia-ticker-track {
          display: flex;
          min-width: max-content;
          align-items: center;
          gap: 1.5rem;
          white-space: nowrap;
          padding: 0.75rem 0;
          animation: ticker 26s linear infinite;
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.3em;
        }
        .naia-outline-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 9999px;
          border: 1px solid rgba(255,255,255,0.7);
          padding: 0.625rem 1.75rem;
          font-size: 0.7rem;
          font-family: var(--ff-display);
          font-weight: 200;
          text-transform: uppercase;
          letter-spacing: 0.32em;
          color: white;
          text-decoration: none;
          transition: opacity 0.15s;
        }
        .naia-outline-pill:hover { opacity: 0.7; }
        .naia-btn-hero {
          display: inline-flex;
          align-items: center;
          border-radius: 9999px;
          background: var(--lipstick);
          color: var(--bg);
          height: 2.75rem;
          padding: 0 1.5rem;
          font-size: 0.68rem;
          font-family: var(--ff-display);
          font-weight: 200;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          text-decoration: none;
          border: none;
          cursor: pointer;
          flex-shrink: 0;
          transition: opacity 0.15s;
        }
        .naia-btn-hero:hover { opacity: 0.85; }
        .naia-thin-display {
          font-family: var(--ff-display);
          font-weight: 200;
          text-transform: uppercase;
        }
        .naia-paper-bg {
          background-color: var(--bg);
          background-image:
            radial-gradient(ellipse at 0% 100%, hsla(352,65%,43%,0.09) 0%, transparent 60%),
            radial-gradient(ellipse at 100% 0%, hsla(30,15%,35%,0.08) 0%, transparent 55%);
        }
        .naia-product-img {
          height: 100%;
          width: 100%;
          object-fit: cover;
          transition: transform 0.7s ease-out;
        }
        .naia-product-strip-card:hover .naia-product-img { transform: scale(1.05); }
        @media (min-width: 640px) {
          .naia-lookbook-aspect { aspect-ratio: 16 / 9 !important; }
          .naia-section-px { padding-left: 2.5rem !important; padding-right: 2.5rem !important; }
          .naia-section-py { padding-top: 8rem !important; padding-bottom: 8rem !important; }
          .naia-hero-bottom { bottom: 18% !important; left: 2.5rem !important; }
          .naia-hero-headline { font-size: 2.25rem !important; }
          .naia-strip-bottom { bottom: 3rem !important; }
          .naia-strip-gap { gap: 1.5rem !important; }
        }
      `}</style>

      {/* ── 1. HERO ───────────────────────────────────────────────────────────────
          Lovable source: section#top, h-[100svh], bg-paper, video + poster overlay */}
      <section
        id="top"
        style={{
          position: "relative",
          height: "100svh",
          minHeight: "640px",
          width: "100%",
          overflow: "hidden",
          background: "#1a1108",
          color: "white",
        }}
      >
        {/* Nav — dark tone, absolute positioned */}
        <PublicNav tone="dark" />

        {/* Hero poster (naia-hero.mp4 PENDING — static poster displayed) */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "url(/nadine/naia-hero.jpg)",
            backgroundPosition: "center",
            backgroundSize: "cover",
            filter: "blur(2px) saturate(0.95)",
            opacity: 0.9,
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.55) 100%)",
          }}
        />

        {/* Masthead wordmark */}
        <h1
          className="naia-thin-display"
          style={{
            position: "absolute",
            top: "16%",
            left: 0,
            right: 0,
            zIndex: 20,
            textAlign: "center",
            color: "white",
            letterSpacing: "0.04em",
            textTransform: "none",
            fontSize: "clamp(6rem, 20vw, 15rem)",
            lineHeight: 0.88,
          }}
        >
          NADINE
        </h1>

        {/* Bottom copy block */}
        <div
          className="naia-hero-bottom"
          style={{
            position: "absolute",
            bottom: "16%",
            left: "1.25rem",
            zIndex: 20,
            maxWidth: "34rem",
          }}
        >
          <p
            className="naia-thin-display naia-hero-headline"
            style={{ fontSize: "1.65rem", lineHeight: 1.2, letterSpacing: "0.02em", color: "rgba(255,255,255,0.9)" }}
          >
            EVERY BODY HAS A STORY TO TELL.
          </p>
          <p style={{ marginTop: "1rem", fontSize: "1rem", lineHeight: 1.75, color: "rgba(255,255,255,0.7)" }}>
            Founded in 2021 and featured in Vogue, Vanity Fair and Soul Arabia, NADINE translates original artwork, memory and emotion into pieces made to be lived in.
          </p>
          <div style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem" }}>
            <Link to="/naia-collection" className="naia-outline-pill">SHOP CHAPTER I</Link>
            <Link to="/stylist" className="naia-outline-pill">MEET YOUR nAia STYLIST</Link>
          </div>
        </div>

        {/* Scroll cue */}
        <div
          style={{
            position: "absolute",
            bottom: "1.5rem",
            right: "1.5rem",
            zIndex: 20,
            fontFamily: "var(--ff-display)",
            fontWeight: 200,
            fontSize: "0.65rem",
            textTransform: "uppercase",
            letterSpacing: "0.34em",
            color: "rgba(255,255,255,0.6)",
          }}
        >
          scroll ↓ chapter I
        </div>
      </section>

      {/* ── 2. BLACK MARQUEE STRIP ───────────────────────────────────────────────
          Lovable: section.bg-foreground, .ticker-track, 26s animation */}
      <section style={{ position: "relative", background: "var(--fg)", padding: "1rem 0", overflow: "hidden" }}>
        <div className="naia-ticker-track" style={{ color: "var(--bg)" }}>
          {[...marquee, ...marquee].map((m, i) => (
            <span key={`${m}-${i}`} style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
              <span>/</span>
              <span>{m}</span>
            </span>
          ))}
        </div>
      </section>

      {/* ── 3. PRESS STRIP ──────────────────────────────────────────────────────
          Lovable: section.paper-bg, "featured in", flex logos */}
      <section className="naia-paper-bg" style={{ borderBottom: "1px solid var(--fg-10)" }}>
        <div
          className="naia-section-px"
          style={{
            marginLeft: "auto",
            marginRight: "auto",
            display: "flex",
            maxWidth: "100rem",
            flexDirection: "column",
            alignItems: "center",
            gap: "1.5rem",
            padding: "2.5rem 1.25rem 3.5rem",
          }}
        >
          <div
            className="naia-thin-display"
            style={{ fontSize: "0.65rem", letterSpacing: "0.4em", color: "var(--fg-55)" }}
          >
            featured in
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "1.5rem 3rem" }}>
            <img src="/nadine/vogue-logo.png" alt="Vogue" style={{ height: "2.5rem", width: "auto", objectFit: "contain", opacity: 0.8 }} />
            <img src="/nadine/vanity-fair-logo.png" alt="Vanity Fair" style={{ height: "2.5rem", width: "auto", objectFit: "contain", opacity: 0.8 }} />
            <img src="/nadine/soul-arabia-logo.png" alt="Soul Arabia" style={{ height: "2.5rem", width: "auto", objectFit: "contain", opacity: 0.8 }} />
          </div>
        </div>
      </section>

      {/* ── 4. DROP SHOWCASE — section#drop ─────────────────────────────────────
          Lovable: PRINT/BECOMING masthead stack + LOOKBOOK inside same section */}
      <section id="drop" className="naia-paper-bg" style={{ position: "relative", overflow: "hidden" }}>

        {/* PRINT / BECOMING masthead stack */}
        <div style={{ position: "relative", width: "100%", overflow: "hidden", paddingTop: "4rem" }}>

          {/* top meta strip */}
          <div
            className="naia-section-px"
            style={{
              marginLeft: "auto",
              marginRight: "auto",
              display: "flex",
              maxWidth: "100rem",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 1.25rem 1.5rem",
            }}
          >
            <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>
              CHAPTER 01 / FW'26
            </div>
            <div style={{ fontFamily: "var(--ff-editorial)", fontStyle: "italic", color: "var(--lipstick)", fontSize: "0.875rem" }}>
              — CHAPTER I COLLECTION
            </div>
          </div>

          {/* Masthead stack */}
          <div style={{ position: "relative" }}>

            {/* PRINT — outlined, full bleed */}
            <h2
              className="naia-thin-display"
              style={{
                position: "relative",
                zIndex: 10,
                textAlign: "center",
                lineHeight: 0.82,
                color: "transparent",
                WebkitTextStroke: "1px var(--fg)",
                fontSize: "clamp(5rem, 22vw, 22rem)",
                userSelect: "none",
              }}
            >
              PRINT
            </h2>

            {/* Print morph — poster only, naia-print-morph.mp4 PENDING */}
            <figure
              style={{
                position: "relative",
                zIndex: 20,
                marginLeft: "auto",
                marginRight: "auto",
                marginTop: "-6vw",
                marginBottom: "-6vw",
                width: "72%",
                maxWidth: "760px",
              }}
            >
              <div
                style={{
                  position: "relative",
                  aspectRatio: "3 / 4",
                  width: "100%",
                  overflow: "hidden",
                  background: "#efeae0",
                  boxShadow: "0 30px 80px -20px rgba(60,30,15,0.45)",
                }}
              >
                <img
                  src="/nadine/print-memory.png"
                  alt="PRINT / MEMORY — Chapter I (video pending)"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    mixBlendMode: "multiply",
                    opacity: 0.3,
                    background: "radial-gradient(120% 80% at 50% 30%, transparent 40%, rgba(60,30,15,0.35) 100%)",
                  }}
                />
                {/* corner marks */}
                <span style={{ position: "absolute", left: "0.5rem", top: "0.5rem", display: "block", height: "0.75rem", width: "0.75rem", borderLeft: "1px solid rgba(60,30,15,0.5)", borderTop: "1px solid rgba(60,30,15,0.5)" }} />
                <span style={{ position: "absolute", right: "0.5rem", top: "0.5rem", display: "block", height: "0.75rem", width: "0.75rem", borderRight: "1px solid rgba(60,30,15,0.5)", borderTop: "1px solid rgba(60,30,15,0.5)" }} />
                <span style={{ position: "absolute", left: "0.5rem", bottom: "0.5rem", display: "block", height: "0.75rem", width: "0.75rem", borderLeft: "1px solid rgba(60,30,15,0.5)", borderBottom: "1px solid rgba(60,30,15,0.5)" }} />
                <span style={{ position: "absolute", right: "0.5rem", bottom: "0.5rem", display: "block", height: "0.75rem", width: "0.75rem", borderRight: "1px solid rgba(60,30,15,0.5)", borderBottom: "1px solid rgba(60,30,15,0.5)" }} />
              </div>
            </figure>

            {/* BECOMING — solid, sits in front of PRINT */}
            <h2
              className="naia-thin-display"
              style={{
                position: "relative",
                zIndex: 30,
                textAlign: "center",
                lineHeight: 0.82,
                color: "var(--fg)",
                fontSize: "clamp(5rem, 22vw, 22rem)",
                userSelect: "none",
              }}
            >
              BECOMING<span style={{ color: "var(--lipstick)" }}>.</span>
            </h2>
          </div>

          {/* sub-headline editorial row */}
          <div
            className="naia-section-px"
            style={{
              marginLeft: "auto",
              marginRight: "auto",
              marginTop: "2.5rem",
              display: "grid",
              maxWidth: "100rem",
              gap: "2rem",
              padding: "0 1.25rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(22rem, 100%), 1fr))",
              alignItems: "end",
            }}
          >
            <div style={{ maxWidth: "28rem", fontSize: "0.875rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              <p style={{ marginTop: "1rem" }}>
                A hand-painted canvas in rust, bone and ember becomes the starting point for Chapter I.
              </p>
              <p style={{ marginTop: "1rem" }}>
                Its marks are translated into fabric, then shaped into pieces that move with the body: cut, sculpted, softened and made to be lived in.
              </p>
              <p style={{ marginTop: "1rem" }}>
                Leather holds. Suede softens. Cotton grounds. Each material carries its own feeling — together forming a collection about return, transformation and becoming.
              </p>
              <p className="naia-thin-display" style={{ marginTop: "1.5rem", fontSize: "0.65rem", letterSpacing: "0.34em", color: "var(--fg-60)" }}>FW'26</p>
              <p className="naia-thin-display" style={{ marginTop: "0.25rem", fontSize: "0.65rem", letterSpacing: "0.34em", color: "var(--fg-60)" }}>CHAPTER I.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ display: "inline-block", height: "1px", width: "4rem", background: "var(--fg-30)" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <p style={{ maxWidth: "28rem", fontSize: "0.875rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
                Every piece begins with a story. Discover the painting, fabric and construction behind Chapter I — then find the piece that becomes part of yours.
              </p>
              <Link to="/naia-collection" className="naia-btn-hero">EXPLORE THE COLLECTION</Link>
            </div>
          </div>
        </div>

        {/* LOOKBOOK — editorial background + scrolling product strip */}
        <div
          style={{
            position: "relative",
            marginLeft: "auto",
            marginRight: "auto",
            marginTop: "4rem",
            maxWidth: "100rem",
            overflow: "hidden",
          }}
        >
          {/* Background: nadine-look-05.png PENDING */}
          <div
            className="naia-lookbook-aspect"
            style={{ position: "relative", aspectRatio: "4 / 5", width: "100%" }}
          >
            {/* [ASSET PENDING: nadine-look-05.png — lookbook background model shot] */}
            <div
              aria-label="Lookbook background — asset pending"
              style={{
                position: "absolute",
                inset: 0,
                background: "#1a1108",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--ff-display)",
                  fontWeight: 200,
                  fontSize: "0.6rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.34em",
                  color: "rgba(255,255,255,0.25)",
                }}
              >
                [ ASSET PENDING: nadine-look-05.png ]
              </span>
            </div>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)",
              }}
            />

            {/* Section title — top left */}
            <div style={{ position: "absolute", left: "1.25rem", top: "1.5rem", zIndex: 10 }}>
              <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "rgba(255,255,255,0.7)" }}>
                chapter 1 · fw'26
              </div>
              <h2
                className="naia-thin-display"
                style={{ marginTop: "0.5rem", fontSize: "clamp(2rem, 6vw, 4rem)", color: "white" }}
              >
                THE COLLECTION<span style={{ color: "var(--lipstick)" }}>.</span>
              </h2>
            </div>

            {/* View all — top right */}
            <Link
              to="/naia-collection"
              style={{
                position: "absolute",
                right: "1.25rem",
                top: "1.75rem",
                zIndex: 10,
                fontFamily: "var(--ff-display)",
                fontWeight: 200,
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: "0.3em",
                color: "rgba(255,255,255,0.7)",
                textDecoration: "none",
                transition: "color 0.15s",
              }}
            >
              view all
            </Link>
          </div>

          {/* Scrolling product strip — 28s animation, overlaps bottom of lookbook */}
          <div
            className="naia-strip-bottom"
            style={{ position: "absolute", bottom: "2rem", left: 0, width: "100%", overflow: "hidden" }}
          >
            <div
              className="naia-strip-gap"
              style={{
                display: "flex",
                gap: "1rem",
                animation: "ticker 28s linear infinite",
                width: "max-content",
              }}
            >
              {[...carouselProducts, ...carouselProducts].map((product, idx) => {
                const piece = pieceSrcs[idx % pieceSrcs.length];
                const imgSrc = piece.modelSrc ?? piece.src;
                return (
                  <Link
                    key={`${product.name}-${idx}`}
                    to="/naia-collection"
                    className="naia-product-strip-card"
                    style={{ display: "block", flexShrink: 0, width: "clamp(140px, 18vw, 260px)", textDecoration: "none" }}
                    aria-label={`${product.name} — ${product.price}`}
                  >
                    <div style={{ position: "relative", aspectRatio: "3 / 4", overflow: "hidden", background: "#f7f5f1" }}>
                      <img
                        src={imgSrc}
                        alt={product.name}
                        loading="lazy"
                        className="naia-product-img"
                      />
                      {product.tryOn && (
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
                    <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                      <h3
                        className="naia-thin-display"
                        style={{ fontSize: "0.7rem", letterSpacing: "0.18em", color: "white" }}
                      >
                        {product.name}
                      </h3>
                      <p style={{ fontSize: "0.65rem", letterSpacing: "0.12em", color: "rgba(255,255,255,0.7)" }}>
                        {product.price}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. nAia — STYLED BY INTELLIGENCE ────────────────────────────────────
          Lovable: section#naia.paper-bg, 3-col capability grid, btn-hero */}
      <section id="naia" className="naia-paper-bg" style={{ position: "relative", borderTop: "1px solid var(--fg-10)" }}>
        <div
          className="naia-section-px naia-section-py"
          style={{ marginLeft: "auto", marginRight: "auto", maxWidth: "100rem", padding: "6rem 1.25rem" }}
        >
          <div
            style={{
              display: "grid",
              gap: "2.5rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(28rem, 100%), 1fr))",
              alignItems: "end",
            }}
          >
            <div>
              <div
                className="naia-thin-display"
                style={{ fontSize: "0.65rem", letterSpacing: "0.4em", color: "var(--fg-55)" }}
              >
                the nAia stylist
              </div>
              <h2
                className="naia-thin-display"
                style={{ marginTop: "1.25rem", fontSize: "clamp(3rem, 8vw, 6rem)", lineHeight: 0.95 }}
              >
                STYLED BY INTELLIGENCE.<br />
                <span
                  style={{
                    fontFamily: "var(--ff-editorial)",
                    fontStyle: "italic",
                    color: "var(--lipstick)",
                    textTransform: "none",
                    fontWeight: 400,
                  }}
                >
                  chosen for your life.
                </span>
              </h2>
            </div>
            <p style={{ maxWidth: "28rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              nAia looks beyond the piece — considering your preferences, your wardrobe and how you want to feel. Discover what works with what you already own, build a complete look and preview eligible pieces on you.
            </p>
          </div>

          <div
            style={{
              marginTop: "4rem",
              display: "grid",
              gap: "2.5rem",
              borderTop: "1px solid var(--fg-15)",
              paddingTop: "3.5rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(18rem, 100%), 1fr))",
            }}
          >
            {[
              { n: "I",   t: "UNDERSTAND YOUR STYLE", d: "Build a Style Passport shaped by your preferences, lifestyle and real feedback." },
              { n: "II",  t: "STYLE WHAT YOU OWN",    d: "Combine NADINE with clothing, shoes and bags already in your Closet." },
              { n: "III", t: "SEE THE LOOK ON YOU",   d: "Create a visual preview using your saved My nAia Model." },
            ].map((c) => (
              <div key={c.t}>
                <span
                  className="naia-thin-display"
                  style={{ display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.34em" }}
                >
                  {c.n}
                </span>
                <h3
                  className="naia-thin-display"
                  style={{ marginTop: "1rem", fontSize: "clamp(1.1rem, 2.5vw, 1.5rem)", letterSpacing: "0.12em", lineHeight: 1.1 }}
                >
                  {c.t}
                </h3>
                <p style={{ marginTop: "1rem", fontSize: "0.875rem", lineHeight: 1.75, color: "var(--fg-70)" }}>
                  {c.d}
                </p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "3.5rem" }}>
            <Link to="/stylist" className="naia-btn-hero">MEET YOUR nAia STYLIST</Link>
          </div>
        </div>
      </section>

      {/* ── 6. MANIFESTO ─────────────────────────────────────────────────────────
          Lovable: section#about.paper-bg, ScribbleUnderline on italic span */}
      <section id="about" className="naia-paper-bg" style={{ position: "relative" }}>
        <div
          className="naia-section-px naia-section-py"
          style={{ position: "relative", marginLeft: "auto", marginRight: "auto", maxWidth: "80rem", padding: "6rem 1.25rem" }}
        >
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-60)" }}>
            manifesto
          </div>
          <h2
            className="naia-thin-display"
            style={{ marginTop: "1rem", fontSize: "clamp(2.5rem, 8vw, 6.5rem)", lineHeight: 0.9 }}
          >
            WE DO NOT BEGIN WITH A TREND.<br />
            <span
              style={{
                position: "relative",
                display: "inline-block",
                fontFamily: "var(--ff-editorial)",
                fontStyle: "italic",
                color: "var(--lipstick)",
                textTransform: "none",
                fontWeight: 400,
              }}
            >
              we begin with a story.
              <ScribbleUnderline
                style={{
                  position: "absolute",
                  bottom: "-0.5rem",
                  left: 0,
                  height: "1rem",
                  width: "100%",
                  color: "var(--lipstick)",
                  display: "block",
                }}
              />
            </span>
          </h2>
          <div
            style={{
              marginTop: "3.5rem",
              display: "grid",
              gap: "2.5rem",
              fontSize: "1rem",
              lineHeight: 1.75,
              color: "var(--fg-75)",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(18rem, 100%), 1fr))",
            }}
          >
            <p>
              <span
                className="naia-thin-display"
                style={{ display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em", marginBottom: "0.5rem" }}
              >
                01 / CANVAS
              </span>
              Every collection begins with an original work. Paint, texture and memory become the starting point.
            </p>
            <p>
              <span
                className="naia-thin-display"
                style={{ display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em", marginBottom: "0.5rem" }}
              >
                02 / FORM
              </span>
              The story is translated through silhouette, construction and movement — cut to meet the body, not overpower it.
            </p>
            <p>
              <span
                className="naia-thin-display"
                style={{ display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em", marginBottom: "0.5rem" }}
              >
                03 / FEELING
              </span>
              Pieces are made to stay with you: expressive, personal, and open to becoming part of your own story.
            </p>
          </div>
        </div>
      </section>

      {/* ── 7. THE MAKING — dark ─────────────────────────────────────────────────
          Lovable: section#making.bg-foreground, editorial italic body copy */}
      <section id="making" style={{ position: "relative", background: "var(--fg)", color: "var(--bg)" }}>
        <div
          className="naia-section-px naia-section-py"
          style={{ position: "relative", marginLeft: "auto", marginRight: "auto", maxWidth: "90rem", padding: "6rem 1.25rem" }}
        >
          <div
            style={{
              display: "grid",
              gap: "2.5rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(26rem, 100%), 1fr))",
              alignItems: "end",
            }}
          >
            <div>
              <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "rgba(255,248,240,0.6)" }}>
                the making
              </div>
              <h2
                className="naia-thin-display"
                style={{ marginTop: "0.75rem", fontSize: "clamp(2.5rem, 7vw, 5.5rem)", color: "var(--bg)" }}
              >
                FROM CANVAS TO CLOTH.
              </h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
              <p
                style={{
                  maxWidth: "28rem",
                  fontFamily: "var(--ff-editorial)",
                  fontStyle: "italic",
                  color: "rgba(255,248,240,0.8)",
                  fontSize: "1.125rem",
                }}
              >
                Every chapter begins with an original work — painting, memory, texture — then moves through fabric, form and feeling until it becomes something made to be worn.
              </p>
              <Link to="/art-story" className="naia-btn-hero">DISCOVER THE ART STORY</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── 8. CLOSING CTA — wardrobe video ─────────────────────────────────────
          Lovable: section#waitlist, h-[90svh], blurred video bg, outline-pill CTAs
          naia-wardrobe.mp4 PENDING — poster displayed until asset available */}
      <section
        id="waitlist"
        style={{
          position: "relative",
          height: "90svh",
          minHeight: "34rem",
          width: "100%",
          overflow: "hidden",
          background: "var(--fg)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "url(/nadine/naia-wardrobe.jpg)",
            backgroundPosition: "center",
            backgroundSize: "cover",
            filter: "blur(10px) saturate(0.9)",
            opacity: 0.8,
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.65) 100%)",
          }}
        />
        <div
          className="naia-section-px"
          style={{
            position: "relative",
            zIndex: 10,
            display: "flex",
            height: "100%",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: "0 1.25rem 4rem",
          }}
        >
          <h2
            className="naia-thin-display"
            style={{ marginTop: "1rem", maxWidth: "64rem", fontSize: "clamp(2.5rem, 8vw, 7rem)", color: "white", lineHeight: 0.95 }}
          >
            THE NEXT CHAPTER<br />OF NADINE{" "}
            <span
              style={{
                fontFamily: "var(--ff-editorial)",
                fontStyle: "italic",
                color: "rgba(255,255,255,0.9)",
                textTransform: "none",
                fontWeight: 400,
              }}
            >
              begins here.
            </span>
          </h2>
          <div style={{ marginTop: "2rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1.5rem" }}>
            <Link to="/naia-collection" className="naia-outline-pill">EXPLORE THE COLLECTION</Link>
            <Link to="/stylist" className="naia-outline-pill">MEET YOUR nAia STYLIST</Link>
          </div>
        </div>
      </section>

      {/* ── 9. FOOTER ────────────────────────────────────────────────────────────
          Lovable: SiteFooter — using PublicFooter (same structure/content) */}
      <PublicFooter />
    </main>
  );
}
