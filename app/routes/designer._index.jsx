import { useEffect, useState } from "react";
export const meta = () => {
  return [{ title: "Designer Dashboard - nAia" }];
};

export default function DesignerDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/designer-dashboard")
      .then(r => r.json())
      .then(d => setDashboard(d.dashboard))
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

  if (!dashboard) {
    return (
      <div style={s.container}>
        <p style={{ fontSize: "14px", color: "#c5553a" }}>Failed to load dashboard</p>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <h1 style={s.mainTitle}>Designer Dashboard</h1>
      <p style={s.subtitle}>Aggregate insights across all nAia users</p>

      {/* Top metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px", marginBottom: "48px" }}>
        <MetricCard number={dashboard.totalUsers} label="Total Users" />
        <MetricCard number={dashboard.totalReviews} label="Total Ratings" />
        <MetricCard number={`${dashboard.avgOverallFeeling}/5`} label="Avg Rating" />
        <MetricCard number={`${dashboard.feltLikeMePercent}%`} label="Style Alignment" />
        <MetricCard number={`${dashboard.wouldWearAgainPercent}%`} label="Would Wear Again" />
      </div>

      {/* What consistently works */}
      <Section title="What Consistently Works" subtitle="Most selected positive feedback tags">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
          {dashboard.topWorkedTags.map(({ tag, count }) => (
            <TagBar key={tag} tag={tag} count={count} total={dashboard.totalReviews} color="#7da563" />
          ))}
        </div>
      </Section>

      {/* What doesn't work */}
      <Section title="What Doesn't Work" subtitle="Most selected negative feedback tags">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
          {dashboard.topDidntWorkTags.map(({ tag, count }) => (
            <TagBar key={tag} tag={tag} count={count} total={dashboard.totalReviews} color="#c5553a" />
          ))}
        </div>
      </Section>

      {/* Best emotional shifts */}
      <Section title="Best Emotional Shifts" subtitle="Transformations with highest ratings">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          {dashboard.bestMoodShifts.map(({ name, avg, count }) => (
            <div key={name} style={{
              padding: "12px 20px",
              background: "#1a1816",
              color: "#f5f2ee",
              borderRadius: "2px",
              fontSize: "14px",
              fontStyle: "italic"
            }}>
              {name} <span style={{ fontSize: "12px", opacity: 0.7 }}>({avg.toFixed(1)}/5 • {count}x)</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Best occasions */}
      <Section title="Best Occasions" subtitle="Events with highest success rates">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          {dashboard.bestOccasions.map(({ name, avg, count }, idx) => (
            <div key={name} style={{
              padding: "12px 20px",
              background: idx === 0 ? "#1a1816" : "#eee9e2",
              color: idx === 0 ? "#f5f2ee" : "#1a1816",
              borderRadius: "2px",
              fontSize: "14px",
              fontWeight: idx === 0 ? 500 : 400
            }}>
              {name} <span style={{ fontSize: "12px", opacity: 0.7 }}>({avg.toFixed(1)}/5 • {count}x)</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Body preferences */}
      <Section title="Body Preferences" subtitle="Most requested fit adjustments">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
          {dashboard.topBodyPrefs.map(({ pref, count }) => (
            <div key={pref} style={{
              padding: "16px",
              background: "#f5f2ee",
              borderRadius: "2px",
              borderLeft: "2px solid #8a7f75"
            }}>
              <p style={{ fontSize: "14px", margin: "0 0 4px", fontWeight: 500 }}>{pref}</p>
              <p style={{ fontSize: "12px", color: "#8a7f75", margin: 0 }}>{count} requests</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function MetricCard({ number, label }) {
  return (
    <div style={{
      padding: "24px",
      background: "#eee9e2",
      borderRadius: "2px",
      textAlign: "center"
    }}>
      <p style={{ fontSize: "32px", fontStyle: "italic", margin: "0 0 8px", color: "#1a1816" }}>{number}</p>
      <p style={{ fontSize: "11px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#8a7f75", margin: 0 }}>{label}</p>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: "48px" }}>
      <div style={{ marginBottom: "16px" }}>
        <h2 style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#8a7f75", margin: "0 0 4px" }}>{title}</h2>
        <p style={{ fontSize: "13px", color: "#8a7f75", fontStyle: "italic", margin: 0 }}>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function TagBar({ tag, count, total, color }) {
  const percentage = Math.round((count / total) * 100);
  
  return (
    <div style={{ padding: "12px", background: "#f5f2ee", borderRadius: "2px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{ fontSize: "13px", fontWeight: 500 }}>{tag}</span>
        <span style={{ fontSize: "12px", color: "#8a7f75" }}>{count} ({percentage}%)</span>
      </div>
      <div style={{ height: "6px", background: "#e0d9d0", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${percentage}%`, background: color, transition: "width 0.3s" }} />
      </div>
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
    margin: