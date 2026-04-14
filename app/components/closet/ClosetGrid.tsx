// app/components/closet/ClosetGrid.tsx
import { useState } from "react";
import { Link } from "@remix-run/react";
import { Badge, Tag } from "~/components/ui/Badge";

// Closet category types
export type ClosetCategory =
  | "TOPS"
  | "BOTTOMS"
  | "DRESSES"
  | "OUTERWEAR"
  | "SHOES"
  | "BAGS"
  | "ACCESSORIES"
  | "JEWELRY"
  | "OTHER";

// Item type matching Prisma schema
export interface ClosetItem {
  id: string;
  name: string | null;
  category: ClosetCategory;
  imageUrl: string;
  colors: string[];
  pattern: string | null;
  material: string | null;
  styleTags: string[];
  seasons: string[];
  occasions: string[];
  favorite: boolean;
  wearCount: number;
  lastWorn: string | null;
  createdAt: string;
}

// Category configuration
export const categoryConfig: Record
  ClosetCategory,
  { label: string; icon: string; color: string }
> = {
  TOPS: { label: "Tops", icon: "👚", color: "#B76E79" },
  BOTTOMS: { label: "Bottoms", icon: "👖", color: "#8B7355" },
  DRESSES: { label: "Dresses", icon: "👗", color: "#9B7EBD" },
  OUTERWEAR: { label: "Outerwear", icon: "🧥", color: "#5D8AA8" },
  SHOES: { label: "Shoes", icon: "👠", color: "#D4AF37" },
  BAGS: { label: "Bags", icon: "👜", color: "#CD853F" },
  ACCESSORIES: { label: "Accessories", icon: "🧣", color: "#BC8F8F" },
  JEWELRY: { label: "Jewelry", icon: "💍", color: "#FFD700" },
  OTHER: { label: "Other", icon: "✨", color: "#808080" },
};

// Category Tabs Component
interface CategoryTabsProps {
  categories: ClosetCategory[];
  activeCategory: ClosetCategory | "ALL";
  onCategoryChange: (category: ClosetCategory | "ALL") => void;
  itemCounts: Record<string, number>;
}

export function CategoryTabs({
  categories,
  activeCategory,
  onCategoryChange,
  itemCounts,
}: CategoryTabsProps) {
  return (
    <div className="overflow-x-auto pb-2 -mx-4 px-4">
      <div className="flex gap-2 min-w-max">
        {/* All tab */}
        <button
          onClick={() => onCategoryChange("ALL")}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-full
            text-sm font-medium whitespace-nowrap
            transition-all duration-200
            ${
              activeCategory === "ALL"
                ? "bg-[var(--naia-charcoal)] text-white"
                : "bg-white text-[var(--naia-text-muted)] hover:bg-[var(--naia-gray-100)]"
            }
          `}
        >
          <span>All</span>
          <span className="text-xs opacity-70">
            {Object.values(itemCounts).reduce((a, b) => a + b, 0)}
          </span>
        </button>

        {/* Category tabs */}
        {categories.map((category) => {
          const config = categoryConfig[category];
          const count = itemCounts[category] || 0;

          return (
            <button
              key={category}
              onClick={() => onCategoryChange(category)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-full
                text-sm font-medium whitespace-nowrap
                transition-all duration-200
                ${
                  activeCategory === category
                    ? "bg-[var(--naia-charcoal)] text-white"
                    : "bg-white text-[var(--naia-text-muted)] hover:bg-[var(--naia-gray-100)]"
                }
              `}
            >
              <span>{config.icon}</span>
              <span>{config.label}</span>
              <span className="text-xs opacity-70">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Individual Item Card
interface ItemCardProps {
  item: ClosetItem;
  onSelect?: (item: ClosetItem) => void;
  isSelected?: boolean;
  selectable?: boolean;
  showDetails?: boolean;
}

export function ItemCard({
  item,
  onSelect,
  isSelected = false,
  selectable = false,
  showDetails = true,
}: ItemCardProps) {
  const config = categoryConfig[item.category];

  const handleClick = () => {
    if (selectable && onSelect) {
      onSelect(item);
    }
  };

  const CardWrapper = selectable ? "button" : Link;
  const wrapperProps = selectable
    ? { onClick: handleClick, type: "button" as const }
    : { to: `/closet/item/${item.id}` };

  return (
    <CardWrapper
      {...wrapperProps}
      className={`
        group relative
        bg-white rounded-xl overflow-hidden
        transition-all duration-200
        ${selectable ? "cursor-pointer" : ""}
        ${isSelected ? "ring-2 ring-[var(--naia-rose)] ring-offset-2" : "hover:shadow-md"}
      `}
    >
      {/* Image */}
      <div className="aspect-[3/4] relative overflow-hidden bg-[var(--naia-gray-100)]">
        <img
          src={item.imageUrl}
          alt={item.name || `${config.label} item`}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />

        {/* Favorite indicator */}
        {item.favorite && (
          <div className="absolute top-2 right-2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center">
            <span className="text-[var(--naia-rose)]">♥</span>
          </div>
        )}

        {/* Selection indicator */}
        {selectable && isSelected && (
          <div className="absolute inset-0 bg-[var(--naia-rose)]/20 flex items-center justify-center">
            <div className="w-12 h-12 bg-[var(--naia-rose)] rounded-full flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Wear count badge */}
        {item.wearCount > 0 && (
          <div className="absolute bottom-2 left-2">
            <Badge variant="neutral" className="bg-white/90 text-xs">
              Worn {item.wearCount}x
            </Badge>
          </div>
        )}
      </div>

      {/* Details */}
      {showDetails && (
        <div className="p-3">
          {/* Name & Category */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="font-medium text-[var(--naia-charcoal)] text-sm line-clamp-1">
              {item.name || config.label}
            </p>
            <span className="text-xs">{config.icon}</span>
          </div>

          {/* Colors */}
          {item.colors.length > 0 && (
            <div className="flex gap-1 mb-2">
              {item.colors.slice(0, 4).map((color, i) => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-full border border-[var(--naia-gray-200)]"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
              {item.colors.length > 4 && (
                <span className="text-xs text-[var(--naia-text-muted)]">
                  +{item.colors.length - 4}
                </span>
              )}
            </div>
          )}

          {/* Tags */}
          {item.styleTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.styleTags.slice(0, 2).map((tag) => (
                <Tag key={tag} size="sm">
                  {tag}
                </Tag>
              ))}
              {item.styleTags.length > 2 && (
                <span className="text-xs text-[var(--naia-text-muted)]">
                  +{item.styleTags.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </CardWrapper>
  );
}

// Main Closet Grid Component
interface ClosetGridProps {
  items: ClosetItem[];
  selectable?: boolean;
  selectedItems?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  maxSelection?: number;
  emptyMessage?: string;
  columns?: 2 | 3 | 4;
}

export function ClosetGrid({
  items,
  selectable = false,
  selectedItems = [],
  onSelectionChange,
  maxSelection,
  emptyMessage = "No items yet",
  columns = 2,
}: ClosetGridProps) {
  const [activeCategory, setActiveCategory] = useState<ClosetCategory | "ALL">("ALL");

  // Get unique categories from items
  const categories = Array.from(
    new Set(items.map((item) => item.category))
  ) as ClosetCategory[];

  // Count items per category
  const itemCounts = items.reduce(
    (acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Filter items by category
  const filteredItems =
    activeCategory === "ALL"
      ? items
      : items.filter((item) => item.category === activeCategory);

  // Handle item selection
  const handleSelect = (item: ClosetItem) => {
    if (!onSelectionChange) return;

    const isSelected = selectedItems.includes(item.id);

    if (isSelected) {
      onSelectionChange(selectedItems.filter((id) => id !== item.id));
    } else if (!maxSelection || selectedItems.length < maxSelection) {
      onSelectionChange([...selectedItems, item.id]);
    }
  };

  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
  };

  return (
    <div className="space-y-4">
      {/* Category tabs */}
      {categories.length > 1 && (
        <CategoryTabs
          categories={categories}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          itemCounts={itemCounts}
        />
      )}

      {/* Selection info */}
      {selectable && maxSelection && (
        <div className="text-sm text-[var(--naia-text-muted)] text-center">
          Selected {selectedItems.length} of {maxSelection}
        </div>
      )}

      {/* Grid */}
      {filteredItems.length > 0 ? (
        <div className={`grid ${gridCols[columns]} gap-4`}>
          {filteredItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              selectable={selectable}
              isSelected={selectedItems.includes(item.id)}
              onSelect={handleSelect}
              showDetails={!selectable}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-[var(--naia-text-muted)]">{emptyMessage}</p>
        </div>
      )}
    </div>
  );
}

// Empty State Component
export function ClosetEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-20 h-20 bg-[var(--naia-rose)]/10 rounded-full flex items-center justify-center mb-6">
        <span className="text-4xl">👗</span>
      </div>
      <h3 className="font-display text-2xl font-medium text-[var(--naia-charcoal)] mb-2">
        Your closet is empty
      </h3>
      <p className="text-[var(--naia-text-muted)] max-w-sm mb-6">
        Add your clothes so nAia can help you create amazing outfits from what you already own.
      </p>
      <Link
        to="/closet/upload"
        className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--naia-rose)] text-white rounded-full font-medium hover:bg-[var(--naia-rose-dark)] transition-colors"
      >
        <span>📸</span>
        Add your first item
      </Link>
    </div>
  );
}
