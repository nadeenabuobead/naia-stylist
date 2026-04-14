// app/components/onboarding/QuizQuestion.tsx
import { useState } from "react";

// Base question wrapper
interface QuestionWrapperProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function QuestionWrapper({ title, subtitle, children }: QuestionWrapperProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-medium text-[var(--naia-charcoal)]">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[var(--naia-text-muted)] mt-2">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// Single Select Question
interface SingleSelectProps {
  options: Array<{ id: string; label: string; emoji?: string; description?: string }>;
  value: string | null;
  onChange: (value: string) => void;
}

export function SingleSelect({ options, value, onChange }: SingleSelectProps) {
  return (
    <div className="space-y-3">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`
            w-full p-4 rounded-xl text-left transition-all duration-200
            flex items-center gap-4
            ${value === option.id
              ? "bg-[var(--naia-rose)] text-white ring-2 ring-[var(--naia-rose)] ring-offset-2"
              : "bg-white hover:bg-[var(--naia-gray-50)] border border-[var(--naia-gray-200)]"
            }
          `}
        >
          {option.emoji && <span className="text-2xl">{option.emoji}</span>}
          <div>
            <p className={`font-medium ${value === option.id ? "text-white" : "text-[var(--naia-charcoal)]"}`}>
              {option.label}
            </p>
            {option.description && (
              <p className={`text-sm ${value === option.id ? "text-white/80" : "text-[var(--naia-text-muted)]"}`}>
                {option.description}
              </p>
            )}
          </div>
          {value === option.id && (
            <div className="ml-auto">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// Multi Select Question
interface MultiSelectProps {
  options: Array<{ id: string; label: string; emoji?: string }>;
  value: string[];
  onChange: (value: string[]) => void;
  maxSelections?: number;
}

export function MultiSelect({ options, value, onChange, maxSelections }: MultiSelectProps) {
  const toggleOption = (optionId: string) => {
    if (value.includes(optionId)) {
      onChange(value.filter((id) => id !== optionId));
    } else if (!maxSelections || value.length < maxSelections) {
      onChange([...value, optionId]);
    }
  };

  return (
    <div>
      {maxSelections && (
        <p className="text-sm text-[var(--naia-text-muted)] text-center mb-4">
          Select up to {maxSelections}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => {
          const isSelected = value.includes(option.id);
          const isDisabled = !isSelected && maxSelections && value.length >= maxSelections;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggleOption(option.id)}
              disabled={isDisabled}
              className={`
                p-4 rounded-xl text-center transition-all duration-200
                ${isSelected
                  ? "bg-[var(--naia-rose)] text-white ring-2 ring-[var(--naia-rose)] ring-offset-2"
                  : isDisabled
                    ? "bg-[var(--naia-gray-100)] opacity-50 cursor-not-allowed"
                    : "bg-white hover:bg-[var(--naia-gray-50)] border border-[var(--naia-gray-200)]"
                }
              `}
            >
              {option.emoji && <span className="text-2xl block mb-1">{option.emoji}</span>}
              <span className={`text-sm font-medium ${isSelected ? "text-white" : "text-[var(--naia-charcoal)]"}`}>
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Image Grid Select
interface ImageGridSelectProps {
  options: Array<{ id: string; label: string; imageUrl: string }>;
  value: string | null;
  onChange: (value: string) => void;
}

export function ImageGridSelect({ options, value, onChange }: ImageGridSelectProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`
            relative rounded-xl overflow-hidden aspect-[3/4]
            transition-all duration-200
            ${value === option.id
              ? "ring-4 ring-[var(--naia-rose)] ring-offset-2"
              : "hover:opacity-90"
            }
          `}
        >
          <img
            src={option.imageUrl}
            alt={option.label}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
            <p className="text-white font-medium text-sm">{option.label}</p>
          </div>
          {value === option.id && (
            <div className="absolute top-2 right-2 w-6 h-6 bg-[var(--naia-rose)] rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// Open Text Question
interface OpenTextProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
}

export function OpenText({ value, onChange, placeholder, maxLength }: OpenTextProps) {
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={4}
        className="w-full px-4 py-3 rounded-xl bg-white border border-[var(--naia-gray-200)]
          text-[var(--naia-charcoal)] placeholder:text-[var(--naia-text-muted)]
          focus:outline-none focus:ring-2 focus:ring-[var(--naia-rose)]/20 focus:border-[var(--naia-rose)]
          transition-all duration-200 resize-none"
      />
      {maxLength && (
        <p className="text-sm text-[var(--naia-text-muted)] text-right mt-1">
          {value.length}/{maxLength}
        </p>
      )}
    </div>
  );
}

// Color Picker Question
interface ColorPickerProps {
  colors: Array<{ id: string; hex: string; name: string }>;
  value: string[];
  onChange: (value: string[]) => void;
  maxSelections?: number;
}

export function ColorPicker({ colors, value, onChange, maxSelections }: ColorPickerProps) {
  const toggleColor = (colorId: string) => {
    if (value.includes(colorId)) {
      onChange(value.filter((id) => id !== colorId));
    } else if (!maxSelections || value.length < maxSelections) {
      onChange([...value, colorId]);
    }
  };

  return (
    <div>
      {maxSelections && (
        <p className="text-sm text-[var(--naia-text-muted)] text-center mb-4">
          Pick your top {maxSelections}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {colors.map((color) => {
          const isSelected = value.includes(color.id);
          return (
            <button
              key={color.id}
              type="button"
              onClick={() => toggleColor(color.id)}
              title={color.name}
              className={`
                w-12 h-12 rounded-full transition-all duration-200
                ${isSelected
                  ? "ring-4 ring-[var(--naia-rose)] ring-offset-2 scale-110"
                  : "hover:scale-105"
                }
              `}
              style={{ backgroundColor: color.hex }}
            >
              {isSelected && (
                <svg className="w-6 h-6 mx-auto text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Scale Question (1-5 or 1-10)
interface ScaleQuestionProps {
  value: number | null;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
}

export function ScaleQuestion({
  value,
  onChange,
  min = 1,
  max = 5,
  minLabel,
  maxLabel,
}: ScaleQuestionProps) {
  const range = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <div>
      <div className="flex justify-between gap-2">
        {range.map((num) => (
          <button
            key={num}
            type="button"
            onClick={() => onChange(num)}
            className={`
              flex-1 py-3 rounded-xl font-medium transition-all duration-200
              ${value === num
                ? "bg-[var(--naia-rose)] text-white"
                : "bg-white border border-[var(--naia-gray-200)] hover:bg-[var(--naia-gray-50)]"
              }
            `}
          >
            {num}
          </button>
        ))}
      </div>
      {(minLabel || maxLabel) && (
        <div className="flex justify-between mt-2">
          <span className="text-sm text-[var(--naia-text-muted)]">{minLabel}</span>
          <span className="text-sm text-[var(--naia-text-muted)]">{maxLabel}</span>
        </div>
      )}
    </div>
  );
}
