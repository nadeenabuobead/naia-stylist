interface Props {
  eyebrow?: string;
  heading: string;
  body?: string;
}

export default function MyNaiaPageIntro({ eyebrow, heading, body }: Props) {
  return (
    <div className="mn-page-intro">
      {eyebrow && <p className="mn-page-intro-eyebrow">{eyebrow}</p>}
      <h1 className="mn-page-intro-heading">{heading}</h1>
      {body && <p className="mn-page-intro-body">{body}</p>}
    </div>
  );
}
