import { useState, useEffect } from "react";

export function TryOnButton({ garmentImage, garmentName }: { garmentImage: string; garmentName: string }) {
  return null; // placeholder — modal is handled globally
}

export function TryOnModal() {
  const [show, setShow] = useState(false);
  const [garmentImage, setGarmentImage] = useState("");
  const [garmentName, setGarmentName] = useState("");
  const [step, setStep] = useState<"upload" | "processing" | "done" | "error">("upload");
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: any) => {
      setGarmentImage(e.detail.garmentImage);
      setGarmentName(e.detail.garmentName);
      setShow(true);
      setStep("upload");
      setResultImage(null);
    };
    window.addEventListener("naia:tryon", handler);
    return () => window.removeEventListener("naia:tryon", handler);
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStep("processing");
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      try {
        const res = await fetch("/api/tryon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: "current", modelImage: base64, garmentImage }),
        });
        const { predictionId, error } = await res.json();
        if (error) throw new Error(error);
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          const r = await fetch(`/api/tryon?predictionId=${predictionId}`);
          const d = await r.json();
          if (d.status === "success") { clearInterval(poll); setResultImage(d.imageUrl); setStep("done"); }
          else if (d.status === "error" || attempts > 20) { clearInterval(poll); setErrorMsg("Try-on failed."); setStep("error"); }
        }, 3000);
      } catch (err: any) { setErrorMsg(err.message); setStep("error"); }
    };
    reader.readAsDataURL(file);
  };

  if (!show) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#f4f4f1", borderRadius: 4, padding: 40, maxWidth: 420, width: "100%", textAlign: "center", position: "relative" }}>
        <button onClick={() => setShow(false)} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#888" }}>✕</button>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "#8b2035", marginBottom: 20 }}>Virtual Try-On</div>

        {step === "upload" && (
          <>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, marginBottom: 8 }}>{garmentName}</div>
            <p style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#7a6f6a", marginBottom: 24 }}>Upload a full-body photo to see how this looks on you</p>
            <div onClick={() => document.getElementById("tryon-file")?.click()} style={{ border: "1px dashed rgba(59,5,16,0.2)", padding: 32, cursor: "pointer", marginBottom: 16 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📸</div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#7a6f6a" }}>Tap to upload photo</div>
            </div>
            <input id="tryon-file" type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
          </>
        )}

        {step === "processing" && (
          <>
            <div style={{ width: 40, height: 40, border: "2px solid #f0e8e4", borderTop: "2px solid #8b2035", borderRadius: "50%", margin: "0 auto 20px", animation: "spin 1s linear infinite" }} />
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 20, marginBottom: 8 }}>Creating your try-on...</div>
            <p style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#7a6f6a" }}>This takes about 10 seconds</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </>
        )}

        {step === "done" && resultImage && (
          <>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 20, marginBottom: 16 }}>{garmentName}</div>
            <img src={resultImage} alt="Try-on result" style={{ width: "100%", borderRadius: 4, marginBottom: 20 }} />
            <button onClick={() => setStep("upload")} style={{ padding: "12px 24px", background: "transparent", border: "1px solid rgba(59,5,16,0.12)", fontFamily: "'Space Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Try another photo</button>
          </>
        )}

        {step === "error" && (
          <>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 20, marginBottom: 8 }}>Something went wrong</div>
            <p style={{ fontFamily: "'Space Mono',monospace", fontSize: 10, color: "#7a6f6a", marginBottom: 20 }}>{errorMsg}</p>
            <button onClick={() => setStep("upload")} style={{ padding: "12px 24px", background: "#221516", color: "#f4f4f1", border: "none", fontFamily: "'Space Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Try again</button>
          </>
        )}
      </div>
    </div>
  );
}