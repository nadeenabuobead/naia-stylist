// app/components/StylingToShoppingConversion.jsx
// Component for the Styling-to-Shopping Conversion section

import { useState } from "react";
import { 
  ShoppingBag, 
  Eye, 
  Camera, 
  Heart, 
  ShoppingCart, 
  CheckCircle,
  TrendingUp,
  AlertCircle,
  ChevronDown,
  ChevronUp
} from "lucide-react";

export default function StylingToShoppingConversion({ data }) {
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [sortBy, setSortBy] = useState("recommended"); // recommended, clickRate, conversionRate

  if (!data?.hasData) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center">
              <ShoppingBag className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Styling-to-Shopping Conversion
            </h3>
            <p className="text-gray-600 mb-4">
              Track how AI styling recommendations lead to purchases
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-900 mb-1">
                  Event tracking not configured
                </p>
                <p className="text-sm text-amber-700">
                  Connect Shopify events to track styling-to-shopping conversion. 
                  This tracks actions after AI styling recommendations, separate from general analytics.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sortedStats = [...data.stats].sort((a, b) => {
    switch (sortBy) {
      case "clickRate":
        return parseFloat(b.clickRate) - parseFloat(a.clickRate);
      case "conversionRate":
        return parseFloat(b.conversionRate) - parseFloat(a.conversionRate);
      default:
        return b.recommended - a.recommended;
    }
  });

  const totalStats = data.stats.reduce(
    (acc, item) => ({
      recommended: acc.recommended + item.recommended,
      clicked: acc.clicked + item.clicked,
      triedOn: acc.triedOn + item.triedOn,
      saved: acc.saved + item.saved,
      addedToCart: acc.addedToCart + item.addedToCart,
      purchased: acc.purchased + item.purchased,
    }),
    { recommended: 0, clicked: 0, triedOn: 0, saved: 0, addedToCart: 0, purchased: 0 }
  );

  const overallClickRate = totalStats.recommended > 0 
    ? ((totalStats.clicked / totalStats.recommended) * 100).toFixed(1)
    : 0;
  
  const overallConversionRate = totalStats.recommended > 0
    ? ((totalStats.purchased / totalStats.recommended) * 100).toFixed(1)
    : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center">
                <ShoppingBag className="w-6 h-6 text-blue-600" />
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                Styling-to-Shopping Conversion
              </h3>
              <p className="text-sm text-gray-600">
                Tracks purchases that happen after AI styling recommendations
              </p>
            </div>
          </div>
          
          {/* Sort Options */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="recommended">Most Recommended</option>
            <option value="clickRate">Highest Click Rate</option>
            <option value="conversionRate">Highest Conversion</option>
          </select>
        </div>

        {/* Overall Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900">{totalStats.recommended}</div>
            <div className="text-xs text-gray-600 mt-1">Total Recommendations</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-900">{overallClickRate}%</div>
            <div className="text-xs text-gray-600 mt-1">Click Rate</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-900">{overallConversionRate}%</div>
            <div className="text-xs text-gray-600 mt-1">Purchase Rate</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-900">{totalStats.purchased}</div>
            <div className="text-xs text-gray-600 mt-1">Total Purchases</div>
          </div>
        </div>
      </div>

      {/* Product List */}
      <div className="divide-y divide-gray-200">
        {sortedStats.map((product) => (
          <ProductConversionCard
            key={product.productId}
            product={product}
            isExpanded={expandedProduct === product.productId}
            onToggle={() => setExpandedProduct(
              expandedProduct === product.productId ? null : product.productId
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ProductConversionCard({ product, isExpanded, onToggle }) {
  return (
    <div className="p-6 hover:bg-gray-50 transition-colors">
      <div className="flex items-start gap-4">
        {/* Product Image */}
        {product.productImage && (
          <img
            src={product.productImage}
            alt={product.productName}
            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
          />
        )}

        {/* Product Info & Stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">
                {product.productName}
              </h4>
              {product.productPrice && (
                <p className="text-sm text-gray-600">
                  ${product.productPrice}
                </p>
              )}
            </div>
            <button
              onClick={onToggle}
              className="p-1 hover:bg-gray-200 rounded transition-colors"
            >
              {isExpanded ? (
                <ChevronUp className="w-5 h-5 text-gray-600" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-600" />
              )}
            </button>
          </div>

          {/* Main Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
            <MetricBadge
              icon={TrendingUp}
              label="Recommended"
              value={product.recommended}
              color="gray"
            />
            <MetricBadge
              icon={Eye}
              label="Clicked"
              value={product.clicked}
              color="blue"
            />
            <MetricBadge
              icon={Camera}
              label="Try-on"
              value={product.triedOn}
              color="purple"
            />
            <MetricBadge
              icon={Heart}
              label="Saved"
              value={product.saved}
              color="pink"
            />
            <MetricBadge
              icon={ShoppingCart}
              label="Carted"
              value={product.addedToCart}
              color="orange"
            />
            <MetricBadge
              icon={CheckCircle}
              label="Purchased"
              value={product.purchased}
              color="green"
            />
          </div>

          {/* Conversion Rates */}
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-600">Click Rate:</span>
              <span className="font-semibold text-blue-700">{product.clickRate}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-600">Conversion:</span>
              <span className="font-semibold text-green-700">{product.conversionRate}%</span>
            </div>
            {product.mainDropOff && (
              <div className="flex items-center gap-2">
                <span className="text-gray-600">Main drop-off:</span>
                <span className="font-medium text-red-600 text-xs bg-red-50 px-2 py-1 rounded">
                  {product.mainDropOff}
                </span>
              </div>
            )}
          </div>

          {/* Expanded View - Funnel Visualization */}
          {isExpanded && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <ConversionFunnel product={product} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricBadge({ icon: Icon, label, value, color }) {
  const colorClasses = {
    gray: "bg-gray-100 text-gray-700",
    blue: "bg-blue-100 text-blue-700",
    purple: "bg-purple-100 text-purple-700",
    pink: "bg-pink-100 text-pink-700",
    orange: "bg-orange-100 text-orange-700",
    green: "bg-green-100 text-green-700",
  };

  return (
    <div className={`${colorClasses[color]} rounded-lg px-3 py-2 flex flex-col`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function ConversionFunnel({ product }) {
  const stages = [
    { label: "Recommended in looks", value: product.recommended, color: "bg-gray-500" },
    { label: "Clicked from styling", value: product.clicked, color: "bg-blue-500" },
    { label: "Virtual try-on", value: product.triedOn, color: "bg-purple-500" },
    { label: "Saved/wishlisted", value: product.saved, color: "bg-pink-500" },
    { label: "Added to cart", value: product.addedToCart, color: "bg-orange-500" },
    { label: "Purchased", value: product.purchased, color: "bg-green-500" },
  ];

  const maxValue = product.recommended;

  return (
    <div className="space-y-2">
      <h5 className="text-sm font-semibold text-gray-900 mb-3">Conversion Funnel</h5>
      {stages.map((stage, index) => {
        const percentage = maxValue > 0 ? (stage.value / maxValue) * 100 : 0;
        const dropOffFromPrevious = index > 0 
          ? stages[index - 1].value - stage.value 
          : 0;

        return (
          <div key={stage.label} className="flex items-center gap-3">
            <div className="w-40 text-sm text-gray-700">{stage.label}</div>
            <div className="flex-1">
              <div className="bg-gray-100 rounded-full h-8 relative overflow-hidden">
                <div
                  className={`${stage.color} h-full rounded-full flex items-center px-3 transition-all duration-500`}
                  style={{ width: `${Math.max(percentage, 5)}%` }}
                >
                  <span className="text-white text-sm font-semibold">
                    {stage.value}
                  </span>
                </div>
              </div>
            </div>
            <div className="w-16 text-right text-sm text-gray-600">
              {percentage.toFixed(0)}%
            </div>
            {dropOffFromPrevious > 0 && (
              <div className="w-20 text-right text-xs text-red-600">
                -{dropOffFromPrevious}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
