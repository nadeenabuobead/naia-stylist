type Variant = "ok" | "pending" | "unavail" | "external";

const CLASS: Record<Variant, string> = {
  ok:       "mn-status mn-status--ok",
  pending:  "mn-status mn-status--pending",
  unavail:  "mn-status mn-status--unavail",
  external: "mn-status mn-status--external",
};

interface Props {
  variant: Variant;
  label: string;
}

export default function MyNaiaStatus({ variant, label }: Props) {
  return <span className={CLASS[variant]}>{label}</span>;
}
