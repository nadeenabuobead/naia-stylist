import { Link } from "react-router";
import type { ReactNode } from "react";

interface SmPageProps {
  backTo?: string;
  backLabel?: string;
  children: ReactNode;
  wide?: boolean;
  step?: number;
  totalSteps?: number;
}

export function SmPage({ backTo, backLabel = "← Back", children, wide, step, totalSteps = 5 }: SmPageProps) {
  const hasStep = step != null;
  return (
    <div className={`sm-page${hasStep ? " sm-page--qs" : ""}`}>
      {hasStep && (
        <>
          <div className="sm-topbar">
            <span className="sm-topbar-wordmark">nAia</span>
            <Link to="/style-me" className="sm-topbar-exit">Exit</Link>
          </div>
          <div className="sm-progress">
            <div className="sm-progress-dots">
              {Array.from({ length: totalSteps }, (_, i) => {
                const n = i + 1;
                const cls =
                  n < step ? " sm-progress-dot--done"
                  : n === step ? " sm-progress-dot--active"
                  : "";
                return <div key={n} className={`sm-progress-dot${cls}`} />;
              })}
            </div>
            <div className="sm-progress-label">Step {step} of {totalSteps}</div>
          </div>
        </>
      )}
      <div className={wide ? "sm-inner sm-inner--wide" : "sm-inner"}>
        {!hasStep && backTo && <Link to={backTo} className="sm-back">{backLabel}</Link>}
        {children}
      </div>
    </div>
  );
}
