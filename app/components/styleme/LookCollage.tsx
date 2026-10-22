// app/components/styleme/LookCollage.tsx
//
// Renders the real pieces from one StyleMe result as a compact collage: one
// image fills the card, two split it evenly, three or four tile it — always
// the actual pieces from that result, never an invented or borrowed image.
// Shared by Overview's Latest StyleMe cards and the StyleMe looks/history
// gallery so both surfaces look and behave identically.

// A single collage tile. If a signed/expired image URL fails client-side, it
// swaps to the same neutral placeholder used when no image resolved server-side
// at all — never a broken-image icon.
function CollageTile({ src, alt }: { src: string; alt: string }) {
  return (
    // 2026-10-24: a visible background so object-fit: contain's letterboxing
    // (which replaced "cover" — cover was cropping the garment's own silhouette
    // to fill the tile) reads as intentional rather than a transparent gap.
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "color-mix(in oklab, var(--bg) 92%, white)" }}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        onError={(e) => {
          e.currentTarget.style.display = "none";
          const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "grid";
        }}
      />
      <div style={{ display: "none", position: "absolute", inset: 0, placeItems: "center", background: "color-mix(in oklab, var(--bg) 92%, white)" }} aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25, color: "var(--fg)" }}>
          <path d="M12 3 4.5 7.5v9L12 21l7.5-4.5v-9L12 3z" /><path d="m4.5 7.5 7.5 4.5 7.5-4.5M12 12v9" />
        </svg>
      </div>
    </div>
  );
}

const EMPTY_LOOK_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25, color: "var(--fg)" }} aria-hidden="true">
    <path d="M12 3 4.5 7.5v9L12 21l7.5-4.5v-9L12 3z" /><path d="m4.5 7.5 7.5 4.5 7.5-4.5M12 12v9" />
  </svg>
);

export function LookCollage({ images, extraCount, alt }: { images: string[]; extraCount: number; alt: string }) {
  if (images.length === 0) {
    return <div style={{ display: "grid", placeItems: "center", width: "100%", height: "100%" }}>{EMPTY_LOOK_ICON}</div>;
  }

  const gridStyle: React.CSSProperties =
    images.length === 1
      ? { display: "grid", width: "100%", height: "100%" }
      : { display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: images.length === 2 ? "1fr" : "1fr 1fr", gap: "2px", width: "100%", height: "100%" };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div style={gridStyle}>
        {images.map((src, i) => (
          <div key={i} style={images.length === 3 && i === 0 ? { gridColumn: "1 / 3" } : undefined}>
            <CollageTile src={src} alt={alt} />
          </div>
        ))}
      </div>
      {extraCount > 0 && (
        <span
          style={{
            position: "absolute", bottom: "0.4rem", right: "0.4rem",
            background: "color-mix(in oklab, var(--bg) 20%, black)", color: "white",
            fontSize: "0.62rem", letterSpacing: "0.05em", lineHeight: 1,
            padding: "0.2rem 0.45rem", borderRadius: "999px",
          }}
        >
          {`+${extraCount}`}
        </span>
      )}
    </div>
  );
}
