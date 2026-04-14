// app/components/ui/Progress.tsx

// Progress Bar
interface ProgressBarProps {
  value: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  size = "md",
  showLabel = false,
  className = "",
}: ProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  const sizeStyles = {
    sm: "h-1",
    md: "h-2",
    lg: "h-3",
  };

  return (
    <div className={className}>
      <div
        className={`
          w-full bg-[var(--naia-gray-100)] rounded-full overflow-hidden
          ${sizeStyles[size]}
        `}
      >
        <div
          className="h-full bg-gradient-to-r from-[var(--naia-rose)] to-[var(--naia-rose-dark)] rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <p className="text-sm text-[var(--naia-text-muted)] mt-1 text-right">
          {Math.round(percentage)}%
        </p>
      )}
    </div>
  );
}

// Step Progress (for multi-step flows)
interface StepProgressProps {
  currentStep: number;
  totalSteps: number;
  labels?: string[];
  className?: string;
}

export function StepProgress({
  currentStep,
  totalSteps,
  labels,
  className = "",
}: StepProgressProps) {
  return (
    <div className={className}>
      <div className="flex gap-1">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`
              flex-1 h-1 rounded-full transition-colors duration-200
              ${i < currentStep 
                ? "bg-[var(--naia-rose)]" 
                : "bg-[var(--naia-gray-200)]"
              }
            `}
          />
        ))}
      </div>
      {labels && labels[currentStep - 1] && (
        <p className="text-sm text-[var(--naia-text-muted)] mt-2 text-center">
          {labels[currentStep - 1]}
        </p>
      )}
    </div>
  );
}

// Slider
interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  showValue?: boolean;
  className?: string;
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  showValue = true,
  className = "",
}: SliderProps) {
  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="flex justify-between mb-2">
          {label && (
            <span className="text-sm font-medium text-[var(--naia-charcoal)]">
              {label}
            </span>
          )}
          {showValue && (
            <span className="text-sm text-[var(--naia-text-muted)]">
              {value}
            </span>
          )}
        </div>
      )}
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full h-2 bg-[var(--naia-gray-100)] rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-5
          [&::-webkit-slider-thumb]:h-5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-[var(--naia-rose)]
          [&::-webkit-slider-thumb]:shadow-md
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:transition-transform
          [&::-webkit-slider-thumb]:hover:scale-110
        "
      />
    </div>
  );
}

// Mood Rating (1-5 with emojis)
interface MoodRatingProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

const moodEmojis = ["😔", "😕", "😐", "🙂", "😊"];

export function MoodRating({ value, onChange, className = "" }: MoodRatingProps) {
  return (
    <div className={`flex justify-between gap-2 ${className}`}>
      {moodEmojis.map((emoji, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i + 1)}
          className={`
            w-12 h-12 rounded-full text-2xl
            transition-all duration-200
            ${value === i + 1
              ? "bg-[var(--naia-rose)] scale-110 shadow-lg"
              : "bg-[var(--naia-gray-100)] hover:bg-[var(--naia-gray-200)]"
            }
          `}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
