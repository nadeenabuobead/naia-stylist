import { Form, Link, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";

const bodyNeeds = [
  { id: "waist-definition", label: "Waist definition", emoji: "⏳" },
  { id: "more-coverage", label: "More coverage", emoji: "🧥" },
  { id: "relaxed", label: "Something relaxed", emoji: "☁️" },
  { id: "structured", label: "Something structured", emoji: "📐" },
  { id: "elongates", label: "Something that elongates me", emoji: "👠" },
  { id: "balances", label: "Something that balances my shape", emoji: "⚖️" },
  { id: "comfortable-elevated", label: "Something comfortable but still elevated", emoji: "✨" },
  { id: "bloated", label: "I feel bloated", emoji: "🌊" },
  { id: "nothing-specific", label: "Nothing specific", emoji: "💫" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const mood = session.get("styleMeMood");
  const feeling = session.get("styleMeFeeling");
  const occasion = session.get("styleMeOccasion");
  
  if (!mood || !feeling || !occasion) {
    return redirect("/style-me/mood");
  }
  
  return data({ mood, feeling, occasion });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const comfort = formData.get("comfort") as string;
  
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeComfort", comfort || "nothing-specific");
  
  return redirect("/style-me/source", {
    headers: { "Set-Cookie": await commitSession(session) }
  });
}

export default function StyleMeComfort() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1", padding: "40px 20px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <Link to="/style-me/occasion" style={{ display: "inline-block", marginBottom: "32px", color: "#7a6f6a", textDecoration: "none", fontSize: "11px", fontFamily: "'Space Mono',monospace", letterSpacing: "2px", textTransform: "uppercase" }}>← Back</Link>
        
        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "42px", fontWeight: 900, marginBottom: "12px", color: "#221516", letterSpacing: "-1px" }}>What does your body need from this outfit today?</h1>
        <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "40px" }}>Optional — skip if nothing specific</p>
        
        <Form method="post">
          <div style={{ display: "grid", gap: "12px", marginBottom: "40px" }}>
            {bodyNeeds.map((need) => (
              <button
                key={need.id}
                type="button"
                onClick={() => setSelected(need.id)}
                style={{
                  padding: "20px 24px",
                  background: selected === need.id ? "#8b2035" : "rgba(255,255,255,0.8)",
                  color: selected === need.id ? "#f4f4f1" : "#221516",
                  border: selected === need.id ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.1)",
                  borderRadius: "4px",
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  fontFamily: "'Cormorant Garamond',serif",
                  fontSize: "18px",
                  transition: "all 0.3s",
                }}
              >
                <span style={{ fontSize: "24px" }}>{need.emoji}</span>
                <span>{need.label}</span>
              </button>
            ))}
          </div>

          <input type="hidden" name="comfort" value={selected || ""} />
          
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "18px",
              background: "#221516",
              color: "#f4f4f1",
              border: "none",
              fontFamily: "'Space Mono',monospace",
              fontSize: "10px",
              letterSpacing: "4px",
              textTransform: "uppercase",
              cursor: "pointer",
              borderRadius: "4px",
            }}
          >
            Continue
          </button>
        </Form>
      </div>
    </div>
  );
}
