import { Form, Link } from "react-router";
import { data, redirect, type ActionFunctionArgs } from "react-router";
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";

const currentStates = [
  { id: "confident", label: "I feel confident", emoji: "💪" },
  { id: "tired", label: "I feel tired", emoji: "😴" },
  { id: "bloated", label: "I feel bloated", emoji: "🌊" },
  { id: "low-energy", label: "I feel low-energy", emoji: "🔋" },
  { id: "playful", label: "I feel playful", emoji: "🎀" },
  { id: "romantic", label: "I feel romantic", emoji: "🌹" },
  { id: "powerful", label: "I feel powerful", emoji: "👑" },
  { id: "need-reset", label: "I feel like I need a reset", emoji: "🔄" },
  { id: "feel-good", label: "I feel good, I just need styling", emoji: "✨" },
];

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const mood = formData.get("mood") as string;
  
  if (!mood) {
    return data({ error: "Please select how you're feeling" }, { status: 400 });
  }
  
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeMood", mood);
  
  return redirect("/style-me/feeling", {
    headers: { "Set-Cookie": await commitSession(session) }
  });
}

export default function StyleMeMood() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1", padding: "40px 20px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <Link to="/" style={{ display: "inline-block", marginBottom: "32px", color: "#7a6f6a", textDecoration: "none", fontSize: "11px", fontFamily: "'Space Mono',monospace", letterSpacing: "2px", textTransform: "uppercase" }}>← Back to Dashboard</Link>
        
        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "42px", fontWeight: 900, marginBottom: "12px", color: "#221516", letterSpacing: "-1px" }}>How are you feeling?</h1>
        <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "40px" }}>Your current emotional state</p>
        
        <Form method="post">
          <div style={{ display: "grid", gap: "12px", marginBottom: "40px" }}>
            {currentStates.map((state) => (
              <button
                key={state.id}
                type="button"
                onClick={() => setSelected(state.id)}
                style={{
                  padding: "20px 24px",
                  background: selected === state.id ? "#8b2035" : "rgba(255,255,255,0.8)",
                  color: selected === state.id ? "#f4f4f1" : "#221516",
                  border: selected === state.id ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.1)",
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
                <span style={{ fontSize: "24px" }}>{state.emoji}</span>
                <span>{state.label}</span>
              </button>
            ))}
          </div>

          <input type="hidden" name="mood" value={selected || ""} />
          
          <button
            type="submit"
            disabled={!selected}
            style={{
              width: "100%",
              padding: "18px",
              background: selected ? "#221516" : "#7a6f6a",
              color: "#f4f4f1",
              border: "none",
              fontFamily: "'Space Mono',monospace",
              fontSize: "10px",
              letterSpacing: "4px",
              textTransform: "uppercase",
              cursor: selected ? "pointer" : "not-allowed",
              borderRadius: "4px",
              opacity: selected ? 1 : 0.6,
            }}
          >
            Continue
          </button>
        </Form>
      </div>
    </div>
  );
}
