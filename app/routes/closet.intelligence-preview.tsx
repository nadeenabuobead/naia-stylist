// app/routes/closet.intelligence-preview.tsx
//
// WARDROBE INTELLIGENCE — presentation preview.
//
// A separate route, not wired into navigation and not replacing
// closet.intelligence.tsx. It reuses that route's exact read-only data path
// (same engine, same needs/recommendations, same buildWardrobePage output)
// so nothing shown here is hard-coded — a different customer's counts,
// garments and findings render here automatically. It never calls
// readAndRecordChange or the completeness action: this pass makes no writes.
//
// Composition follows the approved reference: a compact header, one
// garment-led discovery as the main view, a short list of other findings
// that SWAP the main view when selected (no second long page), and detail
// (matches, pairing, coverage, profile) behind a dialog rather than more
// scrolling.

import { useState } from "react";
import { redirect, type LoaderFunctionArgs, type LinksFunction, data } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { getCloudinaryConfig, buildPrivateDownloadUrl } from "~/lib/cloudinary-admin.server";
import { loadWardrobeIntelligence } from "~/lib/ai/wardrobe-intelligence.server";
import { readClosetConfidence } from "~/lib/ai/wardrobe-confidence.server";
import { buildWardrobePage, type WardrobePage, type PageEntry } from "~/lib/ai/wardrobe-page";

// Duplicated from closet.intelligence.tsx rather than importing a private
// constant — this route makes no change to that file at all.
const PASSPORT_SELECT = {
  lifestyle: true, favoriteColors: true, avoidColors: true, stylePersonalities: true,
  silhouette: true, structure: true, fitPreferences: true, styleStruggles: true,
  styleSupport: true, becoming: true, styleExpression: true, styleDirections: true,
  explorationLevel: true, dressingHabits: true, dressingPreferences: true,
  coveragePreferences: true, preferredCoverage: true, dressingRequirementsNote: true,
  fitConcerns: true, dressesFor: true, neutralVsColour: true, colourIntensity: true,
  printAppetite: true,
} as const;

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

export function meta() {
  return [{ title: "Wardrobe Intelligence — preview | nAia" }];
}

// No `action` export — this route never writes. The closet-status control
// below is local, transient React state, exactly like the reference.
export async function loader({ request }: LoaderFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const customer = await prisma.customer.findUnique({
    where: { id: naiaCustomer.id },
    select: {
      id: true,
      closetItems: { orderBy: { createdAt: "desc" } },
      onboardingProfile: { select: PASSPORT_SELECT },
    },
  });
  if (!customer) return redirect("/auth/shopify/login");

  const cfg = getCloudinaryConfig();
  const imageUrlById = new Map<string, string | null>();
  for (const item of customer.closetItems) {
    if (item.imagePublicId && item.imageFormat && cfg) {
      imageUrlById.set(item.id, buildPrivateDownloadUrl(cfg, item.imagePublicId, item.imageFormat, "private"));
    } else {
      imageUrlById.set(item.id, item.imageUrl ?? null);
    }
  }

  const profile = customer.onboardingProfile;
  const flags = { derivedIntentionIntelligence: process.env.WARDROBE_V2_INTENTIONS === "true" };

  const { intelligence, needs, recommendations, garments } = await loadWardrobeIntelligence(customer.id, {
    imageUrlById,
    flags,
    passport: profile
      ? {
          lifestyle: profile.lifestyle, favoriteColors: profile.favoriteColors, avoidColors: profile.avoidColors,
          stylePersonalities: profile.stylePersonalities, silhouette: profile.silhouette,
          structure: profile.structure ?? null, fitPreferences: profile.fitPreferences,
          styleStruggles: profile.styleStruggles, styleSupport: profile.styleSupport, becoming: profile.becoming,
          styleExpression: profile.styleExpression, styleDirections: profile.styleDirections,
          explorationLevel: profile.explorationLevel ?? null, dressingHabits: profile.dressingHabits,
          dressingPreferences: profile.dressingPreferences, coveragePreferences: profile.coveragePreferences,
          preferredCoverage: profile.preferredCoverage ?? null,
          dressingRequirementsNote: profile.dressingRequirementsNote ?? null,
          fitConcerns: profile.fitConcerns, dressesFor: profile.dressesFor,
          neutralVsColour: profile.neutralVsColour ?? null, colourIntensity: profile.colourIntensity ?? null,
          printAppetite: profile.printAppetite ?? null,
        }
      : null,
  });

  // Read-only preview: no change-tracking write, no completeness write.
  const page = buildWardrobePage({
    intelligence,
    needs,
    recommendations,
    closetCount: customer.closetItems.length,
    confidence: await readClosetConfidence(customer.id),
    garmentName: (id) => garments.find((g) => g.id === id)?.name ?? null,
    change: null,
    lifestyle: profile?.lifestyle ?? [],
  });

  const garmentCards = garments.map((g) => ({
    id: g.id, name: g.name, category: g.category, subcategory: g.subcategory,
    primaryColor: g.primaryColor, imageUrl: g.imageUrl,
  }));

  return data({ page, garmentCards });
}

type GarmentCard = {
  id: string; name: string | null; category: string; subcategory: string | null;
  primaryColor: string | null; imageUrl: string | null;
};

const SWATCH: Readonly<Record<string, string>> = {
  black: "#1A1512", white: "#FBF9F6", cream: "#EFE6D8", ivory: "#F2EAD9",
  beige: "#DCCCB6", "off-white": "#F4EFE7", nude: "#E3C9B4", tan: "#C79E74",
  camel: "#B68B5B", taupe: "#B3A294", stone: "#CFC5B8", brown: "#6B4A32",
  grey: "#9A948D", gray: "#9A948D", charcoal: "#3B3835", navy: "#22304A",
  blue: "#3C5A8A", denim: "#4A6685", green: "#3F6140", burgundy: "#5C1E27",
};

function swatchColour(name: string): string {
  return SWATCH[name.toLowerCase()] ?? "#B3A294";
}

function cardLabel(card: GarmentCard | undefined): string {
  if (!card) return "This piece";
  if (card.name && card.name.trim() !== "") return card.name.trim();
  return [card.primaryColor, card.subcategory ?? card.category.toLowerCase()].filter(Boolean).join(" ");
}

/** A short, real word for "with a ___" — derived from the actual matched
 * piece's own category/name, never a fixed label for one customer's items. */
function shortMatchWord(card: GarmentCard | undefined): string {
  if (!card) return "this piece";
  const n = (card.subcategory ?? card.category).toLowerCase();
  if (/jean|denim/.test(card.name ?? "") || /jean|denim/.test(n)) return "denim";
  if (/blazer/.test(n)) return "a blazer";
  if (/trouser|pant/.test(n)) return "tailoring";
  if (/coat|jacket/.test(n)) return "outerwear";
  return n || "this piece";
}

function Thumb({ card, height = 220 }: { card: GarmentCard | undefined; height?: number }) {
  if (!card) return null;
  return (
    <div className="wip-thumb" style={{ height }}>
      {card.imageUrl
        ? <img src={card.imageUrl} alt={cardLabel(card)} loading="lazy" />
        : <span className="wip-thumb-fallback">{card.category.slice(0, 2)}</span>}
    </div>
  );
}

// ── Dialog ───────────────────────────────────────────────────────────────────

type DialogState =
  | { kind: "matches" }
  | { kind: "pair"; garmentId: string }
  | { kind: "workCombo" }
  | { kind: "worthConsidering" }
  | { kind: "coverage" }
  | { kind: "profile" }
  | { kind: "method" }
  | { kind: "status" }
  | null;

function DialogShell({
  title, subtitle, onClose, children,
}: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="wip-dialog-backdrop" onClick={onClose}>
      <div
        className="wip-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wip-dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="wip-dialog-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="wip-dialog-body">{children}</div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function WardrobeIntelligencePreview() {
  const { page, garmentCards } = useLoaderData<typeof loader>() as {
    page: WardrobePage; garmentCards: GarmentCard[];
  };
  const byId = new Map(garmentCards.map((c) => [c.id, c]));

  const [insight, setInsight] = useState<"work" | "shopping" | "coverage" | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);

  // ── Real data, read from the same page model the live route renders ──────
  const wear = page.sections.find((s) => s.id === "wear");
  const attention = page.sections.find((s) => s.id === "attention");
  const shop = page.sections.find((s) => s.id === "shop");
  const profileSection = page.sections.find((s) => s.id === "profile");

  const rediscover = wear?.blocks.find((b) => b.id === "worth-trying")?.entries[0];
  const forWork = wear?.blocks.find((b) => b.id === "ways-to-get-dressed")?.entries.find((e) => e.title === "For work");
  const workFinding = attention?.blocks.find((b) => b.kind === "findings")?.entries[0];
  const coverage = attention?.blocks.find((b) => b.kind === "coverage")?.entries[0];
  const lowPriority = shop?.blocks.find((b) => b.id === "low-priority")?.entries[0];
  const worthConsidering = shop?.blocks.find((b) => b.id === "worth-considering")?.entries[0];
  const profileBlock = profileSection?.blocks.find((b) => b.id === "profile");

  const paletteRows = (profileBlock?.meta?.palette ?? []) as Array<{ colour: string; count: number }>;

  if (!rediscover) {
    // No dynamic rediscovery candidate for this Closet — the preview has
    // nothing honest to lead with. Real state, not an error.
    return (
      <MyNaiaLayout compact>
        <style>{css}</style>
        <div className="wip-app">
          <main className="wip-main">
            <p className="wip-empty">
              Nothing to preview yet — this Closet doesn&rsquo;t currently have a &ldquo;piece worth
              rediscovering&rdquo; finding to lead with.
            </p>
          </main>
        </div>
      </MyNaiaLayout>
    );
  }

  const rediscoverMembers = (rediscover.meta?.members as Array<{ garmentId: string; title: string }> | undefined);
  const rediscoverGarmentId = (rediscover.meta?.garmentId as string | undefined) ?? rediscoverMembers?.[0]?.garmentId;
  const rediscoverCard = byId.get(rediscoverGarmentId ?? "");
  const matchIds = rediscover.garmentIds;
  const previewPairs = matchIds.slice(0, 3);
  const extraCount = Math.max(0, matchIds.length - previewPairs.length);

  const workGarments = (workFinding?.garmentIds ?? []).map((id) => byId.get(id)).filter((c): c is GarmentCard => !!c);
  const workTops = workGarments.filter((c) => c.category === "TOPS");
  const workBottoms = workGarments.filter((c) => c.category === "BOTTOMS" || c.category === "ONE_PIECE");

  const blockedDetail = (coverage?.meta?.blockedDetail ?? []) as Array<{
    garmentId: string; name: string; reason: string; layers: string[];
  }>;

  function closeDialog() { setDialog(null); }

  function renderDialog() {
    if (!dialog) return null;
    if (dialog.kind === "matches") {
      return (
        <DialogShell
          title={`${matchIds.length} pieces. More possibilities.`}
          subtitle={`Potential matches for your ${cardLabel(rediscoverCard).toLowerCase()}.`}
          onClose={closeDialog}
        >
          <div className="wip-match-grid">
            {matchIds.map((id) => {
              const card = byId.get(id);
              return (
                <button key={id} type="button" className="wip-match-tile" onClick={() => setDialog({ kind: "pair", garmentId: id })}>
                  <Thumb card={card} height={150} />
                  <p>{cardLabel(card)}</p>
                </button>
              );
            })}
          </div>
          <p className="wip-dialog-note">
            Each piece is shown once. Choose one to inspect the potential pairing — this reuses the
            same matching results already computed, not a new outfit-generation service.
          </p>
        </DialogShell>
      );
    }
    if (dialog.kind === "pair") {
      const card = byId.get(dialog.garmentId);
      return (
        <DialogShell title="Try these together." subtitle="A potential pairing from the resolved matching results." onClose={closeDialog}>
          <div className="wip-pair">
            <div><Thumb card={rediscoverCard} height={230} /><p>{cardLabel(rediscoverCard)}</p></div>
            <div><Thumb card={card} height={230} /><p>{cardLabel(card)}</p></div>
          </div>
          <p className="wip-dialog-note">A match between individual pieces is not a complete outfit or a guarantee of fit.</p>
          <button type="button" className="wip-link" onClick={() => setDialog({ kind: "matches" })}>← View all {matchIds.length} matches</button>
        </DialogShell>
      );
    }
    if (dialog.kind === "workCombo" && forWork) {
      return (
        <DialogShell title="An existing work combination." subtitle="Start with the pieces you already own." onClose={closeDialog}>
          <div className="wip-match-grid" style={{ gridTemplateColumns: `repeat(${forWork.garmentIds.length}, minmax(0,1fr))` }}>
            {forWork.garmentIds.map((id) => {
              const card = byId.get(id);
              return <div key={id} className="wip-match-tile"><Thumb card={card} height={170} /><p>{cardLabel(card)}</p></div>;
            })}
          </div>
          <p className="wip-combo-text">{forWork.body}</p>
          <p className="wip-dialog-note">A supported combination already computed for this Closet. Footwear and other finishing items are not represented.</p>
        </DialogShell>
      );
    }
    if (dialog.kind === "worthConsidering" && worthConsidering) {
      const detail = worthConsidering.action?.kind === "reveal" ? worthConsidering.action.detail : undefined;
      return (
        <DialogShell title="What could add useful variety?" subtitle="A recommendation has to be more specific than “buy more grey.”" onClose={closeDialog}>
          <div className="wip-profile-block">
            <h3>The finding</h3>
            <p>{worthConsidering.title}</p>
          </div>
          <div className="wip-proposed-note">
            <strong>Not yet resolved:</strong> the exact garment type and cut. Nothing here invents a
            specific skirt, trouser style or product photograph to fill that gap.
          </div>
          {detail && (
            <div className="wip-profile-block">
              <h3>Why this</h3>
              <p>{detail}</p>
            </div>
          )}
        </DialogShell>
      );
    }
    if (dialog.kind === "coverage" && coverage) {
      return (
        <DialogShell title={`Your ${blockedDetail.length} coverage checks.`} subtitle="Based on your stated coverage preferences." onClose={closeDialog}>
          {blockedDetail.map((b) => (
            <div key={b.garmentId} className="wip-coverage-row">
              <h3>{b.name}</h3>
              <p>
                May not meet your preference for {b.reason.replace(/^keeping your /, "").replace(/^avoiding /, "avoiding ")} on its own.
                {b.layers.length > 0
                  ? ` Worn with your ${b.layers[0]}, it could still work.`
                  : " No suitable layering option was found among your added pieces."}
              </p>
            </div>
          ))}
        </DialogShell>
      );
    }
    if (dialog.kind === "profile" && profileBlock) {
      // Real disclosure entries the engine already computed — Lifestyle and
      // Shape (buildPassportView's structure comparison) among them. Colour
      // and Register comparisons are deliberately not duplicated here: the
      // engine already folds colour into the palette line below and register
      // into the Lifestyle entry, rather than showing the same fact three
      // ways (comparisonDimension(), wardrobe-copy.ts:518-528). No new
      // comparison is added or invented for this preview.
      const entries = (profileBlock.entries ?? []).filter((e) => e.id !== "closet-capability" && !e.id.startsWith("hero-"));
      const capability = profileBlock.entries?.find((e) => e.id === "closet-capability");
      const strengths = (capability?.meta?.strengths ?? []) as Array<{ label: string; count: number }>;
      return (
        <DialogShell title="Your wardrobe profile." subtitle="The supporting picture, without another long report." onClose={closeDialog}>
          {(profileBlock.meta?.summaryLines as string[] | undefined)?.map((line, i) => (
            <div key={i} className="wip-profile-block"><p>{line}</p></div>
          ))}
          {paletteRows.length > 0 && (
            <div className="wip-profile-block">
              <h3>Your main colours</h3>
              <div className="wip-swatches">
                {paletteRows.map((c) => (
                  <div key={c.colour} className="wip-swatch-item">
                    <span className="wip-swatch" style={{ background: swatchColour(c.colour) }} />
                    {c.colour} · {c.count}
                  </div>
                ))}
              </div>
            </div>
          )}
          {entries.map((e) => e.title && e.body ? (
            <div key={e.id} className="wip-profile-block">
              <h3>{e.title}</h3>
              <p>{e.body}</p>
            </div>
          ) : null)}
          {capability && (
            <div className="wip-profile-block">
              <h3>What your Closet can help with</h3>
              <p>{capability.body}</p>
              {strengths.length > 0 && (
                <ul className="wip-capability-list">
                  {strengths.map((s) => <li key={s.label}>{s.label} · {s.count}</li>)}
                </ul>
              )}
            </div>
          )}
          <p className="wip-dialog-note">
            Selected findings from your Closet, Style Passport and StyleMe history — not a new analysis.
            Colour and register comparisons are reflected above (the palette line, and Lifestyle) rather
            than repeated as separate rows.
          </p>
        </DialogShell>
      );
    }
    if (dialog.kind === "method") {
      return (
        <DialogShell title="What this is based on." subtitle="How this page's findings are built and bounded." onClose={closeDialog}>
          <div className="wip-profile-block">
            <h3>Existing evidence</h3>
            <p>Every finding on this page comes from your Closet, your Style Passport, and how you&rsquo;ve used nAia — nothing is generated for this view.</p>
          </div>
          <div className="wip-profile-block">
            <h3>Evidence boundaries</h3>
            <p>
              Individual matches are not complete outfits. A colour appearing less often is not
              automatically a shopping need. Coverage suggestions are checked against what you&rsquo;ve
              stated you prefer. Feedback you&rsquo;ve marked &ldquo;Wore it&rdquo; is genuine self-reported
              evidence — nAia does not automatically track everything you wear.
            </p>
          </div>
          <div className="wip-profile-block">
            <h3>How this preview behaves</h3>
            <p>Selecting a finding changes the main view. Matches, pairings and supporting detail open in a dialog. Nothing here is saved or recalculated.</p>
          </div>
        </DialogShell>
      );
    }
    if (dialog.kind === "status") {
      return (
        <DialogShell title="How much have you added?" subtitle="This changes how confidently a finding can discuss what's missing." onClose={closeDialog}>
          <div className="wip-status-options">
            <button type="button" className="wip-status-choice" onClick={() => { setPreviewStatus("Most of my wardrobe added"); closeDialog(); }}>
              <b>Yes, most of my wardrobe</b>
              <span>The added pieces represent most of what I currently wear.</span>
            </button>
            <button type="button" className="wip-status-choice" onClick={() => { setPreviewStatus("Still adding pieces"); closeDialog(); }}>
              <b>I&rsquo;m still adding pieces</b>
              <span>Some useful pieces may not be in my digital Closet yet.</span>
            </button>
          </div>
          <p className="wip-dialog-note">Preview interaction only. This choice is local to this session and does not recalculate the findings shown here.</p>
        </DialogShell>
      );
    }
    return null;
  }

  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <div className="wip-app">
        <main className="wip-main">
          <p className="wip-eyebrow">My nAia / Wardrobe Intelligence</p>
          <header className="wip-header">
            <div>
              <h1 className="wip-h1">Your wardrobe, <em className="sp-shell-accent">understood.</em></h1>
              <p className="wip-subhead">{page.reading ?? "Find more in what you own. See what deserves your attention."}</p>
            </div>
            <div className="wip-status">
              <strong>{page.basis}</strong>
              <button type="button" className="wip-link" onClick={() => setDialog({ kind: "status" })}>
                {previewStatus ? `${previewStatus} ↗` : "Confirm closet status ↗"}
              </button>
            </div>
          </header>

          <div className="wip-layout">
            <section className="wip-focus" aria-live="polite" aria-label="Selected wardrobe discovery">
              {insight === null && (
                <>
                  <div className="wip-feature-head">
                    <span className="wip-tag">A piece to rediscover</span>
                    <h2>{rediscover.title ?? "More ways to wear this."}</h2>
                    <p>{rediscoverMembers ? rediscover.body : rediscover.meta?.rediscover as string ?? rediscover.body}</p>
                  </div>
                  <div className="wip-board wip-board--split">
                    <div className="wip-hero-piece">
                      <Thumb card={rediscoverCard} height={300} />
                      <p className="wip-piece-label">{cardLabel(rediscoverCard)}</p>
                      <p className="wip-piece-hint">Already in your Closet</p>
                    </div>
                    <div className="wip-partners">
                      <div className="wip-partners-label">
                        Start with these pieces <span>{previewPairs.length} of {matchIds.length}</span>
                      </div>
                      <div className="wip-partner-grid">
                        {previewPairs.map((id) => {
                          const card = byId.get(id);
                          return (
                            <button key={id} type="button" className="wip-partner" onClick={() => setDialog({ kind: "pair", garmentId: id })}>
                              <Thumb card={card} height={110} />
                              <span>With {shortMatchWord(card)}</span>
                            </button>
                          );
                        })}
                        {extraCount > 0 && (
                          <button type="button" className="wip-partner wip-partner--more" onClick={() => setDialog({ kind: "matches" })}>
                            <b>+{extraCount}</b>
                            <span>More pieces to explore</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="wip-feature-foot">
                    <p>Potential individual pairings, not {matchIds.length} complete outfits.</p>
                    <button type="button" className="wip-primary" onClick={() => setDialog({ kind: "matches" })}>
                      Explore all {matchIds.length} matches <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </>
              )}

              {insight === "work" && workFinding && (
                <>
                  <button type="button" className="wip-back" onClick={() => setInsight(null)}>← Back to the rediscovery finding</button>
                  <div className="wip-feature-head">
                    <span className="wip-tag">Your work wardrobe</span>
                    <h2>{workFinding.title}</h2>
                    <p>{workFinding.body} These are some of the pieces behind that finding.</p>
                  </div>
                  <div className="wip-board wip-board--work">
                    <div className="wip-work-group">
                      <h3>Some of your work tops</h3>
                      <div className="wip-work-items">
                        {workTops.slice(0, 2).map((c) => (
                          <div key={c.id} className="wip-work-item"><Thumb card={c} height={190} /><p>{cardLabel(c)}</p></div>
                        ))}
                      </div>
                    </div>
                    <div className="wip-work-group">
                      <h3>Your tailored bottoms</h3>
                      <div className="wip-work-items">
                        {workBottoms.slice(0, 2).map((c) => (
                          <div key={c.id} className="wip-work-item"><Thumb card={c} height={190} /><p>{cardLabel(c)}</p></div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="wip-feature-foot">
                    {worthConsidering && (
                      <button type="button" className="wip-link" onClick={() => setDialog({ kind: "worthConsidering" })}>
                        Review the shopping suggestion
                      </button>
                    )}
                    {forWork && (
                      <button type="button" className="wip-primary" onClick={() => setDialog({ kind: "workCombo" })}>
                        Try what you own <span aria-hidden="true">→</span>
                      </button>
                    )}
                  </div>
                </>
              )}

              {insight === "shopping" && lowPriority && (
                <>
                  <button type="button" className="wip-back" onClick={() => setInsight(null)}>← Back to the rediscovery finding</button>
                  <div className="wip-feature-head">
                    <span className="wip-tag">A lower shopping priority</span>
                    <h2>{lowPriority.title}</h2>
                    <p>{lowPriority.body}</p>
                  </div>
                  <div className="wip-board wip-board--neutral">
                    {lowPriority.garmentIds.map((id) => <Thumb key={id} card={byId.get(id)} height={140} />)}
                  </div>
                  <div className="wip-feature-foot">
                    <p>A shopping priority, not a rule.</p>
                    <button type="button" className="wip-primary" onClick={() => setInsight(null)}>
                      Explore what you have <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </>
              )}

              {insight === "coverage" && coverage && (
                <>
                  <button type="button" className="wip-back" onClick={() => setInsight(null)}>← Back to the rediscovery finding</button>
                  <div className="wip-feature-head">
                    <span className="wip-tag">Your coverage preferences</span>
                    <h2>A closer look at coverage.</h2>
                    <p>{coverage.body}</p>
                  </div>
                  <div className="wip-board wip-board--coverage">
                    {blockedDetail.slice(0, 2).map((b) => (
                      <figure key={b.garmentId}><Thumb card={byId.get(b.garmentId)} height={220} /><figcaption>{b.name}</figcaption></figure>
                    ))}
                  </div>
                  <div className="wip-feature-foot">
                    <p>Checked against what you&rsquo;ve told nAia you prefer.</p>
                    <button type="button" className="wip-primary" onClick={() => setDialog({ kind: "coverage" })}>
                      Review the {blockedDetail.length} pieces <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </>
              )}
            </section>

            <aside className="wip-rail">
              <div className="wip-rail-heading">Also worth a look</div>
              {workFinding && (
                <button type="button" className={`wip-insight${insight === "work" ? " is-active" : ""}`} onClick={() => setInsight("work")}>
                  <span className="wip-insight-topic">Work wardrobe</span>
                  <h3>{workFinding.title}</h3>
                  <p>See the tops and bottoms behind the finding.</p>
                  <span className="wip-insight-arrow" aria-hidden="true">↗</span>
                </button>
              )}
              {lowPriority && (
                <button type="button" className={`wip-insight${insight === "shopping" ? " is-active" : ""}`} onClick={() => setInsight("shopping")}>
                  <span className="wip-insight-topic">Shopping priorities</span>
                  <h3>{lowPriority.title}</h3>
                  <p>{lowPriority.body}</p>
                  <span className="wip-insight-arrow" aria-hidden="true">↗</span>
                </button>
              )}
              {coverage && (
                <button type="button" className={`wip-insight${insight === "coverage" ? " is-active" : ""}`} onClick={() => setInsight("coverage")}>
                  <span className="wip-insight-topic">Your Passport</span>
                  <h3>A closer look at coverage.</h3>
                  <p>{coverage.body}</p>
                  <span className="wip-insight-arrow" aria-hidden="true">↗</span>
                </button>
              )}

              {paletteRows.length > 0 && (
                <div className="wip-palette">
                  <div className="wip-palette-head">
                    <h3>Your main colours</h3>
                    <button type="button" className="wip-link" onClick={() => setDialog({ kind: "profile" })}>View profile ↗</button>
                  </div>
                  <div className="wip-swatches">
                    {paletteRows.map((c) => (
                      <div key={c.colour} className="wip-swatch-item">
                        <span className="wip-swatch" style={{ background: swatchColour(c.colour) }} />
                        {c.colour} · {c.count}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="wip-bottom-line">
                <span>Start with what you own. Add only what earns its place.</span>
                <button type="button" className="wip-link" onClick={() => setDialog({ kind: "method" })}>What this is based on</button>
              </div>
            </aside>
          </div>

          <p className="wip-legal">
            Presentation preview · populated from this Closet&rsquo;s existing analysis, not new
            intelligence. Not the live Wardrobe Intelligence page — nothing here is saved.
          </p>
        </main>
      </div>
      {renderDialog()}
    </MyNaiaLayout>
  );
}

const css = `
  .wip-app{max-width:1180px;margin:0 auto}
  .wip-main{padding:8px 0 40px}
  .wip-eyebrow{font-family:var(--naia-ff-ui);font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:rgba(40,21,12,0.5);margin:0 0 14px}
  .wip-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px;flex-wrap:wrap}
  .wip-h1{font-family:var(--naia-ff-display);font-weight:200;font-size:2rem;letter-spacing:0.01em;text-transform:uppercase;line-height:1.05;margin:0}
  .wip-h1 em{text-transform:none}
  .wip-subhead{font-family:var(--naia-ff-body);font-style:italic;font-size:1rem;color:rgba(40,21,12,0.6);margin:10px 0 0;max-width:520px}
  .wip-status{text-align:right;min-width:180px}
  .wip-status strong{display:block;font-family:var(--naia-ff-ui);font-size:12.5px;font-weight:600;color:var(--naia-ink)}
  .wip-link{border:0;background:none;padding:0;margin-top:6px;font-family:var(--naia-ff-ui);font-size:11.5px;color:var(--naia-accent);text-decoration:underline;text-underline-offset:3px;cursor:pointer}

  .wip-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:26px;align-items:start}
  @media(max-width:900px){.wip-layout{grid-template-columns:1fr}}

  .wip-focus{background:var(--naia-surface);border:1px solid var(--naia-border);border-radius:10px;overflow:hidden}
  .wip-feature-head{padding:24px 24px 16px}
  .wip-tag{display:inline-flex;align-items:center;gap:6px;font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:1.6px;text-transform:uppercase;color:var(--naia-accent);font-weight:600}
  .wip-tag:before{content:'';width:5px;height:5px;border-radius:50%;background:var(--naia-accent)}
  .wip-feature-head h2{font-family:var(--naia-ff-display);font-weight:300;font-size:1.75rem;line-height:1.15;margin:10px 0 8px;color:var(--naia-ink)}
  .wip-feature-head p{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.6;color:rgba(40,21,12,0.65);max-width:560px;margin:0}
  .wip-back{border:0;background:none;padding:20px 24px 0;font-family:var(--naia-ff-ui);font-size:11px;color:var(--naia-accent);cursor:pointer}

  .wip-board{margin:0 18px;background:var(--naia-muted-bg);border-radius:7px;padding:20px;min-height:280px}
  .wip-board--split{display:grid;grid-template-columns:42% minmax(0,1fr);gap:22px}
  .wip-hero-piece{display:flex;flex-direction:column;align-items:center;justify-content:center}
  .wip-thumb{width:100%;display:flex;align-items:center;justify-content:center;background:var(--naia-surface);border-radius:4px;overflow:hidden}
  .wip-thumb img{width:100%;height:100%;object-fit:contain}
  .wip-thumb-fallback{font-family:var(--naia-ff-ui);font-size:11px;color:rgba(40,21,12,0.4)}
  .wip-piece-label{font-family:var(--naia-ff-ui);font-size:12px;font-weight:600;text-align:center;margin:10px 0 2px}
  .wip-piece-hint{font-family:var(--naia-ff-ui);font-size:10px;color:rgba(40,21,12,0.5);text-align:center;margin:0}
  .wip-partners-label{font-family:var(--naia-ff-ui);font-size:11px;font-weight:600;display:flex;justify-content:space-between;margin-bottom:12px;color:var(--naia-ink)}
  .wip-partners-label span{font-weight:400;color:rgba(40,21,12,0.5)}
  .wip-partner-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}
  .wip-partner{border:1px solid var(--naia-border);background:var(--naia-surface);padding:8px;border-radius:5px;text-align:center;cursor:pointer}
  .wip-partner:hover{border-color:var(--naia-accent)}
  .wip-partner span{display:block;margin-top:7px;font-family:var(--naia-ff-ui);font-size:10px;color:rgba(40,21,12,0.65)}
  .wip-partner--more{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:135px;border-style:dashed}
  .wip-partner--more b{font-family:var(--naia-ff-display);font-weight:300;font-size:1.7rem;color:var(--naia-accent)}

  .wip-board--work{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  .wip-board--work h3{font-family:var(--naia-ff-ui);font-size:11px;font-weight:600;margin:0 0 14px}
  .wip-work-items{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .wip-work-item p{font-family:var(--naia-ff-ui);font-size:10px;text-align:center;margin:8px 0 0}

  .wip-board--neutral{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  .wip-board--coverage{display:flex;align-items:center;justify-content:center;gap:20px}
  .wip-board--coverage figure{margin:0;width:38%;max-width:190px}
  .wip-board--coverage figcaption{font-family:var(--naia-ff-ui);font-size:10.5px;text-align:center;margin-top:9px}

  .wip-feature-foot{padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .wip-feature-foot p{font-family:var(--naia-ff-ui);font-size:10.5px;line-height:1.6;color:rgba(40,21,12,0.6);margin:0;max-width:260px}
  .wip-primary{padding:11px 16px;border:1px solid var(--naia-accent);background:var(--naia-accent);color:#fff;border-radius:5px;font-family:var(--naia-ff-ui);font-size:11.5px;font-weight:600;display:inline-flex;align-items:center;gap:10px;cursor:pointer}
  .wip-primary:hover{background:#5a1720}

  .wip-rail-heading{font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:1.6px;text-transform:uppercase;color:rgba(40,21,12,0.5);font-weight:600;margin:0 0 12px}
  .wip-insight{display:block;width:100%;text-align:left;background:transparent;border:0;border-top:1px solid var(--naia-border);padding:17px 24px 17px 0;position:relative;cursor:pointer}
  .wip-insight-topic{font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:1px;text-transform:uppercase;color:rgba(40,21,12,0.5)}
  .wip-insight h3{font-family:var(--naia-ff-display);font-weight:300;font-size:1.2rem;line-height:1.15;margin:7px 0 6px;color:var(--naia-ink)}
  .wip-insight p{font-family:var(--naia-ff-ui);font-size:11px;color:rgba(40,21,12,0.6);line-height:1.5;margin:0}
  .wip-insight-arrow{position:absolute;top:38px;right:0;color:var(--naia-accent);font-size:16px}
  .wip-insight:hover h3{color:var(--naia-accent)}
  .wip-insight.is-active{background:rgba(107,29,38,0.07);border-radius:6px;padding:16px 12px;border-top-color:transparent}

  .wip-palette{margin-top:20px}
  .wip-palette-head{display:flex;align-items:center;justify-content:space-between}
  .wip-palette-head h3{font-family:var(--naia-ff-ui);font-size:11px;font-weight:600;margin:0}
  .wip-swatches{display:flex;gap:18px;margin-top:10px;flex-wrap:wrap}
  .wip-swatch-item{font-family:var(--naia-ff-ui);font-size:9.5px;color:rgba(40,21,12,0.55);text-align:center}
  .wip-swatch{width:26px;height:26px;display:block;margin:0 auto 6px;border-radius:50%;border:1px solid var(--naia-border)}

  .wip-bottom-line{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:20px;font-family:var(--naia-ff-ui);font-size:10.5px;color:rgba(40,21,12,0.55)}
  .wip-legal{font-family:var(--naia-ff-ui);font-size:9.5px;color:rgba(40,21,12,0.45);margin-top:18px}
  .wip-empty{font-family:var(--naia-ff-ui);font-size:13px;color:rgba(40,21,12,0.6);padding:40px 0}

  @media(max-width:700px){
    .wip-header{display:block}
    .wip-status{text-align:left;margin-top:12px}
    .wip-board--split{grid-template-columns:1fr}
    .wip-board--work{grid-template-columns:1fr}
    .wip-board--neutral{grid-template-columns:repeat(2,1fr)}
    .wip-board--coverage{flex-direction:column}
  }

  .wip-dialog-backdrop{position:fixed;inset:0;background:rgba(40,21,12,0.35);display:flex;align-items:center;justify-content:center;padding:20px;z-index:50}
  .wip-dialog{background:var(--naia-surface);border-radius:10px;max-width:780px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(20,10,5,0.25)}
  .wip-dialog-head{position:sticky;top:0;background:var(--naia-surface);padding:20px 22px 14px;border-bottom:1px solid var(--naia-border);display:flex;justify-content:space-between;gap:14px}
  .wip-dialog-head h2{font-family:var(--naia-ff-display);font-weight:300;font-size:1.4rem;margin:0}
  .wip-dialog-head p{font-family:var(--naia-ff-ui);font-size:11.5px;color:rgba(40,21,12,0.55);margin:6px 0 0}
  .wip-dialog-close{width:28px;height:28px;border-radius:50%;border:1px solid var(--naia-border);background:none;font-size:18px;cursor:pointer;flex-shrink:0}
  .wip-dialog-body{padding:20px 22px 24px}
  .wip-match-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  @media(max-width:600px){.wip-match-grid{grid-template-columns:1fr 1fr}}
  .wip-match-tile{border:1px solid var(--naia-border);border-radius:6px;padding:10px;background:var(--naia-muted-bg);text-align:center;cursor:pointer}
  .wip-match-tile p{font-family:var(--naia-ff-ui);font-size:10.5px;margin:8px 0 0}
  .wip-dialog-note{font-family:var(--naia-ff-ui);font-size:10.5px;color:rgba(40,21,12,0.5);line-height:1.6;margin-top:16px}
  .wip-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;background:var(--naia-muted-bg);padding:18px;border-radius:7px}
  .wip-pair p{font-family:var(--naia-ff-ui);font-size:11px;text-align:center;margin-top:8px}
  .wip-profile-block{padding:14px 0;border-bottom:1px solid var(--naia-border)}
  .wip-profile-block:last-child{border-bottom:0}
  .wip-profile-block h3{font-family:var(--naia-ff-ui);font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--naia-accent);margin:0 0 8px}
  .wip-profile-block p{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.7;color:rgba(40,21,12,0.72);margin:0}
  .wip-capability-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:8px 16px;font-family:var(--naia-ff-ui);font-size:11.5px;color:rgba(40,21,12,0.6)}
  .wip-proposed-note{background:rgba(107,29,38,0.07);border-left:3px solid var(--naia-accent);padding:14px 16px;border-radius:5px;margin:14px 0;font-family:var(--naia-ff-ui);font-size:12px;line-height:1.6;color:#59333b}
  .wip-coverage-row{padding:13px 0;border-bottom:1px solid var(--naia-border)}
  .wip-coverage-row:last-child{border-bottom:0}
  .wip-coverage-row h3{font-family:var(--naia-ff-ui);font-size:12.5px;font-weight:600;margin:0 0 5px}
  .wip-coverage-row p{font-family:var(--naia-ff-ui);font-size:11.5px;color:rgba(40,21,12,0.6);line-height:1.6;margin:0}
  .wip-combo-text{font-family:var(--naia-ff-body);font-style:italic;font-size:1rem;line-height:1.6;margin-top:16px;color:var(--naia-ink)}
  .wip-status-options{display:flex;flex-direction:column;gap:12px}
  .wip-status-choice{padding:14px 16px;text-align:left;background:var(--naia-bg);border:1px solid var(--naia-border);border-radius:5px;cursor:pointer}
  .wip-status-choice:hover{border-color:var(--naia-accent)}
  .wip-status-choice b{display:block;font-family:var(--naia-ff-ui);font-size:13px;font-weight:600}
  .wip-status-choice span{display:block;font-family:var(--naia-ff-ui);font-size:11.5px;color:rgba(40,21,12,0.55);margin-top:3px}
`;
