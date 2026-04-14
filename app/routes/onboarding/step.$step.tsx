// app/routes/onboarding/step.$step.tsx
import { useState, useEffect } from "react";
import { Form, Link, useLoaderData, useNavigate, useParams } from "@remix-run/react";
import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { getSession, commitSession } from "~/lib/session.server";
import {
  getQuestionByStep,
  getTotalSteps,
  type OnboardingAnswers,
} from "~/lib/onboarding/quiz-data";
import {
  QuestionWrapper,
  SingleSelect,
  MultiSelect,
  OpenText,
  ColorPicker,
} from "~/components/onboarding/QuizQuestion";
import { StepProgress } from "~/components/ui/Progress";

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

  // Get existing answers from session
  const session = await getSession(request.headers.get("Cookie"));
  const answers = (session.get("onboardingAnswers") || {}) as OnboardingAnswers;

  return json({
    step,
    totalSteps,
    question,
    previousAnswer: answers[question.id as keyof OnboardingAnswers],
  });
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

  // Get session and existing answers
  const session = await getSession(request.headers.get("Cookie"));
  const answers = (session.get("onboardingAnswers") || {}) as OnboardingAnswers;

  // Save answer based on question type
  if (answer) {
    if (question.type === "multi" || question.type === "color") {
      answers[question.id as keyof OnboardingAnswers] = answer.split(",").filter(Boolean) as any;
    } else {
      answers[question.id as keyof OnboardingAnswers] = answer as any;
    }
  }

  session.set("onboardingAnswers", answers);

  // Determine next step
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
  const navigate = useNavigate();

  // Initialize state based on question type
  const [singleValue, setSingleValue] = useState<string | null>(
    typeof previousAnswer === "string" ? previousAnswer : null
  );
  const [multiValue, setMultiValue] = useState<string[]>(
    Array.isArray(previousAnswer) ? previousAnswer : []
  );
  const [textValue, setTextValue] = useState<string>(
    typeof previousAnswer === "string" ? previousAnswer : ""
  );

  // Reset state when question changes
  useEffect(() => {
    if (typeof previousAnswer === "string") {
      setSingleValue(previousAnswer);
      setTextValue(previousAnswer);
    } else if (Array.isArray(previousAnswer)) {
      setMultiValue(previousAnswer);
    } else {
      setSingleValue(null);
      setMultiValue([]);
      setTextValue("");
    }
  }, [question.id, previousAnswer]);

  // Get current answer value for form
  const getCurrentAnswer = (): string => {
    switch (question.type) {
      case "single":
        return singleValue || "";
      case "multi":
      case "color":
        return multiValue.join(",");
      case "text":
        return textValue;
      default:
        return "";
    }
  };

  // Check if can proceed
  const canProceed = (): boolean => {
    switch (question.type) {
      case "single":
        return !!singleValue;
      case "multi":
      case "color":
        return multiValue.length > 0;
      case "text":
        return true; // Text is optional
      default:
        return true;
    }
  };

  return (
    <div className="min-h-screen bg-[var(--naia-cream)]">
      {/* Header */}
      <header className="px-4 py-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <StepProgress currentStep={step} totalSteps={totalSteps} />
          <div className="flex items-center justify-between mt-4">
            {step > 1 ? (
              <Form method="post">
                <input type="hidden" name="answer" value={getCurrentAnswer()} />
                <input type="hidden" name="direction" value="back" />
                <button
                  type="submit"
                  className="text-[var(--naia-text-muted)] text-sm"
                >
                  ← Back
                </button>
              </Form>
            ) : (
              <Link to="/" className="text-[var(--naia-text-muted)] text-sm">
                ← Exit
              </Link>
            )}
            <span className="text-sm text-[var(--naia-text-muted)]">
              {step} of {totalSteps}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="px-4 py-8 max-w-lg mx-auto">
        <Form method="post" className="space-y-8">
          <input type="hidden" name="answer" value={getCurrentAnswer()} />

          <QuestionWrapper title={question.title} subtitle={question.subtitle}>
            {/* Single Select */}
            {question.type === "single" && question.options && (
              <SingleSelect
                options={question.options}
                value={singleValue}
                onChange={setSingleValue}
              />
            )}

            {/* Multi Select */}
            {question.type === "multi" && question.options && (
              <MultiSelect
                options={question.options}
                value={multiValue}
                onChange={setMultiValue}
                maxSelections={question.maxSelections}
              />
            )}

            {/* Color Picker */}
            {question.type === "color" && question.colors && (
              <ColorPicker
                colors={question.colors}
                value={multiValue}
                onChange={setMultiValue}
                maxSelections={question.maxSelections}
              />
            )}

            {/* Open Text */}
            {question.type === "text" && (
              <OpenText
                value={textValue}
                onChange={setTextValue}
                placeholder={question.placeholder}
                maxLength={question.maxLength}
              />
            )}
          </QuestionWrapper>

          {/* Continue Button */}
          <button
            type="submit"
            disabled={!canProceed()}
            className={`
              w-full py-4 px-6 rounded-full font-medium text-center
              transition-all duration-200
              ${canProceed()
                ? "bg-[var(--naia-rose)] text-white hover:bg-[var(--naia-rose-dark)] shadow-lg"
                : "bg-[var(--naia-gray-200)] text-[var(--naia-text-muted)] cursor-not-allowed"
              }
            `}
          >
            {step === totalSteps ? "Complete ✨" : "Continue →"}
          </button>

          {/* Skip option for optional questions */}
          {question.type === "text" && (
            <button
              type="submit"
              className="w-full text-center text-sm text-[var(--naia-text-muted)] hover:text-[var(--naia-charcoal)]"
            >
              Skip for now
            </button>
          )}
        </Form>
      </main>
    </div>
  );
}
