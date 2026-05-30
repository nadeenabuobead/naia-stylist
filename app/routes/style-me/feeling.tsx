import { Form, Link, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";

const desiredFeelings = [
  { id: "more-confident", label: "Make me feel more confident", emoji: "💪" },
  { id: "more-put-together", label: "Make me feel more put together", emoji: "✨" },
  { id: "softer", label: "Make me feel softer", emoji: "🌸" },
  { id: "more-powerful", label: "Make me feel more powerful", emoji: "👑" },
  { id: "more-feminine", label: "Make me feel more feminine", emoji: "💐" },
  { id: "more-effortless", label: "Make me feel more effortless", emoji: "🌊" },
  { id: "more-elevated", label: "Make me feel more elevated", emoji: "🎯" },
  { id: "more-attractive", label: "Make me feel more attractive", emoji: "💫" },
  { id: "like-myself", label: "Make me feel like myself again", emoji: "🌟" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const mood = session.get("styleMeMood");
  
  if (!mood) {
    return redirect("/style-me/mood");
  }
  
  return data({ mood });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const feeling = formData.get("feeling") as string;
  
  if (!feeling) {
    return data({ error: "Please select how you want to feel" }, { status: 400 });
  }
  
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeFeeling", feeling);
  
  return redirect("/style-me/occasion", {
    headers: { "Set-Cookie": await commitSession(session) }
  });
}

export default function StyleMeFeeling() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1", padding: "40px 20px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <Link to="/style-me/mood" style={{ display: "inline-block", marginBottom: "32px", color: "#7a6f6a", textDecoration: "none", fontSize: "11px", fontFamily: "'Space Mono',monospace", letterSpacing: "2px", textTransform: "uppercase" }}>← Back</Link>
        
        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "42px", fontWeight: 900, marginBottom: "12px", color: "#221516", letterSpacing: "-1px" }}>How do you want to feel?</h1>
        <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "40px" }}>The transformation you're seeking</p>
        
        <Form method="post">
          <div style={{ display: "grid", gap: "12px", marginBottom: "40px" }}>
            {desiredFeelings.map((feeling) => (
              <button
                key={feeling.id}
                type="button"
                onClick={() => setSelected(feeling.id)}
                style={{
                  padding: "20px 24px",
                  background: selected === feeling.id ? "#8b2035" : "rgba(255,255,255,0.8)",
                  color: selected === feeling.id ? "#f4f4f1" : "#221516",
                  border: selected === feeling.id ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.1)",
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
                <span style={{ fontSize: "24px" }}>{feeling.emoji}</span>
                <span>{feeling.label}</span>
              </button>
            ))}
          </div>

          <input type="hidden" name="feeling" value={selected || ""} />
          
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
