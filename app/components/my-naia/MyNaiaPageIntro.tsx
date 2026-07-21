import { Link } from "react-router";

interface Props {
  eyebrow?: string;
  heading: string;
  body?: string;
  backTo?: string;
  backLabel?: string;
}

export default function MyNaiaPageIntro({
  eyebrow,
  heading,
  body,
  backTo,
  backLabel = "Back to Overview",
}: Props) {
  return (
    <div className="mn-page-intro">
      {backTo && (
        <>
          <Link to={backTo} className="mn-back-to-overview">
            ← {backLabel}
          </Link>
          <hr className="mn-page-divider" />
        </>
      )}
      {eyebrow && <p className="mn-page-intro-eyebrow">{eyebrow}</p>}
      <h1 className="mn-page-intro-heading">{heading}</h1>
      {body && <p className="mn-page-intro-body">{body}</p>}
    </div>
  );
}
