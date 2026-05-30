import { Form, Link, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";

const sourceOptions = [
  { id: "naia-piece", label: "A nAia piece", emoji: "✨", description: "Style one of our pieces" },
  { id: "my-closet", label: "Something from my closet", emoji: "👗", description: "Upload or describe what you own" },
  { id: "both", label: "nAia + my closet", emoji: "🎨", description: "Combine nAia with what you have" },
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
  const source = formData.get("source") as string;
  
  if (!source) {
    return data({ error: "Please select what we're styling" }, { status: 400 });
  }
  
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeSource", source);
  
  return redirect("/style-me/result", {
    headers: { "Set-Cookie": await commitSession(session) }
  });
}

export default function StyleMeSource() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1", padding: "40px 20px" }}>
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <Link to="/style-me/comfort" style={{ display: "inline-block", marginBottom: "32px", color: "#7a6f6a", textDecoration: "none" }}>Back</Link>
        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "42px", fontWeight: 900, marginBottom: "16px" }}>What are we building the look around?</h1>
        <Form method="post">
          <div style={{ display: "grid", gap: "16px", marginBottom: "40px" }}>
            {sourceOptions.map((option) => (
              <button key={option.id} type="button" onClick={() => setSelected(option.id)} style={{ padding: "24px", background: selected === option.id ? "#8b2035" : "white", color: selected === option.id ? "#f4f4f1" : "#221516", border: "2px solid " + (selected === option.id ? "#8b2035" : "#ddd"), cursor: "pointer", textAlign: "left" }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>{option.emoji}</div>
                <div style={{ fontSize: "20px", fontWeight: 700, marginBottom: "4px" }}>{option.label}</div>
                <div style={{ fontSize: "14px", opacity: 0.8 }}>{option.description}</div>
              </button>
            ))}
          </div>
          <input type="hidden" name="source" value={selected || ""} />
          <button type="submit" disabled={!selected} style={{ width: "100%", padding: "18px", background: selected ? "#221516" : "#999", color: "white", border: "none", cursor: selected ? "pointer" : "not-allowed" }}>Get My Look</button>
        </Form>
      </div>
    </div>
  );
}
