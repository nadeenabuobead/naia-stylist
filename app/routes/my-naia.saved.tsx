import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import naiaStyles from "~/styles/naia-design-system.css?url";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import MyNaiaPageIntro from "~/components/my-naia/MyNaiaPageIntro";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

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
      },
    },
  });

  // Resolve the original StylingSession ID for each saved look so the
  // "View original session" link uses the correct ?sessionId= param.
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
        productImageUrl: item.productImageUrl,
        shopifyProductId: item.shopifyProductId,
      })),
    })),
  };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;
type Look = LoaderData["looks"][number];

export default function SavedLooks() {
  const { looks } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout currentPath="/my-naia/saved">
      <MyNaiaPageIntro
        eyebrow="SAVED LOOKS"
        heading="Looks you've kept"
      />

      {looks.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {looks.map((look) => (
            <LookCard key={look.id} look={look} />
          ))}
        </div>
      )}
    </MyNaiaLayout>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: "48px 0", textAlign: "center" }}>
      <p style={{
        fontFamily: "var(--ff-body, 'Cormorant Garamond', serif)",
        fontSize: "18px",
        fontStyle: "italic",
        color: "var(--c-muted, #7a6f6a)",
        marginBottom: "24px",
      }}>
        You haven't saved any looks yet.
      </p>
      <p style={{
        fontFamily: "var(--ff-body, 'Cormorant Garamond', serif)",
        fontSize: "15px",
        color: "var(--c-muted, #7a6f6a)",
        marginBottom: "32px",
      }}>
        When nAia creates a look you love, tap "Save this look" to keep it here.
      </p>
      <Link
        to="/style-me"
        style={{
          display: "inline-block",
          padding: "14px 32px",
          background: "var(--c-deep, #221516)",
          color: "var(--c-cream, #f4f4f1)",
          fontFamily: "var(--ff-ui, 'Space Mono', monospace)",
          fontSize: "10px",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          textDecoration: "none",
        }}
      >
        Start StyleMe
      </Link>
    </div>
  );
}

function LookCard({ look }: { look: Look }) {
  const imagedItems = look.items.filter((i) => i.productImageUrl);
  const displayImages = imagedItems.slice(0, 3);

  const formattedDate = new Date(look.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div style={{
      border: "1px solid var(--c-border, #e5e0d8)",
      padding: "24px",
      background: "var(--c-surface, #fff)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          {look.name && (
            <p style={{
              fontFamily: "var(--ff-body, 'Cormorant Garamond', serif)",
              fontSize: "18px",
              fontWeight: 600,
              fontStyle: "italic",
              margin: "0 0 4px",
            }}>
              {look.name}
            </p>
          )}
          {look.occasion && (
            <p style={{
              fontFamily: "var(--ff-ui, sans-serif)",
              fontSize: "11px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--c-muted, #7a6f6a)",
              margin: 0,
            }}>
              {look.occasion}
            </p>
          )}
        </div>
        <p style={{
          fontFamily: "var(--ff-ui, sans-serif)",
          fontSize: "11px",
          color: "var(--c-muted, #7a6f6a)",
          margin: 0,
          flexShrink: 0,
        }}>
          {formattedDate}
        </p>
      </div>

      {/* Item images */}
      {displayImages.length > 0 && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          {displayImages.map((item) => (
            <div
              key={item.id}
              style={{
                width: "80px",
                height: "100px",
                background: "var(--c-warm, #f0ebe4)",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              {item.productImageUrl && (
                <img
                  src={item.productImageUrl}
                  alt={item.itemType}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              )}
            </div>
          ))}
          {look.items.length > 3 && (
            <div style={{
              width: "80px",
              height: "100px",
              background: "var(--c-warm, #f0ebe4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
              <span style={{
                fontFamily: "var(--ff-ui, sans-serif)",
                fontSize: "12px",
                color: "var(--c-muted, #7a6f6a)",
              }}>
                +{look.items.length - 3}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Finishing touches */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {look.perfumeRec && (
          <FinishingLine label="Scent" value={look.perfumeRec} />
        )}
        {look.hairstyleRec && (
          <FinishingLine label="Hair" value={look.hairstyleRec} />
        )}
        {look.songRec && (
          <FinishingLine label="Song" value={look.songRec} />
        )}
      </div>

      {/* Wear tracking */}
      {look.timesWorn > 0 && (
        <p style={{
          fontFamily: "var(--ff-ui, sans-serif)",
          fontSize: "11px",
          color: "var(--c-muted, #7a6f6a)",
          marginTop: "12px",
          margin: "12px 0 0",
        }}>
          Worn {look.timesWorn} time{look.timesWorn !== 1 ? "s" : ""}
          {look.lastWorn
            ? ` · Last worn ${new Date(look.lastWorn).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
            : ""}
        </p>
      )}

      {/* Session link + delete */}
      <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--c-border, #e5e0d8)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        {look.originalSessionId ? (
          <Link
            to={`/style-me/result?sessionId=${look.originalSessionId}`}
            style={{
              fontFamily: "var(--ff-ui, sans-serif)",
              fontSize: "11px",
              letterSpacing: "0.08em",
              color: "var(--c-burg, #8b2035)",
              textDecoration: "none",
            }}
          >
            View original session →
          </Link>
        ) : <span />}
        <Form method="post" style={{ margin: 0 }}>
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="lookId" value={look.id} />
          <button
            type="submit"
            style={{
              background: "none",
              border: "none",
              fontFamily: "var(--ff-ui, sans-serif)",
              fontSize: "11px",
              letterSpacing: "0.08em",
              color: "var(--c-muted, #7a6f6a)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            Remove
          </button>
        </Form>
      </div>
    </div>
  );
}

function FinishingLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
      <span style={{
        fontFamily: "var(--ff-ui, sans-serif)",
        fontSize: "10px",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--c-muted, #7a6f6a)",
        flexShrink: 0,
        minWidth: "40px",
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: "var(--ff-body, 'Cormorant Garamond', serif)",
        fontSize: "14px",
        fontStyle: "italic",
        color: "var(--c-ink, #221516)",
      }}>
        {value}
      </span>
    </div>
  );
}
