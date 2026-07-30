interface Props {
  heading?: string;
  body?: string;
}

export default function MyNaiaUnavailableState({
  heading = "Coming soon",
  body    = "This section is not yet available.",
}: Props) {
  return (
    <div className="mn-unavailable">
      <p className="mn-unavailable-heading">{heading}</p>
      <p className="mn-unavailable-body">{body}</p>
    </div>
  );
}
