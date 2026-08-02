import { useState } from "react";
import { data, Form, redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { BODY_NEED_NORMALIZATION_MAP } from "~/lib/ai/signal-contract";

export async function action({ request }: ActionFunctionArgs) {
  const { getSession, commitSession } = await import("~/lib/session.server");

  const formData = await request.formData();
  const mood = formData.get("mood") as string;
  const feeling = formData.get("feeling") as string;
  const occasion = formData.get("occasion") as string;
  const source = formData.get("source") as string;
  const bodyNeedsRaw = formData.get("bodyNeeds") as string;

  let bodyNeeds: string[] = [];
  try { bodyNeeds = JSON.parse(bodyNeedsRaw || "[]"); } catch { /* invalid JSON */ }

  if (!mood || !VALID_MOOD_IDS_QS.has(mood)) {
    return data({ error: "Invalid mood selection" }, { status: 400 });
  }

  const normalizedBodyNeeds = bodyNeeds.map((id) => BODY_NEED_NORMALIZATION_MAP[id] ?? id);

  if (normalizedBodyNeeds.length === 0) {
    return data({ error: "Please select what your body needs today" }, { status: 400 });
  }
  if (normalizedBodyNeeds.some((id) => !VALID_BODY_NEED_IDS_QS.has(id))) {
    return data({ error: "Invalid body need selection" }, { status: 400 });
  }
  if (normalizedBodyNeeds.length > 3) {
    return data({ error: "Please select up to three body needs" }, { status: 400 });
  }
  if (normalizedBodyNeeds.includes("nothing-specific") && normalizedBodyNeeds.length > 1) {
    return data({ error: "Nothing specific cannot be combined with other selections" }, { status: 400 });
  }

  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeMood", [mood]);
  session.set("styleMeFeelings", feeling ? [feeling] : []);
  session.set("styleMeBodyNeeds", normalizedBodyNeeds);
  session.set("styleMeOccasion", occasion);
  session.set("styleMeSource", source);

  return redirect("/style-me/result", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

const moodOpts = [
  { id: "confident", label: "I feel confident" },
  { id: "playful", label: "I feel playful" },
  { id: "romantic", label: "I feel romantic" },
  { id: "powerful", label: "I feel powerful" },
  { id: "feel-good", label: "I feel good, I just need styling" },
  { id: "need-reset", label: "I feel like I need a reset" },
  { id: "tired", label: "I feel tired" },
  { id: "low-energy", label: "I feel low-energy" },
  { id: "feeling-low", label: "I'm feeling low" },
  { id: "overwhelmed", label: "I feel overwhelmed" },
  { id: "self-conscious", label: "I feel self-conscious" },
  { id: "neutral", label: "I feel neutral — just need an outfit" },
];

const feelingOpts = [
  { id: "more-confident", label: "Make me feel more confident" },
  { id: "more-put-together", label: "Make me feel more put together" },
  { id: "softer", label: "Make me feel softer" },
  { id: "more-powerful", label: "Make me feel more powerful" },
  { id: "more-feminine", label: "Make me feel more feminine" },
  { id: "more-effortless", label: "Make me feel more effortless" },
  { id: "more-elevated", label: "Make me feel more elevated" },
  { id: "more-attractive", label: "Make me feel more attractive" },
  { id: "like-myself", label: "Make me feel like myself again" },
];

const occasionOpts = [
  { id: "everyday", label: "Everyday / casual plans" },
  { id: "work", label: "Work / meetings" },
  { id: "dinner", label: "Dinner" },
  { id: "date-night", label: "Date night" },
  { id: "girls-night", label: "Girls' night" },
  { id: "family", label: "Family gathering" },
  { id: "special-event", label: "Special event" },
  { id: "travel", label: "Travel day" },
  { id: "not-sure", label: "I'm not sure yet" },
];

const bodyComfortOpts = [
  { id: "waist-definition", label: "Waist definition" },
  { id: "soft-and-forgiving-around-waist", label: "Soft and forgiving around my waist today" },
  { id: "more-coverage", label: "More coverage" },
  { id: "relaxed", label: "Something relaxed" },
  { id: "structured", label: "Something structured" },
  { id: "elongates", label: "Something that elongates me" },
  { id: "balances", label: "Something that balances my shape" },
  { id: "comfortable-elevated", label: "Something comfortable but still elevated" },
  { id: "nothing-specific", label: "Nothing specific" },
];

const VALID_MOOD_IDS_QS = new Set(moodOpts.map((m) => m.id));
const VALID_BODY_NEED_IDS_QS = new Set(bodyComfortOpts.map((b) => b.id));

const sourceOpts = [
  { id: "naia-piece", label: "A nAia piece" },
  { id: "my-closet", label: "Something from my closet" },
  { id: "both", label: "nAia + my closet" },
];

export default function QuickStyle() {
  const [currentStep, setCurrentStep] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string>("");
  const [uploadedItem, setUploadedItem] = useState<any>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [itemDetails, setItemDetails] = useState({
    category: "",
    color: "",
    tags: [] as string[],
  });

  const [sessionData, setSessionData] = useState({
    mood: "",
    feeling: "",
    occasion: "",
    bodyComfort: [] as string[],
    source: "",
  });

  const categories = ["Top", "Bottom", "Dress", "Outerwear", "Shoes", "Bag", "Accessory"];
  const colors = ["Black", "White", "Grey", "Beige", "Brown", "Red", "Pink", "Orange", "Yellow", "Green", "Blue", "Purple"];
  const tagOptions = ["Casual", "Formal", "Work", "Evening", "Summer", "Winter", "Comfortable", "Statement"];

  const selectSingle = (id: string, field: "mood" | "feeling" | "occasion" | "source") => {
    setSessionData({ ...sessionData, [field]: id });
  };

  const toggleBodyComfort = (id: string) => {
    const arr = sessionData.bodyComfort;
    if (id === "nothing-specific") {
      setSessionData({ ...sessionData, bodyComfort: arr.includes("nothing-specific") ? [] : ["nothing-specific"] });
    } else {
      const withoutNothing = arr.filter((v) => v !== "nothing-specific");
      if (withoutNothing.includes(id)) {
        setSessionData({ ...sessionData, bodyComfort: withoutNothing.filter((v) => v !== id) });
      } else if (withoutNothing.length < 3) {
        setSessionData({ ...sessionData, bodyComfort: [...withoutNothing, id] });
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadPreview(reader.result as string);
        setShowModal(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleTag = (tag: string) => {
    const updated = itemDetails.tags.includes(tag)
      ? itemDetails.tags.filter((t) => t !== tag)
      : [...itemDetails.tags, tag];
    setItemDetails({ ...itemDetails, tags: updated });
  };

  const saveItem = () => {
    if (!itemDetails.category || !itemDetails.color) {
      setSaveError("Please select category and colour");
      return;
    }
    setSaveError(null);
    setUploadedItem({
      image: uploadPreview,
      category: itemDetails.category,
      color: itemDetails.color,
      tags: itemDetails.tags,
    });
    setShowModal(false);
  };

  const cancelModal = () => {
    setShowModal(false);
    setUploadPreview("");
    setItemDetails({ category: "", color: "", tags: [] });
  };

  const canProceed = () => {
    if (currentStep === 1) return !!sessionData.mood;
    if (currentStep === 2) return !!sessionData.feeling;
    if (currentStep === 3) return !!sessionData.occasion;
    if (currentStep === 4) return sessionData.bodyComfort.length > 0;
    if (currentStep === 5) {
      if (!sessionData.source) return false;
      const needsUpload = sessionData.source === "my-closet" || sessionData.source === "both";
      if (needsUpload && !uploadedItem) return false;
      return true;
    }
    return false;
  };

  const nextStep = () => {
    if (canProceed() && currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const needsUpload = sessionData.source === "my-closet" || sessionData.source === "both";

  const css = `:root{--cream:#f4f4f1;--warm:#e1dbd7;--burg:#3b0510;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}*{margin:0;padding:0;box-sizing:border-box}body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}body::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:0.03;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:200px}.topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}.topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}.topbar-close{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);text-decoration:none}.progress{padding:24px 40px 0;max-width:700px;margin:0 auto}.progress-dots{display:flex;gap:8px;justify-content:center;margin-bottom:8px}.progress-dot{width:10px;height:10px;border-radius:50%;background:var(--warm);transition:all .4s}.progress-dot.active{width:28px;border-radius:14px;background:var(--deep)}.progress-dot.done{background:var(--accent)}.progress-label{text-align:center;font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}.step{display:none;max-width:700px;margin:0 auto;padding:48px 40px 80px}.step.active{display:block;animation:fadeUp .5s ease}@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}.step-label{font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--accent);margin-bottom:12px}.step h2{font-family:var(--ff-display);font-size:clamp(28px,4vw,42px);font-weight:900;font-style:italic;color:var(--deep);letter-spacing:-1px;margin-bottom:32px;line-height:1.1}.pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}.pill{padding:12px 22px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;transition:all .3s;background:transparent}.pill:hover{border-color:var(--deep)}.pill.selected{background:#8b2035;color:var(--cream)}.step-buttons{display:flex;gap:12px;margin-top:16px}.btn-back{padding:14px 32px;border:1px solid rgba(59,5,16,.1);background:transparent;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--deep);cursor:pointer}.btn-next{padding:14px 40px;border:none;background:var(--deep);font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--cream);cursor:pointer}.btn-next:disabled{opacity:.3;cursor:not-allowed}.btn-next.generate{background:var(--burg);padding:14px 48px;letter-spacing:5px}.upload-box{margin:24px 0;padding:32px;border:2px dashed rgba(59,5,16,.2);text-align:center;cursor:pointer;transition:border-color .3s}.upload-box:hover{border-color:var(--deep)}.uploaded-preview{margin:24px 0;padding:20px;background:rgba(59,5,16,.02);text-align:center}.modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px}.modal-content{background:var(--cream);max-width:500px;width:100%;padding:32px;max-height:90vh;overflow-y:auto}.modal-section{margin-bottom:24px}.qs-hero{max-width:700px;margin:0 auto;padding:48px 40px 32px}.qs-hero-h{font-family:var(--ff-display);font-size:clamp(36px,5vw,56px);font-weight:900;color:var(--deep);margin-bottom:12px}.qs-hero-sub{font-family:var(--ff-mono);font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}@media(max-width:640px){.topbar{padding:16px 20px}.progress{padding:20px 20px 0}.qs-hero{padding:32px 20px 24px}.step{padding:32px 20px 80px}.btn-next.generate{padding:14px 28px;letter-spacing:3px}.step-buttons{flex-direction:column}.btn-back{order:2}.btn-next{order:1}}`;

  return (
    <div>
      <style>{css}</style>
      <div className="topbar">
        <div className="topbar-logo">nAia</div>
        <a href="/style-me" className="topbar-close">Exit</a>
      </div>

      <div className="qs-hero">
        <h1 className="qs-hero-h">Style Me</h1>
        <p className="qs-hero-sub">Get a personalized outfit based on your mood, occasion, and what feels right today.</p>
      </div>

      <div className="progress">
        <div className="progress-dots">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className={`progress-dot ${n < currentStep ? "done" : ""} ${n === currentStep ? "active" : ""}`} />
          ))}
        </div>
        <div className="progress-label">Step {currentStep} of 5</div>
      </div>

      {/* Step 1 — Mood */}
      <div className={`step ${currentStep === 1 ? "active" : ""}`}>
        <div className="step-label">Step 1 of 5</div>
        <h2>How are you feeling?</h2>
        <div className="pills">
          {moodOpts.map((m) => (
            <div key={m.id} className={`pill ${sessionData.mood === m.id ? "selected" : ""}`} onClick={() => selectSingle(m.id, "mood")}>{m.label}</div>
          ))}
        </div>
        <div className="step-buttons">
          <button className="btn-next" onClick={nextStep} disabled={!canProceed()}>Continue</button>
        </div>
      </div>

      {/* Step 2 — Desired Feeling */}
      <div className={`step ${currentStep === 2 ? "active" : ""}`}>
        <div className="step-label">Step 2 of 5</div>
        <h2>How do you want this outfit to shift your energy?</h2>
        <div className="pills">
          {feelingOpts.map((f) => (
            <div key={f.id} className={`pill ${sessionData.feeling === f.id ? "selected" : ""}`} onClick={() => selectSingle(f.id, "feeling")}>{f.label}</div>
          ))}
        </div>
        <div className="step-buttons">
          <button className="btn-back" onClick={prevStep}>Back</button>
          <button className="btn-next" onClick={nextStep} disabled={!canProceed()}>Continue</button>
        </div>
      </div>

      {/* Step 3 — Occasion */}
      <div className={`step ${currentStep === 3 ? "active" : ""}`}>
        <div className="step-label">Step 3 of 5</div>
        <h2>What does the outfit need to work for?</h2>
        <div className="pills">
          {occasionOpts.map((o) => (
            <div key={o.id} className={`pill ${sessionData.occasion === o.id ? "selected" : ""}`} onClick={() => selectSingle(o.id, "occasion")}>{o.label}</div>
          ))}
        </div>
        <div className="step-buttons">
          <button className="btn-back" onClick={prevStep}>Back</button>
          <button className="btn-next" onClick={nextStep} disabled={!canProceed()}>Continue</button>
        </div>
      </div>

      {/* Step 4 — Body Needs */}
      <div className={`step ${currentStep === 4 ? "active" : ""}`}>
        <div className="step-label">Step 4 of 5</div>
        <h2>What does your body need from this outfit today?</h2>
        <div className="pills">
          {bodyComfortOpts.map((b) => (
            <div key={b.id} className={`pill ${sessionData.bodyComfort.includes(b.id) ? "selected" : ""}`} onClick={() => toggleBodyComfort(b.id)}>{b.label}</div>
          ))}
        </div>
        <div className="step-buttons">
          <button className="btn-back" onClick={prevStep}>Back</button>
          <button className="btn-next" onClick={nextStep} disabled={!canProceed()}>Continue</button>
        </div>
      </div>

      {/* Step 5 — Source */}
      <div className={`step ${currentStep === 5 ? "active" : ""}`}>
        <div className="step-label">Step 5 of 5</div>
        <h2>What are we building the look around?</h2>
        <div className="pills">
          {sourceOpts.map((s) => (
            <div key={s.id} className={`pill ${sessionData.source === s.id ? "selected" : ""}`} onClick={() => selectSingle(s.id, "source")}>{s.label}</div>
          ))}
        </div>

        {needsUpload && !uploadedItem && (
          <div>
            <input type="file" id="file-upload" accept="image/*" style={{ display: "none" }} onChange={handleFileSelect} />
            <div className="upload-box" onClick={() => document.getElementById("file-upload")?.click()}>
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", marginBottom: "8px" }}>Upload from Closet</div>
              <div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", fontStyle: "italic", color: "#7a6f6a" }}>Click to select an image</div>
            </div>
          </div>
        )}

        {needsUpload && uploadedItem && (
          <div className="uploaded-preview">
            <img src={uploadedItem.image} alt="Upload" style={{ maxWidth: "150px", maxHeight: "150px", objectFit: "contain", marginBottom: "12px" }} />
            <div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "16px", marginBottom: "8px" }}><strong>{uploadedItem.category}</strong> • {uploadedItem.color}</div>
            {uploadedItem.tags.length > 0 && <div style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "14px", fontStyle: "italic", color: "#7a6f6a", marginBottom: "12px" }}>{uploadedItem.tags.join(", ")}</div>}
            <button onClick={() => setUploadedItem(null)} style={{ padding: "10px 20px", background: "transparent", border: "1px solid rgba(59,5,16,.12)", fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", cursor: "pointer" }}>Remove</button>
          </div>
        )}

        <Form method="post" className="step-buttons">
          <input type="hidden" name="mood" value={sessionData.mood} />
          <input type="hidden" name="feeling" value={sessionData.feeling} />
          <input type="hidden" name="occasion" value={sessionData.occasion} />
          <input type="hidden" name="bodyNeeds" value={JSON.stringify(sessionData.bodyComfort)} />
          <input type="hidden" name="source" value={sessionData.source} />
          <button type="button" className="btn-back" onClick={prevStep}>Back</button>
          <button type="submit" className="btn-next generate" disabled={!canProceed()}>Get My Look</button>
        </Form>
      </div>

      {showModal && (
        <div className="modal" onClick={cancelModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "28px", fontWeight: 900, marginBottom: "24px" }}>Tell us about this item</h2>

            {uploadPreview && <img src={uploadPreview} alt="Preview" style={{ maxWidth: "150px", maxHeight: "150px", objectFit: "contain", display: "block", margin: "0 auto 24px" }} />}

            <div className="modal-section">
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px", color: "#8b2035" }}>Category *</div>
              <div className="pills">
                {categories.map((cat) => (
                  <div key={cat} onClick={() => setItemDetails({ ...itemDetails, category: cat })} className={`pill ${itemDetails.category === cat ? "selected" : ""}`}>{cat}</div>
                ))}
              </div>
            </div>

            <div className="modal-section">
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px", color: "#8b2035" }}>Color *</div>
              <div className="pills">
                {colors.map((color) => (
                  <div key={color} onClick={() => setItemDetails({ ...itemDetails, color })} className={`pill ${itemDetails.color === color ? "selected" : ""}`}>{color}</div>
                ))}
              </div>
            </div>

            <div className="modal-section">
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px", color: "#7a6f6a" }}>Tags (optional)</div>
              <div className="pills">
                {tagOptions.map((tag) => (
                  <div key={tag} onClick={() => toggleTag(tag)} className={`pill ${itemDetails.tags.includes(tag) ? "selected" : ""}`}>{tag}</div>
                ))}
              </div>
            </div>

            {saveError && (
              <p style={{ color: "#8b2035", fontFamily: "var(--ff-body, serif)", fontSize: "14px", fontStyle: "italic", marginTop: "12px" }}>
                {saveError}
              </p>
            )}
            <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
              <button onClick={cancelModal} className="btn-back" style={{ flex: 1 }}>Cancel</button>
              <button onClick={saveItem} className="btn-next" style={{ flex: 1 }}>Save Item</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
