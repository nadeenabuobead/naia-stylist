interface Props {
  show: boolean;
  message?: string;
}

export default function DevFixtureNotice({
  show,
  message = "Development build — no real customer data is shown",
}: Props) {
  if (!show) return null;
  return (
    <div className="mn-fixture-notice" role="status" aria-live="polite">
      {message}
    </div>
  );
}
