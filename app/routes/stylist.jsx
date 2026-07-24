// SUPERSEDED by Lovable/TanStack (nadine-storefront repo). Redirected to /ai-stylist. Held for rollback — do not delete.
import { Link } from "react-router";
import naiaStyles from "../styles/naia-design-system.css?url";
import { PublicNav, PublicFooter } from "../components/PublicLayout";

export const links = () => [{ rel: "stylesheet", href: naiaStyles }];

const steps = [
  { n: "01", t: "BUILD YOUR STYLE PROFILE", d: "Tell nAia about your preferences, lifestyle, fit, coverage, colour direction and how you want to feel when you get dressed." },
  { n: "02", t: "ADD WHAT YOU ALREADY OWN", d: "Build your Digital Closet with clothing, shoes and bags. Clear item photos can also become available for visual try-on." },
  { n: "03", t: "STYLE THE MOMENT", d: "Share the occasion, mood and practical needs of your day. nAia creates a look using NADINE, your Closet or a considered combination of both." },
  { n: "04", t: "PREVIEW THE LOOK", d: "Try eligible pieces individually or preview a complete look using your saved My nAia Model. Virtual previews show styling direction and silhouette rather than exact physical fit." },
  { n: "05", t: "REFINE OVER TIME", d: "Respond to recommendations and review what you actually wore. Your feedback softly improves future ranking and explanations without overriding your explicit preferences." },
];

const features = [
  { t: "STYLE PASSPORT", d: "Your evolving record of preferences, lifestyle, fit, coverage, colour and styling direction." },
  { t: "DIGITAL CLOSET", d: "Clothing, shoes and bags you already own—ready to be styled into new combinations." },
  { t: "STYLEME", d: "Personal recommendations shaped around the occasion, your wardrobe and how you want to feel." },
  { t: "MY nAia MODEL", d: "A private saved model used to create visual previews of eligible pieces and complete looks." },
  { t: "PERSONAL STYLING PHOTO ANALYSIS", d: "Optional selfie-based guidance for colour direction, necklines, hair, earrings and glasses." },
  { t: "SHOULD I BUY THIS?", d: "An honest recommendation based on your style, wardrobe, lifestyle, fit preferences and whether you already own something similar." },
];

const sec = { maxWidth: "100rem", margin: "0 auto", padding: "0 1.25rem" };

export default function StylistPage() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)" }}>
      {/* Hero */}
      <div style={{ background: "var(--bg)" }}>
        <PublicNav tone="light" />
        <section style={{ ...sec, paddingTop: "5rem", paddingBottom: "4rem" }}>
          <div style={{ paddingTop: "2rem" }}>
            <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>
              THE SYSTEM · nAia STYLIST
            </div>
            <h1
              style={{
                fontFamily: "var(--ff-display)",
                fontWeight: 200,
                marginTop: "1.5rem",
                fontSize: "clamp(3rem, 10vw, 9rem)",
                lineHeight: 0.95,
                letterSpacing: "0.02em",
              }}
            >
              STYLED BY
              <br />
              <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>INTELLIGENCE.</span>
            </h1>
            <div style={{ marginTop: "2rem", maxWidth: "42rem", display: "flex", flexDirection: "column", gap: "1.25rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              <p>A personal styling system for the way you actually live, dress and make decisions.</p>
              <p>nAia brings together your preferences, lifestyle, wardrobe, fit and coverage needs, and how you want to feel—then turns them into clear styling guidance.</p>
              <p>Style what you already own, understand whether a new piece belongs in your wardrobe, build complete looks and preview eligible pieces on you. As you respond to recommendations and wear your outfits, the experience becomes more useful over time.</p>
            </div>
          </div>
        </section>
      </div>

      {/* HOW IT WORKS */}
      <section style={{ background: "var(--fg)", color: "var(--bg)" }}>
        <div style={{ maxWidth: "90rem", margin: "0 auto", padding: "6rem 1.25rem" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "rgba(255,248,240,0.6)" }}>the system</div>
              <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "clamp(2.5rem, 6vw, 5rem)" }}>HOW IT WORKS</h2>
            </div>
            <p style={{ maxWidth: "20rem", fontStyle: "italic", color: "rgba(255,248,240,0.75)", fontSize: "1.1rem", lineHeight: 1.6, fontFamily: "var(--ff-editorial)" }}>
              Five steps that turn preferences, wardrobe and daily life into clear styling guidance.
            </p>
          </div>

          <ol style={{ marginTop: "4rem", listStyle: "none", padding: 0, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
            {steps.map((s) => (
              <li
                key={s.n}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "1rem 3rem",
                  alignItems: "baseline",
                  padding: "2rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <span style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(1.25rem, 3vw, 2.5rem)", color: "var(--lipstick)", minWidth: "3.5rem" }}>{s.n}</span>
                <div>
                  <h3 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(1.1rem, 2.5vw, 2rem)", letterSpacing: "0.04em" }}>{s.t}</h3>
                  <p style={{ marginTop: "0.5rem", maxWidth: "42rem", fontSize: "0.875rem", lineHeight: 1.6, color: "rgba(255,255,255,0.65)" }}>{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* THE PARTS OF THE SYSTEM */}
      <section style={{ background: "var(--bg)" }}>
        <div style={{ ...sec, paddingTop: "6rem", paddingBottom: "6rem" }}>
          <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>your nAia</div>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "1rem", fontSize: "clamp(2rem, 5vw, 4.5rem)", lineHeight: 0.95 }}>
            THE PARTS OF THE{" "}
            <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>system.</span>
          </h2>
          <div
            style={{
              marginTop: "4rem",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(18rem, 100%), 1fr))",
              gap: "2.5rem",
            }}
          >
            {features.map((f) => (
              <div key={f.t} style={{ borderTop: "1px solid var(--fg-15)", paddingTop: "1.5rem" }}>
                <h3 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "1.1rem", letterSpacing: "0.14em", textTransform: "uppercase" }}>{f.t}</h3>
                <p style={{ marginTop: "1rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-70)" }}>{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* YOUR WARDROBE COMES FIRST */}
      <section style={{ borderTop: "1px solid var(--fg-10)", borderBottom: "1px solid var(--fg-10)", background: "var(--bg)" }}>
        <div style={{ maxWidth: "80rem", margin: "0 auto", padding: "6rem 1.25rem" }}>
          <div style={{ display: "grid", gap: "3rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(24rem, 100%), 1fr))" }}>
            <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2rem, 5vw, 3.75rem)", lineHeight: 0.95 }}>
              YOUR WARDROBE
              <br />
              COMES{" "}
              <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>first.</span>
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              <p>nAia does not begin by asking what else you should buy. It begins with what you already own, what you actually wear and what may genuinely be missing.</p>
              <p>A NADINE piece is introduced when it adds something meaningful—not simply because it is available.</p>
            </div>
          </div>
        </div>
      </section>

      {/* PRIVACY */}
      <section style={{ background: "var(--bg)" }}>
        <div style={{ maxWidth: "80rem", margin: "0 auto", padding: "6rem 1.25rem" }}>
          <div style={{ display: "grid", gap: "3rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(24rem, 100%), 1fr))" }}>
            <div>
              <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)", marginBottom: "1.5rem" }}>privacy</div>
              <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2rem, 5vw, 3.75rem)", lineHeight: 0.95 }}>
                YOUR INFORMATION,
                <br />
                YOUR{" "}
                <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>choice.</span>
              </h2>
            </div>
            <p style={{ fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-75)", alignSelf: "center" }}>
              Selfie analysis and My nAia Model are optional. Your private images are used only for the selected experience, and you can remove your photo or analysis later. StyleMe remains available without them.
            </p>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{ background: "var(--fg)", color: "var(--bg)", textAlign: "center" }}>
        <div style={{ ...sec, paddingTop: "6rem", paddingBottom: "6rem" }}>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, fontSize: "clamp(2rem, 5vw, 4.5rem)", lineHeight: 0.95 }}>
            READY TO MEET
            <br />
            YOUR{" "}
            <span style={{ fontStyle: "italic", color: "var(--lipstick)", fontFamily: "var(--ff-editorial)" }}>nAia</span>?
          </h2>
          <div style={{ marginTop: "3rem" }}>
            <Link
              to="/my-naia"
              style={{
                display: "inline-block",
                borderRadius: "9999px",
                padding: "1rem 2rem",
                background: "var(--bg)",
                color: "var(--fg)",
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: "0.34em",
                textDecoration: "none",
                fontFamily: "var(--ff-display)",
              }}
            >
              Explore the Experience
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
