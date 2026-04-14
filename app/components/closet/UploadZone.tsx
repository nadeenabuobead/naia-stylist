// app/components/closet/UploadZone.tsx
import { useState, useRef, useCallback } from "react";
import { categoryConfig, type ClosetCategory } from "./ClosetGrid";

// Upload Zone Component
interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  acceptedTypes?: string[];
  isUploading?: boolean;
}

export function UploadZone({
  onFilesSelected,
  maxFiles = 10,
  acceptedTypes = ["image/jpeg", "image/png", "image/webp"],
  isUploading = false,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files).filter((file) =>
        acceptedTypes.includes(file.type)
      );

      if (files.length > 0) {
        onFilesSelected(files.slice(0, maxFiles));
      }
    },
    [acceptedTypes, maxFiles, onFilesSelected]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        onFilesSelected(files.slice(0, maxFiles));
      }
    },
    [maxFiles, onFilesSelected]
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        relative border-2 border-dashed rounded-2xl p-8
        flex flex-col items-center justify-center
        cursor-pointer transition-all duration-200
        ${isDragging
          ? "border-[var(--naia-rose)] bg-[var(--naia-rose)]/5"
          : "border-[var(--naia-gray-300)] hover:border-[var(--naia-rose)] hover:bg-[var(--naia-gray-50)]"
        }
        ${isUploading ? "pointer-events-none opacity-50" : ""}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={acceptedTypes.join(",")}
        multiple={maxFiles > 1}
        onChange={handleFileInput}
        className="hidden"
      />

      {isUploading ? (
        <>
          <div className="w-12 h-12 border-4 border-[var(--naia-rose)] border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-[var(--naia-charcoal)] font-medium">Uploading...</p>
        </>
      ) : (
        <>
          <div className="w-16 h-16 bg-[var(--naia-rose)]/10 rounded-full flex items-center justify-center mb-4">
            <span className="text-3xl">📸</span>
          </div>
          <p className="text-[var(--naia-charcoal)] font-medium mb-1">
            Drop photos here
          </p>
          <p className="text-sm text-[var(--naia-text-muted)]">
            or tap to browse
          </p>
          <p className="text-xs text-[var(--naia-text-muted)] mt-4">
            JPG, PNG, or WebP • Max {maxFiles} files
          </p>
        </>
      )}
    </div>
  );
}

// Category Selector
interface CategorySelectorProps {
  value: ClosetCategory | null;
  onChange: (category: ClosetCategory) => void;
}

export function CategorySelector({ value, onChange }: CategorySelectorProps) {
  const categories = Object.entries(categoryConfig) as [ClosetCategory, typeof categoryConfig[ClosetCategory]][];

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-[var(--naia-charcoal)]">
        Category
      </label>
      <div className="grid grid-cols-3 gap-2">
        {categories.map(([key, config]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`
              p-3 rounded-xl text-center transition-all duration-200
              ${value === key
                ? "bg-[var(--naia-rose)] text-white"
                : "bg-white border border-[var(--naia-gray-200)] hover:bg-[var(--naia-gray-50)]"
              }
            `}
          >
            <span className="text-xl block mb-1">{config.icon}</span>
            <span className="text-xs font-medium">{config.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Item Details Form
interface ItemDetailsFormProps {
  imageUrl: string;
  initialData?: {
    name?: string;
    category?: ClosetCategory;
    colors?: string[];
    styleTags?: string[];
    seasons?: string[];
    occasions?: string[];
  };
  onSave: (data: {
    name: string;
    category: ClosetCategory;
    colors: string[];
    styleTags: string[];
    seasons: string[];
    occasions: string[];
  }) => void;
  onCancel: () => void;
  isAnalyzing?: boolean;
}

export function ItemDetailsForm({
  imageUrl,
  initialData,
  onSave,
  onCancel,
  isAnalyzing = false,
}: ItemDetailsFormProps) {
  const [name, setName] = useState(initialData?.name || "");
  const [category, setCategory] = useState<ClosetCategory | null>(
    initialData?.category || null
  );
  const [colors, setColors] = useState<string[]>(initialData?.colors || []);
  const [styleTags, setStyleTags] = useState<string[]>(initialData?.styleTags || []);
  const [seasons, setSeasons] = useState<string[]>(initialData?.seasons || []);
  const [occasions, setOccasions] = useState<string[]>(initialData?.occasions || []);

  const seasonOptions = ["Spring", "Summer", "Fall", "Winter"];
  const occasionOptions = ["Everyday", "Work", "Date Night", "Special Event", "Travel", "Active"];
  const styleTagOptions = ["Casual", "Formal", "Bohemian", "Minimalist", "Edgy", "Classic", "Trendy", "Romantic"];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) return;

    onSave({
      name,
      category,
      colors,
      styleTags,
      seasons,
      occasions,
    });
  };

  const toggleArrayItem = (
    arr: string[],
    setArr: (arr: string[]) => void,
    item: string
  ) => {
    if (arr.includes(item)) {
      setArr(arr.filter((i) => i !== item));
    } else {
      setArr([...arr, item]);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Image Preview */}
      <div className="aspect-square max-w-[200px] mx-auto rounded-xl overflow-hidden bg-[var(--naia-gray-100)]">
        <img
          src={imageUrl}
          alt="Item preview"
          className="w-full h-full object-cover"
        />
      </div>

      {isAnalyzing && (
        <div className="text-center p-4 bg-[var(--naia-rose)]/10 rounded-xl">
          <p className="text-sm text-[var(--naia-rose)]">
            ✨ nAia is analyzing your item...
          </p>
        </div>
      )}

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-[var(--naia-charcoal)] mb-1.5">
          Name (optional)
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Favorite black dress"
          className="w-full px-4 py-3 rounded-xl bg-white border border-[var(--naia-gray-200)]
            text-[var(--naia-charcoal)] placeholder:text-[var(--naia-text-muted)]
            focus:outline-none focus:ring-2 focus:ring-[var(--naia-rose)]/20 focus:border-[var(--naia-rose)]"
        />
      </div>

      {/* Category */}
      <CategorySelector value={category} onChange={setCategory} />

      {/* Seasons */}
      <div>
        <label className="block text-sm font-medium text-[var(--naia-charcoal)] mb-2">
          Seasons
        </label>
        <div className="flex flex-wrap gap-2">
          {seasonOptions.map((season) => (
            <button
              key={season}
              type="button"
              onClick={() => toggleArrayItem(seasons, setSeasons, season.toLowerCase())}
              className={`
                px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                ${seasons.includes(season.toLowerCase())
                  ? "bg-[var(--naia-rose)] text-white"
                  : "bg-[var(--naia-gray-100)] text-[var(--naia-charcoal)] hover:bg-[var(--naia-gray-200)]"
                }
              `}
            >
              {season}
            </button>
          ))}
        </div>
      </div>

      {/* Occasions */}
      <div>
        <label className="block text-sm font-medium text-[var(--naia-charcoal)] mb-2">
          Best for
        </label>
        <div className="flex flex-wrap gap-2">
          {occasionOptions.map((occasion) => (
            <button
              key={occasion}
              type="button"
              onClick={() => toggleArrayItem(occasions, setOccasions, occasion.toLowerCase())}
              className={`
                px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                ${occasions.includes(occasion.toLowerCase())
                  ? "bg-[var(--naia-rose)] text-white"
                  : "bg-[var(--naia-gray-100)] text-[var(--naia-charcoal)] hover:bg-[var(--naia-gray-200)]"
                }
              `}
            >
              {occasion}
            </button>
          ))}
        </div>
      </div>

      {/* Style Tags */}
      <div>
        <label className="block text-sm font-medium text-[var(--naia-charcoal)] mb-2">
          Style vibes
        </label>
        <div className="flex flex-wrap gap-2">
          {styleTagOptions.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleArrayItem(styleTags, setStyleTags, tag.toLowerCase())}
              className={`
                px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                ${styleTags.includes(tag.toLowerCase())
                  ? "bg-[var(--naia-rose)] text-white"
                  : "bg-[var(--naia-gray-100)] text-[var(--naia-charcoal)] hover:bg-[var(--naia-gray-200)]"
                }
              `}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-3 rounded-xl border border-[var(--naia-gray-200)] text-[var(--naia-charcoal)] font-medium hover:bg-[var(--naia-gray-50)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!category}
          className={`
            flex-1 px-4 py-3 rounded-xl font-medium transition-colors
            ${category
              ? "bg-[var(--naia-rose)] text-white hover:bg-[var(--naia-rose-dark)]"
              : "bg-[var(--naia-gray-200)] text-[var(--naia-text-muted)] cursor-not-allowed"
            }
          `}
        >
          Save Item
        </button>
      </div>
    </form>
  );
}
