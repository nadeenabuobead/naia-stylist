import { Link } from "react-router";

export default function Dashboard() {
  return (
    <div style={{ padding: "60px 40px", fontFamily: "sans-serif", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "48px", marginBottom: "20px" }}>Customer Dashboard</h1>
      <p style={{ fontSize: "18px", color: "#666", marginBottom: "40px" }}>Your styling journey</p>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "20px" }}>
        <div style={{ background: "#f5f5f5", padding: "30px", borderRadius: "8px" }}>
          <div style={{ fontSize: "36px", fontWeight: "bold" }}>12</div>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "#999" }}>Looks Styled</div>
        </div>
        <div style={{ background: "#f5f5f5", padding: "30px", borderRadius: "8px" }}>
          <div style={{ fontSize: "36px", fontWeight: "bold" }}>8</div>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "#999" }}>Closet Items</div>
        </div>
        <div style={{ background: "#f5f5f5", padding: "30px", borderRadius: "8px" }}>
          <div style={{ fontSize: "36px", fontWeight: "bold" }}>4.2</div>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "#999" }}>Avg Rating</div>
        </div>
        <div style={{ background: "#f5f5f5", padding: "30px", borderRadius: "8px" }}>
          <div style={{ fontSize: "36px", fontWeight: "bold" }}>87%</div>
          <div style={{ fontSize: "12px", textTransform: "uppercase", color: "#999" }}>Style Match</div>
        </div>
      </div>

      <div style={{ marginTop: "60px" }}>
        <Link to="/quick-style" style={{ display: "inline-block", padding: "16px 40px", background: "#000", color: "#fff", textDecoration: "none" }}>
          New Styling Session →
        </Link>
      </div>
    </div>
  );
}
