import { useState } from "react";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import type { TrendReportData } from "~/lib/trend-reports";
import {
  getEditorialReportBySlug,
  getPublishedEditorialReports,
} from "~/lib/editorial-reports.server";
import {
  getShopperEvidence,
  buildShopperEdit,
  type ShopperEdit,
} from "~/lib/trend-evidence.server";
import {
  matchNadineProduct,
  type NadineProductRecommendation,
} from "~/lib/trend-product-recommendation.server";
import { checkEntitlement } from "~/lib/plan/entitlement.server";
import {
  recordPersonalisedTrendEditUsage,
  getTrendEditUsageState,
  type TrendEditSnapshot,
} from "~/lib/plan/personalised-trend-edit-usage.server";
import { getUsageWindow } from "~/lib/plan/usage-window.server";
import {
  emitTrendEditGenerated,
  recordJourneyEventAwaited,
  hashCustomerId,
} from "~/lib/ai/journey-events.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import TrendEditReportBody, { TREND_EDIT_REPORT_BODY_CSS } from "~/components/trends/TrendEditReportBody";
import naiaStyles from "~/styles/naia-design-system.css?url";

type LoaderData = {
  report: TrendReportData;
  edit: ShopperEdit | null;
  hasProfile: boolean;
  generationFailed: boolean;
  nadineRecommendation: NadineProductRecommendation | null;
  reportIndex: number;
  membershipRequired: boolean;
  /** A generation happened this period, but predates snapshot persistence —
   *  its exact content was never captured. Never regenerated, never
   *  backfilled — see getTrendEditUsageState. */
  historicalUnavailable: boolean;
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Oswald:wght@200;300;400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Space+Mono&display=swap",
  },
];

export function meta({ data }: { data?: LoaderData }) {
  if (!data?.report) return [{ title: "Report Not Found | My nAia" }];
  return [{ title: `My Edit — ${data.report.title} | My nAia` }];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);

  const [report, allPublished] = await Promise.all([
    getEditorialReportBySlug(params.slug ?? ""),
    getPublishedEditorialReports(),
  ]);
  if (!report) throw new Response("Not Found", { status: 404 });
  const reportIndex = allPublished.findIndex((r) => r.slug === report.slug);

  // Frozen-at-first-generation behaviour: once this customer has a stored
  // snapshot for this report in the current period, EVERY later view this
  // period renders that exact stored snapshot — never a fresh regeneration
  // from whatever Passport/Closet state happens to look like today. Without
  // this, a customer could see Edit A on first visit while a changed Closet
  // silently produced Edit B on a later visit, and Admin's stored snapshot
  // (frozen at Edit A) would permanently disagree with what the customer is
  // currently looking at. No second generation-history system here — this
  // reads the same PersonalisedTrendEditUsage row the usage/quota logic
  // already owns.
  //
  // Three distinct states, not two: "no row yet" and "row exists but
  // predates snapshot persistence" must never collapse into the same
  // "generate" behavior — see getTrendEditUsageState. A legacy row
  // (snapshot: null) means a generation already happened this period before
  // snapshot capture existed; it is NEVER regenerated and NEVER backfilled —
  // the customer sees an honest historical-unavailable state instead.
  const usageState = await getTrendEditUsageState(customer.id, report.slug);
  if (usageState.status === "snapshotted") {
    return {
      report,
      edit: usageState.snapshot.edit,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: usageState.snapshot.nadineRecommendation,
      reportIndex,
      membershipRequired: false,
      historicalUnavailable: false,
    } satisfies LoaderData;
  }
  if (usageState.status === "legacy_no_snapshot") {
    return {
      report,
      edit: null,
      hasProfile: true,
      generationFailed: false,
      nadineRecommendation: null,
      reportIndex,
      membershipRequired: false,
      historicalUnavailable: true,
    } satisfies LoaderData;
  }

  // Personalised Trend Edit is a membership feature. Behind ENTITLEMENT_ENFORCEMENT
  // (same rollout flag as StyleMe/BuySkip/VTO — disabled in production until the
  // upgrade flow exists) a non-member sees a clear membership-required state
  // instead of the full personalised edit. No Closet/Passport read happens for a
  // blocked customer — nothing to leak, nothing generated, nothing to count.
  if (process.env.ENTITLEMENT_ENFORCEMENT === "true") {
    const entitlement = await checkEntitlement(customer.id, customer.membershipStatus, "personalisedTrend");
    if (!entitlement.allowed) {
      return {
        report,
        edit: null,
        hasProfile: false,
        generationFailed: false,
        nadineRecommendation: null,
        reportIndex,
        membershipRequired: true,
        historicalUnavailable: false,
      } satisfies LoaderData;
    }
  }

  try {
    const evidence = await getShopperEvidence(customer.id);
    const rawEdit = evidence.hasProfile ? buildShopperEdit(report, evidence) : null;
    const nadineRecommendation =
      rawEdit ? matchNadineProduct(report, evidence, rawEdit) : null;

    // For Modern Tailoring: when the shopper's only closet evidence is a TOP
    // (the softer counterpart) and a NADINE piece fills the missing tailored
    // anchor, name the product directly in the Look To Try so the outfit
    // formula matches the recommendation card below it.
    let edit = rawEdit;
    if (
      rawEdit &&
      nadineRecommendation &&
      report.slug === "modern-tailoring-spring-2026" &&
      rawEdit.worthInvestingStatement === null &&
      rawEdit.evidenceClosetItems.length > 0 &&
      rawEdit.evidenceClosetItems[0].category === "TOPS"
    ) {
      const topName = rawEdit.evidenceClosetItems[0].name;
      edit = {
        ...rawEdit,
        aLookToTry: `Your ${topName} + ${nadineRecommendation.title} + a clean straight or wide-leg trouser + minimal flats.`,
      };
    }

    // Usage recording — fired only for a genuine personalised edit (never a
    // locked/empty/failed state). Two independent writes, two independent
    // purposes:
    //   - recordPersonalisedTrendEditUsage: the customer entitlement/usage
    //     source of truth (PersonalisedTrendEditUsage) — this is what Plan &
    //     Usage and checkEntitlement read. Idempotent create-if-absent; the
    //     DB unique constraint is the race-safety authority.
    //   - emitTrendEditGenerated: analytics only (JourneyEvent, hashed
    //     customerId) — never read for quota or Plan & Usage.
    // Both share one periodKey from getUsageWindow(), so the idempotency
    // boundary and the monthly count window can never drift apart. Neither
    // write ever blocks the response.
    if (edit) {
      const { periodKey } = getUsageWindow();
      try {
        const snapshot: TrendEditSnapshot = {
          schemaVersion: "trend-edit-snapshot-v1",
          reportSlug: report.slug,
          reportTitle: report.title,
          reportSeason: report.season,
          generatedAt: new Date().toISOString(),
          edit,
          nadineRecommendation,
        };
        await recordPersonalisedTrendEditUsage(customer.id, report.slug, snapshot);
        // Defensive verification, not a retry/self-heal: a genuine first
        // generation must never leave a row with a null snapshot. Nothing
        // else in this codebase can tell "the write worked" apart from
        // "it silently didn't" — the previous version of this code had no
        // logging at all here, which is exactly why a prior null-snapshot
        // row (14 Oct 2026) could not be traced to a cause. This never
        // writes again on a bad result — see getTrendEditUsageState's own
        // "legacy_no_snapshot" handling for why a stuck-null row must stay
        // untouched rather than being retried into existing.
        const verify = await getTrendEditUsageState(customer.id, report.slug);
        if (verify.status !== "snapshotted") {
          console.error(
            `trend_edit_snapshot_write_unverified customer=${hashCustomerId(customer.id)} report=${report.slug} period=${periodKey} status=${verify.status}`,
          );
        }
      } catch (writeError) {
        console.error(
          `trend_edit_snapshot_write_failed customer=${hashCustomerId(customer.id)} report=${report.slug} period=${periodKey}`,
          writeError,
        );
      }
      try {
        await recordJourneyEventAwaited(
          emitTrendEditGenerated({
            customerId: customer.id,
            slug: report.slug,
            closetItemCount: evidence.closetItems.length,
          }),
          `trend_edit_generated:${hashCustomerId(customer.id)}:${report.slug}:${periodKey}:v1`,
        );
      } catch {
        /* never let usage-event recording block the response */
      }
    }

    return {
      report,
      edit,
      hasProfile: evidence.hasProfile,
      generationFailed: false,
      nadineRecommendation,
      reportIndex,
      membershipRequired: false,
      historicalUnavailable: false,
    } satisfies LoaderData;
  } catch (error) {
    console.error("Shopper trend edit generation failed:", error);
    return {
      report,
      edit: null,
      hasProfile: false,
      generationFailed: true,
      nadineRecommendation: null,
      reportIndex,
      membershipRequired: false,
      historicalUnavailable: false,
    } satisfies LoaderData;
  }
}

const TINTS = ["#efeae0", "#e6dccb", "#d9c9b5", "#efe6d7", "#e2d3bf", "#ede2cf"];

const css = `
  .tmd-page { padding: 48px 0 96px; }

  /* ── Back link ───────────────────────────────────────────────── */
  .tmd-back {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.55);
    text-decoration: none;
    margin-bottom: 40px;
    transition: color 0.2s;
  }
  .tmd-back:hover { color: #7a1e28; }

  /* ── Action buttons ─────────────────────────────────────────── */
  .tmd-action-row {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 32px;
  }
  .tmd-action-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border: 1px solid rgba(26,17,9,0.18);
    font-family: 'Space Mono', monospace; font-size: 0.58rem; letter-spacing: 0.24em;
    text-transform: uppercase; color: #1a1109; background: transparent;
    cursor: pointer; text-decoration: none; transition: border-color 0.2s, color 0.2s;
  }
  .tmd-action-btn:hover { border-color: #7a1e28; color: #7a1e28; }
  .tmd-action-btn.active { color: #7a1e28; border-color: #7a1e28; }
  @media (max-width: 767px) { .tmd-action-row { display: none; } }

  /* ── Hero tinted block ───────────────────────────────────────── */
  .tmd-hero {
    position: relative;
    overflow: hidden;
    padding: 36px;
    margin-bottom: 48px;
  }
  .tmd-hero-num {
    position: absolute;
    right: -16px;
    top: -40px;
    font-family: 'Oswald', sans-serif;
    font-size: clamp(10rem, 14vw, 14rem);
    font-weight: 200;
    line-height: 1;
    color: rgba(26,17,9,0.05);
    pointer-events: none;
    user-select: none;
    z-index: 0;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .tmd-hero-inner { position: relative; z-index: 1; }
  .tmd-hero-kicker {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.50);
    margin-bottom: 16px;
  }
  .tmd-hero-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(2.4rem, 5vw, 4rem);
    font-weight: 200;
    line-height: 0.9;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: #1a1109;
    margin: 0 0 20px;
  }
  .tmd-hero-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    text-transform: none;
    color: #7a1e28;
  }
  .tmd-hero-subtitle {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-style: italic;
    color: rgba(26,17,9,0.68);
    line-height: 1.7;
    max-width: 40rem;
    margin-bottom: 24px;
  }
  .tmd-hero-public-link {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: #7a1e28;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    opacity: 0.8;
    transition: opacity 0.2s;
  }
  .tmd-hero-public-link:hover { opacity: 1; }

  /* Divider, section labels, body text, reading box, evidence panel,
     closet items, low-data notice, and bullet lists now live in
     TREND_EDIT_REPORT_BODY_CSS (app/components/trends/TrendEditReportBody),
     shared with the Admin Customer 360 Trend Edit detail view. */

  /* ── State boxes ─────────────────────────────────────────────── */
  .tmd-state {
    padding: 48px 40px;
    border: 1px solid rgba(26,17,9,0.08);
    background: rgba(255,255,255,0.45);
    text-align: center;
  }
  .tmd-state-text {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.15rem;
    font-style: italic;
    color: #1a1109;
    line-height: 1.7;
    margin-bottom: 28px;
    max-width: 34rem;
    margin-left: auto;
    margin-right: auto;
  }
  .tmd-state-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(26,17,9,0.80);
    border-radius: 9999px;
    padding: 11px 22px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #1a1109;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .tmd-state-btn:hover { background: #1a1109; color: #f5f0e8; }

  /* ── Footer CTA ──────────────────────────────────────────────── */
  .tmd-footer {
    margin-top: 60px;
    padding: 36px 36px;
    background: #2a1e17;
    color: #f0ebe2;
  }
  .tmd-footer-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(240,235,226,0.50);
    margin-bottom: 16px;
  }
  .tmd-footer-body {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-style: italic;
    color: rgba(240,235,226,0.75);
    line-height: 1.7;
    max-width: 36rem;
    margin-bottom: 24px;
  }
  .tmd-footer-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(240,235,226,0.6);
    border-radius: 9999px;
    padding: 11px 22px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #f0ebe2;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .tmd-footer-btn:hover { background: #f0ebe2; color: #1a1109; }

  /* NADINE product card and "Already yours" strip now live in
     TREND_EDIT_REPORT_BODY_CSS (app/components/trends/TrendEditReportBody),
     shared with the Admin Customer 360 Trend Edit detail view. */
`;

export function ErrorBoundary() {
  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <style>{TREND_EDIT_REPORT_BODY_CSS}</style>
      <div className="tmd-page">
        <Link to="/trends/my-edits" className="tmd-back">← My Trend Edits</Link>
        <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.1rem", fontStyle: "italic", color: "rgba(26,17,9,0.60)" }}>
          This edit could not be found.
        </p>
      </div>
    </MyNaiaLayout>
  );
}

export default function MyTrendEditDetail() {
  const { report, edit, hasProfile, generationFailed, nadineRecommendation, reportIndex, membershipRequired, historicalUnavailable } = useLoaderData() as LoaderData;
  const tint = TINTS[Math.max(0, reportIndex) % TINTS.length];
  const num = String(Math.max(0, reportIndex)).padStart(2, "0");

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const copyLink = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const fallbackCopy = () => {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
      } catch { return false; }
    };
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(url); ok = true; } catch { ok = fallbackCopy(); }
    } else { ok = fallbackCopy(); }
    setCopyStatus(ok ? "copied" : "error");
    window.setTimeout(() => setCopyStatus("idle"), 2500);
  };

  const downloadMyEdit = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 20;
    const maxW = pageW - margin * 2;
    let y = 20;
    const addText = (text: string, size: number, style: string, color: number[], spaceAfter?: number) => {
      doc.setFontSize(size);
      doc.setFont("helvetica", style || "normal");
      doc.setTextColor(...(color as [number, number, number]));
      const lines = doc.splitTextToSize(String(text || ""), maxW);
      lines.forEach((line: string) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(line, margin, y);
        y += size * 0.45;
      });
      y += spaceAfter || 4;
    };
    doc.setFontSize(24); doc.setFont("helvetica", "bolditalic"); doc.setTextColor(34, 21, 22);
    doc.text("nAia", margin, y); y += 8;
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(139, 32, 53);
    doc.text("MY TREND EDIT · " + report.season.toUpperCase(), margin, y); y += 10;
    doc.setDrawColor(34, 21, 22); doc.line(margin, y, pageW - margin, y); y += 10;
    addText(report.title, 20, "bold", [34, 21, 22], 6);
    if (edit?.subTitle) addText(edit.subTitle, 12, "italic", [122, 111, 106], 10);
    if (edit?.yourVersion) { addText("YOUR VERSION", 8, "bold", [139, 32, 53], 3); addText(edit.yourVersion, 11, "normal", [34, 21, 22], 10); }
    if (edit?.evidenceStyleDna) { addText("YOUR STYLE DNA SAYS", 8, "bold", [139, 32, 53], 3); addText(edit.evidenceStyleDna, 10, "normal", [34, 21, 22], 8); }
    if (edit?.evidencePassportSays) { addText("YOUR PASSPORT SAYS", 8, "bold", [139, 32, 53], 3); addText(edit.evidencePassportSays, 10, "normal", [34, 21, 22], 8); }
    if (edit?.evidenceReviews) { addText("YOUR RATINGS SAY", 8, "bold", [139, 32, 53], 3); addText(edit.evidenceReviews, 10, "normal", [34, 21, 22], 8); }
    if (edit?.yourBestRouteIn) { addText("YOUR BEST ROUTE IN", 8, "bold", [139, 32, 53], 3); addText(edit.yourBestRouteIn, 10, "normal", [34, 21, 22], 8); }
    if (edit?.aLookToTry) { addText("A LOOK TO TRY", 8, "bold", [139, 32, 53], 3); addText(edit.aLookToTry, 10, "normal", [34, 21, 22], 8); }
    if (edit?.worthInvestingStatement) { addText("WORTH INVESTING IN", 8, "bold", [139, 32, 53], 3); addText(edit.worthInvestingStatement, 10, "normal", [34, 21, 22], 8); }
    if (edit?.partToTake?.length) { addText("THE PART TO TAKE", 8, "bold", [139, 32, 53], 3); addText(edit.partToTake.join("\n"), 10, "normal", [34, 21, 22], 8); }
    if (nadineRecommendation && !edit?.worthInvestingStatement) { addText("A NADINE PIECE FOR THIS GAP", 8, "bold", [139, 32, 53], 3); addText(`${nadineRecommendation.title} — ${nadineRecommendation.personalExplanation}`, 10, "normal", [34, 21, 22], 8); }
    if (edit?.theBalanceToProtect) { addText("THE BALANCE TO PROTECT", 8, "bold", [139, 32, 53], 3); addText(edit.theBalanceToProtect, 10, "normal", [34, 21, 22], 8); }
    if (edit?.partToLeave?.length) { addText("THE PART TO LEAVE", 8, "bold", [139, 32, 53], 3); addText(edit.partToLeave.join("\n"), 10, "normal", [34, 21, 22], 8); }
    doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(122, 111, 106);
    doc.text("nAia Trend Reports · Your personalised edit", margin, 285);
    doc.save("my-edit-" + report.title.replace(/[^a-z0-9]/gi, "-").toLowerCase() + ".pdf");
  };

  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <style>{TREND_EDIT_REPORT_BODY_CSS}</style>
      <div className="tmd-page">
        <Link to="/trends/my-edits" className="tmd-back">← My Trend Edits</Link>

        {edit && (
          <div className="tmd-action-row">
            <button className={`tmd-action-btn${copyStatus === "copied" ? " active" : ""}`} onClick={copyLink}>
              {copyStatus === "copied" ? "Copied ✓" : copyStatus === "error" ? "Failed" : "Copy link"}
            </button>
            <button className="tmd-action-btn" onClick={downloadMyEdit}>Download My Edit</button>
          </div>
        )}

        {/* Hero tinted block */}
        <div className="tmd-hero" style={{ background: tint }}>
          <span className="tmd-hero-num" aria-hidden="true">{num}</span>
          <div className="tmd-hero-inner">
            <div className="tmd-hero-kicker">{report.season} · personal edit</div>
            <h1 className="tmd-hero-title">
              {report.title.split(" ").slice(0, -1).join(" ")}<br />
              <em>{report.title.split(" ").slice(-1)[0]}</em>
            </h1>
            {edit && <p className="tmd-hero-subtitle">{edit.subTitle}</p>}
            <Link to={`/trend-reports/${report.slug}`} className="tmd-hero-public-link">
              Read the public report →
            </Link>
          </div>
        </div>

        {/* State: membership required */}
        {membershipRequired ? (
          <div className="tmd-state">
            <p className="tmd-state-text">
              Your Personalised Trend Edit is a nAia Membership feature. Join to see this direction read through your own Style Passport and Closet.
            </p>
            <Link to="/my-naia/plan-usage" className="tmd-state-btn">Explore nAia Membership →</Link>
          </div>
        ) : generationFailed ? (
          <div className="tmd-state">
            <p className="tmd-state-text">
              Your nAia Edit is taking a moment. Please try again shortly.
            </p>
            <Link to={`/trend-reports/${report.slug}`} className="tmd-state-btn">
              Back to the report →
            </Link>
          </div>
        ) : historicalUnavailable ? (
          /* State: a generation happened earlier this period, before we
             started saving the full edit — never regenerated, never
             backfilled. */
          <div className="tmd-state">
            <p className="tmd-state-text">
              You already received a nAia Edit for this report earlier this period, and we can&rsquo;t reopen it in its original form. Check back once this period resets for a fresh personalised edit.
            </p>
            <Link to="/trends/my-edits" className="tmd-state-btn">Back to My Trend Edits →</Link>
          </div>
        ) : !hasProfile ? (
          /* State: passport incomplete */
          <div className="tmd-state">
            <p className="tmd-state-text">
              Your nAia Edit reads this report through your Passport — and yours isn&rsquo;t complete yet. Finish it to see what this direction means for you specifically.
            </p>
            <Link to="/passport" className="tmd-state-btn">Complete Your Passport →</Link>
          </div>
        ) : edit ? (
          /* Full edit */
          <>
            <TrendEditReportBody edit={edit} nadineRecommendation={nadineRecommendation} />

            {/* Footer CTA */}
            <div className="tmd-footer">
              <div className="tmd-footer-eyebrow">build a sharper edit</div>
              <p className="tmd-footer-body">
                Add your most-worn pieces and rate your outfits so nAia can read your real style world more precisely.
              </p>
              <Link to="/closet" className="tmd-footer-btn">Open My Closet →</Link>
            </div>
          </>
        ) : null}
      </div>
    </MyNaiaLayout>
  );
}
