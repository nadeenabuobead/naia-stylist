import { useLoaderData, Link } from "react-router";
import { data, type LoaderFunctionArgs } from "react-router";
import { useState, useEffect } from "react";

export async function loader({ request }: LoaderFunctionArgs) {
  return data({});
}

export default function Wishlist() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/wishlist')
      .then(res => res.json())
      .then(data => {
        setItems(data.items || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "60px 40px" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "60px" }}>
          <div>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(48px,6vw,72px)", fontWeight: 900, lineHeight: 1, marginBottom: "12px" }}>
              Wishlist
            </h1>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#7a6f6a" }}>
              Pieces you've saved and loved.
            </p>
          </div>
          <Link to="/" style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none" }}>
            ← DASHBOARD
          </Link>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "48px", marginBottom: "20px", opacity: 0.2 }}>◇</div>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a" }}>
              Loading your wishlist...
            </p>
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "72px", marginBottom: "20px", opacity: 0.1 }}>★</div>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: "32px", fontWeight: 700, marginBottom: "12px", color: "#221516" }}>
              Your wishlist is empty
            </h2>
            <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "32px" }}>
              Start adding pieces you love during styling sessions.
            </p>
            <Link to="/quick-style" style={{ display: "inline-block", padding: "16px 32px", background: "#8b2035", color: "#f4f4f1", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", textDecoration: "none" }}>
              START STYLING
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "24px" }}>
            {items.map((item: any) => (
              <div key={item.id} style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)", overflow: "hidden" }}>
                {item.imageUrl && (
                  <div style={{ aspectRatio: "1/1", overflow: "hidden", background: "#f9f9f9" }}>
                    <img src={item.imageUrl} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                )}
                <div style={{ padding: "20px" }}>
                  <h3 style={{ fontFamily: "'Playfair Display',serif", fontSize: "20px", fontWeight: 600, marginBottom: "8px", color: "#221516" }}>
                    {item.title}
                  </h3>
                  {item.handle && (
                    <a 
                      href={`https://naiabynadine.com/products/${item.handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "inline-block", marginTop: "12px", fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", textDecoration: "none" }}
                    >
                      VIEW PRODUCT →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
