// app/routes/naia-designer-dashboard-2026.jsx
import { useEffect, useState } from "react";

export default function DesignerDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/designer-stats")
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={s.container}>
        <div style={s.loading}>Loading designer insights...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={s.container}>
        <div style={s.error}>Unable to load dashboard data</div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.h1}>nAia Designer Dashboard</h1>
        <p style={s.subtitle}>Collection performance, customer insights, and design direction</p>
      </div>

      {/* 1. Overview */}
      <Section title="Overview">
        <div style={s.statsGrid}>
          <StatCard label="Total Users" value={data.totalUsers || 0} />
          <StatCard label="Total Looks Rated" value={data.totalLooks || 0} />
          <StatCard label="Avg Rating" value={(data.avgRating || 0).toFixed(1)} suffix="/5" />
          <StatCard label="Avg Style Alignment" value={`${Math.round((data.avgAlignment || 0) * 100)}%`} />
          <StatCard label="Would Wear Again" value={`${Math.round((data.avgRewear || 0) * 100)}%`} />
        </div>
      </Section>

      {/* 2. Top-Performing Pieces */}
      <Section title="Top-Performing Pieces" desc="What's working best">
        <div style={s.pieceGrid}>
          {(data.topPieces || []).map((piece, i) => (
            <PieceCard key={i} piece={piece} type="top" />
          ))}
        </div>
      </Section>

      {/* 3. Mixed-Signal Pieces */}
      <Section title="Mixed-Signal Pieces" desc="High potential with friction">
        <div style={s.pieceGrid}>
          {(data.mixedPieces || []).map((piece, i) => (
            <MixedPieceCard key={i} piece={piece} />
          ))}
        </div>
      </Section>

      {/* 4. Underperforming Pieces */}
      <Section title="Underperforming Pieces" desc="Not landing with customers">
        <div style={s.pieceGrid}>
          {(data.underperformingPieces || []).map((piece, i) => (
            <UnderperformingCard key={i} piece={piece} />
          ))}
        </div>
      </Section>

      {/* 5. Pieces to Watch */}
      <Section title="Pieces to Watch" desc="Early signals - not enough data yet">
        <div style={s.pieceGrid}>
          {(data.watchPieces || []).map((piece, i) => (
            <WatchCard key={i} piece={piece} />
          ))}
        </div>
      </Section>

      {/* 6. What Users Liked Most */}
      <Section title="What Users Liked Most" desc="Positive feedback patterns">
        <div style={s.feedbackGrid}>
          {(data.positiveTags || []).map((tag, i) => (
            <FeedbackCard key={i} tag={tag} type="positive" />
          ))}
        </div>
      </Section>

      {/* 7. What Didn't Work */}
      <Section title="What Didn't Work" desc="Negative feedback patterns">
        <div style={s.feedbackGrid}>
          {(data.negativeTags || []).map((tag, i) => (
            <FeedbackCard key={i} tag={tag} type="negative" />
          ))}
        </div>
      </Section>

      {/* 8. Style DNA Breakdown */}
      <Section title="Style DNA Breakdown" desc="Customer identity distribution">
        <div style={s.dnaGrid}>
          {(data.styleDNA || []).map((dna, i) => (
            <DNACard key={i} dna={dna} />
          ))}
        </div>
      </Section>

      {/* 9. Style DNA by Piece */}
      <Section title="Style DNA by Piece" desc="Which identities resonate with each piece">
        <div style={s.pieceGrid}>
          {(data.piecesByDNA || []).map((piece, i) => (
            <PieceDNACard key={i} piece={piece} />
          ))}
        </div>
      </Section>

      {/* 10. Body and Fit Patterns */}
      <Section title="Body and Fit Patterns" desc="How pieces perform for different bodies">
        <div style={s.bodyGrid}>
          {(data.bodyPatterns || []).map((pattern, i) => (
            <BodyPatternCard key={i} pattern={pattern} />
          ))}
        </div>
      </Section>

      {/* 11. What Users Need Help Styling */}
      <Section title="What Users Need Help Styling" desc="Demand signals">
        <div style={s.occasionGrid}>
          {(data.stylingNeeds || []).map((need, i) => (
            <StylingNeedCard key={i} need={need} />
          ))}
        </div>
      </Section>

      {/* 12. Emotional Outcomes by Piece */}
      <Section title="Emotional Outcomes by Piece" desc="How pieces make users feel">
        <div style={s.pieceGrid}>
          {(data.emotionalOutcomes || []).map((piece, i) => (
            <EmotionalCard key={i} piece={piece} />
          ))}
        </div>
      </Section>

      {/* 13. Best-Performing Occasions */}
      <Section title="Best-Performing Occasions" desc="Where the collection shines">
        <div style={s.occasionGrid}>
          {(data.topOccasions || []).map((occ, i) => (
            <OccasionCard key={i} occasion={occ} />
          ))}
        </div>
      </Section>


      {/* Design Actions */}
      <Section title="Design Actions" desc="Recommended next steps">
        {data.designActions && data.designActions.length > 0 ? (
          data.designActions.map((action, i) => (
            <DesignActionCard key={i} action={action} />
          ))
        ) : (
          <p style={{ color: "#999", fontStyle: "italic" }}>No actions yet</p>
        )}
      </Section>

      {/* 14. User Quotes */}
      <Section title="User Quotes" desc="Qualitative insights">
        <div style={s.quotesGrid}>
          {(data.quotes || []).map((quote, i) => (
            <QuoteCard key={i} quote={quote} />
          ))}
        </div>
      </Section>
    </div>
  );
}

// Components
function Section({ title, desc, children }) {
  return (
    <section style={s.section}>
      <h2 style={s.h2}>{title}</h2>
      {desc && <p style={s.sectionDesc}>{desc}</p>}
      {children}
    </section>
  );
}

function StatCard({ label, value, suffix = "" }) {
  return (
    <div style={s.statCard}>
      <div style={s.statValue}>{value}{suffix}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  );
}

function PieceCard({ piece }) {
  return (
    <div style={s.pieceCard}>
      <div style={s.pieceName}>{piece.name}</div>
      <div style={s.pieceCategory}>{piece.category}</div>
      <div style={s.pieceStats}>
        <div>★ {piece.avgRating?.toFixed(1)} <span style={s.muted}>({piece.ratingCount} ratings)</span></div>
        <div>Would wear again: <strong>{Math.round(piece.rewear * 100)}%</strong></div>
        {piece.helpedFeel && <div style={s.helpedFeel}>Helped users feel: {piece.helpedFeel.join(", ")}</div>}
        {piece.bestOccasions && <div style={s.occasions}>Best for: {piece.bestOccasions.join(", ")}</div>}
        {piece.topDNA && <div style={s.dna}>Resonates with: {piece.topDNA.join(", ")}</div>}
      </div>
    </div>
  );
}

function MixedPieceCard({ piece }) {
  return (
    <div style={{...s.pieceCard, borderLeft: "3px solid #f4a261"}}>
      <div style={s.pieceName}>{piece.name}</div>
      <div style={s.mixedReason}>{piece.reason}</div>
      <div style={s.pieceStats}>
        <div>★ {piece.avgRating?.toFixed(1)} | Rewear: {Math.round(piece.rewear * 100)}%</div>
        {piece.friction && <div style={s.friction}>⚠️ {piece.friction}</div>}
      </div>
    </div>
  );
}

function UnderperformingCard({ piece }) {
  return (
    <div style={{...s.pieceCard, borderLeft: "3px solid #c5553a"}}>
      <div style={s.pieceName}>{piece.name}</div>
      <div style={s.weakSignals}>Weak signals: {piece.weakSignals?.join(", ")}</div>
      {piece.rejectionReasons && (
        <div style={s.rejections}>
          <div style={s.label}>Common rejections:</div>
          {piece.rejectionReasons.map((r, i) => <div key={i} style={s.rejection}>• {r}</div>)}
        </div>
      )}
    </div>
  );
}

function WatchCard({ piece }) {
  return (
    <div style={{...s.pieceCard, opacity: 0.7}}>
      <div style={s.pieceName}>{piece.name}</div>
      <div style={s.early}>⏱ Too little data ({piece.ratingCount} ratings)</div>
      <div style={s.pieceStats}>
        <div>Current: ★ {piece.avgRating?.toFixed(1)}</div>
      </div>
    </div>
  );
}

function FeedbackCard({ tag, type }) {
  const color = type === "positive" ? "#2a9d8f" : "#c5553a";
  return (
    <div style={{...s.feedbackCard, borderLeft: `3px solid ${color}`}}>
      <div style={s.tagName}>{tag.name}</div>
      <div style={s.tagCount}>{tag.count} mentions</div>
      {tag.topPieces && (
        <div style={s.linkedPieces}>
          <div style={s.label}>Most linked pieces:</div>
          {tag.topPieces.map((p, i) => <div key={i} style={s.linkedPiece}>• {p}</div>)}
        </div>
      )}
    </div>
  );
}

function DNACard({ dna }) {
  const percent = Math.round(dna.percentage * 100);
  return (
    <div style={s.dnaCard}>
      <div style={s.dnaName}>{dna.name}</div>
      <div style={s.dnaBar}>
        <div style={{...s.dnaFill, width: `${percent}%`}} />
      </div>
      <div style={s.dnaPercent}>{percent}% of users</div>
    </div>
  );
}

function PieceDNACard({ piece }) {
  return (
    <div style={s.pieceCard}>
      <div style={s.pieceName}>{piece.name}</div>
      <div style={s.label}>Resonates most with:</div>
      <div style={s.dnaList}>
        {piece.topDNA?.map((dna, i) => <span key={i} style={s.dnaBadge}>{dna}</span>)}
      </div>
    </div>
  );
}

function BodyPatternCard({ pattern }) {
  return (
    <div style={s.bodyCard}>
      <div style={s.bodyName}>{pattern.preference}</div>
      <div style={s.bodyCount}>{pattern.userCount} users</div>
      {pattern.bestPieces && (
        <div style={s.bodyPieces}>
          <div style={s.label}>Works best:</div>
          {pattern.bestPieces.map((p, i) => <div key={i}>• {p}</div>)}
        </div>
      )}
      {pattern.worstPieces && (
        <div style={s.bodyPieces}>
          <div style={s.label}>Struggles:</div>
          {pattern.worstPieces.map((p, i) => <div key={i} style={{color: "#c5553a"}}>• {p}</div>)}
        </div>
      )}
    </div>
  );
}

function StylingNeedCard({ need }) {
  return (
    <div style={s.needCard}>
      <div style={s.needName}>{need.occasion || need.need}</div>
      <div style={s.needCount}>{need.count} requests</div>
    </div>
  );
}

function EmotionalCard({ piece }) {
  return (
    <div style={s.pieceCard}>
      <div style={s.pieceName}>{piece.name}</div>
      <div style={s.label}>Helped users feel:</div>
      <div style={s.emotionList}>
        {piece.emotions?.map((e, i) => <div key={i} style={s.emotion}>✨ {e}</div>)}
      </div>
      {piece.startingStates && (
        <div style={s.startingStates}>
          <div style={s.label}>Worked when starting:</div>
          {piece.startingStates.map((s, i) => <div key={i} style={s.muted}>• {s}</div>)}
        </div>
      )}
    </div>
  );
}

function OccasionCard({ occasion }) {
  return (
    <div style={s.occasionCard}>
      <div style={s.occasionName}>{occasion.name}</div>
      <div style={s.occasionStats}>
        <div>★ {occasion.avgRating?.toFixed(1)}</div>
        <div>{occasion.lookCount} looks</div>
        <div>{Math.round(occasion.rewear * 100)}% rewear</div>
      </div>
    </div>
  );
}

function QuoteCard({ quote }) {
  return (
    <div style={s.quoteCard}>
      <div style={s.quoteText}>"{quote.text}"</div>
      {quote.piece && <div style={s.quotePiece}>— about {quote.piece}</div>}
    </div>
  );
}


function DesignActionCard({ action }) {
  return (
    <div style={{
      padding: "20px",
      border: `2px solid ${action.priority === "high" ? "#1a1816" : "#8B7355"}`,
      borderRadius: "4px",
      marginBottom: "16px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "8px" }}>
        <h4 style={{ margin: 0, fontFamily: "Cormorant Garamond", fontSize: "18px" }}>{action.piece}</h4>
        <span style={{
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "1px",
          padding: "4px 12px",
          background: action.priority === "high" ? "#1a1816" : "#8B7355",
          color: "#faf9f7",
          borderRadius: "2px",
        }}>
          {action.priority}
        </span>
      </div>
      <div style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "4px" }}>
        {action.action}
      </div>
      <div style={{ fontSize: "14px", color: "#6b6b6b", lineHeight: "1.6" }}>
        {action.reason}
      </div>
    </div>
  );
}

// Styles
const s = {
  container: { maxWidth: "1400px", margin: "0 auto", padding: "40px 20px", fontFamily: '"Cormorant Garamond", Georgia, serif', background: "#faf9f7", minHeight: "100vh" },
  header: { marginBottom: "48px", borderBottom: "1px solid #e0e0e0", paddingBottom: "24px", background: "white", padding: "32px", borderRadius: "4px" },
  h1: { fontSize: "36px", fontWeight: 400, margin: "0 0 8px", color: "#1a1816" },
  subtitle: { fontSize: "16px", color: "#8a7f75", margin: 0 },
  h2: { fontSize: "24px", fontWeight: 500, margin: "0 0 16px", color: "#1a1816" },
  section: { marginBottom: "56px", background: "white", padding: "32px", borderRadius: "4px", border: "1px solid #e8e4df" },
  sectionDesc: { fontSize: "14px", color: "#8a7f75", margin: "0 0 24px", fontStyle: "italic" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px" },
  statCard: { padding: "24px", background: "#faf9f7", borderRadius: "4px", border: "1px solid #e8e4df" },
  statValue: { fontSize: "32px", fontWeight: 500, color: "#1a1816", marginBottom: "8px" },
  statLabel: { fontSize: "13px", color: "#8a7f75", textTransform: "uppercase", letterSpacing: "0.1em" },
  pieceGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "20px" },
  pieceCard: { padding: "20px", background: "#fafafa", border: "1px solid #e8e4df", borderRadius: "4px" },
  pieceName: { fontSize: "18px", fontWeight: 500, marginBottom: "4px", color: "#1a1816" },
  pieceCategory: { fontSize: "12px", color: "#8a7f75", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" },
  pieceStats: { fontSize: "14px", color: "#4a4540", display: "flex", flexDirection: "column", gap: "8px" },
  muted: { color: "#8a7f75", fontSize: "13px" },
  helpedFeel: { fontStyle: "italic", color: "#2a9d8f" },
  occasions: { fontSize: "13px" },
  dna: { fontSize: "13px", color: "#6a4c93" },
  mixedReason: { fontSize: "14px", fontStyle: "italic", color: "#f4a261", marginBottom: "12px" },
  friction: { color: "#f4a261", fontSize: "13px" },
  weakSignals: { fontSize: "14px", color: "#c5553a", marginBottom: "12px" },
  label: { fontSize: "12px", color: "#8a7f75", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px", marginTop: "8px" },
  rejections: { marginTop: "12px" },
  rejection: { fontSize: "13px", color: "#c5553a", marginLeft: "8px" },
  early: { fontSize: "13px", color: "#8a7f75", fontStyle: "italic", marginBottom: "12px" },
  feedbackGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" },
  feedbackCard: { padding: "16px", background: "#fafafa", border: "1px solid #e8e4df", borderRadius: "4px" },
  tagName: { fontSize: "16px", fontWeight: 500, marginBottom: "4px", color: "#1a1816" },
  tagCount: { fontSize: "13px", color: "#8a7f75", marginBottom: "12px" },
  linkedPieces: { marginTop: "8px" },
  linkedPiece: { fontSize: "13px", marginLeft: "8px", color: "#4a4540" },
  dnaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "20px" },
  dnaCard: { padding: "20px", background: "#fafafa", border: "1px solid #e8e4df", borderRadius: "4px" },
  dnaName: { fontSize: "16px", fontWeight: 500, marginBottom: "12px", color: "#1a1816" },
  dnaBar: { height: "8px", background: "#e8e4df", borderRadius: "4px", overflow: "hidden", marginBottom: "8px" },
  dnaFill: { height: "100%", background: "#6a4c93" },
  dnaPercent: { fontSize: "14px", color: "#8a7f75" },
  dnaList: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" },
  dnaBadge: { padding: "4px 12px", background: "#6a4c93", color: "white", borderRadius: "12px", fontSize: "13px" },
  bodyGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "20px" },
  bodyCard: { padding: "20px", background: "#fafafa", border: "1px solid #e8e4df", borderRadius: "4px" },
  bodyName: { fontSize: "16px", fontWeight: 500, marginBottom: "4px", color: "#1a1816" },
  bodyCount: { fontSize: "13px", color: "#8a7f75", marginBottom: "12px" },
  bodyPieces: { marginTop: "12px", fontSize: "13px" },
  occasionGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" },
  needCard: { padding: "16px", background: "#fafafa", border: "1px solid #e8e4df", borderRadius: "4px" },
  needName: { fontSize: "16px", fontWeight: 500, marginBottom: "4px", color: "#1a1816" },
  needCount: { fontSize: "13px", color: "#8a7f75" },
  emotionList: { marginTop: "8px" },
  emotion: { fontSize: "14px", marginBottom: "4px", color: "#2a9d8f" },
  startingStates: { marginTop: "12px", fontSize: "13px" },
  occasionCard: { padding: "16px", background: "#fafafa", border: "1px solid #e8e4df", borderRadius: "4px" },
  occasionName: { fontSize: "16px", fontWeight: 500, marginBottom: "8px", color: "#1a1816" },
  occasionStats: { fontSize: "13px", color: "#4a4540", display: "flex", gap: "12px" },
  quotesGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "20px" },
  quoteCard: { padding: "20px", background: "#fafafa", border: "1px solid #e8e4df", borderRadius: "4px", borderLeft: "3px solid #2a9d8f" },
  quoteText: { fontSize: "15px", fontStyle: "italic", color: "#1a1816", marginBottom: "8px", lineHeight: 1.6 },
  quotePiece: { fontSize: "13px", color: "#8a7f75" },
  loading: { textAlign: "center", padding: "100px 20px", fontSize: "18px", color: "#8a7f75", fontStyle: "italic" },
  error: { textAlign: "center", padding: "100px 20px", fontSize: "18px", color: "#c5553a" },
};
