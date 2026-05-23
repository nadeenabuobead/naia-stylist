import { useLoaderData, Link } from "react-router";

export async function loader() {
  // For now, mock data - we'll connect real auth later
  return {
    customer: { firstName: "Guest" },
    stats: { looksStyled: 12, closetPieces: 8, avgRating: 4.2, styleAlignment: "87%" }
  };
}

export default function AppDashboard() {
  const { customer, stats } = useLoaderData();
  
  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1", padding: "60px 40px" }}>
      <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "48px", fontWeight: 900, marginBottom: "20px" }}>
        Welcome back, {customer.firstName}
      </h1>
      <p style={{ fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "40px" }}>
        Your personal styling journey
      </p>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "20px", marginBottom: "40px" }}>
        <div style={{ background: "white", padding: "30px", borderRadius: "8px" }}>
          <div style={{ fontSize: "48px", fontWeight: 900 }}>{stats.looksStyled}</div>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "2px", color: "#999" }}>Looks Styled</div>
        </div>
        <div style={{ background: "white", padding: "30px", borderRadius: "8px" }}>
          <div style={{ fontSize: "48px", fontWeight: 900 }}>{stats.closetPieces}</div>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "2px", color: "#999" }}>Closet Pieces</div>
        </div>
        <div style={{ background: "white", padding: "30px", borderRadius: "8px" }}>
          <div style={{ fontSize: "48px", fontWeight: 900 }}>{stats.avgRating}</div>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "2px", color: "#999" }}>Avg Rating</div>
        </div>
        <div style={{ background: "white", padding: "30px", borderRadius: "8px" }}>
          <div style={{ fontSize: "48px", fontWeight: 900 }}>{stats.styleAlignment}</div>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "2px", color: "#999" }}>Style Alignment</div>
        </div>
      </div>

      <Link to="/quick-style" style={{ display: "inline-block", padding: "16px 40px", background: "#221516", color: "white", textDecoration: "none", fontSize: "14px", letterSpacing: "3px", textTransform: "uppercase" }}>
        Start New Session →
      </Link>
    </div>
  );
}
