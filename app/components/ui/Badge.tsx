// app/components/ui/Badge.tsx
type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "neutral";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-[var(--naia-rose)]/10 text-[var(--naia-rose)]",
  success: "bg-green-100 text-green-700",
  warning: "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-700",
  neutral: "bg-[var(--naia-gray-100)] text-[var(--naia-text-muted)]",
};

export function Badge({
  variant = "default",
  children,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2.5 py-0.5
        text-xs font-medium rounded-full
        ${variantStyles[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}

// Tag Component (for style tags, closet tags, etc.)
interface TagProps {
  children: React.ReactNode;
  onRemove?: () => void;
  size?: "sm" | "md";
  className?: string;
}

export function Tag({
  children,
  onRemove,
  size = "md",
  className = "",
}: TagProps) {
  const sizeStyles = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1
        bg-[var(--naia-gray-100)] text-[var(--naia-charcoal)]
        rounded-full font-medium
        ${sizeStyles[size]}
        ${className}
      `}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 hover:text-red-500 transition-colors"
        >
          ×
        </button>
      )}
    </span>
  );
}

// Color Dot (for showing colors in closet items)
interface ColorDotProps {
  color: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function ColorDot({ color, size = "md", className = "" }: ColorDotProps) {
  const sizeStyles = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-6 h-6",
  };

  return (
    <span
      className={`
        inline-block rounded-full
        border border-[var(--naia-gray-200)]
        ${sizeStyles[size]}
        ${className}
      `}
      style={{ backgroundColor: color }}
      title={color}
    />
  );
}
