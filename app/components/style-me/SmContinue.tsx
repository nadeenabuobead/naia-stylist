interface SmContinueProps {
  disabled?: boolean;
  children?: string;
}

export function SmContinue({ disabled, children = "Continue" }: SmContinueProps) {
  return (
    <button type="submit" disabled={disabled} className="sm-continue">
      {children}
    </button>
  );
}
