import type { LinksFunction } from "react-router";
import { Link } from "react-router";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { PublicNav, PublicFooter } from "~/components/PublicLayout";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const marquee = [
  "EVERY BODY HAS A STORY TO TELL",
  "PAINTED BY INSTINCT",
  "FROM CANVAS TO CLOTH",
  "CUT WITH INTENTION",
  "MADE TO BE REMEMBERED",
];

const pillStyle: React.CSSProperties = {
  display: "inline-block",
  border: "1px solid rgba(255,255,255,0.7)",
  borderRadius: "9999px",
  padding: "0.75rem 1.5rem",
  fontSize: "0.65rem",
  textTransform: "uppercase",
  letterSpacing: "0.3em",
  color: "white",
  textDecoration: "none",
  fontFamily: "var(--ff-display)",
};

export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)", overflow: "hidden" }}>
      <style>{`
        @keyframes pub-ticker {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>

      {/* ── HERO ── */}
      <section
        style={{
          position: "relative",
          height: "100svh",
          minHeight: "640px",
          overflow: "hidden",
          backgroundImage: "url('/nadine/naia-hero.jpg')",
          backgroundPosition: "center",
          backgroundSize: "cover",
          color: "white",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.55))" }} />

        {/* Nav sits inside hero (dark tone) */}
        <PublicNav tone="dark" />

        {/* Giant wordmark */}
        <h1
          style={{
            fontFamily: "var(--ff-display)",
            fontWeight: 200,
            position: "absolute",
            inset: "auto 0 auto 0",
            top: "16%",
            zIndex: 20,
            textAlign: "center",
            fontSize: "clamp(5rem, 20vw, 15rem)",
            letterSpacing: "0.04em",
            color: "white",
            lineHeight: 1,
          }}
        >
          NADINE
        </h1>

        {/* Headline + CTAs */}
        <div
          style={{
            position: "absolute",
            bottom: "16%",
            left: "1.25rem",
            zIndex: 20,
            maxWidth: "34rem",
          }}
        >
          <p style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(1.5rem, 3.5vw, 2.25rem)", lineHeight: 1.2, color: "rgba(255,255,255,0.9)", letterSpacing: "0.02em" }}>
            EVERY BODY HAS A STORY TO TELL.
          </p>
          <p style={{ marginTop: "1rem", fontSize: "1rem", lineHeight: 1.75, color: "rgba(255,255,255,0.7)" }}>
            Founded in 2021 and featured in Vogue, Vanity Fair and Soul Arabia, NADINE translates original artwork, memory and emotion into pieces made to be lived in.
          </p>
          <div style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            <Link to="/naia-collection" style={pillStyle}>SHOP CHAPTER I</Link>
            <Link to="/stylist" style={pillStyle}>MEET YOUR nAia STYLIST</Link>
          </div>
        </div>

        <div style={{ position: "absolute", bottom: "1.5rem", right: "1.5rem", zIndex: 20, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "rgba(255,255,255,0.6)" }}>
          scroll ↓ chapter I
        </div>
      </section>

      {/* ── MARQUEE STRIP ── */}
      <section style={{ background: "var(--fg)", padding: "1rem 0", overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            gap: "4rem",
            width: "max-content",
            animation: "pub-ticker 32s linear infinite",
          }}
        >
          {[...marquee, ...marquee, ...marquee, ...marquee].map((m, i) => (
            <span
              key={i}
              style={{ display: "flex", alignItems: "center", gap: "1.5rem", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--bg)", whiteSpace: "nowrap" }}
            >
              <span>/</span>
              <span>{m}</span>
            </span>
          ))}
        </div>
      </section>

      {/* ── PRESS STRIP ── */}
      <section style={{ borderBottom: "1px solid var(--fg-10)" }}>
        <div style={{ maxWidth: "100rem", margin: "0 auto", padding: "2.5rem 1.25rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem" }}>
          <div style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.4em", color: "var(--fg-55)" }}>featured in</div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "3rem" }}>
            <img src="/nadine/vogue-logo.png" alt="Vogue" style={{ height: "2.5rem", width: "auto", objectFit: "contain", opacity: 0.8 }} />
            <img src="/nadine/vanity-fair-logo.png" alt="Vanity Fair" style={{ height: "2.5rem", width: "auto", objectFit: "contain", opacity: 0.8 }} />
            <img src="/nadine/soul-arabia-logo.png" alt="Soul Arabia" style={{ height: "2.5rem", width: "auto", objectFit: "contain", opacity: 0.8 }} />
          </div>
        </div>
      </section>

      {/* ── DROP SHOWCASE ── */}
      <section style={{ background: "var(--bg)", overflow: "hidden" }}>
        <div style={{ maxWidth: "100rem", margin: "0 auto", padding: "4rem 1.25rem 2rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>CHAPTER 01 / FW'26</div>
          <div style={{ fontStyle: "italic", color: "var(--lipstick)", fontSize: "0.9rem", fontFamily: "var(--ff-display)" }}>— CHAPTER I COLLECTION</div>
        </div>

        <div style={{ position: "relative" }}>
          {/* PRINT — outlined */}
          <h2
            style={{
              fontFamily: "var(--ff-display)",
              fontWeight: 200,
              textAlign: "center",
              lineHeight: 0.82,
              fontSize: "clamp(5rem, 22vw, 22rem)",
              letterSpacing: "0.02em",
              WebkitTextStroke: "1px var(--fg)",
              color: "transparent",
              userSelect: "none",
              position: "relative",
              zIndex: 10,
            }}
          >
            PRINT
          </h2>

          {/* Centre image */}
          <figure
            style={{
              position: "relative",
              zIndex: 20,
              margin: "-6vw auto -6vw",
              width: "min(72%, 760px)",
              aspectRatio: "3/4",
              overflow: "hidden",
              background: "#efeae0",
              boxShadow: "0 30px 80px -20px rgba(60,30,15,0.45)",
            }}
          >
            <img
              src="/nadine/print-memory.png"
              alt="NADINE FW'26 — Chapter I print"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </figure>

          {/* BECOMING. — solid */}
          <h2
            style={{
              fontFamily: "var(--ff-display)",
              fontWeight: 200,
              textAlign: "center",
              lineHeight: 0.82,
              fontSize: "clamp(5rem, 22vw, 22rem)",
              letterSpacing: "0.02em",
              position: "relative",
              zIndex: 30,
              color: "var(--fg)",
            }}
          >
            BECOMING<span style={{ color: "var(--lipstick)" }}>.</span>
          </h2>
        </div>

        {/* Sub-headline */}
        <div
          style={{
            maxWidth: "100rem",
            margin: "0 auto",
            padding: "3rem 1.25rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(22rem, 100%), 1fr))",
            gap: "2rem",
            alignItems: "end",
          }}
        >
          <div style={{ maxWidth: "28rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            <p>A hand-painted canvas in rust, bone and ember becomes the starting point for Chapter I.</p>
            <p style={{ marginTop: "1rem" }}>Its marks are translated into fabric, then shaped into pieces that move with the body: cut, sculpted, softened and made to be lived in.</p>
            <p style={{ marginTop: "1rem" }}>Leather holds. Suede softens. Cotton grounds. Each material carries its own feeling — together forming a collection about return, transformation and becoming.</p>
            <p style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1.5rem", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-60)" }}>FW'26 · CHAPTER I.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "1rem" }}>
            <p style={{ maxWidth: "28rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)", textAlign: "right" }}>
              Every piece begins with a story. Discover the painting, fabric and construction behind Chapter I — then find the piece that becomes part of yours.
            </p>
            <Link
              to="/naia-collection"
              style={{ display: "inline-block", border: "1px solid var(--fg)", borderRadius: "9999px", padding: "0.875rem 2rem", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg)", textDecoration: "none", fontFamily: "var(--ff-display)" }}
            >
              EXPLORE THE COLLECTION
            </Link>
          </div>
        </div>
      </section>

      {/* ── nAia SECTION ── */}
      <section style={{ borderTop: "1px solid var(--fg-10)", background: "var(--bg)" }}>
        <div style={{ maxWidth: "100rem", margin: "0 auto", padding: "6rem 1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(24rem, 100%), 1fr))", gap: "2.5rem", alignItems: "end" }}>
            <div>
              <div style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.4em", color: "var(--fg-55)" }}>the nAia stylist</div>
              <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1.25rem", fontSize: "clamp(2.5rem, 7vw, 6rem)", lineHeight: 0.95 }}>
                STYLED BY INTELLIGENCE.
                <br />
                <span style={{ fontStyle: "italic", color: "var(--lipstick)" }}>chosen for your life.</span>
              </h2>
            </div>
            <p style={{ maxWidth: "26rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              nAia looks beyond the piece — considering your preferences, your wardrobe and how you want to feel. Discover what works with what you already own, build a complete look and preview eligible pieces on you.
            </p>
          </div>

          <div
            style={{
              marginTop: "4rem",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(18rem, 100%), 1fr))",
              gap: "2.5rem 3.5rem",
              borderTop: "1px solid var(--fg-15)",
              paddingTop: "3.5rem",
            }}
          >
            {[
              { n: "I",   t: "UNDERSTAND YOUR STYLE", d: "Build a Style Passport shaped by your preferences, lifestyle and real feedback." },
              { n: "II",  t: "STYLE WHAT YOU OWN",    d: "Combine NADINE with clothing, shoes and bags already in your Closet." },
              { n: "III", t: "SEE THE LOOK ON YOU",   d: "Create a visual preview using your saved My nAia Model." },
            ].map((c) => (
              <div key={c.t}>
                <span style={{ fontFamily: "var(--ff-display)", fontWeight: 200, display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.34em" }}>{c.n}</span>
                <h3 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1rem", fontSize: "1.25rem", letterSpacing: "0.12em" }}>{c.t}</h3>
                <p style={{ marginTop: "1rem", fontSize: "0.9rem", lineHeight: 1.6, color: "var(--fg-70)" }}>{c.d}</p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "3.5rem" }}>
            <Link to="/stylist" style={{ display: "inline-block", border: "1px solid var(--fg)", borderRadius: "9999px", padding: "0.875rem 2rem", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg)", textDecoration: "none", fontFamily: "var(--ff-display)" }}>
              MEET YOUR nAia STYLIST
            </Link>
          </div>
        </div>
      </section>

      {/* ── MANIFESTO ── */}
      <section style={{ background: "var(--bg)" }}>
        <div style={{ maxWidth: "80rem", margin: "0 auto", padding: "6rem 1.25rem" }}>
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-60)" }}>manifesto</div>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1rem", fontSize: "clamp(2.5rem, 7vw, 6.5rem)", lineHeight: 0.95 }}>
            WE DO NOT BEGIN WITH A TREND.
            <br />
            <span style={{ fontStyle: "italic", color: "var(--lipstick)" }}>we begin with a story.</span>
          </h2>
          <div style={{ marginTop: "3.5rem", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(18rem, 100%), 1fr))", gap: "2.5rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            <p>
              <span style={{ fontFamily: "var(--ff-display)", fontWeight: 200, display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em", marginBottom: "0.5rem" }}>01 / CANVAS</span>
              Every collection begins with an original work. Paint, texture and memory become the starting point.
            </p>
            <p>
              <span style={{ fontFamily: "var(--ff-display)", fontWeight: 200, display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em", marginBottom: "0.5rem" }}>02 / FORM</span>
              The story is translated through silhouette, construction and movement — cut to meet the body, not overpower it.
            </p>
            <p>
              <span style={{ fontFamily: "var(--ff-display)", fontWeight: 200, display: "block", color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em", marginBottom: "0.5rem" }}>03 / FEELING</span>
              Pieces are made to stay with you: expressive, personal, and open to becoming part of your own story.
            </p>
          </div>
        </div>
      </section>

      {/* ── THE MAKING ── */}
      <section style={{ background: "var(--fg)", color: "var(--bg)" }}>
        <div style={{ maxWidth: "90rem", margin: "0 auto", padding: "6rem 1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(24rem, 100%), 1fr))", gap: "2.5rem", alignItems: "end" }}>
            <div>
              <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "rgba(255,248,240,0.6)" }}>the making</div>
              <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "clamp(2.5rem, 6vw, 4.5rem)" }}>FROM CANVAS TO CLOTH.</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
              <p style={{ maxWidth: "26rem", fontStyle: "italic", color: "rgba(255,248,240,0.8)", fontSize: "1.15rem", lineHeight: 1.65, fontFamily: "var(--ff-display)" }}>
                Every chapter begins with an original work — painting, memory, texture — then moves through fabric, form and feeling until it becomes something made to be worn.
              </p>
              <Link to="/art-story" style={{ display: "inline-block", border: "1px solid rgba(255,248,240,0.8)", borderRadius: "9999px", padding: "0.875rem 2rem", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--bg)", textDecoration: "none", fontFamily: "var(--ff-display)" }}>
                DISCOVER THE ART STORY
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── CLOSING CTA ── */}
      <section
        style={{
          position: "relative",
          height: "90svh",
          minHeight: "34rem",
          overflow: "hidden",
          backgroundImage: "url('/nadine/naia-wardrobe.jpg')",
          backgroundPosition: "center",
          backgroundSize: "cover",
          color: "white",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.65))" }} />
        <div style={{ position: "relative", zIndex: 10, padding: "0 1.25rem 4rem" }}>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2.5rem, 7vw, 7rem)", lineHeight: 0.95, color: "white", maxWidth: "60rem" }}>
            THE NEXT CHAPTER
            <br />
            OF NADINE <span style={{ fontStyle: "italic", color: "rgba(255,255,255,0.9)" }}>begins here.</span>
          </h2>
          <div style={{ marginTop: "2rem", display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            <Link to="/naia-collection" style={pillStyle}>EXPLORE THE COLLECTION</Link>
            <Link to="/stylist" style={pillStyle}>MEET YOUR nAia STYLIST</Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
