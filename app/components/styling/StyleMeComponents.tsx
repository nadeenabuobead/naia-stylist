// app/components/styling/StyleMeComponents.tsx
import { useState } from "react";
import { Link } from "@remix-run/react";

// Mood Selector
interface MoodOption {
  id: string;
  label: string;
  emoji: string;
  gradient: string;
  description: string;
}

const moods: MoodOption[] = [
  { id: "confident", label: "Confident", emoji: "💪", gradient: "from-rose-400 to-pink-500", description: "Ready to own the room" },
  { id: "calm", label: "Calm", emoji: "🌿", gradient: "from-teal-400 to-cyan-500", description: "Peaceful and centered" },
  { id: "playful", label: "Playful", emoji: "🎀", gradient: "from-pink-400 to-purple-500", description: "Fun and carefree" },
  { id: "romantic", label: "Romantic", emoji: "🌹", gradient: "from-rose-300 to-red-400", description: "Soft and dreamy" },
  { id: "powerful", label: "Powerful", emoji: "👑", gradient: "from-amber-400 to-orange-500", description: "Strong and in charge" },
  { id: "mysterious", label: "Mysterious", emoji: "🌙", gradient: "from-slate-600 to-purple-700", description: "Intriguing and alluring" },
  { id: "joyful", label: "Joyful", emoji: "☀️", gradient: "from-yellow-400 to-orange-400", description: "Bright and happy" },
  { id: "sophisticated", label: "Sophisticated", emoji: "✨", gradient: "from-slate-400 to-gray-600", description: "Elegant and refined" },
];

interface MoodSelectorProps {
  value: string | null;
  onChange: (mood: string) => void;
}

export function MoodSelector({ value, onChange }: MoodSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {moods.map((mood) => (
        <button
          key={mood.id}
          type="button"
          onClick={() => onChange(mood.id)}
          className={`
            relative p-5 rounded-2xl text-left transition-all duration-200
            ${value === mood.id
              ? "ring-2 ring-[var(--naia-rose)] ring-offset-2 scale-[1.02]"
              : "hover:scale-[1.02]"
            }
          `}
        >
          <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${mood.gradient}`} />
          <div className="relative z-10">
            <span className="text-3xl mb-2 block">{mood.emoji}</span>
            <p className="font-medium text-white text-lg">{mood.label}</p>
            <p className="text-white/80 text-sm">{mood.description}</p>
          </div>
          {value === mood.id && (
            <div className="absolute top-3 right-3 w-6 h-6 bg-white rounded-full flex items-center justify-center z-10">
              <svg className="w-4 h-4 text-[var(--naia-rose)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// Feeling Selector
interface FeelingOption {
  id: string;
  label: string;
  emoji: string;
  color: string;
}

const feelings: FeelingOption[] = [
  { id: "elegant", label: "Elegant", emoji: "💎", color: "bg-purple-100 text-purple-700" },
  { id: "cozy", label: "Cozy", emoji: "🧸", color: "bg-amber-100 text-amber-700" },
  { id: "bold", label: "Bold", emoji: "🔥", color: "bg-red-100 text-red-700" },
  { id: "effortless", label: "Effortless", emoji: "🌊", color: "bg-blue-100 text-blue-700" },
  { id: "feminine", label: "Feminine", emoji: "🌸", color: "bg-pink-100 text-pink-700" },
  { id: "edgy", label: "Edgy", emoji: "⚡", color: "bg-slate-200 text-slate-700" },
  { id: "classic", label: "Classic", emoji: "🎩", color: "bg-gray-100 text-gray-700" },
  { id: "trendy", label: "Trendy", emoji: "✨", color: "bg-fuchsia-100 text-fuchsia-700" },
  { id: "minimalist", label: "Minimalist", emoji: "○", color: "bg-stone-100 text-stone-700" },
  { id: "glamorous", label: "Glamorous", emoji: "💄", color: "bg-rose-100 text-rose-700" },
  { id: "bohemian", label: "Bohemian", emoji: "🌻", color: "bg-orange-100 text-orange-700" },
  { id: "professional", label: "Professional", emoji: "💼", color: "bg-indigo-100 text-indigo-700" },
];

interface FeelingSelectorProps {
  value: string[];
  onChange: (feelings: string[]) => void;
  maxSelections?: number;
}

export function FeelingSelector({ value, onChange, maxSelections = 3 }: FeelingSelectorProps) {
  const toggleFeeling = (feelingId: string) => {
    if (value.includes(feelingId)) {
      onChange(value.filter((id) => id !== feelingId));
    } else if (value.length < maxSelections) {
      onChange([...value, feelingId]);
    }
  };

  return (
    <div>
      <p className="text-sm text-[var(--naia-text-muted)] text-center mb-4">
        Pick up to {maxSelections}
      </p>
      <div className="grid grid-cols-3 gap-3">
        {feelings.map((feeling) => {
          const isSelected = value.includes(feeling.id);
          const isDisabled = !isSelected && value.length >= maxSelections;

          return (
            <button
              key={feeling.id}
              type="button"
              onClick={() => toggleFeeling(feeling.id)}
              disabled={isDisabled}
              className={`
                p-4 rounded-xl text-center transition-all duration-200
                ${isSelected
                  ? "ring-2 ring-[var(--naia-rose)] ring-offset-2 scale-[1.02]"
                  : isDisabled
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:scale-[1.02]"
                }
                ${feeling.color}
              `}
            >
              <span className="text-2xl block mb-1">{feeling.emoji}</span>
              <span className="text-sm font-medium">{feeling.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Occasion Picker
interface OccasionOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

const occasions: OccasionOption[] = [
  { id: "everyday", label: "Everyday", emoji: "☕", description: "Running errands, casual day out" },
  { id: "work", label: "Work", emoji: "💼", description: "Office or professional setting" },
  { id: "datenight", label: "Date Night", emoji: "🌹", description: "Romantic dinner or evening" },
  { id: "girlsnight", label: "Girls' Night", emoji: "🥂", description: "Out with friends" },
  { id: "special", label: "Special Event", emoji: "✨", description: "Celebration or milestone" },
  { id: "travel", label: "Travel", emoji: "✈️", description: "Airport or sightseeing" },
  { id: "athome", label: "Cozy at Home", emoji: "🏠", description: "Comfortable but put-together" },
  { id: "fitness", label: "Active", emoji: "🧘", description: "Workout or athleisure" },
];

interface OccasionPickerProps {
  value: string | null;
  onChange: (occasion: string) => void;
}

export function OccasionPicker({ value, onChange }: OccasionPickerProps) {
  return (
    <div className="space-y-3">
      {occasions.map((occasion) => (
        <button
          key={occasion.id}
          type="button"
          onClick={() => onChange(occasion.id)}
          className={`
            w-full p-4 rounded-xl text-left transition-all duration-200
            flex items-center gap-4
            ${value === occasion.id
              ? "bg-[var(--naia-rose)] text-white ring-2 ring-[var(--naia-rose)] ring-offset-2"
              : "bg-white hover:bg-[var(--naia-gray-50)]"
            }
          `}
        >
          <div className={`
            w-12 h-12 rounded-full flex items-center justify-center text-2xl
            ${value === occasion.id ? "bg-white/20" : "bg-[var(--naia-rose)]/10"}
          `}>
            {occasion.emoji}
          </div>
          <div className="flex-1">
            <p className={`font-medium ${value === occasion.id ? "text-white" : "text-[var(--naia-charcoal)]"}`}>
              {occasion.label}
            </p>
            <p className={`text-sm ${value === occasion.id ? "text-white/80" : "text-[var(--naia-text-muted)]"}`}>
              {occasion.description}
            </p>
          </div>
          {value === occasion.id && (
            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-[var(--naia-rose)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// Source Toggle (Closet / nAia / Both)
type SourceType = "CLOSET" | "NAIA" | "BOTH";

interface SourceToggleProps {
  value: SourceType | null;
  onChange: (source: SourceType) => void;
  closetCount: number;
}

export function SourceToggle({ value, onChange, closetCount }: SourceToggleProps) {
  const sources: Array<{ id: SourceType; label: string; emoji: string; description: string; requiresCloset: boolean }> = [
    { id: "CLOSET", label: "My Closet Only", emoji: "👗", description: "Style me using only what I already own", requiresCloset: true },
    { id: "NAIA", label: "nAia's Picks", emoji: "🛍️", description: "Show me new pieces from the store", requiresCloset: false },
    { id: "BOTH", label: "Mix It Up", emoji: "✨", description: "Combine my closet with new suggestions", requiresCloset: false },
  ];

  return (
    <div className="space-y-4">
      {sources.map((source) => {
        const isDisabled = source.requiresCloset && closetCount === 0;
        const isSelected = value === source.id;

        return (
          <button
            key={source.id}
            type="button"
            onClick={() => !isDisabled && onChange(source.id)}
            disabled={isDisabled}
            className={`
              w-full p-5 rounded-2xl text-left transition-all duration-200
              ${isSelected
                ? "bg-gradient-to-r from-[var(--naia-rose)] to-[var(--naia-rose-dark)] text-white ring-2 ring-[var(--naia-rose)] ring-offset-2"
                : isDisabled
                  ? "bg-[var(--naia-gray-100)] opacity-50 cursor-not-allowed"
                  : "bg-white hover:shadow-md"
              }
            `}
          >
            <div className="flex items-start gap-4">
              <div className={`
                w-14 h-14 rounded-xl flex items-center justify-center text-3xl
                ${isSelected ? "bg-white/20" : "bg-[var(--naia-rose)]/10"}
              `}>
                {source.emoji}
              </div>
              <div className="flex-1">
                <p className={`font-medium text-lg mb-1 ${isSelected ? "text-white" : "text-[var(--naia-charcoal)]"}`}>
                  {source.label}
                </p>
                <p className={`text-sm ${isSelected ? "text-white/80" : "text-[var(--naia-text-muted)]"}`}>
                  {source.description}
                </p>
                {source.id !== "NAIA" && (
                  <p className={`text-xs mt-2 ${isSelected ? "text-white/60" : "text-[var(--naia-text-muted)]"}`}>
                    📦 {closetCount > 0 ? `${closetCount} items in your closet` : "No items in closet yet"}
                  </p>
                )}
              </div>
              {isSelected && (
                <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-[var(--naia-rose)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Outfit Display
interface OutfitItem {
  id: string;
  type: string;
  name: string;
  imageUrl?: string;
  description?: string;
  stylingTip?: string;
  price?: number;
  closetItemId?: string;
  shopifyProductId?: string;
}

interface OutfitDisplayProps {
  outfitName: string;
  confidenceBoost?: string;
  styleNotes?: string;
  items: OutfitItem[];
  perfumeSuggestion?: string;
  hairSuggestion?: string;
  makeupSuggestion?: string;
  songSuggestion?: string;
  onSave?: () => void;
  isSaved?: boolean;
}

export function OutfitDisplay({
  outfitName,
  confidenceBoost,
  styleNotes,
  items,
  perfumeSuggestion,
  hairSuggestion,
  makeupSuggestion,
  songSuggestion,
  onSave,
  isSaved = false,
}: OutfitDisplayProps) {
  const [activeTab, setActiveTab] = useState<"outfit" | "vibe">("outfit");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="font-display text-2xl font-medium text-[var(--naia-charcoal)] mb-2">
          {outfitName}
        </h2>
        {confidenceBoost && (
          <p className="text-[var(--naia-rose)] italic">"{confidenceBoost}"</p>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="flex bg-white rounded-full p-1">
        <button
          onClick={() => setActiveTab("outfit")}
          className={`flex-1 py-2 px-4 rounded-full text-sm font-medium transition-colors ${
            activeTab === "outfit"
              ? "bg-[var(--naia-charcoal)] text-white"
              : "text-[var(--naia-text-muted)]"
          }`}
        >
          👗 Outfit
        </button>
        <button
          onClick={() => setActiveTab("vibe")}
          className={`flex-1 py-2 px-4 rounded-full text-sm font-medium transition-colors ${
            activeTab === "vibe"
              ? "bg-[var(--naia-charcoal)] text-white"
              : "text-[var(--naia-text-muted)]"
          }`}
        >
          ✨ Complete Vibe
        </button>
      </div>

      {activeTab === "outfit" ? (
        <>
          {/* Outfit Items */}
          <div className="space-y-4">
            {items.map((item) => (
              <OutfitItemCard key={item.id} item={item} />
            ))}
          </div>

          {/* Style Notes */}
          {styleNotes && (
            <div className="p-4 bg-[var(--naia-rose)]/5 rounded-xl">
              <h3 className="font-medium text-[var(--naia-charcoal)] mb-2">✨ Styling Notes</h3>
              <p className="text-[var(--naia-text-muted)] text-sm">{styleNotes}</p>
            </div>
          )}
        </>
      ) : (
        /* Vibe Tab */
        <div className="space-y-4">
          {perfumeSuggestion && (
            <div className="p-4 bg-white rounded-xl">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">🌸</span>
                <h3 className="font-medium text-[var(--naia-charcoal)]">Scent</h3>
              </div>
              <p className="text-[var(--naia-text-muted)]">{perfumeSuggestion}</p>
            </div>
          )}
          {hairSuggestion && (
            <div className="p-4 bg-white rounded-xl">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">💇‍♀️</span>
                <h3 className="font-medium text-[var(--naia-charcoal)]">Hair</h3>
              </div>
              <p className="text-[var(--naia-text-muted)]">{hairSuggestion}</p>
            </div>
          )}
          {makeupSuggestion && (
            <div className="p-4 bg-white rounded-xl">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">💄</span>
                <h3 className="font-medium text-[var(--naia-charcoal)]">Makeup</h3>
              </div>
              <p className="text-[var(--naia-text-muted)]">{makeupSuggestion}</p>
            </div>
          )}
          {songSuggestion && (
            <div className="p-4 bg-gradient-to-br from-[var(--naia-rose)]/10 to-purple-100 rounded-xl">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">🎵</span>
                <h3 className="font-medium text-[var(--naia-charcoal)]">Your Confidence Song</h3>
              </div>
              <p className="text-[var(--naia-charcoal)] font-medium">{songSuggestion}</p>
              <p className="text-sm text-[var(--naia-text-muted)] mt-1">Play this while getting ready ✨</p>
            </div>
          )}
        </div>
      )}

      {/* Save Button */}
      {onSave && (
        <button
          onClick={onSave}
          disabled={isSaved}
          className={`w-full py-3 rounded-full font-medium transition-colors ${
            isSaved
              ? "bg-green-100 text-green-700"
              : "bg-[var(--naia-rose)] text-white hover:bg-[var(--naia-rose-dark)]"
          }`}
        >
          {isSaved ? "✓ Saved to Your Looks" : "Save This Look"}
        </button>
      )}
    </div>
  );
}

// Outfit Item Card
function OutfitItemCard({ item }: { item: OutfitItem }) {
  return (
    <div className="flex gap-4 p-4 bg-white rounded-xl">
      <div className="w-20 h-20 rounded-lg overflow-hidden bg-[var(--naia-gray-100)] flex-shrink-0">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl">👗</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-xs text-[var(--naia-text-muted)] uppercase">{item.type}</span>
            <p className="font-medium text-[var(--naia-charcoal)]">{item.name}</p>
          </div>
          {item.price && (
            <span className="text-sm font-medium text-[var(--naia-charcoal)]">${item.price}</span>
          )}
        </div>
        {item.stylingTip && (
          <p className="text-sm text-[var(--naia-text-muted)] mt-1">💡 {item.stylingTip}</p>
        )}
        <div className="flex gap-2 mt-2">
          {item.closetItemId && (
            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
              From your closet
            </span>
          )}
          {item.shopifyProductId && (
            <Link
              to={`/products/${item.shopifyProductId}`}
              className="text-xs px-2 py-1 bg-[var(--naia-rose)]/10 text-[var(--naia-rose)] rounded-full"
            >
              View in store →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
