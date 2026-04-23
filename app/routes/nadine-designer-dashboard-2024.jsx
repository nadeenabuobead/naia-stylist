import { useEffect, useState } from "react";

export default function DesignerDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/designer-stats")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={s.container}>
        <p style={{ fontSize: "14px", color: "#8a7f75", fontStyle: "italic" }}>Loading designer insights...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={s.container}>
        <p style={{ fontSize: "14px", color: "#c5553a" }}>Failed to load dashboard</p>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <h1 style={s.mainTitle}>Designer Dashboard</h1>
      <p style={s.subtitle}>Which pieces are landing, for whom, and why</p>

      {/* Top Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px", marginBottom: "48px" }}>
        <MetricCard number={data.totalUsers} label="Total Users" />
        <MetricCard number={data.totalReviews} label="Looks Rated" />
        <MetricCard number={`${data.avgFeeling}/5`} label="Avg Rating" />
        <MetricCard number={`${data.feltLikeMePercent}%`} label="Style Alignment" />
        <MetricCard number={`${data.wouldWearPercent}%`} label="Would Wear Again" />
      </div>

      {/* Top Performing Pieces */}
      <Section title="Top-Performing Pieces" subtitle="Garments from your collection with highest ratings">
        {data.topPieces?.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {data.topPieces.map(piece => (
              <PieceCard key={piece.name} piece={piece} variant="success" />
            ))}
          </div>
        ) : (
          <p style={{ fontSize: "14px", color: "#8a7f75", fontStyle: "italic" }}>Not enough data yet</p>
        )}
      </Section>

      {/* Struggling Pieces */}
      {data.strugglingPieces?.length > 0 && (
        <Section title="Pieces That Need Attention" subtitle="Garments with lower ratings or frequent rejection">
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {data.strugglingPieces.map(piece => (
              <PieceCard key={piece.name} piece={piece} variant="warning" />
            ))}
          </div>
        </Section>
      )}

      {/* What Users Liked Most */}
      <Section title="What Users Liked Most" subtitle="Most selected positive feedback across all looks">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          {data.topWorkedOverall?.map(item => (
            <div key={item.tag} style={{ background: "#fff", padding: "16px", borderRadius: "4px", border: "1px solid #d4cfc9" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: "14px", fontWeight: 500, color: "#1a1816" }}>{item.tag}</span>
                <span style={{ fontSize: "12px", color: "#8a7f75" }}>{item.count} look{item.count !== 1 ? 's' : ''}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* What Didn't Work */}
      <Section title="What Didn't Work" subtitle="Most common rejection points">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          {data.topDidntWorkOverall?.map(item => (
            <div key={item.tag} style={{ background: "#fef2f2", padding: "16px", borderRadius: "4px", border: "1px solid #fee2e2" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: "14px", fontWeight: 500, color: "#991b1b" }}>{item.tag}</span>
                <span style={{ fontSize: "12px", color: "#dc2626" }}>{item.count} look{item.count !== 1 ? 's' : ''}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Body Preference Patterns */}
      {data.topBodyPrefsOverall?.length > 0 && (
        <Section title="Body Preference Patterns" subtitle="What customers are asking for physically">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
            {data.topBodyPrefsOverall.map(pref => (
              <div key={pref.pref} style={{ background: "#fff", padding: "16px", borderRadius: "4px", border: "1px solid #d4cfc9" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: "14px", fontWeight: 500, color: "#1a1816" }}>{pref.pref}</span>
                  <span style={{ fontSize: "12px", color: "#8a7f75" }}>{pref.count} request{pref.count !== 1 ? 's' : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* What Users Need Help Styling */}
      <Section title="What Users Need Help Styling" subtitle="Most requested occasions">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          {data.topOccasionsOverall?.map((occ, idx) => (
            <div 
              key={occ.occasion} 
              style={{ 
                padding: "16px", 
                borderRadius: "4px", 
                background: idx === 0 ? "#1a1816" : "#fff",
                color: idx === 0 ? "#f5f2ee" : "#1a1816",
                border: idx === 0 ? "none" : "1px solid #d4cfc9"
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "4px", textTransform: "capitalize" }}>
                {occ.occasion}
              </div>
              <div style={{ fontSize: "12px", opacity: 0.7 }}>
                {occ.count} look{occ.count !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function PieceCard({ piece, variant }) {
  const bgColor = variant === 'success' ? '#f0fdf4' : '#fff7ed';
  const borderColor = variant === 'success' ? '#86efac' : '#fed7aa';
  
  return (
    <div style={{ background: bgColor, border: `2px solid ${borderColor}`, borderRadius: "8px", padding: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "16px" }}>
        <div>
          <h3 style={{ fontSize: "18px", fontWeight: 500, color: "#1a1816", margin: "0 0 4px" }}>{piece.name}</h3>
          <p style={{ fontSize: "14px", color: "#8a7f75", textTransform: "capitalize", margin: 0 }}>{piece.category}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "28px", fontWeight: 300, color: "#1a1816" }}>{piece.avgRating}/5</div>
          <div style={{ fontSize: "12px", color: "#8a7f75" }}>{piece.timesRated} rating{piece.timesRated !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        <div>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#8a7f75", marginBottom: "4px" }}>Recommended</div>
          <div style={{ fontSize: "14px", fontWeight: 500, color: "#1a1816" }}>{piece.timesRecommended} time{piece.timesRecommended !== 1 ? 's' : ''}</div>
        </div>
        <div>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#8a7f75", marginBottom: "4px" }}>Would Wear Again</div>
          <div style={{ fontSize: "14px", fontWeight: 500, color: "#1a1816" }}>{piece.wouldWearPercent}%</div>
        </div>
      </div>

      {/* What Worked */}
      {piece.topWorked?.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#8a7f75", marginBottom: "8px" }}>What Worked</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {piece.topWorked.map(tag => (
              <span key={tag} style={{ fontSize: "12px", background: "#fff", border: "1px solid #d4cfc9", color: "#1a1816", padding: "4px 8px", borderRadius: "4px" }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Watchouts */}
      {piece.topDidntWork?.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#8a7f75", marginBottom: "8px" }}>Watchouts</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {piece.topDidntWork.map(tag => (
              <span key={tag} style={{ fontSize: "12px", background: "#fee2e2", color: "#991b1b", padding: "4px 8px", borderRadius: "4px" }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Context */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", paddingTop: "12px", borderTop: "1px solid #d4cfc9" }}>
        {piece.topFeelings?.length > 0 && (
          <div>
            <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#8a7f75", marginBottom: "4px" }}>Helped Users Feel</div>
            <div style={{ fontSize: "12px", color: "#1a1816" }}>{piece.topFeelings.join(', ')}</div>
          </div>
        )}
        {piece.topOccasions?.length > 0 && (
          <div>
            <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#8a7f75", marginBottom: "4px" }}>Best For</div>
            <div style={{ fontSize: "12px", color: "#1a1816", textTransform: "capitalize" }}>{piece.topOccasions.join(', ')}</div>
          </div>
        )}
        {piece.topBodyPrefs?.length > 0 && (
          <div>
            <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#8a7f75", marginBottom: "4px" }}>Body Match</div>
            <div style={{ fontSize: "12px", color: "#1a1816" }}>{piece.topBodyPrefs.join(', ')}</div>
          </div>
        )}
      </div>

      {/* Quote */}
      {piece.quote && (
        <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #d4cfc9" }}>
          <p style={{ fontSize: "14px", color: "#1a1816", fontStyle: "italic", margin: 0 }}>"{piece.quote}"</p>
        </div>
      )}
    </div>
  );
}

function MetricCard({ number, label }) {
  return (
    <div style={{ background: "#eee9e2", padding: "24px", borderRadius: "4px", textAlign: "center" }}>
      <p style={{ fontSize: "32px", fontStyle: "italic", margin: "0 0 8px", color: "#1a1816" }}>{number}</p>
      <p style={{ fontSize: "11px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#8a7f75", margin: 0 }}>{label}</p>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: "48px" }}>
      <div style={{ marginBottom: "16px" }}>
        <h2 style={{ fontSize: "14px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#1a1816", margin: "0 0 4px", fontWeight: 500 }}>{title}</h2>
        <p style={{ fontSize: "13px", color: "#8a7f75", fontStyle: "italic", margin: 0 }}>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

const s = {
  container: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "48px 24px",
    fontFamily: '"Cormorant Garamond", Georgia, serif',
  },
  mainTitle: {
    fontSize: "36px",
    fontWeight: 400,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "#1a1816",
    margin: "0 0 8px",
  },
  subtitle: {
    fontSize: "15px",
    fontStyle: "italic",
    color: "#8a7f75",
    margin: "0 0 48px",
  },
};