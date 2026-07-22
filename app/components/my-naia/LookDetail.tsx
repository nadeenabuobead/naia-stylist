import { useState, type Dispatch, type SetStateAction } from "react";
import { Link, useNavigate } from "react-router";

export type LookData = {
  id: string;
  title: string;
  date: string;
  occasion: string;
  mood: string;
  feeling: string;
  sourcing: string;
  canTryOn: false;
  tryOnReason: string;
  saved: boolean;
  feedback: string | null;
  nadinePiece: string | null;
  closetPieces: string[];
  shoes: string;
  bag: string;
  accessories: string;
  hair: string;
  colour: string;
  whyItWorks: string;
  shopHref?: string;
};

/* ---------- Toast ---------- */

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  return {
    msg,
    show: (m: string) => {
      setMsg(m);
      setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3200);
    },
    node: msg ? (
      <div
        style={{
          position: "fixed",
          bottom: "1.5rem",
          left: "50%",
          zIndex: 80,
          transform: "translateX(-50%)",
          borderRadius: "9999px",
          border: "1px solid var(--fg-15)",
          background: "var(--bg)",
          padding: "0.5rem 1rem",
          fontSize: "0.7rem",
          textTransform: "uppercase",
          letterSpacing: "0.28em",
          color: "var(--fg)",
          boxShadow: "0 4px 24px oklch(0.22 0.035 45 / 0.12)",
        }}
      >
        {msg}
      </div>
    ) : null,
  };
}

/* ---------- Sparkles icon (inline, no external deps) ---------- */

function SparklesIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3L13.5 8H18L14.25 11L15.75 16L12 13L8.25 16L9.75 11L6 8H10.5L12 3Z" />
      <path d="M5 3l.75 2H8L6.25 6.5 7 9 5 7.5 3 9l.75-2.5L2 5h2.25L5 3z" />
      <path d="M19 13l.75 2H22L20.25 16.5 21 19l-2-1.5L17 19l.75-2.5L16 15h2.25L19 13z" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "inline", marginLeft: "0.375rem" }}>
      <path d="M7 17L17 7M17 7H7M17 7v10" />
    </svg>
  );
}

/* ---------- Shared detail view ---------- */

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>{label}</div>
      <div style={{ marginTop: "0.375rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>{value}</div>
    </div>
  );
}

export function LookDetailView({ look }: { look: LookData }) {
  const [saved, setSaved] = useState(look.saved);
  const toast = useToast();

  const feedbackLabel = look.feedback === "loved" ? "Loved" : look.feedback === "almost" ? "Almost" : look.feedback === "not-for-me" ? "Not for me" : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-55)" }}>
          {look.date} · {look.occasion} · Session SM-{look.id.slice(0, 6).toUpperCase()}
        </div>
        <h2
          style={{
            fontFamily: "var(--ff-display)",
            fontWeight: 200,
            fontSize: "clamp(2.25rem, 6vw, 3rem)",
            lineHeight: 0.95,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
          }}
        >
          {look.title}
        </h2>
        <p style={{ maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
          <span style={{ color: "var(--fg-55)" }}>Mood ·</span> {look.mood}{" "}
          <span style={{ color: "var(--fg-40)" }}>→</span>{" "}
          <span style={{ color: "var(--fg-55)" }}>Feeling ·</span> {look.feeling}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>
          <span style={{ border: "1px solid var(--fg-20)", padding: "0.25rem 0.5rem" }}>{look.sourcing}</span>
          {saved && <span style={{ border: "1px solid var(--fg-20)", padding: "0.25rem 0.5rem" }}>Saved</span>}
          {feedbackLabel === "Loved" && (
            <span style={{ border: "1px solid var(--lipstick-40)", color: "var(--lipstick)", padding: "0.25rem 0.5rem" }}>Loved</span>
          )}
          {feedbackLabel && feedbackLabel !== "Loved" && (
            <span style={{ border: "1px solid var(--fg-20)", padding: "0.25rem 0.5rem" }}>{feedbackLabel}</span>
          )}
          <span style={{ border: "1px solid var(--fg-15)", padding: "0.25rem 0.5rem", color: "var(--fg-45)" }}>
            Try-On unavailable
          </span>
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gap: "2rem",
          gridTemplateColumns: "minmax(0,1fr)",
        }}
        className="mn-look-detail-grid"
      >
        {/* Left: image + thumbnails */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div
            style={{
              position: "relative",
              aspectRatio: "4/5",
              overflow: "hidden",
              border: "1px solid var(--fg-10)",
              background: "color-mix(in oklab, var(--bg) 92%, white)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", color: "var(--fg-40)" }}>
              <SparklesIcon />
              <span style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em" }}>Complete outfit</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem" }}>
            {["Anchor", "Layer", "Shoes", "Bag"].map((label) => (
              <div key={label}>
                <div style={{ aspectRatio: "1", border: "1px solid var(--fg-10)", background: "color-mix(in oklab, var(--bg) 94%, white)" }} />
                <div style={{ marginTop: "0.375rem", fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.24em", color: "var(--fg-50)" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: detail fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <Detail label="NADINE Anchor Piece" value={look.nadinePiece ?? "—"} />
          <Detail label="Closet Pieces" value={look.closetPieces.length ? look.closetPieces.join(" · ") : "None"} />
          <Detail label="Shoes" value={look.shoes || "—"} />
          <Detail label="Bag" value={look.bag || "—"} />
          <Detail label="Accessories & Jewellery" value={look.accessories || "—"} />
          <Detail label="Hair Direction" value={look.hair || "—"} />
          <Detail label="Colour Direction" value={look.colour || "—"} />
          <div>
            <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>Why This Works</div>
            <p style={{ marginTop: "0.5rem", fontSize: "0.95rem", lineHeight: 1.75, color: "var(--fg-85)" }}>{look.whyItWorks || "—"}</p>
          </div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <Link to={`/my-naia/styleme/looks/${look.id}/refine`} className="mn-btn-primary">
            Refine
          </Link>
          <span className="mn-btn-outline" style={{ opacity: 0.45, cursor: "not-allowed" }} aria-disabled="true" title="Try-On is not available for this look.">
            Try-On Unavailable
          </span>
          <Link to={`/my-naia/styleme/looks/${look.id}/feedback`} className="mn-btn-outline">
            {look.feedback ? "View / Update Feedback" : "Give Feedback"}
          </Link>
          <button
            type="button"
            className="mn-btn-outline"
            onClick={() => {
              setSaved((s) => !s);
              toast.show(saved ? "Removed from Saved." : "Saved.");
            }}
          >
            {saved ? "Remove from Saved" : "Save Look"}
          </button>
          {look.shopHref && look.nadinePiece && (
            <Link to={look.shopHref} className="mn-btn-outline">
              Shop NADINE Anchor <ArrowUpRightIcon />
            </Link>
          )}
        </div>
        <p style={{ marginTop: "1rem", maxWidth: "36rem", fontSize: "0.78rem", lineHeight: 1.5, color: "var(--fg-55)" }}>
          Virtual Try-On is not available for this look. Try-On is available for selected looks that include an eligible NADINE piece.
        </p>
      </div>

      {toast.node}
    </div>
  );
}

/* ---------- Drawer ---------- */

export function Drawer({
  title,
  subtitle,
  lookId,
  children,
}: {
  title: string;
  subtitle?: string;
  lookId: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const close = () => navigate(`/my-naia/styleme/looks/${lookId}`);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        justifyContent: "flex-end",
        background: "oklch(0.22 0.035 45 / 0.40)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        className="mn-drawer-panel"
        style={{
          height: "100%",
          width: "100%",
          maxWidth: "32rem",
          overflowY: "auto",
          background: "var(--bg)",
          color: "var(--fg)",
          padding: "1.5rem 2rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <h3
              style={{
                fontFamily: "var(--ff-display)",
                fontWeight: 200,
                fontSize: "1.5rem",
                lineHeight: 1,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              {title}
            </h3>
            {subtitle && (
              <p style={{ marginTop: "0.25rem", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.28em", textDecoration: "underline", textUnderlineOffset: "3px", flexShrink: 0 }}
          >
            Close
          </button>
        </div>
        <div style={{ marginTop: "1.5rem" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- Refine ---------- */

const REFINE_OPTIONS = [
  "More coverage", "Less coverage",
  "More relaxed", "More structured", "More fitted",
  "More ease around the waist",
  "Different NADINE piece", "Different Closet piece",
  "Different shoes", "Different bag", "Different accessories",
  "Different colour direction", "Something else",
] as const;

export function RefinePanel({ look }: { look: LookData }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState("");

  const toggle = (o: string) =>
    setSelected((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));

  return (
    <Drawer title="Refine This Look" subtitle={`Same session · ${look.title}`} lookId={look.id}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Keeping */}
        <div style={{ border: "1px solid var(--fg-10)", background: "var(--bg-60)", padding: "1rem" }}>
          <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>Keeping</div>
          <dl style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))", gap: "0.75rem", fontSize: "0.82rem", lineHeight: 1.5 }}>
            {[
              { dt: "Occasion", dd: look.occasion },
              { dt: "Mood", dd: look.mood },
              { dt: "Feeling", dd: look.feeling },
              { dt: "Source", dd: look.sourcing },
            ].map((row) => (
              <div key={row.dt}>
                <dt style={{ color: "var(--fg-55)" }}>{row.dt}</dt>
                <dd>{row.dd || "—"}</dd>
              </div>
            ))}
            {look.nadinePiece && (
              <div style={{ gridColumn: "1 / -1" }}>
                <dt style={{ color: "var(--fg-55)" }}>NADINE Anchor</dt>
                <dd>{look.nadinePiece}</dd>
              </div>
            )}
            {look.closetPieces.length > 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <dt style={{ color: "var(--fg-55)" }}>Closet Pieces</dt>
                <dd>{look.closetPieces.join(" · ")}</dd>
              </div>
            )}
          </dl>
        </div>

        <p style={{ fontSize: "0.85rem", lineHeight: 1.625, color: "var(--fg-70)" }}>
          What would you like changed? A small refinement stays in this StyleMe session.
        </p>

        {/* Refine pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {REFINE_OPTIONS.map((o) => {
            const on = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => toggle(o)}
                className={`mn-refine-pill${on ? " mn-active" : ""}`}
              >
                {on && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline", marginRight: "0.375rem" }} aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {o}
              </button>
            );
          })}
        </div>

        <label style={{ display: "block" }}>
          <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>
            Tell nAia what you would like changed
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{
              display: "block",
              marginTop: "0.5rem",
              width: "100%",
              border: "1px solid var(--fg-15)",
              background: "transparent",
              padding: "0.75rem",
              fontSize: "0.9rem",
              color: "var(--fg)",
              outline: "none",
              resize: "none",
              fontFamily: "var(--ff-ui)",
            }}
            placeholder="Optional note…"
          />
        </label>

        {sent && (
          <p style={{ fontSize: "0.8rem", color: "var(--lipstick)" }}>Refinement sent to nAia.</p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
          <button
            type="button"
            className="mn-btn-outline"
            onClick={() => navigate(`/my-naia/styleme/looks/${look.id}`)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="mn-btn-primary"
            onClick={() => {
              setSent(true);
              setTimeout(() => navigate(`/my-naia/styleme/looks/${look.id}`), 700);
            }}
          >
            Refine This Look
          </button>
        </div>
      </div>
    </Drawer>
  );
}

/* ---------- Try-On (always unavailable per VIRTUAL_TRY_ON_ENABLED = false) ---------- */

export function TryOnPanel({ look }: { look: LookData }) {
  const navigate = useNavigate();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "oklch(0.22 0.035 45 / 0.40)",
        backdropFilter: "blur(4px)",
        padding: "1rem",
      }}
    >
      <div style={{ width: "100%", maxWidth: "28rem", background: "var(--bg)", color: "var(--fg)", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <p className="mn-state-note">
          Try-On is not available for {look.title}.{" "}
          {look.tryOnReason || "Virtual Try-On is available for selected looks that include an eligible NADINE piece."}
        </p>
        <button
          type="button"
          className="mn-btn-primary"
          onClick={() => navigate(`/my-naia/styleme/looks/${look.id}`)}
        >
          Back to Look
        </button>
      </div>
    </div>
  );
}

/* ---------- Feedback ---------- */

const WORKED_OPTIONS = [
  "Silhouette", "Color Palette", "Styling Approach", "Accessories",
  "Hair Suggestion", "Makeup Suggestion", "Perfume", "Song",
  "Confidence Boost", "Overall Vibe",
] as const;

const DIDNT_WORK_OPTIONS = [
  "Too Formal", "Too Casual", "Wrong Colors", "Uncomfortable Silhouette",
  "Doesn't Match My Style", "Too Bold", "Too Safe", "Wrong Occasion",
  "Accessories Felt Off", "Hair/Makeup Didn't Resonate", "Not My Vibe",
] as const;

function OptionTile({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mn-option-tile${active ? " mn-active" : ""}`}
    >
      {children}
    </button>
  );
}

function SquareTile({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mn-square-tile${active ? " mn-active" : ""}`}
    >
      {children}
    </button>
  );
}

function YNTile({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mn-yn-tile${active ? " mn-active" : ""}`}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--lipstick)" }}>
      {children}
      {required && <span style={{ marginLeft: "0.25rem" }}>*</span>}
    </div>
  );
}

export function FeedbackPanel({ look }: { look: LookData }) {
  const navigate = useNavigate();
  const [overall, setOverall] = useState(0);
  const [feltLikeYou, setFeltLikeYou] = useState<"Yes" | "No" | null>(null);
  const [createdFeeling, setCreatedFeeling] = useState<"Yes" | "No" | null>(null);
  const [wouldWear, setWouldWear] = useState<"Yes" | "No" | null>(null);
  const [comfort, setComfort] = useState(0);
  const [worked, setWorked] = useState<string[]>([]);
  const [didntWork, setDidntWork] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const toggle = (setter: Dispatch<SetStateAction<string[]>>, v: string) =>
    setter((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));

  const canSubmit = overall > 0 && !!feltLikeYou && !!createdFeeling && !!wouldWear && comfort > 0;

  const submit = () => {
    navigate(`/my-naia/styleme/looks/${look.id}`);
  };

  return (
    <Drawer
      title="How was this look?"
      subtitle={look.feedback ? `Your Feedback · ${look.title}` : look.title}
      lookId={look.id}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
        {/* Overall */}
        <div>
          <FieldLabel required>Overall Reaction</FieldLabel>
          <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <SquareTile key={n} active={overall >= n} onClick={() => setOverall(n)}>★</SquareTile>
            ))}
          </div>
        </div>

        {/* Felt like you? */}
        <div>
          <FieldLabel required>Did it feel like you?</FieldLabel>
          <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {(["Yes", "No"] as const).map((v) => (
              <YNTile key={v} active={feltLikeYou === v} onClick={() => setFeltLikeYou(v)}>{v}</YNTile>
            ))}
          </div>
        </div>

        {/* Created feeling? */}
        <div>
          <FieldLabel required>Created the feeling you wanted?</FieldLabel>
          <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {(["Yes", "No"] as const).map((v) => (
              <YNTile key={v} active={createdFeeling === v} onClick={() => setCreatedFeeling(v)}>{v}</YNTile>
            ))}
          </div>
        </div>

        {/* Would wear? */}
        <div>
          <FieldLabel required>Would you wear this?</FieldLabel>
          <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {(["Yes", "No"] as const).map((v) => (
              <YNTile key={v} active={wouldWear === v} onClick={() => setWouldWear(v)}>{v}</YNTile>
            ))}
          </div>
        </div>

        {/* Physical Comfort */}
        <div>
          <FieldLabel required>Physical Comfort</FieldLabel>
          <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <SquareTile key={n} active={comfort === n} onClick={() => setComfort(n)}>{n}</SquareTile>
            ))}
          </div>
        </div>

        {/* What worked? */}
        <div>
          <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-60)" }}>What worked?</div>
          <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {WORKED_OPTIONS.map((o) => (
              <OptionTile key={o} active={worked.includes(o)} onClick={() => toggle(setWorked, o)}>{o}</OptionTile>
            ))}
          </div>
        </div>

        {/* What didn't work? */}
        <div>
          <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-60)" }}>What didn&apos;t work?</div>
          <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {DIDNT_WORK_OPTIONS.map((o) => (
              <OptionTile key={o} active={didntWork.includes(o)} onClick={() => toggle(setDidntWork, o)}>{o}</OptionTile>
            ))}
          </div>
        </div>

        {/* Optional notes */}
        <div>
          <label style={{ display: "block" }}>
            <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-60)" }}>Optional Notes</span>
            <textarea
              rows={4}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              placeholder="Is there anything else you'd like nAia to know?"
              style={{
                marginTop: "0.75rem",
                display: "block",
                width: "100%",
                border: "1px solid var(--fg-25)",
                background: "transparent",
                padding: "0.75rem 1rem",
                fontSize: "0.9rem",
                lineHeight: 1.5,
                color: "var(--fg)",
                outline: "none",
                resize: "none",
                fontFamily: "var(--ff-ui)",
              }}
            />
          </label>
          <div style={{ marginTop: "0.5rem", textAlign: "right", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.22em", color: "var(--fg-50)" }}>
            {notes.length} / 500
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", paddingTop: "0.5rem" }}>
          <button
            type="button"
            onClick={() => navigate(`/my-naia/styleme/looks/${look.id}`)}
            style={{
              border: "1px solid var(--fg-25)",
              padding: "1rem",
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.28em",
              color: "var(--fg-80)",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              background: canSubmit ? "var(--fg)" : "var(--fg-40)",
              padding: "1rem",
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.28em",
              color: "var(--bg)",
              border: "none",
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.4,
            }}
          >
            Submit Review
          </button>
        </div>
      </div>
    </Drawer>
  );
}
