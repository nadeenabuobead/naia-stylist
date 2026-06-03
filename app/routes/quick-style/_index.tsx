import { useState } from "react";
import { Form, redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  const { getSession, commitSession } = await import("~/lib/session.server");
  
  const formData = await request.formData();
  const mood = formData.get("mood") as string;
  const feelings = formData.get("feelings") as string;
  const occasion = formData.get("occasion") as string;
  const source = formData.get("source") as string;
  
  const session = await getSession(request.headers.get("Cookie"));
  session.set("styleMeMood", mood);
  session.set("styleMeFeelings", [feelings]);
  session.set("styleMeOccasion", occasion);
  session.set("styleMeSource", source);
  
  return redirect("/style-me/result", {
    headers: { "Set-Cookie": await commitSession(session) }
  });
}

export default function QuickStyle() {
  const [currentStep, setCurrentStep] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string>("");
  const [uploadedItem, setUploadedItem] = useState<any>(null);
  const [itemDetails, setItemDetails] = useState({
    category: "",
    color: "",
    tags: [] as string[]
  });
  
  const [sessionData, setSessionData] = useState({
    mood: "",
    feeling: "",
    occasion: "",
    bodyComfort: [] as string[],
    source: ""
  });

  const categories = ["Top", "Bottom", "Dress", "Outerwear", "Shoes", "Bag", "Accessory"];
  const colors = ["Black", "White", "Grey", "Beige", "Brown", "Red", "Pink", "Orange", "Yellow", "Green", "Blue", "Purple"];
  const tagOptions = ["Casual", "Formal", "Work", "Evening", "Summer", "Winter", "Comfortable", "Statement"];

  const selectPill = (value: string, field: keyof typeof sessionData, multi?: boolean) => {
    if (field === 'bodyComfort' && multi) {
      const arr = sessionData.bodyComfort;
      if (arr.includes(value)) {
        setSessionData({ ...sessionData, bodyComfort: arr.filter(v => v !== value) });
      } else {
        setSessionData({ ...sessionData, bodyComfort: [...arr, value] });
      }
    } else {
      setSessionData({ ...sessionData, [field]: value });
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
      ? itemDetails.tags.filter(t => t !== tag)
      : [...itemDetails.tags, tag];
    setItemDetails({ ...itemDetails, tags: updated });
  };

  const saveItem = () => {
    if (!itemDetails.category || !itemDetails.color) {
      alert("Please select category and color");
      return;
    }
    setUploadedItem({
      image: uploadPreview,
      category: itemDetails.category,
      color: itemDetails.color,
      tags: itemDetails.tags
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
      const needsUpload = sessionData.source !== "A nAia piece";
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

  const getSourceValue = () => {
    if (sessionData.source === "nAia only") return "NAIA";
    if (sessionData.source === "My closet only") return "CLOSET";
    return "BOTH";
  };

  const needsUpload = sessionData.source && sessionData.source !== "A nAia piece";

  const css = `:root{--cream:#f4f4f1;--warm:#e1dbd7;--burg:#3b0510;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}*{margin:0;padding:0;box-sizing:border-box}body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}body::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:0.03;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:200px}.topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}.topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}.topbar-close{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);text-decoration:none}.progress{padding:24px 40px 0;max-width:700px;margin:0 auto}.progress-dots{display:flex;gap:8px;justify-content:center;margin-bottom:8px}.progress-dot{width:10px;height:10px;border-radius:50%;background:var(--warm);transition:all .4s}.progress-dot.active{width:28px;border-radius:14px;background:var(--deep)}.progress-dot.done{background:var(--accent)}.progress-label{text-align:center;font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}.step{display:none;max-width:700px;margin:0 auto;padding:48px 40px 80px}.step.active{display:block;animation:fadeUp .5s ease}@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}.step-label{font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--accent);margin-bottom:12px}.step h2{font-family:var(--ff-display);font-size:clamp(28px,4vw,42px);font-weight:900;font-style:italic;color:var(--deep);letter-spacing:-1px;margin-bottom:32px;line-height:1.1}.pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}.pill{padding:12px 22px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;transition:all .3s;background:transparent}.pill:hover{border-color:var(--deep)}.pill.selected{background:#8b2035;color:var(--cream)}.step-buttons{display:flex;gap:12px;margin-top:16px}.btn-back{padding:14px 32px;border:1px solid rgba(59,5,16,.1);background:transparent;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--deep);cursor:pointer}.btn-next{padding:14px 40px;border:none;background:var(--deep);font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--cream);cursor:pointer}.btn-next:disabled{opacity:.3;cursor:not-allowed}.btn-next.generate{background:var(--burg);padding:14px 48px;letter-spacing:5px}.upload-box{margin:24px 0;padding:32px;border:2px dashed rgba(59,5,16,.2);text-align:center;cursor:pointer;transition:border-color .3s}.upload-box:hover{border-color:var(--deep)}.uploaded-preview{margin:24px 0;padding:20px;background:rgba(59,5,16,.02);text-align:center}.modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px}.modal-content{background:var(--cream);max-width:500px;width:100%;padding:32px;max-height:90vh;overflow-y:auto}.modal-section{margin-bottom:24px}`;

  return (
    <div>
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div className="topbar">
        <div className="topbar-logo">nAia</div>
        <a href="/" className="topbar-close">Exit Session</a>
      </div>

      <div className="progress">
        <div className="progress-dots">
          {[1,2,3,4,5].map(n => (
            <div key={n} className={`progress-dot ${n < currentStep ? 'done' : ''} ${n === currentStep ? 'active' : ''}`} />
          ))}
        </div>
        <div className="progress-label">Step {currentStep} of 5</div>
      </div>

      <div className={`step ${currentStep === 1 ? 'active' : ''}`}>
        <div className="step-label">Step 1 of 5</div>
        <h2>How are you feeling?</h2>
        <div className="pills">
          {["I feel confident", "I feel tired", "I feel bloated", "I feel low-energy", "I feel playful", "I feel romantic", "I feel powerful", "I feel like I need a reset", "I feel good, I just need styling"].map(m => (
            <div key={m} className={`pill ${sessionData.mood === m ? 'selected' : ''}`} onClick={() => selectPill(m, 'mood')}>{m}</div>
          ))}
        </div>
        <div className="step-buttons">
          <button className="btn-next" onClick={nextStep} disabled={!canProceed()}>Continue</button>
        </div>
      </div>

      <div className={`step ${currentStep === 2 ? 'active' : ''}`}>
        <div className="step-label">Step 2 of 5</div>
        <h2>How do you want this outfit to shift your energy?</h2>
        <div className="pills">
          {["Make me feel more confident", "Make me feel more put together", "Make me feel softer", "Make me feel more powerful", "Make me feel more feminine", "Make me feel more effortless", "Make me feel more elevated", "Make me feel more attractive", "Make me feel like myself again"].map(f => (
            <div key={f} className={`pill ${sessionData.feeling === f ? 'selected' : ''}`} onClick={() => selectPill(f, 'feeling')}>{f}</div>
          ))}
        </div>
        <div className="step-buttons">
          <button className="btn-back" onClick={prevStep}>Back</button>
          <button className="btn-next" onClick={nextStep} disabled={!canProceed()}>Continue</button>
        </div>
      </div>

      <div className={`step ${currentStep === 3 ? 'active' : ''}`}>
        <div className="step-label">Step 3 of 5</div>
        <h2>What does the outfit need to work for?</h2>
        <div className="pills">
          {["Everyday / casual plans", "Work / meetings", "Dinner", "Date night", "Girls' night", "Family gathering", "Special event", "Travel day", "I'm not sure yet"].map(o => (
            <div key={o} className={`pill ${sessionData.occasion === o ? 'selected' : ''}`} onClick={() => selectPill(o, 'occasion')}>{o}</div>
          ))}
        </div>
        <div className="step-buttons">
          <button className="btn-back" onClick={prevStep}>Back</button>
          <button className="btn-next" onClick={nextStep} disabled={!canProceed()}>Continue</button>
        </div>
      </div>

      <div className={`step ${currentStep === 4 ? 'active' : ''}`}>
        <div className="step-label">Step 4 of 5</div>
        <h2>What does your body need from this outfit today?</h2>
        <div className="pills">
          {["Waist definition", "More coverage", "Something relaxed", "Something structured", "Something that elongates me", "Something that balances my shape", "Something comfortable but still elevated", "I feel bloated", "Nothing specific"].map(b => (
            <div key={b} className={`pill ${sessionData.bodyComfort.includes(b) ? 'selected' : ''}`} onClick={() => selectPill(b, 'bodyComfort', true)}>{b}</div>
          ))}
        </div>
        <div className="step-buttons">
          <button className="btn-back" onClick={prevStep}>Back</button>
          <button className="btn-next" onClick={nextStep} disabled={!canProceed()}>Continue</button>
        </div>
      </div>

      <div className={`step ${currentStep === 5 ? 'active' : ''}`}>
        <div className="step-label">Step 5 of 5</div>
        <h2>What are we building the look around?</h2>
        <div className="pills">
          {["A nAia piece", "Something from my closet", "nAia + my closet"].map(s => (
            <div key={s} className={`pill ${sessionData.source === s ? 'selected' : ''}`} onClick={() => selectPill(s, 'source')}>{s}</div>
          ))}
        </div>

        {needsUpload && !uploadedItem && (
          <div>
            <input type="file" id="file-upload" accept="image/*" style={{ display: "none" }} onChange={handleFileSelect} />
            <div className="upload-box" onClick={() => document.getElementById('file-upload')?.click()}>
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
          <input type="hidden" name="feelings" value={sessionData.feeling} />
          <input type="hidden" name="occasion" value={sessionData.occasion} />
          <input type="hidden" name="source" value={getSourceValue()} />
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
                {categories.map(cat => (
                  <div key={cat} onClick={() => setItemDetails({ ...itemDetails, category: cat })} className={`pill ${itemDetails.category === cat ? 'selected' : ''}`}>{cat}</div>
                ))}
              </div>
            </div>

            <div className="modal-section">
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px", color: "#8b2035" }}>Color *</div>
              <div className="pills">
                {colors.map(color => (
                  <div key={color} onClick={() => setItemDetails({ ...itemDetails, color })} className={`pill ${itemDetails.color === color ? 'selected' : ''}`}>{color}</div>
                ))}
              </div>
            </div>

            <div className="modal-section">
              <div style={{ fontFamily: "'Space Mono','Courier New',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px", color: "#7a6f6a" }}>Tags (optional)</div>
              <div className="pills">
                {tagOptions.map(tag => (
                  <div key={tag} onClick={() => toggleTag(tag)} className={`pill ${itemDetails.tags.includes(tag) ? 'selected' : ''}`}>{tag}</div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", marginTop: "32px" }}>
              <button onClick={cancelModal} className="btn-back" style={{ flex: 1 }}>Cancel</button>
              <button onClick={saveItem} className="btn-next" style={{ flex: 1 }}>Save Item</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
