import { useState, useEffect } from "react";
import { Form, Link, useLoaderData } from "react-router";
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
  if (isNaN(step) || step < 1 || step > totalSteps) return redirect("/onboarding/step/1");
  const question = getQuestionByStep(step);
  if (!question) return redirect("/onboarding/step/1");
  const session = await getSession(request.headers.get("Cookie"));
  const answers = (session.get("onboardingAnswers") || {}) as OnboardingAnswers;
  return { step, totalSteps, question, previousAnswer: answers[question.id as keyof OnboardingAnswers] };
}

export async function action({ params, request }: ActionFunctionArgs) {
  const step = parseInt(params.step || "1", 10);
  const totalSteps = getTotalSteps();
  const question = getQuestionByStep(step);
  if (!question) return redirect("/onboarding/step/1");
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
  if (direction === "back" && step > 1) nextUrl = `/onboarding/step/${step - 1}`;
  else if (step >= totalSteps) nextUrl = "/onboarding/complete";
  else nextUrl = `/onboarding/step/${step + 1}`;
  return redirect(nextUrl, { headers: { "Set-Cookie": await commitSession(session) } });
}

const css = `
  :root{--cream:#f4f4f1;--warm:#e1dbd7;--burg:#3b0510;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .ob-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .ob-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .ob-topbar-close{font-family:var(--ff-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);text-decoration:none;background:none;border:none;cursor:pointer}
  .ob-progress{padding:24px 40px 0;max-width:700px;margin:0 auto}
  .ob-progress-dots{display:flex;gap:8px;justify-content:center;margin-bottom:8px}
  .ob-progress-dot{width:10px;height:10px;border-radius:50%;background:var(--warm);transition:all .4s}
  .ob-progress-dot.active{width:28px;border-radius:14px;background:var(--deep)}
  .ob-progress-dot.done{background:var(--accent)}
  .ob-progress-label{text-align:center;font-family:var(--ff-mono);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}
  .ob-main{max-width:700px;margin:0 auto;padding:48px 40px 80px}
  .ob-step-label{font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--accent);margin-bottom:12px}
  .ob-headline{font-family:var(--ff-display);font-size:clamp(28px,4vw,42px);font-weight:900;font-style:italic;color:var(--deep);letter-spacing:-1px;margin-bottom:8px;line-height:1.1}
  .ob-subtitle{font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:32px}
  .ob-pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}
  .ob-pill{padding:12px 22px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;transition:all .3s;background:transparent}
  .ob-pill:hover{border-color:var(--deep)}
  .ob-pill.selected{background:var(--deep);color:var(--cream)}
  .ob-pill:disabled{opacity:.35;cursor:not-allowed}
  .ob-color-grid{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}
  .ob-color-swatch{padding:12px 16px;border:1px solid rgba(59,5,16,.12);font-family:var(--ff-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--deep);cursor:pointer;transition:all .3s;background:transparent;display:flex;align-items:center;gap:10px}
  .ob-color-swatch:hover{border-color:var(--deep)}
  .ob-color-swatch.selected{background:var(--deep);color:var(--cream)}
  .ob-color-dot{width:20px;height:20px;border:1px solid rgba(0,0,0,0.15);flex-shrink:0}
  .ob-textarea{width:100%;min-height:150px;padding:20px;border:1px solid rgba(59,5,16,.12);font-size:18px;font-family:var(--ff-body);font-style:italic;background:transparent;resize:vertical;color:var(--deep);outline:none}
  .ob-textarea:focus{border-color:var(--deep)}
  .ob-charcount{font-family:var(--ff-mono);font-size:9px;color:var(--muted);text-align:right;margin-top:6px;margin-bottom:32px}
  .ob-buttons{display:flex;gap:12px;margin-top:16px}
  .ob-btn-continue{padding:14px 40px;border:none;background:var(--deep);font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--cream);cursor:pointer}
  .ob-btn-continue:disabled{opacity:.3;cursor:not-allowed}
  .ob-btn-skip{padding:14px 32px;border:1px solid rgba(59,5,16,.1);background:transparent;font-family:var(--ff-mono);font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--deep);cursor:pointer}
`;

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
    typeof previousAnswer === "number" ? previousAnswer : 5
  );

  useEffect(() => {
    if (typeof previousAnswer === "string") { setSingleValue(previousAnswer); setTextValue(previousAnswer); }
    else if (Array.isArray(previousAnswer)) setMultiValue(previousAnswer);
    else if (typeof previousAnswer === "number") setScaleValue(previousAnswer);
    else { setSingleValue(null); setMultiValue([]); setTextValue(""); setScaleValue(5); }
  }, [question.id, previousAnswer]);

  const getCurrentAnswer = (): string => {
    if (question.type === "single") return singleValue || "";
    if (question.type === "multi" || question.type === "color") return multiValue.join(",");
    if (question.type === "text") return textValue;
    if (question.type === "scale") return scaleValue.toString();
    return "";
  };

  const canProceed = (): boolean => {
    if (question.type === "single") return !!singleValue;
    if (question.type === "multi" || question.type === "color") return multiValue.length > 0;
    return true;
  };

  const toggleMulti = (id: string) => {
    setMultiValue(prev => {
      if (prev.includes(id)) return prev.filter(v => v !== id);
      if (!question.maxSelections || prev.length < question.maxSelections) return [...prev, id];
      return prev;
    });
  };

  const totalDots = Math.min(totalSteps, 10);

  return (
    <div>
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      <div className="ob-topbar">
        <div className="ob-topbar-logo">nAia</div>
        <Link to="/" className="ob-topbar-close">Exit Session</Link>
      </div>

      <div className="ob-progress">
        <div className="ob-progress-dots">
          {Array.from({ length: totalDots }).map((_, i) => {
            const n = i + 1;
            return (
              <div key={n} className={`ob-progress-dot${n < step ? " done" : ""}${n === step ? " active" : ""}`} />
            );
          })}
        </div>
        <div className="ob-progress-label">Step {step} of {totalSteps}</div>
      </div>

      <main className="ob-main">
        <Form method="post">
          <input type="hidden" name="answer" value={getCurrentAnswer()} />

          <div className="ob-step-label">Step {step} of {totalSteps}</div>
          <h2 className="ob-headline">{question.title}</h2>
          {question.subtitle && (
            <p className="ob-subtitle">{question.subtitle}</p>
          )}

          {question.type === "single" && question.options && (
            <div className="ob-pills">
              {question.options.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSingleValue(opt.id)}
                  className={`ob-pill${singleValue === opt.id ? " selected" : ""}`}
                >
                  {opt.emoji && <span style={{ marginRight: "6px" }}>{opt.emoji}</span>}
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {question.type === "multi" && question.options && (
            <div className="ob-pills">
              {question.options.map(opt => {
                const isSelected = multiValue.includes(opt.id);
                const isDisabled = !isSelected && !!question.maxSelections && multiValue.length >= question.maxSelections;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleMulti(opt.id)}
                    disabled={isDisabled}
                    className={`ob-pill${isSelected ? " selected" : ""}`}
                  >
                    {opt.emoji && <span style={{ marginRight: "6px" }}>{opt.emoji}</span>}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}

          {question.type === "color" && question.colors && (
            <div className="ob-color-grid">
              {question.colors.map(color => {
                const isSelected = multiValue.includes(color.id);
                const isDisabled = !isSelected && !!question.maxSelections && multiValue.length >= question.maxSelections;
                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => toggleMulti(color.id)}
                    disabled={isDisabled}
                    className={`ob-color-swatch${isSelected ? " selected" : ""}`}
                  >
                    <span className="ob-color-dot" style={{ background: color.hex }} />
                    {color.name}
                  </button>
                );
              })}
            </div>
          )}

          {question.type === "text" && (
            <>
              <textarea
                className="ob-textarea"
                value={textValue}
                onChange={e => setTextValue(e.target.value)}
                placeholder={question.placeholder}
                maxLength={question.maxLength}
              />
              {question.maxLength && (
                <div className="ob-charcount">{textValue.length} / {question.maxLength}</div>
              )}
            </>
          )}

          <div className="ob-buttons">
            {step > 1 && (
              <button type="submit" name="direction" value="back" className="ob-btn-skip">
                Back
              </button>
            )}
            <button type="submit" disabled={!canProceed()} className="ob-btn-continue">
              {step === totalSteps ? "Complete" : "Continue"}
            </button>
            {question.type === "text" && (
              <button type="submit" className="ob-btn-skip">Skip</button>
            )}
          </div>
        </Form>
      </main>
    </div>
  );
}
