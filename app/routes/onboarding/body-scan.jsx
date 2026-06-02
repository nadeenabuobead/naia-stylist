import { useState, useRef, useCallback, useEffect } from "react";
import { useLoaderData } from "react-router";
import { authenticateCustomer } from "../../customer-auth.server";
import QRCode from "qrcode";

export async function loader({ request }) {
  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ customerId: "dev-test-customer-123", isDev: true });
  }
  return Response.json({ customerId: customer.id, isDev: false });
}

export default function BodyScanPage() {
  const { customerId } = useLoaderData();
  const [step, setStep] = useState("intro");
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [poseStatus, setPoseStatus] = useState("waiting");
  const [poseMessage, setPoseMessage] = useState("Stand straight, face forward");
  const [countdown, setCountdown] = useState(null);
  const [measurements, setMeasurements] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const poseLandmarkerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const goodPoseStartRef = useRef(null);
  const animFrameRef = useRef(null);
  const frontPhotoRef = useRef(null);
  const pollRef = useRef(null);
  const audioCtxRef = useRef(null);

  useEffect(() => {
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    setIsMobile(mobile);
    const urlParams = new URLSearchParams(window.location.search);
    const sid = urlParams.get("session");
    const cid = urlParams.get("customer");
    if (sid && cid && mobile) {
      setStep("mobile-ready");
    }
  }, []);

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  }, []);

  const speakSequence = useCallback((sentences) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    sentences.forEach((sentence) => {
      const utt = new SpeechSynthesisUtterance(sentence);
      utt.rate = 0.9;
      utt.pitch = 1.1;
      utt.volume = 1;
      window.speechSynthesis.speak(utt);
    });
  }, []);

  const speak = useCallback((text, force = false) => {
    if (!window.speechSynthesis) return;
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.9;
    utt.pitch = 1.1;
    utt.volume = 1;
    window.speechSynthesis.speak(utt);
  }, []);

  const playClick = useCallback(() => {
    try {
      const ctx = getAudioCtx();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = 880;
      oscillator.type = "sine";
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.15);
    } catch {}
  }, [getAudioCtx]);

  const startCamera = async () => {
  try {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    streamRef.current = stream;
    setTimeout(() => {
  const video = document.getElementById("naia-scan-video");
  if (video) {
    video.srcObject = stream;
    video.muted = true;
    video.play().catch(e => console.error("Play error:", e));
  }
}, 500);
  } catch (err) {
    console.error("Camera error:", err);
    setErrorMsg("Camera access denied. Go to Settings → Safari → Camera → Allow");
    setStep("error");
  }
};

  const stopCamera = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  };

  const capturePhoto = useCallback(() => {
  const video = document.getElementById("naia-scan-video");
  if (!video) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}, []);

  const loadPoseLandmarker = async () => {
    try {
      const { PoseLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      poseLandmarkerRef.current = landmarker;
      return true;
    } catch (err) {
      console.error("MediaPipe error:", err);
      return false;
    }
  };

  const analyzePose = (landmarks, forSide = false) => {
    if (!landmarks || landmarks.length === 0) {
      return { good: false, message: "Step back so your full body is visible" };
    }
    const lm = landmarks[0];
    const nose = lm[0];
    const leftShoulder = lm[11];
    const rightShoulder = lm[12];
    const leftAnkle = lm[27];
    const rightAnkle = lm[28];

    if (leftAnkle.visibility < 0.3 || rightAnkle.visibility < 0.3) {
      return { good: false, message: "Step back — we need to see your full body including feet" };
    }
    if (nose.visibility < 0.5) {
      return { good: false, message: "Move into frame — we can't see your face" };
    }
    const shoulderDiff = Math.abs(leftShoulder.y - rightShoulder.y);
    if (!forSide && shoulderDiff > 0.05) {
      return { good: false, message: "Level your shoulders — stand up straight" };
    }
    const centerX = (leftShoulder.x + rightShoulder.x) / 2;
    if (centerX < 0.25 || centerX > 0.75) {
      return { good: false, message: "Move to the center of the frame" };
    }
    const bodyHeight = Math.abs(nose.y - leftAnkle.y);
    if (bodyHeight > 0.85) {
      return { good: false, message: "Step back a little — you're too close" };
    }
    if (bodyHeight < 0.4) {
      return { good: false, message: "Step closer — you're too far away" };
    }
    return { good: true, message: forSide ? "Perfect — hold that pose" : "Perfect — hold still" };
  };

  const runPoseDetection = useCallback((forSide = false, sid, cid) => {
    const detect = () => {
      const landmarker = poseLandmarkerRef.current;
      const video = videoRef.current;
      if (!landmarker || !video || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(detect);
        return;
      }
      try {
        const result = landmarker.detectForVideo(video, performance.now());
        const { good, message } = analyzePose(result.landmarks, forSide);
        setPoseStatus(good ? "good" : "bad");
        setPoseMessage(message);

        if (good) {
          if (!goodPoseStartRef.current) {
            goodPoseStartRef.current = Date.now();
            playClick();
            let count = 3;
            setCountdown(count);
            countdownTimerRef.current = setInterval(() => {
              count--;
              if (count > 0) {
                setCountdown(count);
                playClick();
              } else {
                clearInterval(countdownTimerRef.current);
                setCountdown(null);
                goodPoseStartRef.current = null;
                cancelAnimationFrame(animFrameRef.current);
                setCaptureFlash(true);
                setTimeout(() => setCaptureFlash(false), 300);
                const photo = capturePhoto();
                if (!forSide) {
                  frontPhotoRef.current = photo;
                  speakSequence([
                    "Front photo taken.",
                    "Now turn 90 degrees to your right for the side photo."
                  ]);
                  setTimeout(() => setStep("mobile-side"), 2500);
                } else {
                  speakSequence([
                    "Side photo taken.",
                    "I am now building your avatar. This will take about 30 seconds."
                  ]);
                  submitPhotos(photo, sid, cid);
                }
              }
            }, 1000);
          }
        } else {
          speak(message);
          if (goodPoseStartRef.current) {
            goodPoseStartRef.current = null;
            clearInterval(countdownTimerRef.current);
            setCountdown(null);
          }
        }
      } catch {}
      animFrameRef.current = requestAnimationFrame(detect);
    };
    animFrameRef.current = requestAnimationFrame(detect);
  }, [capturePhoto, speak, speakSequence, playClick]);

  const submitPhotos = async (sidePhoto, sid, cid) => {
    setStep("processing");
    stopCamera();
    try {
      const sessionRes = await fetch("/api/body-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: cid || customerId }),
      });
      const sessionData = await sessionRes.json();
      if (sessionData.error) {
        setErrorMsg(sessionData.error);
        setStep("error");
        return;
      }
      const pollInterval = setInterval(async () => {
        const resultsRes = await fetch(
          `/api/body-scan?sessionId=${sessionData.sessionId}&customerId=${cid || customerId}`
        );
        const resultsData = await resultsRes.json();
        if (resultsData.status === "success") {
          clearInterval(pollInterval);
          setMeasurements(resultsData.measurements);
          speakSequence(["Your Naya avatar is ready!", "Here are your measurements."]);
          setStep("done");
        } else if (resultsData.status === "error") {
          clearInterval(pollInterval);
          setErrorMsg(resultsData.message);
          setStep("error");
        }
      }, 3000);
      setTimeout(() => clearInterval(pollInterval), 120000);
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
      setStep("error");
    }
  };

  const handleStartScan = async () => {
    setStep("qr");
    try {
      const sessionRes = await fetch("/api/body-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const sessionData = await sessionRes.json();
      if (sessionData.error) {
        setErrorMsg(sessionData.error);
        setStep("error");
        return;
      }

      const mobileUrl = `${window.location.origin}/onboarding/body-scan?session=${sessionData.sessionId}&customer=${customerId}`;
      const qr = await QRCode.toDataURL(mobileUrl, {
        width: 280, margin: 2,
        color: { dark: "#111111", light: "#ffffff" }
      });
      setQrCodeUrl(qr);

      pollRef.current = setInterval(async () => {
        const resultsRes = await fetch(
          `/api/body-scan?sessionId=${sessionData.sessionId}&customerId=${customerId}`
        );
        const resultsData = await resultsRes.json();
        if (resultsData.status === "success") {
          clearInterval(pollRef.current);
          setMeasurements(resultsData.measurements);
          setStep("done");
        }
      }, 3000);

      setTimeout(() => clearInterval(pollRef.current), 300000);
    } catch {
      setErrorMsg("Failed to create scan session.");
      setStep("error");
    }
  };

  // Mobile: user taps "Start scan" button — this is the direct user gesture
  const handleMobileStart = async () => {
    // Step 1: Request camera permission as direct user gesture
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach(t => t.stop());
    } catch {
      setErrorMsg("Camera access denied. Go to Settings → Safari → Camera → Allow, then try again.");
      setStep("error");
      return;
    }

    // Step 2: Start audio context as direct user gesture
    getAudioCtx();

    setStep("loading");

    // Step 3: Speak intro
    speakSequence([
      "Hi, I am Naya.",
      "I am here to guide you through your body scan.",
      "This will take about 60 seconds.",
      "Please make sure you are in a well lit room and wearing fitted clothes.",
    ]);

    // Step 4: Load MediaPipe
    await loadPoseLandmarker();

    // Step 5: Start camera properly
    await startCamera();

    setStep("mobile-scan");

    setTimeout(() => {
      speakSequence([
        "Great.",
        "Now stand straight with your full body visible.",
        "Keep your arms slightly away from your body.",
      ]);
      const urlParams = new URLSearchParams(window.location.search);
      const sid = urlParams.get("session");
      const cid = urlParams.get("customer");
      runPoseDetection(false, sid, cid);
    }, 3000);
  };

  useEffect(() => {
    if (step === "mobile-side") {
      setPoseStatus("waiting");
      setPoseMessage("Turn 90 degrees to your right");
      goodPoseStartRef.current = null;
      clearInterval(countdownTimerRef.current);
      setCountdown(null);
      startCamera().then(() => {
        setTimeout(() => {
          speakSequence([
            "Perfect.",
            "Now turn 90 degrees to your right.",
            "Keep your full body in frame.",
          ]);
          const urlParams = new URLSearchParams(window.location.search);
          const sid = urlParams.get("session");
          const cid = urlParams.get("customer");
          runPoseDetection(true, sid, cid);
        }, 2000);
      });
    }
  }, [step]);

  useEffect(() => {
    return () => {
      stopCamera();
      clearInterval(countdownTimerRef.current);
      clearInterval(pollRef.current);
      window.speechSynthesis?.cancel();
    };
  }, []);

  const borderColor = poseStatus === "good" ? "#1D9E75" : poseStatus === "bad" ? "#E24B4A" : "#444";
  const glowColor = poseStatus === "good" ? "0 0 40px #1D9E7566" : poseStatus === "bad" ? "0 0 40px #E24B4A44" : "none";

  return (
    <div style={styles.container}>

      {/* DESKTOP INTRO */}
      {step === "intro" && !isMobile && (
        <div style={styles.card}>
          <div style={styles.logo}>nAia</div>
          <h1 style={styles.title}>Your body scan</h1>
          <p style={styles.subtitle}>
            Scan the QR code with your phone to complete the body scan. Our AI will guide you with voice instructions.
          </p>
          <div style={styles.tips}>
            <Tip icon="👕" text="Wear fitted clothes" />
            <Tip icon="💡" text="Good lighting" />
            <Tip icon="📏" text="Stand 2m from camera" />
            <Tip icon="🔒" text="Photos never stored" />
          </div>
          <button style={styles.primaryBtn} onClick={handleStartScan}>
            Generate QR code
          </button>
        </div>
      )}

      {/* MOBILE INTRO — shown when user opens QR link */}
      {step === "mobile-ready" && (
        <div style={styles.card}>
          <div style={styles.logo}>nAia</div>
          <h1 style={styles.title}>Ready to scan</h1>
          <p style={styles.subtitle}>
            I'll guide you through two quick photos. Make sure you're in a well-lit room wearing fitted clothes.
          </p>
          <div style={styles.tips}>
            <Tip icon="👕" text="Wear fitted clothes" />
            <Tip icon="💡" text="Good lighting" />
            <Tip icon="📏" text="Stand 2m from camera" />
            <Tip icon="🔒" text="Photos never stored" />
          </div>
          <button style={styles.primaryBtn} onClick={handleMobileStart}>
            Start scan
          </button>
        </div>
      )}

      {/* QR CODE — shown on desktop */}
      {step === "qr" && (
        <div style={styles.card}>
          <div style={styles.logo}>nAia</div>
          <h2 style={styles.title}>Scan with your phone</h2>
          <p style={styles.subtitle}>
            Point your phone camera at this QR code to complete the body scan on your mobile.
          </p>
          {qrCodeUrl ? (
            <div style={styles.qrWrapper}>
              <img src={qrCodeUrl} alt="QR code" style={styles.qrCode} />
            </div>
          ) : (
            <div style={styles.spinner} />
          )}
          <p style={{ fontSize: 13, color: "#999", marginTop: 16 }}>
            Waiting for your phone to complete the scan...
          </p>
          <div style={styles.pulsingDot} />
        </div>
      )}

      {/* LOADING */}
      {step === "loading" && (
        <div style={styles.card}>
          <div style={styles.logo}>nAia</div>
          <div style={styles.spinner} />
          <h2 style={styles.title}>Preparing scanner...</h2>
          <p style={styles.subtitle}>Loading AI pose detection</p>
        </div>
      )}

      {/* CAMERA — mobile scan steps */}
      {(step === "mobile-scan" || step === "mobile-side") && (
        <div style={{
          ...styles.cameraContainer,
          border: `3px solid ${borderColor}`,
          boxShadow: glowColor,
        }}>
          {captureFlash && <div style={styles.flash} />}
          <div style={styles.cameraHeader}>
            <span style={styles.logoSmall}>nAia</span>
            <span style={styles.stepLabel}>
              {step === "mobile-scan" ? "Step 1 of 2 — Face forward" : "Step 2 of 2 — Side view"}
            </span>
          </div>
          <div style={styles.videoWrapper}>
            <video
  id="naia-scan-video"
  autoPlay
  playsInline
  muted
  style={styles.video}
/>
            <div style={{
              ...styles.statusBadge,
              background: poseStatus === "good" ? "#1D9E75" : poseStatus === "bad" ? "#E24B4A" : "#333",
            }}>
              <span style={styles.statusDot} />
              {poseStatus === "good" ? "✓ Perfect pose" : poseMessage}
            </div>
            <div style={styles.silhouetteOverlay}>
              <svg viewBox="0 0 200 420" style={styles.silhouette}>
                {step === "mobile-scan" ? (
                  <g opacity={poseStatus === "good" ? 0.6 : 0.2} fill={poseStatus === "good" ? "#1D9E75" : "white"} style={{ transition: "fill 0.3s, opacity 0.3s" }}>
                    <ellipse cx="100" cy="38" rx="22" ry="25" />
                    <rect x="68" y="68" width="64" height="95" rx="10" />
                    <rect x="36" y="72" width="30" height="72" rx="8" />
                    <rect x="134" y="72" width="30" height="72" rx="8" />
                    <rect x="70" y="162" width="27" height="110" rx="8" />
                    <rect x="103" y="162" width="27" height="110" rx="8" />
                  </g>
                ) : (
                  <g opacity={poseStatus === "good" ? 0.6 : 0.2} fill={poseStatus === "good" ? "#1D9E75" : "white"} style={{ transition: "fill 0.3s, opacity 0.3s" }}>
                    <ellipse cx="100" cy="38" rx="18" ry="25" />
                    <rect x="80" y="68" width="38" height="95" rx="10" />
                    <rect x="60" y="72" width="22" height="72" rx="8" />
                    <rect x="82" y="162" width="24" height="110" rx="8" />
                    <rect x="108" y="162" width="24" height="110" rx="8" />
                  </g>
                )}
              </svg>
            </div>
            {countdown !== null && (
              <div style={styles.countdown}>{countdown}</div>
            )}
            <div style={{ ...styles.poseGuide, borderColor }}>
              {step === "mobile-scan"
                ? "Face forward · Arms slightly out · Full body visible"
                : "Turn 90° right · Stand straight · Full body visible"}
            </div>
          </div>
        </div>
      )}

      {/* PROCESSING */}
      {step === "processing" && (
        <div style={styles.card}>
          <div style={styles.logo}>nAia</div>
          <div style={styles.spinner} />
          <h2 style={styles.title}>Building your avatar...</h2>
          <p style={styles.subtitle}>Analysing your body shape and extracting your measurements.</p>
          <div style={styles.processingSteps}>
            <ProcessStep text="Photos captured" done />
            <ProcessStep text="Detecting body outline" done />
            <ProcessStep text="Extracting measurements" active />
            <ProcessStep text="Generating your avatar" />
          </div>
        </div>
      )}

      {/* DONE */}
      {step === "done" && (
        <div style={styles.card}>
          <div style={styles.logo}>nAia</div>
          <div style={styles.successIcon}>✓</div>
          <h2 style={styles.title}>Your avatar is ready</h2>
          {measurements && (
            <div style={styles.measurementGrid}>
              <Measurement label="Chest" value={measurements.chestCm} />
              <Measurement label="Waist" value={measurements.waistCm} />
              <Measurement label="Hips" value={measurements.hipsCm} />
              <Measurement label="Height" value={measurements.heightCm} />
            </div>
          )}
          <button style={styles.primaryBtn} onClick={() => window.location.href = "/onboarding/style"}>
            Continue to style profile →
          </button>
        </div>
      )}

      {/* ERROR */}
      {step === "error" && (
        <div style={styles.card}>
          <div style={styles.logo}>nAia</div>
          <h2 style={styles.title}>Something went wrong</h2>
          <p style={styles.subtitle}>{errorMsg}</p>
          <button style={styles.primaryBtn} onClick={() => { setStep("intro"); setErrorMsg(null); }}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function Tip({ icon, text }) {
  return (
    <div style={styles.tip}>
      <span>{icon}</span>
      <span style={{ fontSize: 13, color: "#666" }}>{text}</span>
    </div>
  );
}

function ProcessStep({ text, done, active }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
      <div style={{
        width: 20, height: 20, borderRadius: "50%",
        background: done ? "#1D9E75" : active ? "#7F77DD" : "#e5e5e5",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, color: "#fff", flexShrink: 0,
      }}>
        {done ? "✓" : ""}
      </div>
      <span style={{ fontSize: 13, color: done ? "#111" : active ? "#7F77DD" : "#999" }}>{text}</span>
    </div>
  );
}

function Measurement({ label, value }) {
  return (
    <div style={styles.measurementCard}>
      <div style={{ fontSize: 20, fontWeight: 500 }}>
        {value}<span style={{ fontSize: 12, color: "#888" }}>cm</span>
      </div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{label}</div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh", background: "#0a0a0a",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 20, fontFamily: "system-ui, sans-serif",
  },
  card: {
    background: "#fff", borderRadius: 20, padding: "40px 32px",
    maxWidth: 420, width: "100%", textAlign: "center",
  },
  logo: { fontSize: 22, fontWeight: 600, letterSpacing: "-0.5px", marginBottom: 24, color: "#7F77DD" },
  logoSmall: { fontSize: 16, fontWeight: 600, color: "#fff", letterSpacing: "-0.5px" },
  title: { fontSize: 22, fontWeight: 600, margin: "0 0 12px", color: "#111" },
  subtitle: { fontSize: 14, color: "#666", lineHeight: 1.6, margin: "0 0 24px" },
  tips: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 },
  tip: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#f5f5f5", borderRadius: 10, fontSize: 13 },
  primaryBtn: {
    width: "100%", padding: "14px 20px", background: "#7F77DD",
    color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 500, cursor: "pointer",
  },
  qrWrapper: {
    display: "flex", justifyContent: "center", alignItems: "center",
    padding: 20, background: "#f9f9f9", borderRadius: 16, margin: "0 auto 8px",
    width: "fit-content",
  },
  qrCode: { width: 240, height: 240, borderRadius: 8 },
  pulsingDot: {
    width: 12, height: 12, borderRadius: "50%", background: "#7F77DD",
    margin: "12px auto 0",
  },
  cameraContainer: {
    width: "100%", maxWidth: 480, background: "#000",
    borderRadius: 20, overflow: "hidden", position: "relative",
    transition: "border 0.3s, box-shadow 0.3s",
  },
  cameraHeader: {
    padding: "14px 20px", display: "flex", alignItems: "center",
    justifyContent: "space-between", background: "rgba(0,0,0,0.85)",
  },
  stepLabel: { fontSize: 13, color: "#fff", opacity: 0.8 },
  videoWrapper: { position: "relative", height: "70vh", background: "#111", overflow: "hidden" },
  video: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  silhouetteOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
  },
  silhouette: { width: "42%", height: "85%" },
  statusBadge: {
    position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
    color: "#fff", fontSize: 13, fontWeight: 500, padding: "7px 18px",
    borderRadius: 20, whiteSpace: "nowrap", transition: "background 0.3s", zIndex: 2,
  },
  statusDot: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#fff", marginRight: 6 },
  countdown: {
    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
    fontSize: 120, fontWeight: 700, color: "#fff", opacity: 0.9,
    textShadow: "0 0 60px rgba(0,0,0,0.9)", zIndex: 3, pointerEvents: "none",
  },
  poseGuide: {
    position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 12,
    padding: "8px 16px", borderRadius: 20, whiteSpace: "nowrap", border: "1px solid", zIndex: 2,
  },
  flash: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    background: "#fff", opacity: 0.9, zIndex: 10, pointerEvents: "none", borderRadius: 20,
  },
  spinner: {
    width: 40, height: 40, border: "3px solid #f0f0f0",
    borderTop: "3px solid #7F77DD", borderRadius: "50%",
    margin: "0 auto 24px",
  },
  processingSteps: { textAlign: "left", marginTop: 20 },
  successIcon: {
    width: 56, height: 56, background: "#1D9E75", borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "#fff", fontSize: 24, margin: "0 auto 20px",
  },
  measurementGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "20px 0 28px" },
  measurementCard: { background: "#f5f5f5", borderRadius: 12, padding: "14px 10px", textAlign: "center" },
};