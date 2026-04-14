// app/components/ui/Button.tsx
import { forwardRef } from "react";
import { Link } from "@remix-run/react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "gold" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

interface LinkButtonProps extends Omit<ButtonProps, "onClick"> {
  to: string;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-[var(--naia-rose)] text-white
    hover:bg-[var(--naia-rose-dark)]
    active:bg-[var(--naia-rose-dark)]
    shadow-sm hover:shadow-md
  `,
  secondary: `
    bg-white text-[var(--naia-charcoal)]
    border border-[var(--naia-gray-200)]
    hover:bg-[var(--naia-gray-50)]
    hover:border-[var(--naia-gray-300)]
  `,
  ghost: `
    bg-transparent text-[var(--naia-charcoal)]
    hover:bg-[var(--naia-gray-100)]
  `,
  gold: `
    bg-[var(--naia-gold)] text-white
    hover:bg-[var(--naia-gold-dark)]
    shadow-sm hover:shadow-md
  `,
  danger: `
    bg-red-500 text-white
    hover:bg-red-600
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm rounded-lg",
  md: "px-4 py-2.5 text-base rounded-xl",
  lg: "px-6 py-3.5 text-lg rounded-2xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className = "",
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`
          inline-flex items-center justify-center gap-2
          font-medium transition-all duration-200
          disabled:opacity-50 disabled:cursor-not-allowed
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${fullWidth ? "w-full" : ""}
          ${className}
        `}
        {...props}
      >
        {isLoading ? (
          <span className="animate-spin">⟳</span>
        ) : (
          <>
            {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  leftIcon,
  rightIcon,
  fullWidth = false,
  className = "",
  children,
}: LinkButtonProps) {
  return (
    <Link
      to={to}
      className={`
        inline-flex items-center justify-center gap-2
        font-medium transition-all duration-200
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${fullWidth ? "w-full" : ""}
        ${className}
      `}
    >
      {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
    </Link>
  );
}
