import { useState, useEffect } from "react";
import { Form, Link, useLoaderData, useParams } from "react-router";
import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { getSession, commitSession } from "~/lib/session.server";
import {
  getQuestionByStep,
  getTotalSteps,
  type OnboardingAnswers,
} from "~/lib/onboarding/quiz-data";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const step = parseInt(params.step || "1", 10);
  const totalSteps = getTotalSteps();

  if (isNaN(step) || step < 1 || step > totalSteps) {
    return redirect("/onboarding/step/1");
  }

  const question = getQuestionByStep(step);
  if (!question) {
    return redirect("/onboarding/step/1");
  }

  const session = await getSession(request.headers.get("Cookie"));
  const answers = (session.get("onboardingAnswers") || {}) as OnboardingAnswers;

  return {
    step,
    totalSteps,
    question,
    previousAnswer: answers[question.id as keyof OnboardingAnswers],
  };
}

export async function action({ params, request }: ActionFunctionArgs) {
  const step = parseInt(params.step || "1", 10);
  const totalSteps = getTotalSteps();
  const question = getQuestionByStep(step);

  if (!question) {
    return redirect("/onboarding/step/1");
  }

  const formData = await request.formData();
  const answer = formData.get("answer") as string;
  const direction = formData.get("direction") as string;

  const session = await getSession(request.headers.get("Cookie"));
  const answers = (session.get("onboardingAnswers") || {}) as OnboardingAnswers;

  if (answer) {
    if (question.type === "multi" || question.type === "color") {
      answers[question.id as keyof OnboardingAnswers] = answer.split(",").filter(Boolean) as any;
    } else if (question.type === "scale") {
      answers[question.id as keyof OnboardingAnswers] = parseInt(answer) as any;
    } else {
      answers[question.id as keyof OnboardingAnswers] = answer as any;
    }
  }

  session.set("onboardingAnswers", answers);

  let nextUrl: string;
  if (direction === "back" && step > 1) {
    nextUrl = `/onboarding/step/${step - 1}`;
  } else if (step >= totalSteps) {
    nextUrl = "/onboarding/complete";
  } else {
    nextUrl = `/onboarding/step/${step + 1}`;
  }

  return redirect(nextUrl, {
    headers: {
      "Set-Cookie": await commitSession(session),
    },
  });
}

export default function OnboardingStep() {
  const { step, totalSteps, question, previousAnswer } = useLoaderData<typeof loader>();

  const [singleValue, setSingleValue] = useState<string | null>(
    typeof previousAnswer === "string" ? previousAnswer : null
  );
  const [multiValue, setMultiValue] = useState<string[]>(
    Array.isArray(previousAnswer) ? previousAnswer : []
  );
  const [textValue, setTextValue] = useState<string>(
    typeof previousAnswer === "string" ? previousAnswer : ""
  );
  const [scaleValue, setScaleValue] = useState<number>(
    typeof previousAnswer === "number" ? previousAnswer : question.min || 5
  );

  useEffect(() => {
    if (typeof previousAnswer === "string") {
      setSingleValue(previousAnswer);
      setTextValue(previousAnswer);
    } else if (Array.isArray(previousAnswer)) {
      setMultiValue(previousAnswer);
    } else if (typeof previousAnswer === "number") {
      setScaleValue(previousAnswer);
    } else {
      setSingleValue(null);
      setMultiValue([]);
      setTextValue("");
      setScaleValue(question.min || 5);
    }
  }, [question.id, previousAnswer]);

  const getCurrentAnswer = (): string => {
    switch (question.type) {
      case "single":
        return singleValue || "";
      case "multi":
      case "color":
        return multiValue.join(",");
      case "text":
        return textValue;
      case "scale":
        return scaleValue.toString();
      default:
        return "";
    }
  };

  const canProceed = (): boolean => {
    switch (question.type) {
      case "single":
        return !!singleValue;
      case "multi":
      case "color":
        return multiValue.length > 0;
      case "text":
        return true;
      case "scale":
        return true;
      default:
        return true;
    }
  };

  const toggleMulti = (id: string) => {
    setMultiValue(prev => {
      if (prev.includes(id)) {
        return prev.filter(v => v !== id);
      } else if (!question.maxSelections || prev.length < question.maxSelections) {
        return [...prev, id];
      }
      return prev;
    });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      
      {/* Progress Bar */}
      <div style={{ background: "rgba(255,255,255,0.8)", padding: "24px 40px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            {step > 1 ? (
              <Form method="post" style={{ margin: 0 }}>
                <input type="hidden" name="answer" value={getCurrentAnswer()} />
                <input type="hidden" name="direction" value="back" />
                <button type="submit" style={{ background: "none", border: "none", fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#8b2035", cursor: "pointer" }}>
                  ← BACK
                </button>
              </Form>
            ) : (
              <Link to="/" style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", textDecoration: "none" }}>
                ← EXIT
              </Link>
            )}
            <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a" }}>
              STEP {step} OF {totalSteps}
            </span>
          </div>
          <div style={{ height: "4px", background: "rgba(59,5,16,0.1)", borderRadius: "2px", overflow: "hidden" }}>
            <div style={{ height: "100%", background: "#8b2035", width: `${(step / totalSteps) * 100}%`, transition: "width 0.3s" }} />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main style={{ maxWidth: "800px", margin: "0 auto", padding: "60px 40px" }}>
        <Form method="post">
          <input type="hidden" name="answer" value={getCurrentAnswer()} />

          {/* Question */}
          <div style={{ marginBottom: "40px" }}>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(32px,5vw,48px)", fontWeight: 900, lineHeight: 1.2, marginBottom: "12px", color: "#221516" }}>
              {question.title}
            </h1>
            {question.subtitle && (
              <p style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontStyle: "italic", color: "#7a6f6a" }}>
                {question.subtitle}
              </p>
            )}
          </div>

          {/* Single Select */}
          {question.type === "single" && question.options && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px", marginBottom: "40px" }}>
              {question.options.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSingleValue(opt.id)}
                  style={{
                    padding: "20px",
                    background: singleValue === opt.id ? "rgba(139,32,53,0.08)" : "rgba(255,255,255,0.7)",
                    border: singleValue === opt.id ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.1)",
                    cursor: "pointer",
                    fontFamily: "'Cormorant Garamond',serif",
                    fontSize: "18px",
                    color: "#221516",
                    transition: "all 0.2s",
                    textAlign: "left"
                  }}
                >
                  {opt.emoji && <span style={{ marginRight: "8px" }}>{opt.emoji}</span>}
                  {opt.label}
                  {opt.description && (
                    <div style={{ fontSize: "14px", color: "#7a6f6a", fontStyle: "italic", marginTop: "4px" }}>
                      {opt.description}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Multi Select */}
          {question.type === "multi" && question.options && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px", marginBottom: "40px" }}>
              {question.options.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggleMulti(opt.id)}
                  disabled={!multiValue.includes(opt.id) && question.maxSelections && multiValue.length >= question.maxSelections}
                  style={{
                    padding: "20px",
                    background: multiValue.includes(opt.id) ? "rgba(139,32,53,0.08)" : "rgba(255,255,255,0.7)",
                    border: multiValue.includes(opt.id) ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.1)",
                    cursor: "pointer",
                    fontFamily: "'Cormorant Garamond',serif",
                    fontSize: "18px",
                    color: "#221516",
                    transition: "all 0.2s",
                    textAlign: "left",
                    opacity: (!multiValue.includes(opt.id) && question.maxSelections && multiValue.length >= question.maxSelections) ? 0.5 : 1
                  }}
                >
                  {opt.emoji && <span style={{ marginRight: "8px" }}>{opt.emoji}</span>}
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Color Picker */}
          {question.type === "color" && question.colors && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "16px", marginBottom: "40px" }}>
              {question.colors.map(color => (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => toggleMulti(color.id)}
                  disabled={!multiValue.includes(color.id) && question.maxSelections && multiValue.length >= question.maxSelections}
                  style={{
                    padding: "16px",
                    background: "rgba(255,255,255,0.7)",
                    border: multiValue.includes(color.id) ? "2px solid #8b2035" : "1px solid rgba(59,5,16,0.1)",
                    cursor: "pointer",
                    textAlign: "center",
                    transition: "all 0.2s",
                    opacity: (!multiValue.includes(color.id) && question.maxSelections && multiValue.length >= question.maxSelections) ? 0.5 : 1
                  }}
                >
                  <div style={{ width: "100%", height: "60px", background: color.hex, border: "1px solid rgba(0,0,0,0.1)", marginBottom: "12px" }} />
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", color: "#221516" }}>
                    {color.name}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Text Input */}
          {question.type === "text" && (
            <div style={{ marginBottom: "40px" }}>
              <textarea
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                placeholder={question.placeholder}
                maxLength={question.maxLength}
                style={{
                  width: "100%",
                  minHeight: "150px",
                  padding: "20px",
                  border: "1px solid rgba(59,5,16,0.1)",
                  fontSize: "18px",
                  fontFamily: "'Cormorant Garamond',serif",
                  fontStyle: "italic",
                  boxSizing: "border-box",
                  background: "rgba(255,255,255,0.7)",
                  resize: "vertical"
                }}
              />
              {question.maxLength && (
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", color: "#7a6f6a", marginTop: "8px", textAlign: "right" }}>
                  {textValue.length} / {question.maxLength}
                </div>
              )}
            </div>
          )}

          {/* Continue Button */}
          <button
            type="submit"
            disabled={!canProceed()}
            style={{
              width: "100%",
              padding: "20px",
              background: canProceed() ? "#8b2035" : "#d4cfc9",
              color: "#f4f4f1",
              border: "none",
              fontSize: "14px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              cursor: canProceed() ? "pointer" : "default",
              fontFamily: "'Space Mono',monospace",
              transition: "all 0.2s"
            }}
          >
            {step === totalSteps ? "COMPLETE ✨" : "CONTINUE →"}
          </button>

          {/* Skip for text */}
          {question.type === "text" && (
            <button
              type="submit"
              style={{
                width: "100%",
                marginTop: "16px",
                padding: "16px",
                background: "none",
                border: "none",
                fontFamily: "'Cormorant Garamond',serif",
                fontSize: "16px",
                fontStyle: "italic",
                color: "#7a6f6a",
                cursor: "pointer"
              }}
            >
              Skip for now
            </button>
          )}
        </Form>
      </main>
    </div>
  );
}
