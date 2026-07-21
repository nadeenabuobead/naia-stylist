interface Props {
  heading: string;
  body: string;
  action?: React.ReactNode;
}

export default function MyNaiaEmptyState({ heading, body, action }: Props) {
  return (
    <div className="mn-empty">
      <p className="mn-empty-heading">{heading}</p>
      <p className="mn-empty-body">{body}</p>
      {action}
    </div>
  );
}
