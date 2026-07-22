import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

function fmtDate(d: string | Date): string {
  const date = new Date(d);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return { authed: false as const, looks: [] };

  const sessions = await prisma.stylingSession.findMany({
    where: { customerId: customer.id },
    take: 100,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      currentMood: true,
      desiredFeeling: true,
      occasion: true,
      styleFrom: true,
      review: { select: { id: true } },
      suggestions: {
        take: 1,
        where: { selected: true },
        select: {
          id: true,
          outfitName: true,
          savedAsLook: true,
          items: {
            select: {
              itemType: true,
              productTitle: true,
              closetItemId: true,
              closetItem: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const looks = sessions.map((s) => {
    const sug = s.suggestions[0] ?? null;
    const fromStyle = s.styleFrom;
    const items = sug?.items ?? [];
    const nadineItems = items.filter((i) => !i.closetItemId && i.productTitle).map((i) => i.productTitle ?? "");
    const closetItems = items.filter((i) => i.closetItemId).map((i) => i.closetItem?.name ?? "Closet piece");
    return {
      id: s.id,
      title: sug?.outfitName ?? "nAia Look",
      date: fmtDate(s.createdAt),
      occasion: s.occasion ?? "",
      mood: s.currentMood ?? "",
      feeling: s.desiredFeeling ?? "",
      sourcing: nadineItems.length && closetItems.length ? "NADINE + My Closet" : nadineItems.length ? "NADINE" : closetItems.length ? "My Closet" : fromStyle === "OWN_WARDROBE" ? "My Closet" : "NADINE",
      saved: sug?.savedAsLook ?? false,
      hasFeedback: !!s.review,
    };
  });

  return { authed: true as const, looks };
}

type LookRow = {
  id: string;
  title: string;
  date: string;
  occasion: string;
  mood: string;
  feeling: string;
  sourcing: string;
  saved: boolean;
  hasFeedback: boolean;
};

type Sourcing = "all" | "NADINE" | "My Closet" | "NADINE + My Closet";
type Saved = "all" | "saved" | "unsaved";
type Fb = "all" | "any" | "none";
type Sort = "newest" | "oldest";

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          marginTop: "0.375rem",
          display: "block",
          width: "100%",
          border: "1px solid var(--fg-15)",
          background: "var(--bg-60)",
          padding: "0.5rem 0.75rem",
          fontSize: "0.85rem",
          color: "var(--fg)",
          outline: "none",
          borderRadius: 0,
          fontFamily: "var(--ff-ui)",
        }}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function SparklesSmall() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--fg-25)" }}>
      <path d="M12 3L13.5 8H18L14.25 11L15.75 16L12 13L8.25 16L9.75 11L6 8H10.5L12 3Z" />
      <path d="M5 3l.75 2H8L6.25 6.5 7 9 5 7.5 3 9l.75-2.5L2 5h2.25L5 3z" />
    </svg>
  );
}

function LookGridCard({ look }: { look: LookRow }) {
  return (
    <article style={{ display: "flex", flexDirection: "column" }}>
      <Link
        to={`/my-naia/styleme/looks/${look.id}`}
        style={{
          display: "grid",
          placeItems: "center",
          aspectRatio: "4/5",
          border: "1px solid var(--fg-10)",
          background: "color-mix(in oklab, var(--bg) 92%, white)",
          position: "relative",
          overflow: "hidden",
          textDecoration: "none",
          transition: "border-color 0.15s",
        }}
      >
        <SparklesSmall />
      </Link>

      <div style={{ marginTop: "0.75rem", fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>
        {look.date}{look.occasion ? ` · ${look.occasion}` : ""}
      </div>

      <Link
        to={`/my-naia/styleme/looks/${look.id}`}
        style={{
          display: "block",
          marginTop: "0.375rem",
          fontFamily: "var(--ff-display)",
          fontWeight: 300,
          fontSize: "1.25rem",
          lineHeight: 1,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          color: "var(--fg)",
          textDecoration: "none",
        }}
      >
        {look.title}
      </Link>

      {(look.mood || look.feeling) && (
        <p style={{ marginTop: "0.375rem", fontSize: "0.82rem", lineHeight: 1.5, color: "var(--fg-70)" }}>
          {look.mood && <><span style={{ color: "var(--fg-55)" }}>Mood ·</span> {look.mood}</>}
          {look.mood && look.feeling && <span style={{ color: "var(--fg-40)" }}> → </span>}
          {look.feeling && <><span style={{ color: "var(--fg-55)" }}>Feeling ·</span> {look.feeling}</>}
        </p>
      )}

      <div style={{ marginTop: "0.375rem", fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>{look.sourcing}</div>

      <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.28em" }}>
        <Link to={`/my-naia/styleme/looks/${look.id}`} style={{ textDecoration: "underline", textUnderlineOffset: "3px", color: "var(--fg-80)" }}>View Look</Link>
        <span style={{ color: "var(--fg-25)" }}>·</span>
        <Link to={`/my-naia/styleme/looks/${look.id}/refine`} style={{ textDecoration: "underline", textUnderlineOffset: "3px", color: "var(--fg-80)" }}>Refine</Link>
        <span style={{ color: "var(--fg-25)" }}>·</span>
        <Link to={`/my-naia/styleme/looks/${look.id}/feedback`} style={{ textDecoration: "underline", textUnderlineOffset: "3px", color: "var(--fg-80)" }}>
          {look.hasFeedback ? "View Feedback" : "Give Feedback"}
        </Link>
      </div>
    </article>
  );
}

export default function LooksHistoryPage() {
  const data = useLoaderData<typeof loader>();
  const { looks } = data;

  const [q, setQ] = useState("");
  const [sourcing, setSourcing] = useState<Sourcing>("all");
  const [savedFilter, setSavedFilter] = useState<Saved>("all");
  const [fb, setFb] = useState<Fb>("all");
  const [sort, setSort] = useState<Sort>("newest");

  const UNIQUE_OCCASIONS = useMemo(() => Array.from(new Set(looks.map((l) => l.occasion).filter(Boolean))), [looks]);
  const [occasion, setOccasion] = useState<string>("all");

  const results = useMemo(() => {
    const filtered = looks.filter((l) => {
      if (q && !`${l.title} ${l.occasion} ${l.mood} ${l.feeling}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (occasion !== "all" && l.occasion !== occasion) return false;
      if (sourcing !== "all" && l.sourcing !== sourcing) return false;
      if (savedFilter === "saved" && !l.saved) return false;
      if (savedFilter === "unsaved" && l.saved) return false;
      if (fb === "any" && !l.hasFeedback) return false;
      if (fb === "none" && l.hasFeedback) return false;
      return true;
    });
    return sort === "oldest" ? [...filtered].reverse() : filtered;
  }, [looks, q, occasion, sourcing, savedFilter, fb, sort]);

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Header */}
        <section>
          <div className="mn-eyebrow">StyleMe</div>
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
            All Looks
          </h1>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            Every look nAia has styled for you. Search, filter and open any card to view the full look.
          </p>
        </section>

        {/* Filters */}
        <section
          style={{
            border: "1px solid var(--fg-10)",
            background: "var(--bg-40)",
            padding: "1.25rem 1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search looks by title, occasion, mood…"
            style={{
              width: "100%",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              borderBottom: "1px solid var(--fg-20)",
              background: "transparent",
              padding: "0.5rem 0",
              fontSize: "0.9rem",
              color: "var(--fg)",
              outline: "none",
              fontFamily: "var(--ff-ui)",
            }}
          />
          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))" }}>
            <FilterSelect
              label="Occasion"
              value={occasion}
              onChange={setOccasion}
              options={[["all", "All"], ...UNIQUE_OCCASIONS.map((o) => [o, o] as [string, string])]}
            />
            <FilterSelect
              label="Source"
              value={sourcing}
              onChange={(v) => setSourcing(v as Sourcing)}
              options={[["all", "All"], ["NADINE", "NADINE"], ["My Closet", "My Closet"], ["NADINE + My Closet", "Both"]]}
            />
            <FilterSelect
              label="Saved"
              value={savedFilter}
              onChange={(v) => setSavedFilter(v as Saved)}
              options={[["all", "All"], ["saved", "Saved"], ["unsaved", "Unsaved"]]}
            />
            <FilterSelect
              label="Feedback"
              value={fb}
              onChange={(v) => setFb(v as Fb)}
              options={[["all", "All"], ["any", "Any given"], ["none", "None yet"]]}
            />
            <FilterSelect
              label="Sort"
              value={sort}
              onChange={(v) => setSort(v as Sort)}
              options={[["newest", "Newest first"], ["oldest", "Oldest first"]]}
            />
          </div>
        </section>

        {/* Results */}
        {looks.length === 0 ? (
          <p className="mn-state-note">
            {data.authed
              ? "Your looks will appear here after your first StyleMe session."
              : "Sign in to view your looks."}
          </p>
        ) : results.length === 0 ? (
          <div style={{ border: "1px solid var(--fg-10)", background: "var(--bg-50)", padding: "2rem", textAlign: "center" }}>
            <p style={{ fontSize: "0.9rem", color: "var(--fg-75)" }}>No looks match those filters.</p>
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              display: "grid",
              gap: "2rem",
              gridTemplateColumns: "repeat(auto-fill, minmax(13rem, 1fr))",
            }}
          >
            {results.map((l) => (
              <li key={l.id}>
                <LookGridCard look={l} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </MyNaiaLayout>
  );
}
