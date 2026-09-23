// app/routes/my-naia.saved.tsx
//
// MY SAVED — the cross-nAia saved space.
//
// One destination for everything a customer has deliberately kept: looks from
// StyleMe, and trends, brands, pieces and directions from everywhere else.
// SavedLook and SavedItem both feed it; neither is copied into the other.
//
// Until Step 3 adds the save affordances, the non-look lanes are empty by
// design, and the page reads as an invitation rather than a fault.
//
// Replaces the redirect-to-/style-me stub this route had become.

import { useState } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadMySaved, unsaveItem, deleteSavedLook } from "~/lib/saved-items.server";
import {
  activeLanes,
  countByLane,
  SAVED_LANE_LABELS,
  type SavedCard,
  type SavedLane,
} from "~/lib/saved-items";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

export function meta() {
  return [{ title: "My Saved | nAia" }];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtUtcDate(value: string): string {
  const d = new Date(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "unsave-item") {
    const refKey = formData.get("refKey");
    if (typeof refKey === "string" && refKey) await unsaveItem(customer.id, refKey);
  }

  if (intent === "delete-look") {
    const lookId = formData.get("lookId");
    if (typeof lookId === "string" && lookId) await deleteSavedLook(customer.id, lookId);
  }

  return null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const cards = await loadMySaved(customer.id);
  return { cards, lanes: activeLanes(cards), counts: countByLane(cards) };
}

export default function MySaved() {
  const { cards, lanes, counts } = useLoaderData<typeof loader>();
  const [lane, setLane] = useState<SavedLane | "all">("all");

  const visible = lane === "all" ? cards : cards.filter((c) => c.lane === lane);

  return (
    <MyNaiaLayout>
      <style>{css}</style>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Your Style Archive</div>
        <h1 className="sp-shell-title">
          MY <span className="sp-shell-accent">saved.</span>
        </h1>
        <p className="sp-shell-desc">
          Everything you&rsquo;ve kept — looks nAia styled for you, and the trends, brands and
          directions you wanted to come back to.
        </p>
      </div>

      {cards.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {lanes.length > 1 && (
            <div className="msv-filters" role="group" aria-label="Filter saved items">
              <button
                type="button"
                className={`msv-filter${lane === "all" ? " on" : ""}`}
                aria-pressed={lane === "all"}
                onClick={() => setLane("all")}
              >
                All <span className="msv-filter-count">{cards.length}</span>
              </button>
              {lanes.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`msv-filter${lane === l ? " on" : ""}`}
                  aria-pressed={lane === l}
                  onClick={() => setLane(l)}
                >
                  {SAVED_LANE_LABELS[l]} <span className="msv-filter-count">{counts[l]}</span>
                </button>
              ))}
            </div>
          )}

          <p className="msv-count">
            {visible.length} {visible.length === 1 ? "item" : "items"}
          </p>

          <div className="msv-grid">
            {visible.map((card) => (
              <SavedCardView key={`${card.store}-${card.id}`} card={card} />
            ))}
          </div>
        </>
      )}
    </MyNaiaLayout>
  );
}

function EmptyState() {
  return (
    <div className="sv-empty">
      <p className="sv-empty-text">Nothing saved yet.</p>
      <p className="sv-empty-hint">
        When nAia styles a look you love, or you find a trend worth returning to, save it —
        it will live here with a note of where you found it.
      </p>
      <div className="msv-empty-actions">
        <Link to="/style-me" className="sp-btn-primary" style={{ display: "inline-block" }}>
          Start StyleMe
        </Link>
        <Link to="/trends/my-edits" className="msv-empty-secondary">
          Browse My Trend Edits →
        </Link>
      </div>
    </div>
  );
}

function SavedCardView({ card }: { card: SavedCard }) {
  return (
    <article className="msv-card">
      <div className="msv-card-thumb">
        {card.images.length > 0 ? (
          <div className="msv-card-thumb-inner">
            {card.images.map((src, i) => (
              <div key={i} className="msv-card-thumb-tile">
                <img src={src} alt="" loading="lazy" />
              </div>
            ))}
          </div>
        ) : (
          <div className="msv-card-thumb-inner msv-card-thumb-empty">
            <span className="msv-card-type-glyph">{card.typeLabel}</span>
          </div>
        )}
      </div>

      <div className="msv-card-type">{card.typeLabel}</div>

      {card.href ? (
        <Link to={card.href} className="msv-card-title">{card.label}</Link>
      ) : (
        <span className="msv-card-title msv-card-title--plain">{card.label}</span>
      )}

      {card.sublabel && <p className="msv-card-sub">{card.sublabel}</p>}

      {(card.provenance || card.provenanceDetail) && (
        <div className="msv-card-prov">
          {card.provenance && <span>{card.provenance}</span>}
          {card.provenanceDetail && <span>{card.provenanceDetail}</span>}
        </div>
      )}

      <div className="msv-card-actions">
        <span className="msv-card-date">{fmtUtcDate(card.createdAt)}</span>
        <Form method="post">
          {card.store === "item" ? (
            <>
              <input type="hidden" name="intent" value="unsave-item" />
              <input type="hidden" name="refKey" value={card.refKey ?? ""} />
            </>
          ) : (
            <>
              <input type="hidden" name="intent" value="delete-look" />
              <input type="hidden" name="lookId" value={card.id} />
            </>
          )}
          <button type="submit" className="msv-card-remove">Remove</button>
        </Form>
      </div>
    </article>
  );
}

const css = `
  .msv-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
  .msv-filter {
    padding: 8px 14px;
    border: 1px solid var(--naia-border, rgba(26,17,9,0.14));
    background: transparent;
    font-family: var(--naia-ff-ui, monospace);
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--naia-ink, #1a1109);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .msv-filter:hover { background: rgba(26,17,9,0.04); }
  .msv-filter.on {
    background: var(--naia-accent, #7a1e28);
    color: #faf6f1;
    border-color: var(--naia-accent, #7a1e28);
  }
  .msv-filter-count { opacity: 0.6; margin-left: 4px; font-variant-numeric: tabular-nums; }

  .msv-count {
    font-family: var(--naia-ff-ui, monospace);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--naia-muted, rgba(26,17,9,0.55));
    margin: 0 0 20px;
  }

  .msv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
    gap: 28px 20px;
  }

  .msv-card { display: flex; flex-direction: column; gap: 8px; }
  .msv-card-thumb { aspect-ratio: 3 / 4; overflow: hidden; background: rgba(26,17,9,0.05); }
  .msv-card-thumb-inner { display: flex; height: 100%; gap: 1px; }
  .msv-card-thumb-tile { flex: 1; min-width: 0; overflow: hidden; }
  .msv-card-thumb-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .msv-card-thumb-empty { align-items: center; justify-content: center; }
  .msv-card-type-glyph {
    font-family: var(--naia-ff-ui, monospace);
    font-size: 9px;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--naia-muted, rgba(26,17,9,0.45));
  }

  .msv-card-type {
    font-family: var(--naia-ff-ui, monospace);
    font-size: 8.5px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--naia-accent, #7a1e28);
  }
  .msv-card-title {
    font-family: var(--naia-ff-display, serif);
    font-size: 15px;
    line-height: 1.35;
    color: var(--naia-ink, #1a1109);
    text-decoration: none;
    text-wrap: balance;
  }
  a.msv-card-title:hover { text-decoration: underline; text-underline-offset: 3px; }
  .msv-card-title--plain { cursor: default; }
  .msv-card-sub {
    font-size: 13px;
    line-height: 1.5;
    color: var(--naia-muted, rgba(26,17,9,0.62));
    margin: 0;
  }
  .msv-card-prov {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: var(--naia-ff-ui, monospace);
    font-size: 9.5px;
    letter-spacing: 0.08em;
    color: var(--naia-muted, rgba(26,17,9,0.5));
  }
  .msv-card-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 2px;
    padding-top: 8px;
    border-top: 1px solid rgba(26,17,9,0.08);
  }
  .msv-card-date {
    font-family: var(--naia-ff-ui, monospace);
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--naia-muted, rgba(26,17,9,0.45));
  }
  .msv-card-remove {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--naia-ff-ui, monospace);
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--naia-muted, rgba(26,17,9,0.55));
  }
  .msv-card-remove:hover { color: var(--naia-accent, #7a1e28); }

  .msv-empty-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 20px;
    margin-top: 8px;
  }
  .msv-empty-secondary {
    font-family: var(--naia-ff-ui, monospace);
    font-size: 9.5px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--naia-ink, #1a1109);
    text-decoration: underline;
    text-underline-offset: 4px;
  }
`;
