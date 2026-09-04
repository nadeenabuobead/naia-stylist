import { useState, useEffect } from "react";

const tryOnPhrases = [
  "Draping the fabric...",
  "Fitting the silhouette...",
  "Adjusting the cut...",
  "Styling your look...",
  "Pressing the details...",
  "Almost on you...",
  "Finishing touches...",
];

function TryOnLoadingScreen() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % tryOnPhrases.length), 2500);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Caveat:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{ width: "200px", height: "3px", background: "#e1dbd7", margin: "0 auto 24px", overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: "-60%", width: "60%", height: "100%", background: "#8b2035", animation: "loadSlide 1.5s ease infinite" }} />
      </div>
      <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: 22, fontWeight: 900, fontStyle: "italic", color: "#221516", marginBottom: 12 }}>
        nAia is dressing you...
      </div>
      <div style={{ fontFamily: "'Caveat',cursive", fontSize: 18, color: "#8b2035", opacity: 0.6 }}>
        {tryOnPhrases[idx]}
      </div>
      <style>{`@keyframes loadSlide{0%{left:-60%}100%{left:100%}}`}</style>
    </div>
  );
}

export function TryOnButton({ garmentImage, garmentName }: { garmentImage: string; garmentName: string }) {
  return null;
}

export function TryOnModal() {
  const [show, setShow] = useState(false);
  const [garmentImage, setGarmentImage] = useState("");
  const [garmentImage2, setGarmentImage2] = useState("");
  const [garmentImage3, setGarmentImage3] = useState("");
  const [outfitName, setOutfitName] = useState("");
  const [step, setStep] = useState<"upload" | "processing" | "done" | "error">("upload");
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: any) => {
      setGarmentImage(e.detail.garmentImage || "");
      setGarmentImage2(e.detail.garmentImage2 || "");
      setGarmentImage3(e.detail.garmentImage3 || "");
      setOutfitName(e.detail.outfitName || "this look");
      setShow(true);
      setStep("upload");
      setResultImage(null);
      setErrorMsg(null);
    };
    window.addEventListener("naia:tryon", handler);
    return () => window.removeEventListener("naia:tryon", handler);
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStep("processing");

    try {
      // Upload photo to Cloudinary on client side first
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", "kqfhwrpq");
      const cloudRes = await fetch("https://api.cloudinary.com/v1_1/diybves1z/image/upload", {
        method: "POST",
        body: formData,
      });
      const cloudData = await cloudRes.json();
      const modelImageUrl = cloudData.secure_url;
      if (!modelImageUrl) throw new Error("Photo upload failed. Please try again.");

      const body: any = {
        customerId: "current",
        modelImage: modelImageUrl,
        garmentImage,
      };
      if (garmentImage2) body.garmentImage2 = garmentImage2;
      if (garmentImage3) body.garmentImage3 = garmentImage3;

      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);

      const { predictionId } = result;
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const r = await fetch(`/api/tryon?predictionId=${predictionId}`);
        const d = await r.json();
        if (d.status === "success") {
          clearInterval(poll);
          setResultImage(d.imageUrl);
          setStep("done");
        } else if (d.status === "error" || attempts > 40) {
          clearInterval(poll);
          setErrorMsg("Try-on failed. Please try again.");
          setStep("error");
        }
      }, 3000);
    } catch (err: any) {
      setErrorMsg(err.message);
      setStep("error");
    }
  };

  if (!show) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#f4f4f1", padding: 40, maxWidth: 440, width: "100%", textAlign: "center", position: "relative" }}>
        <button onClick={() => setShow(false)} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#888" }}>✕</button>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "#8b2035", marginBottom: 20 }}>Virtual Try-On</div>

        {step === "upload" && (
          <>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, marginBottom: 8 }}>{outfitName}</div>
            <p style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#7a6f6a", marginBottom: 24, lineHeight: 1.6 }}>
              Upload a photo to see how this looks on you
            </p>
            <div
              onClick={() => document.getElementById("tryon-file")?.click()}
              style={{ border: "1px dashed rgba(59,5,16,0.2)", padding: 28, cursor: "pointer", marginBottom: 16 }}
            >
              <div style={{ fontSize: 32, marginBottom: 10 }}>📸</div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#7a6f6a", marginBottom: 8 }}>
                Tap to upload your photo
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 13, fontStyle: "italic", color: "#7a6f6a", lineHeight: 1.6 }}>
                Full body · facing forward · arms slightly out<br />
                fitted clothes · good lighting
              </div>
            </div>
            <input id="tryon-file" type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
          </>
        )}

        {step === "processing" && <TryOnLoadingScreen />}

        {step === "done" && resultImage && (
          <>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 20, marginBottom: 16 }}>{outfitName}</div>
            <img src={resultImage} alt="Try-on result" style={{ width: "100%", marginBottom: 20 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setStep("upload")}
                style={{ flex: 1, padding: "12px 24px", background: "transparent", border: "1px solid rgba(59,5,16,0.12)", fontFamily: "'Space Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}
              >
                Try another photo
              </button>
              <button
                onClick={() => setShow(false)}
                style={{ flex: 1, padding: "12px 24px", background: "#221516", color: "#f4f4f1", border: "none", fontFamily: "'Space Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}
              >
                Done
              </button>
            </div>
          </>
        )}

        {step === "error" && (
          <>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 20, marginBottom: 8 }}>Something went wrong</div>
            <p style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#7a6f6a", marginBottom: 20 }}>{errorMsg}</p>
            <button
              onClick={() => setStep("upload")}
              style={{ padding: "12px 24px", background: "#221516", color: "#f4f4f1", border: "none", fontFamily: "'Space Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
