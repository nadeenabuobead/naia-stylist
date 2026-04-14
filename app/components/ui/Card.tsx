// app/components/ui/Card.tsx
import { forwardRef } from "react";

type CardVariant = "default" | "elevated" | "interactive" | "glass";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: "none" | "sm" | "md" | "lg";
}

const variantStyles: Record<CardVariant, string> = {
  default: "bg-white border border-[var(--naia-gray-100)]",
  elevated: "bg-white shadow-lg",
  interactive: `
    bg-white border border-[var(--naia-gray-100)]
    hover:shadow-md hover:border-[var(--naia-gray-200)]
    transition-all duration-200 cursor-pointer
  `,
  glass: "bg-white/80 backdrop-blur-sm border border-white/20",
};

const paddingStyles = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    { variant = "default", padding = "md", className = "", children, ...props },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={`
          rounded-2xl
          ${variantStyles[variant]}
          ${paddingStyles[padding]}
          ${className}
        `}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

// Card Header
interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className = "",
  children,
  ...props
}: CardHeaderProps) {
  return (
    <div
      className={`flex items-start justify-between gap-4 ${className}`}
      {...props}
    >
      <div>
        {title && (
          <h3 className="font-display text-lg font-medium text-[var(--naia-charcoal)]">
            {title}
          </h3>
        )}
        {subtitle && (
          <p className="text-sm text-[var(--naia-text-muted)] mt-0.5">
            {subtitle}
          </p>
        )}
        {children}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

// Card Body
export function CardBody({
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`mt-4 ${className}`} {...props}>
      {children}
    </div>
  );
}

// Card Footer
export function CardFooter({
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`mt-4 pt-4 border-t border-[var(--naia-gray-100)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
