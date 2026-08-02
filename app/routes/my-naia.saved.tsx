import { useState } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function fmtUtcDate(d: string | Date, short = false): string {
  const dt = new Date(d);
  const months = short ? MONTHS_SHORT : MONTHS_LONG;
  return `${dt.getUTCDate()} ${months[dt.getUTCMonth()]}${short ? "" : ` ${dt.getUTCFullYear()}`}`;
}

export function meta() {
  return [{ title: "Saved Looks | nAia" }];
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const lookId = formData.get("lookId") as string;

  if (intent === "delete" && lookId) {
    await prisma.savedLook.deleteMany({
      where: { id: lookId, customerId: customer.id },
    });
  }

  return null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);

  const savedLooks = await prisma.savedLook.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        orderBy: { id: "asc" },
        include: {
          closetItem: { select: { imageUrl: true } },
        },
      },
    },
  });

  const suggestionIds = savedLooks.map((l) => l.fromSuggestionId).filter(Boolean) as string[];
  const suggestionSessionMap = new Map<string, string>();
  if (suggestionIds.length > 0) {
    const suggestions = await prisma.outfitSuggestion.findMany({
      where: { id: { in: suggestionIds } },
      select: { id: true, sessionId: true },
    });
    for (const s of suggestions) suggestionSessionMap.set(s.id, s.sessionId);
  }

  return {
    looks: savedLooks.map((look) => ({
      id: look.id,
      name: look.name,
      occasion: look.occasion,
      notes: look.notes,
      perfumeRec: look.perfumeRec,
      hairstyleRec: look.hairstyleRec,
      songRec: look.songRec,
      timesWorn: look.timesWorn,
      lastWorn: look.lastWorn?.toISOString() ?? null,
      fromSuggestionId: look.fromSuggestionId,
      originalSessionId: look.fromSuggestionId ? (suggestionSessionMap.get(look.fromSuggestionId) ?? null) : null,
      createdAt: look.createdAt.toISOString(),
      items: look.items.map((item) => ({
        id: item.id,
        itemType: item.itemType,
        productImageUrl: item.productImageUrl ?? item.closetItem?.imageUrl ?? null,
        shopifyProductId: item.shopifyProductId,
      })),
    })),
  };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;
type Look = LoaderData["looks"][number];

type Tab = "looks" | "products" | "previews";

const TABS: { key: Tab; label: string }[] = [
  { key: "looks",    label: "Looks" },
  { key: "products", label: "Products" },
  { key: "previews", label: "Virtual Previews" },
];

export default function SavedLooks() {
  const { looks } = useLoaderData<typeof loader>();
  const [tab, setTab] = useState<Tab>("looks");

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Your Style Archive</div>
        <h1 className="sp-shell-title">Saved Looks</h1>
        <p className="sp-shell-desc">
          Looks you've kept from your styling sessions. Return to them any time to revisit the pieces and the finishing touches that made them yours.
        </p>
      </div>

      <nav className="sv-tabs" aria-label="Saved looks sections">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`sv-tab${tab === key ? " sv-tab--active" : ""}`}
            onClick={() => setTab(key)}
            aria-current={tab === key ? "true" : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "looks" && (
        looks.length === 0 ? (
          <div className="sv-empty">
            <p className="sv-empty-text">You haven't saved any looks yet.</p>
            <p className="sv-empty-hint">
              When nAia creates a look you love, save it to keep it here.
            </p>
            <Link to="/style-me" className="sp-btn-primary" style={{ display: "inline-block" }}>
              Start StyleMe
            </Link>
          </div>
        ) : (
          <div className="sv-grid">
            {looks.map((look) => (
              <LookCard key={look.id} look={look} />
            ))}
          </div>
        )
      )}

      {tab === "products" && (
        <div className="sv-empty">
          <p className="sv-empty-text">No products saved yet.</p>
          <p className="sv-empty-hint">
            Products you favourite during styling sessions will appear here.
          </p>
        </div>
      )}

      {tab === "previews" && (
        <div className="sv-empty">
          <p className="sv-empty-text">No virtual previews saved yet.</p>
          <p className="sv-empty-hint">
            Virtual try-on previews you keep will appear here once your nAia Model is active.
          </p>
        </div>
      )}
    </MyNaiaLayout>
  );
}

function LookCard({ look }: { look: Look }) {
  const imagedItems = look.items.filter((i) => i.productImageUrl);
  const thumbItems = imagedItems.slice(0, 3);

  const formattedDate = fmtUtcDate(look.createdAt);

  const metaParts = [look.occasion, formattedDate].filter(Boolean).join(" · ");

  return (
    <article className="sv-card">
      {/* Thumbnail */}
      <div className="sv-card-thumb">
        {thumbItems.length > 0 ? (
          <div className="sv-card-thumb-placeholder">
            {thumbItems.map((item) => (
              <div key={item.id} className="sv-card-thumb-img-tile">
                <img src={item.productImageUrl!} alt={item.itemType} />
              </div>
            ))}
          </div>
        ) : (
          <div className="sv-card-thumb-placeholder">
            <span style={{ fontFamily: "var(--naia-ff-body)", fontSize: "13px", fontStyle: "italic", color: "var(--naia-muted)" }}>
              No items
            </span>
          </div>
        )}
      </div>

      {/* Title */}
      {look.originalSessionId ? (
        <Link
          to={`/style-me/result?sessionId=${look.originalSessionId}`}
          className="sv-card-title"
        >
          {look.name || "Saved look"}
        </Link>
      ) : (
        <span className="sv-card-title" style={{ cursor: "default" }}>
          {look.name || "Saved look"}
        </span>
      )}

      {/* Meta */}
      {metaParts && <p className="sv-card-meta">{metaParts}</p>}

      {/* Finishing touches */}
      {(look.perfumeRec || look.hairstyleRec || look.songRec) && (
        <div className="sv-card-finishing">
          {look.perfumeRec  && <FinishingLine label="Scent" value={look.perfumeRec} />}
          {look.hairstyleRec && <FinishingLine label="Hair"  value={look.hairstyleRec} />}
          {look.songRec     && <FinishingLine label="Song"  value={look.songRec} />}
        </div>
      )}

      {/* Wear tracking */}
      {look.timesWorn > 0 && (
        <p className="sv-card-wear">
          Worn {look.timesWorn} time{look.timesWorn !== 1 ? "s" : ""}
          {look.lastWorn
            ? ` · Last worn ${fmtUtcDate(look.lastWorn!, true)}`
            : ""}
        </p>
      )}

      {/* Actions */}
      <div className="sv-card-actions">
        {look.originalSessionId ? (
          <Link
            to={`/style-me/result?sessionId=${look.originalSessionId}`}
            className="sv-card-action"
          >
            Open
          </Link>
        ) : (
          <span className="sv-card-action sv-card-action--disabled">Open</span>
        )}
        <span className="sv-card-action sv-card-action--disabled">Try the look</span>
        <Form method="post" style={{ display: "inline" }}>
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="lookId" value={look.id} />
          <button type="submit" className="sv-card-action">Remove</button>
        </Form>
      </div>
    </article>
  );
}

function FinishingLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="sv-card-finishing-row">
      <span className="sv-card-finishing-label">{label}</span>
      <span className="sv-card-finishing-value">{value}</span>
    </div>
  );
}
