import { Link } from "react-router";
import type { ReactNode } from "react";

interface SmPageProps {
  backTo: string;
  backLabel?: string;
  children: ReactNode;
  wide?: boolean;
}

export function SmPage({ backTo, backLabel = "← Back", children, wide }: SmPageProps) {
  return (
    <div className="sm-page">
      <div className={wide ? "sm-inner sm-inner--wide" : "sm-inner"}>
        <Link to={backTo} className="sm-back">{backLabel}</Link>
        {children}
      </div>
    </div>
  );
}
