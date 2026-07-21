import { Link } from "react-router";
import MyNaiaStatus from "./MyNaiaStatus";

type StatusVariant = "ok" | "pending" | "unavail" | "external" | "inactive";

interface Props {
  label: string;
  description: string;
  to?: string;
  href?: string;
  status?: StatusVariant;
  statusLabel?: string;
}

const STATUS_LABELS: Record<StatusVariant, string> = {
  ok:       "ready",
  pending:  "in progress",
  unavail:  "soon",
  external: "opens in shopify",
  inactive: "soon",
};

export default function MyNaiaAction({
  label,
  description,
  to,
  href,
  status,
  statusLabel,
}: Props) {
  const isInactive = status === "inactive" || (!to && !href);
  const chipLabel  = statusLabel ?? (status ? STATUS_LABELS[status] : undefined);
  const chipVariant = status === "external" ? "external"
    : status === "ok"      ? "ok"
    : status === "pending" ? "pending"
    : "unavail";

  const inner = (
    <>
      <div className="mn-action-body">
        <p className="mn-action-label">{label}</p>
        <p className="mn-action-desc">{description}</p>
      </div>
      <div className="mn-action-end">
        {chipLabel && <MyNaiaStatus variant={chipVariant} label={chipLabel} />}
        {(to || href) && <span className="mn-action-arrow" aria-hidden="true">→</span>}
      </div>
    </>
  );

  if (isInactive) {
    return (
      <div className="mn-action mn-action--inactive" aria-disabled="true">
        {inner}
      </div>
    );
  }

  if (href) {
    return (
      <a
        className="mn-action"
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={`${label} — opens in a new tab`}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link className="mn-action" to={to!}>
      {inner}
    </Link>
  );
}
