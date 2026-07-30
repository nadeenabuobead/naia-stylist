interface Props {
  label?: string;
  heading: string;
}

export default function MyNaiaSectionHeader({ label, heading }: Props) {
  return (
    <div className="mn-section-header">
      {label && <p className="mn-section-eyebrow">{label}</p>}
      <h2 className="mn-section-heading">{heading}</h2>
    </div>
  );
}
