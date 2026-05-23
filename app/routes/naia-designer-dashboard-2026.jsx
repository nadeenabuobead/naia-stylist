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
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
        <div style={s.innerContainer}>
          <div style={s.loading}>Loading designer insights...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={s.container}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
        <div style={s.innerContainer}>
          <div style={s.error}>Unable to load dashboard data</div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <div style={s.innerContainer}>
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

      {/* ONBOARDING INSIGHTS - NEW */}
      {data.onboarding && data.onboarding.totalProfiles > 0 && (
        <>
          <Section title="Customer Style DNA" desc={`Based on ${data.onboarding.totalProfiles} completed profiles`}>
            <div style={s.grid3}>
              {data.onboarding.styleDNADistribution.slice(0, 9).map(item => (
                <div key={item.style} style={s.card}>
                  <div style={s.cardLabel}>{item.style}</div>
                  <div style={s.cardValue}>{item.count} users ({item.percentage}%)</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Favorite Colors" desc="What colors your customers gravitate toward">
            <div style={s.grid3}>
              {data.onboarding.colorDistribution.slice(0, 9).map(item => (
                <div key={item.color} style={s.card}>
                  <div style={s.cardLabel}>{item.color}</div>
                  <div style={s.cardValue}>{item.count} users ({item.percentage}%)</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Common Styling Struggles" desc="What your customers need help with">
            <div style={s.grid3}>
              {data.onboarding.commonStruggles.slice(0, 6).map(item => (
                <div key={item.struggle} style={s.card}>
                  <div style={s.cardLabel}>{item.struggle}</div>
                  <div style={s.cardValue}>{item.count} users ({item.percentage}%)</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Lifestyle Contexts" desc="How your customers dress in daily life">
            <div style={s.grid3}>
              {data.onboarding.lifestyleDistribution.slice(0, 9).map(item => (
                <div key={item.lifestyle} style={s.card}>
                  <div style={s.cardLabel}>{item.lifestyle}</div>
                  <div style={s.cardValue}>{item.count} users ({item.percentage}%)</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Desired Feelings" desc="How your customers want to feel when dressed">
            <div style={s.grid3}>
              {data.onboarding.desiredFeelings.slice(0, 6).map(item => (
                <div key={item.feeling} style={s.card}>
                  <div style={s.cardLabel}>{item.feeling}</div>
                  <div style={s.cardValue}>{item.count} users ({item.percentage}%)</div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}


      {/* 2. Top-Performing Pieces */}
      <Section title="Top-Performing Pieces" desc="What's working best">
        <p style={{ fontSize: "13px", color: "#999", fontStyle: "italic", marginBottom: "16px" }}>
          Early leaders ranked by rating, wearability, and positive feedback.
        </p>
        <div style={s.pieceGrid}>
          {(data.topPieces || []).map((piece, i) => (
            <PieceCard key={i} piece={piece} type="top" styleDNA={data.styleDNA} />
          ))}
        </div>
      </Section>

      {/* 3. Mixed-Signal Pieces */}
      <Section title="Mixed-Signal Pieces" desc="High potential with friction">
        {data.mixedPieces && data.mixedPieces.length > 0 ? (
          <div style={s.pieceGrid}>
            {data.mixedPieces.map((piece, i) => (
              <MixedPieceCard key={i} piece={piece} />
            ))}
          </div>
        ) : (
          <div style={{ padding: "32px", textAlign: "center", color: "#999", fontStyle: "italic" }}>
            No pieces with mixed signals yet. This section shows pieces with 5+ reviews that have high ratings but low rewear intent (or vice versa).
          </div>
        )}
      </Section>

      {/* 4. Underperforming Pieces */}
      <Section title="Underperforming Pieces" desc="Not landing with customers">
        {data.underperformingPieces && data.underperformingPieces.length > 0 ? (
          <div style={s.pieceGrid}>
            {data.underperformingPieces.map((piece, i) => (
              <UnderperformingCard key={i} piece={piece} />
            ))}
          </div>
        ) : (
          <div style={{ padding: "32px", textAlign: "center", color: "#999", fontStyle: "italic" }}>
            Great news! No underperforming pieces yet. This section shows pieces with 5+ reviews and ratings below 3.0 or rewear intent below 30%.
          </div>
        )}
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
      <Section title="Body and Fit Patterns" desc="What works for different fit and comfort needs">
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
        <div style={{ 
          fontSize: "13px", 
          color: "#8B7355", 
          backgroundColor: "#faf9f7", 
          padding: "12px 16px", 
          borderLeft: "3px solid #8B7355",
          marginBottom: "20px",
          lineHeight: "1.6"
        }}>
          <strong>Note:</strong> Recommendations become more confident after 5+ reviews per piece. Early signals should guide testing and styling content, not final production decisions.
        </div>
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



      {/* Product Pairing Insights */}
      <Section title="Product Pairing Insights" desc="Best closet + nAia combinations">
        {data.productPairings && data.productPairings.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {data.productPairings.map((pairing, i) => (
              <div key={i} style={{ 
                padding: "16px", 
                background: "#fff", 
                border: "1px solid #e5e5e5",
                borderRadius: "4px"
              }}>
                <div style={{ fontSize: "16px", fontWeight: 500, marginBottom: "8px" }}>
                  {pairing.closetItem} + {pairing.naiaPiece}
                </div>
                <div style={{ fontSize: "14px", color: "#666" }}>
                  {pairing.avgRating.toFixed(1)}/5 rating • {pairing.reviewCount} review{pairing.reviewCount !== 1 ? 's' : ''} • {Math.round(pairing.rewearRate * 100)}% would wear again
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "32px", textAlign: "center", color: "#999", fontStyle: "italic" }}>
            No pairings yet. Try styling sessions that combine your closet items with nAia pieces!
          </div>
        )}
      </Section>

      {/* Objection Tracker */}
      <Section title="Objection Tracker" desc="Why users hesitate">
        {data.topObjections && data.topObjections.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {data.topObjections.map((obj, i) => (
              <div key={i} style={{ padding: "16px", background: "#fff", border: "1px solid #e5e5e5", borderRadius: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ fontSize: "16px", fontWeight: 500 }}>{obj.name}</div>
                  <div style={{ fontSize: "14px", color: "#fff", background: "#d97706", padding: "4px 12px", borderRadius: "12px" }}>
                    {obj.count} {obj.count === 1 ? 'mention' : 'mentions'}
                  </div>
                </div>
                {obj.topPieces && obj.topPieces.length > 0 && (
                  <div style={{ fontSize: "13px", color: "#666", marginTop: "8px" }}>
                    Most mentioned with: {obj.topPieces.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "32px", textAlign: "center", color: "#999", fontStyle: "italic" }}>
            No objections tracked yet. Users will share what stops them from wearing or buying pieces.
          </div>
        )}
      </Section>

      {/* Styling-to-Shopping Conversion */}
      <Section title="Styling-to-Shopping Conversion" desc="Does AI styling lead to purchases?">
        {data.conversionStats && data.conversionStats.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {data.conversionStats.map((product, i) => (
              <div key={i} style={{ padding: "16px", background: "#fff", border: "1px solid #e5e5e5", borderRadius: "4px" }}>
                <div style={{ fontSize: "16px", fontWeight: 500, marginBottom: "12px" }}>{product.productTitle}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px", fontSize: "13px" }}>
                  <div>
                    <div style={{ color: "#999" }}>Recommended</div>
                    <div style={{ fontSize: "18px", fontWeight: 500 }}>{product.recommended}</div>
                  </div>
                  <div>
                    <div style={{ color: "#999" }}>Clicked</div>
                    <div style={{ fontSize: "18px", fontWeight: 500 }}>{product.clicked}</div>
                    <div style={{ fontSize: "11px", color: "#666" }}>{product.clickRate}% click rate</div>
                  </div>
                  <div>
                    <div style={{ color: "#999" }}>Try-on used</div>
                    <div style={{ fontSize: "18px", fontWeight: 500 }}>{product.tryon}</div>
                    {product.clicked > 0 && <div style={{ fontSize: "11px", color: "#666" }}>{product.tryonRate}% of clicks</div>}
                  </div>
                  <div>
                    <div style={{ color: "#999" }}>Wishlisted</div>
                    <div style={{ fontSize: "18px", fontWeight: 500 }}>{product.wishlisted}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "32px", textAlign: "center", color: "#999", fontStyle: "italic" }}>
            Start tracking! When users click products, use try-on, or save items from styling results, conversion data will appear here.
          </div>
        )}
      </Section>
      </div>
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

function PieceCard({ piece, styleDNA }) {
  return (
    <div style={s.pieceCard}>
      <div style={s.pieceName}>{piece.name}</div>
      <div style={s.pieceCategory}>{piece.category}</div>
      
      <div style={s.pieceStats}>
        <div>★ {piece.avgRating?.toFixed(1)} ({piece.ratingCount} ratings)</div>
        <div>Would wear in real life: <strong>{Math.round(piece.rewear * 100)}%</strong></div>
        
        {piece.helpedFeel && piece.helpedFeel.length > 0 && (
          <div style={{ marginTop: "8px" }}>
            <span style={s.muted}>Helped users feel: </span>
            <span style={s.helpedFeel}>{piece.helpedFeel.join(", ").toLowerCase()}</span>
          </div>
        )}
        
        {piece.bestOccasions && piece.bestOccasions.length > 0 && (
          <div style={{ marginTop: "8px" }}>
            <span style={s.muted}>Best for: </span>
            <span style={s.occasions}>{piece.bestOccasions.slice(0, 2).join(", ")}</span>
            {piece.bestOccasions.length > 2 && (
              <>
                <br />
                <span style={s.muted}>Secondary: </span>
                <span style={{ fontSize: "13px", color: "#666" }}>{piece.bestOccasions.slice(2).join(", ")}</span>
              </>
            )}
          </div>
        )}
        
        {piece.positiveComments && piece.positiveComments.length > 0 && (
          <div style={{ marginTop: "8px" }}>
            <span style={s.muted}>Top feedback: </span>
            <span style={{ fontSize: "13px", color: "#2a9d8f" }}>{piece.positiveComments.join(", ").toLowerCase()}</span>
          </div>
        )}
        
        <div style={{ marginTop: "8px" }}>
          <span style={s.muted}>Watch-outs: </span>
          <span style={{ fontSize: "13px", color: "#d97706" }}>
            {piece.negativeComments && piece.negativeComments.length > 0 
              ? piece.negativeComments.join(", ")
              : "No repeated watch-outs yet"}
          </span>
        </div>
        
        <div style={{ marginTop: "8px" }}>
          <span style={s.muted}>Resonates with: </span>
          <span style={s.dna}>{piece.topDNA && piece.topDNA.length > 0 ? piece.topDNA.join(", ") : (styleDNA && styleDNA.length > 0 ? styleDNA.slice(0,3).map(d => d.name).join(", ") + " (overall)" : "More style DNA data needed")}</span>
        </div>
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
  const percent = dna.percentage;
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
      <div style={s.bodyCount}>
        {pattern.userCount} {pattern.userCount === 1 ? "user" : "users"} selected this preference
      </div>

      
      <div style={{ marginTop: "12px" }}>
        <div style={s.label}>Best-performing nAia pieces:</div>
        {pattern.bestPieces && pattern.bestPieces.length > 0 ? (
          pattern.bestPieces.map((p, i) => (
            <div key={i} style={{ fontSize: "14px", color: "#333", marginTop: "4px" }}>
              • {typeof p === 'string' ? p : p.name}
            </div>
          ))
        ) : (
          <div style={{ fontSize: "14px", color: "#999", marginTop: "4px", fontStyle: "italic" }}>
            No nAia piece signal yet
          </div>
        )}
      </div>
      

      
      <div style={{ marginTop: "12px" }}>
        <div style={s.label}>Fit concerns:</div>
        {pattern.struggles && pattern.struggles.length > 0 ? (
          pattern.struggles.map((s, i) => (
            <div key={i} style={{ fontSize: "14px", color: "#c5553a", marginTop: "4px" }}>• {s}</div>
          ))
        ) : (
          <div style={{ fontSize: "14px", color: "#999", marginTop: "4px" }}>No repeated fit concerns yet</div>
        )}
      </div>
      
      <div style={{ marginTop: "12px" }}>
        <div style={s.label}>Design implication:</div>
        <div style={{ fontSize: "14px", color: "#666", fontStyle: "italic", marginTop: "4px" }}>
          {pattern.implication}
        </div>
      </div>
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
      {occasion.topPieces && occasion.topPieces.length > 0 && (
        <div style={{ fontSize: "11px", color: "#666", marginTop: "8px" }}>
          Best pieces: {occasion.topPieces.join(", ")}
        </div>
      )}
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
  const getPriorityColor = (priority) => {
    if (priority === "High Confidence") return "#1a1816";
    if (priority === "Medium Confidence") return "#8B7355";
    if (priority === "Early Signal") return "#9CA3AF";
    return "#D4C4B0";
  };
  
  const color = getPriorityColor(action.priority || action.confidenceBadge);
  
  return (
    <div style={{
      padding: "22px",
      border: `2px solid ${color}`,
      borderRadius: "4px",
      marginBottom: "18px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "14px" }}>
        <h4 style={{ margin: 0, fontFamily: "Cormorant Garamond", fontSize: "21px", fontWeight: 600 }}>
          {action.piece}
        </h4>
        <span style={{
          fontSize: "10px",
          textTransform: "uppercase",
          letterSpacing: "1.3px",
          padding: "6px 14px",
          background: color,
          color: "#faf9f7",
          borderRadius: "3px",
          whiteSpace: "nowrap",
          fontWeight: 600,
        }}>
          {action.confidenceBadge || action.priority}
        </span>
      </div>
      
      <div style={{ fontSize: "14px", color: "#8B7355", marginBottom: "14px", fontWeight: 600 }}>
        {action.actionType}: {action.action}
      </div>
      
      <div style={{ marginBottom: "10px" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "#666", marginRight: "8px" }}>Performance:</span>
        <span style={{ fontSize: "13px", color: "#333" }}>{action.performance}</span>
      </div>
      
      <div style={{ marginBottom: "10px" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "#2a9d8f", marginRight: "8px" }}>Liked:</span>
        <span style={{ fontSize: "13px", color: "#333" }}>{action.liked}</span>
      </div>
      
      <div style={{ marginBottom: "10px" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "#d97706", marginRight: "8px" }}>Watch:</span>
        <span style={{ fontSize: "13px", color: "#92400e" }}>{action.watch}</span>
      </div>
      
      <div style={{ marginBottom: "14px" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "#1a1816", marginRight: "8px" }}>Next step:</span>
        <span style={{ fontSize: "13px", color: "#333" }}>{action.nextStep}</span>
      </div>
      
      <div style={{ 
        fontSize: "12px", 
        color: "#999", 
        paddingTop: "10px",
        borderTop: "1px solid #f0f0f0"
      }}>
        {action.data}
      </div>
    </div>
  );
}



// Styles
const s = {
  container: { 
    background: "#f4f4f1", 
    minHeight: "100vh",
    padding: "60px 0"
  },
  innerContainer: {
    maxWidth: "1400px", 
    margin: "0 auto", 
    padding: "0 40px"
  },
  header: { 
    marginBottom: "60px", 
    paddingBottom: "32px",
    borderBottom: "1px solid rgba(59,5,16,0.1)"
  },
  h1: { 
    fontFamily: "'Playfair Display', serif", 
    fontSize: "clamp(48px, 6vw, 72px)", 
    fontWeight: 900, 
    lineHeight: 1,
    margin: "0 0 12px", 
    color: "#221516" 
  },
  subtitle: { 
    fontFamily: "'Cormorant Garamond', serif", 
    fontSize: "20px", 
    fontStyle: "italic",
    color: "#7a6f6a", 
    margin: 0 
  },
  h2: { 
    fontFamily: "'Playfair Display', serif", 
    fontSize: "28px", 
    fontWeight: 700, 
    margin: "0 0 8px", 
    color: "#221516" 
  },
  section: { 
    marginBottom: "48px", 
    background: "rgba(255,255,255,0.6)", 
    padding: "40px", 
    border: "1px solid rgba(59,5,16,0.06)",
    backdropFilter: "blur(10px)"
  },
  sectionDesc: { 
    fontFamily: "'Cormorant Garamond', serif", 
    fontSize: "16px", 
    color: "#7a6f6a", 
    margin: "0 0 32px", 
    fontStyle: "italic" 
  },
  statsGrid: { 
    display: "grid", 
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", 
    gap: "20px" 
  },
  statCard: { 
    padding: "24px", 
    background: "rgba(255,255,255,0.8)", 
    border: "1px solid rgba(59,5,16,0.08)" 
  },
  statValue: { 
    fontFamily: "'Playfair Display', serif", 
    fontSize: "36px", 
    fontWeight: 700, 
    color: "#8b2035", 
    marginBottom: "8px" 
  },
  statLabel: { 
    fontFamily: "'Space Mono', monospace", 
    fontSize: "9px", 
    color: "#7a6f6a", 
    textTransform: "uppercase", 
    letterSpacing: "2px" 
  },
  grid3: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "20px"
  },
  card: {
    padding: "20px",
    background: "rgba(255,255,255,0.8)",
    border: "1px solid rgba(59,5,16,0.06)"
  },
  cardLabel: {
    fontFamily: "'Cormorant Garamond', serif",
    fontSize: "18px",
    fontWeight: 600,
    color: "#221516",
    marginBottom: "8px"
  },
  cardValue: {
    fontFamily: "'Space Mono', monospace",
    fontSize: "11px",
    letterSpacing: "1px",
    color: "#7a6f6a"
  },
  pieceGrid: { 
    display: "grid", 
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", 
    gap: "20px" 
  },
  pieceCard: { 
    padding: "24px", 
    background: "rgba(255,255,255,0.8)", 
    border: "1px solid rgba(59,5,16,0.06)" 
  },
  pieceName: { 
    fontFamily: "'Playfair Display', serif", 
    fontSize: "20px", 
    fontWeight: 600, 
    marginBottom: "8px", 
    color: "#221516" 
  },
  pieceCategory: { 
    fontFamily: "'Space Mono', monospace", 
    fontSize: "9px", 
    color: "#7a6f6a", 
    textTransform: "uppercase", 
    letterSpacing: "2px", 
    marginBottom: "16px" 
  },
  pieceStats: { 
    fontFamily: "'Cormorant Garamond', serif", 
    fontSize: "15px", 
    color: "#221516", 
    lineHeight: 1.6 
  },
  muted: { 
    color: "#7a6f6a", 
    fontSize: "14px",
    fontFamily: "'Cormorant Garamond', serif",
    fontStyle: "italic"
  },
  helpedFeel: { 
    fontStyle: "italic", 
    color: "#8b2035",
    fontFamily: "'Cormorant Garamond', serif"
  },
  occasions: { fontSize: "14px", fontFamily: "'Cormorant Garamond', serif" },
  dna: { fontSize: "14px", color: "#8b2035", fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic" },
  mixedReason: { 
    fontSize: "15px", 
    fontStyle: "italic", 
    color: "#8b2035", 
    marginBottom: "12px",
    fontFamily: "'Cormorant Garamond', serif"
  },
  friction: { color: "#8b2035", fontSize: "14px", fontFamily: "'Cormorant Garamond', serif" },
  weakSignals: { 
    fontSize: "15px", 
    color: "#8b2035", 
    marginBottom: "12px",
    fontFamily: "'Cormorant Garamond', serif"
  },
  label: { 
    fontFamily: "'Space Mono', monospace", 
    fontSize: "9px", 
    color: "#7a6f6a", 
    textTransform: "uppercase", 
    letterSpacing: "2px", 
    marginBottom: "8px", 
    marginTop: "12px" 
  },
  rejections: { marginTop: "12px" },
  rejection: { fontSize: "14px", color: "#8b2035", marginLeft: "8px", fontFamily: "'Cormorant Garamond', serif" },
  early: { fontSize: "14px", color: "#7a6f6a", fontStyle: "italic", marginBottom: "12px", fontFamily: "'Cormorant Garamond', serif" },
  feedbackGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "20px" },
  feedbackCard: { padding: "20px", background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)" },
  tagName: { fontFamily: "'Playfair Display', serif", fontSize: "18px", fontWeight: 600, marginBottom: "8px", color: "#221516" },
  tagCount: { fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#7a6f6a", marginBottom: "12px" },
  linkedPieces: { marginTop: "12px" },
  linkedPiece: { fontSize: "14px", marginLeft: "8px", color: "#221516", fontFamily: "'Cormorant Garamond', serif" },
  dnaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "20px" },
  dnaCard: { padding: "24px", background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)" },
  dnaName: { fontFamily: "'Playfair Display', serif", fontSize: "18px", fontWeight: 600, marginBottom: "16px", color: "#221516" },
  dnaBar: { height: "8px", background: "rgba(59,5,16,0.1)", borderRadius: "4px", overflow: "hidden", marginBottom: "8px" },
  dnaFill: { height: "100%", background: "#8b2035" },
  dnaPercent: { fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#7a6f6a" },
  dnaList: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" },
  dnaBadge: { padding: "6px 12px", background: "#8b2035", color: "#f4f4f1", borderRadius: "20px", fontSize: "12px", fontFamily: "'Space Mono', monospace" },
  bodyGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "20px" },
  bodyCard: { padding: "24px", background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)" },
  bodyName: { fontFamily: "'Playfair Display', serif", fontSize: "18px", fontWeight: 600, marginBottom: "8px", color: "#221516" },
  bodyCount: { fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#7a6f6a", marginBottom: "12px" },
  bodyPieces: { marginTop: "12px", fontSize: "14px", fontFamily: "'Cormorant Garamond', serif" },
  occasionGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "20px" },
  needCard: { padding: "20px", background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)" },
  needName: { fontFamily: "'Cormorant Garamond', serif", fontSize: "16px", fontWeight: 600, marginBottom: "8px", color: "#221516" },
  needCount: { fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#7a6f6a" },
  emotionList: { marginTop: "12px" },
  emotion: { fontSize: "15px", marginBottom: "6px", color: "#8b2035", fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic" },
  startingStates: { marginTop: "12px", fontSize: "14px" },
  occasionCard: { padding: "20px", background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)" },
  occasionName: { fontFamily: "'Playfair Display', serif", fontSize: "18px", fontWeight: 600, marginBottom: "12px", color: "#221516" },
  occasionStats: { fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#7a6f6a", display: "flex", gap: "16px" },
  quotesGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "20px" },
  quoteCard: { padding: "24px", background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)", borderLeft: "3px solid #8b2035" },
  quoteText: { fontFamily: "'Cormorant Garamond', serif", fontSize: "16px", fontStyle: "italic", color: "#221516", marginBottom: "12px", lineHeight: 1.7 },
  quotePiece: { fontFamily: "'Space Mono', monospace", fontSize: "10px", color: "#7a6f6a", letterSpacing: "1px" },
  loading: { textAlign: "center", padding: "100px 20px", fontSize: "20px", color: "#7a6f6a", fontStyle: "italic", fontFamily: "'Cormorant Garamond', serif" },
  error: { textAlign: "center", padding: "100px 20px", fontSize: "20px", color: "#8b2035", fontFamily: "'Cormorant Garamond', serif" },
};
