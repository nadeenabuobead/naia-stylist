import { useState } from "react";
import { Link } from "react-router";
import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

type Tab = "Looks" | "Products" | "Virtual Previews";

const SAMPLE_LOOKS = [
  { id: "ivory-ease-at-dusk", title: "Ivory Ease at Dusk", date: "14 Mar 2026", occasion: "Dinner · Beirut" },
  { id: "chocolate-weekend", title: "Chocolate Weekend", date: "24 Feb 2026", occasion: "Weekend · Paris" },
  { id: "evening-in-red", title: "Evening in Red", date: "18 Jan 2026", occasion: "Dinner · Milan" },
];

const SAMPLE_PRODUCTS = [
  { id: "p1", title: "Draped Silk Blouse — Ivory", price: "AED 890" },
  { id: "p2", title: "Wide-Leg Wool Trouser — Chocolate", price: "AED 1,290" },
  { id: "p3", title: "Sculpted Column Dress — Mocha", price: "AED 2,450" },
];

const SAMPLE_PREVIEWS = [
  { id: "vp1", title: "Ivory Ease at Dusk", piece: "Draped Silk Slip — Ivory", date: "14 Mar 2026" },
  { id: "vp2", title: "Evening in Red", piece: "Lipstick-Red Slip — Signature", date: "18 Jan 2026" },
];

export default function SavedPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Looks");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [undoId, setUndoId] = useState<string | null>(null);

  const handleRemove = (id: string) => {
    setRemoved((s) => new Set(s).add(id));
    setUndoId(id);
    setTimeout(() => setUndoId((cur) => (cur === id ? null : cur)), 4000);
  };

  const handleUndo = (id: string) => {
    setRemoved((s) => { const next = new Set(s); next.delete(id); return next; });
    setUndoId(null);
  };

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Header */}
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div>
              <div className="mn-eyebrow">My nAia</div>
              <h1
                style={{
                  fontFamily: "var(--ff-display)",
                  fontWeight: 200,
                  marginTop: "0.75rem",
                  fontSize: "clamp(1.875rem, 5vw, 2.5rem)",
                  lineHeight: 1,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                }}
              >
                Saved
              </h1>
            </div>
            <span className="mn-sample-badge">
              <span className="mn-sample-dot" aria-hidden="true" />
              Sample data
            </span>
          </div>
        </section>

        {/* Tabs */}
        <div className="mn-saved-tabs">
          {(["Looks", "Products", "Virtual Previews"] as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`mn-filter-pill${activeTab === tab ? " mn-active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Looks tab */}
        {activeTab === "Looks" && (
          <section>
            {SAMPLE_LOOKS.filter((l) => !removed.has(l.id)).length === 0 ? (
              <p className="mn-state-note">No saved looks yet.</p>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  display: "grid",
                  gap: "1.5rem",
                  gridTemplateColumns: "repeat(auto-fill, minmax(12rem, 1fr))",
                }}
              >
                {SAMPLE_LOOKS.filter((l) => !removed.has(l.id)).map((look) => (
                  <li key={look.id}>
                    <div>
                      <div
                        style={{
                          aspectRatio: "4/5",
                          border: "1px solid var(--fg-10)",
                          background: "color-mix(in oklab, var(--bg) 92%, white)",
                          display: "grid",
                          placeItems: "center",
                          marginBottom: "0.75rem",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.58rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.28em",
                            color: "var(--fg-40)",
                          }}
                        >
                          Look
                        </span>
                      </div>
                      <div className="mn-eyebrow">{look.date}</div>
                      <Link
                        to={`/my-naia/styleme/looks/${look.id}`}
                        style={{
                          display: "block",
                          marginTop: "0.375rem",
                          fontFamily: "var(--ff-display)",
                          fontWeight: 300,
                          fontSize: "1.125rem",
                          letterSpacing: "0.02em",
                          textTransform: "uppercase",
                          color: "var(--fg)",
                          textDecoration: "none",
                        }}
                      >
                        {look.title}
                      </Link>
                      <div
                        style={{
                          marginTop: "0.25rem",
                          fontSize: "0.78rem",
                          color: "var(--fg-65)",
                        }}
                      >
                        {look.occasion}
                      </div>
                      <div
                        style={{
                          marginTop: "0.75rem",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "0.75rem",
                          alignItems: "center",
                          fontSize: "0.62rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.26em",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleRemove(look.id)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            textDecoration: "underline",
                            textUnderlineOffset: "3px",
                            color: "var(--fg-60)",
                            fontSize: "0.62rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.26em",
                            transition: "color 0.15s",
                          }}
                        >
                          Remove
                        </button>
                        {undoId === look.id && (
                          <button
                            type="button"
                            onClick={() => handleUndo(look.id)}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--lipstick)",
                              fontSize: "0.62rem",
                              textTransform: "uppercase",
                              letterSpacing: "0.26em",
                            }}
                          >
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Products tab */}
        {activeTab === "Products" && (
          <section>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                display: "grid",
                gap: "1rem",
              }}
            >
              {SAMPLE_PRODUCTS.map((p) => (
                <li
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                    padding: "1rem 0",
                    borderBottom: "1px solid var(--fg-10)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--ff-display)",
                        fontWeight: 300,
                        fontSize: "1.125rem",
                        letterSpacing: "0.02em",
                        textTransform: "uppercase",
                      }}
                    >
                      {p.title}
                    </div>
                    <div
                      style={{
                        marginTop: "0.25rem",
                        fontSize: "0.85rem",
                        color: "var(--fg-65)",
                      }}
                    >
                      {p.price}
                    </div>
                  </div>
                  <button type="button" className="mn-btn-outline">View</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Virtual Previews tab */}
        {activeTab === "Virtual Previews" && (
          <section>
            <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "1rem" }}>
              {SAMPLE_PREVIEWS.map((vp) => (
                <li
                  key={vp.id}
                  style={{
                    border: "1px solid var(--fg-10)",
                    padding: "1.25rem",
                    display: "grid",
                    gap: "0.75rem",
                    gridTemplateColumns: "4rem minmax(0,1fr) auto",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      aspectRatio: "3/4",
                      background: "var(--fg-10)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.55rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.24em",
                        color: "var(--fg-45)",
                      }}
                    >
                      VTO
                    </span>
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--ff-display)",
                        fontWeight: 300,
                        fontSize: "1rem",
                        letterSpacing: "0.02em",
                        textTransform: "uppercase",
                      }}
                    >
                      {vp.title}
                    </div>
                    <div style={{ marginTop: "0.25rem", fontSize: "0.82rem", color: "var(--fg-65)" }}>
                      {vp.piece}
                    </div>
                    <div
                      style={{
                        marginTop: "0.25rem",
                        fontSize: "0.62rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.28em",
                        color: "var(--fg-55)",
                      }}
                    >
                      {vp.date}
                    </div>
                  </div>
                  <button type="button" className="mn-btn-outline">View</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </MyNaiaLayout>
  );
}
