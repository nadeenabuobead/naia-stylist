interface Props {
  children: React.ReactNode;
  bordered?: boolean;
}

export default function MyNaiaSection({ children, bordered }: Props) {
  return (
    <section className={`mn-section${bordered ? " mn-section--bordered" : ""}`}>
      {children}
    </section>
  );
}
