import type { LinksFunction } from "react-router";
import { Link } from "react-router";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { PublicNav, PublicFooter } from "~/components/PublicLayout";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const sec = { maxWidth: "100rem", margin: "0 auto", padding: "0 1.25rem" };
const secNarrow = { maxWidth: "80rem", margin: "0 auto", padding: "0 1.25rem" };

export default function AboutPage() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)" }}>
      <PublicNav tone="light" />

      {/* HERO */}
      <section style={{ ...sec, paddingTop: "5rem", paddingBottom: "2.5rem" }}>
        <div style={{ paddingTop: "2rem" }}>
          <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>the house · founded 2021</div>
          <h1
            style={{
              fontFamily: "var(--ff-display)",
              fontWeight: 200,
              marginTop: "1.5rem",
              fontSize: "clamp(3.5rem, 12vw, 10rem)",
              lineHeight: 0.9,
            }}
          >
            A FASHION
            <br />
            <span style={{ fontStyle: "italic", color: "var(--lipstick)" }}>ATELIER.</span>
          </h1>
        </div>
      </section>

      {/* PRESS STRIP */}
      <section style={{ borderTop: "1px solid var(--fg-10)", borderBottom: "1px solid var(--fg-10)" }}>
        <div style={{ ...sec, padding: "2rem 1.25rem" }}>
          <div style={{ textAlign: "center", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)", marginBottom: "1.5rem" }}>
            As seen in
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "2rem 4rem" }}>
            <img src="/nadine/vogue-logo.png" alt="Vogue" style={{ height: "3rem", width: "auto", objectFit: "contain" }} />
            <img src="/nadine/vanity-fair-logo.png" alt="Vanity Fair" style={{ height: "3rem", width: "auto", objectFit: "contain" }} />
            <img src="/nadine/soul-arabia-logo.png" alt="Soul Arabia" style={{ height: "3rem", width: "auto", objectFit: "contain" }} />
          </div>
        </div>
      </section>

      {/* ABOUT TEXT — two columns */}
      <section style={{ ...secNarrow, padding: "4rem 1.25rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(22rem, 100%), 1fr))", gap: "3rem 5rem" }}>
          <p style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(1.4rem, 3vw, 2rem)", lineHeight: 1.3 }}>
            NADINE WAS FOUNDED IN 2021 AS AN INDEPENDENT FASHION HOUSE SHAPED BY ART, HUMAN EXPERIENCE AND PERSONAL EXPRESSION.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            <p>
              Every collection begins with a story—a memory, a feeling, a painting or a question. Original artworks are translated into print, texture, silhouette and form through considered material development and construction.
            </p>
            <p>
              This is a new chapter, not a new beginning. NADINE returns with a clearer language: expressive pieces with a distinct point of view, designed to leave room for the woman wearing them.
            </p>
            <p style={{ fontStyle: "italic", color: "var(--lipstick)", fontSize: "1.15rem", fontFamily: "var(--ff-editorial)" }}>
              Every body has a story to tell.
            </p>
          </div>
        </div>
      </section>

      {/* THE FOUNDER */}
      <section style={{ borderTop: "1px solid var(--fg-10)" }}>
        <div style={{ ...secNarrow, padding: "4rem 1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(22rem, 100%), 1fr))", gap: "3rem 5rem" }}>
            <div>
              <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)", marginBottom: "1.5rem" }}>the founder</div>
              <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2rem, 5vw, 3.75rem)", lineHeight: 0.95 }}>
                FOUNDED WITH A
                <br />
                <span style={{ fontStyle: "italic", color: "var(--lipstick)" }}>different</span> POINT OF VIEW
              </h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              <p>
                Founded by Nadeen Abuobead, NADINE brings together original artwork, fashion and a psychology-informed understanding of personal style. The house was built around the belief that clothing can be expressive without overpowering the person wearing it—and that good styling begins with understanding the woman, not simply selling her another piece.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* THE HOUSE + THE INTELLIGENCE */}
      <section style={{ borderTop: "1px solid var(--fg-10)" }}>
        <div style={{ ...secNarrow, padding: "4rem 1.25rem" }}>
          <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)", marginBottom: "1.5rem" }}>the house + the intelligence</div>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2rem, 5vw, 4.5rem)", lineHeight: 0.95 }}>
            NADINE, POWERED BY <span style={{ fontStyle: "italic", color: "var(--lipstick)" }}>nAia</span>
          </h2>
          <div style={{ marginTop: "3rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(22rem, 100%), 1fr))", gap: "3rem 5rem" }}>
            <p style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(1.25rem, 2.5vw, 1.75rem)", lineHeight: 1.3 }}>
              NADINE is the fashion house. <span style={{ fontStyle: "italic", color: "var(--lipstick)" }}>nAia</span> is its intelligence layer.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              <p>
                nAia extends the way NADINE thinks about clothing beyond the garment itself. It considers the customer's preferences, lifestyle, wardrobe and feedback to help her understand what works for her, style what she already owns and make more considered decisions.
              </p>
              <p style={{ fontStyle: "italic", color: "var(--lipstick)", fontSize: "1.15rem", fontFamily: "var(--ff-editorial)" }}>
                The technology remains in service of the fashion—not the other way around.
              </p>
            </div>
          </div>
          <div
            style={{
              marginTop: "4rem",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(16rem, 100%), 1fr))",
              gap: "2.5rem",
              borderTop: "1px solid var(--fg-10)",
              paddingTop: "3rem",
            }}
          >
            {[
              { t: "PERSONAL", d: "Recommendations shaped by explicit preferences, lifestyle and real feedback." },
              { t: "WARDROBE-FIRST", d: "NADINE pieces styled alongside clothing, shoes and bags already owned." },
              { t: "EVOLVING", d: "The experience becomes more useful as the customer chooses, wears and responds." },
            ].map((b) => (
              <div key={b.t}>
                <span style={{ fontFamily: "var(--ff-display)", fontWeight: 200, color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em" }}>{b.t}</span>
                <p style={{ marginTop: "0.75rem", color: "var(--fg-70)", lineHeight: 1.75 }}>{b.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FROM PAINTING TO PIECE — dark */}
      <section style={{ background: "var(--fg)", color: "var(--bg)" }}>
        <div style={{ ...sec, padding: "6rem 1.25rem" }}>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2rem, 5vw, 3.25rem)", marginBottom: "4rem" }}>FROM PAINTING TO PIECE.</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(18rem, 100%), 1fr))", gap: "2.5rem" }}>
            {[
              { n: "01", t: "ORIGINAL WORK", d: "Each chapter begins with an original artwork, memory or emotional starting point." },
              { n: "02", t: "MATERIAL AND FORM", d: "Artwork is translated through fabric development, silhouette and considered construction." },
              { n: "03", t: "MADE PERSONAL", d: "The final piece enters the woman's wardrobe and becomes part of how she chooses to wear and express it." },
            ].map((b) => (
              <div key={b.n}>
                <span style={{ fontFamily: "var(--ff-display)", fontWeight: 200, color: "var(--lipstick)", fontSize: "0.875rem", letterSpacing: "0.3em", display: "block" }}>{b.n} / {b.t}</span>
                <p style={{ marginTop: "0.75rem", color: "rgba(255,248,240,0.7)", lineHeight: 1.75 }}>{b.d}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "4rem" }}>
            <Link
              to="/art-story"
              style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--bg)", textDecoration: "none", borderBottom: "1px solid rgba(255,248,240,0.6)", paddingBottom: "0.25rem", fontFamily: "var(--ff-display)" }}
            >
              Discover the Art Story →
            </Link>
          </div>
        </div>
      </section>

      {/* CLOSING CTA */}
      <section style={{ textAlign: "center" }}>
        <div style={{ ...sec, padding: "6rem 1.25rem" }}>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2rem, 5vw, 4.5rem)", lineHeight: 0.95 }}>
            DISCOVER NADINE IN
            <br />
            YOUR <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>own</span> WAY.
          </h2>
          <div style={{ marginTop: "3rem", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
            <Link to="/naia-collection" style={{ display: "inline-block", borderRadius: "9999px", padding: "1rem 2rem", background: "var(--fg)", color: "var(--bg)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", textDecoration: "none", fontFamily: "var(--ff-display)" }}>Explore Chapter I</Link>
            <Link to="/stylist" style={{ display: "inline-block", borderRadius: "9999px", padding: "1rem 2rem", border: "1px solid var(--fg)", color: "var(--fg)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", textDecoration: "none", fontFamily: "var(--ff-display)" }}>Meet your nAia stylist</Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
