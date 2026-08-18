// Canonical public storefront — nadine-storefront Vercel project
// Source of truth: nadine-storefront/src/components/SiteNav.tsx navLinks
// Architecture: storefront proxies /trends/:slug/lens/:lens → naia-stylist via vercel.json rewrite
export const STOREFRONT_ORIGIN =
  "https://nadine-storefront-nadeenabuobeads-projects.vercel.app";

// Five storefront destinations for the public trend-reports nav.
// TREND REPORTS is omitted — it stays as an internal naia-stylist /trends link.
export const STOREFRONT_NAV = [
  { label: "HOME",           path: "/" },
  { label: "THE HOUSE",      path: "/about" },
  { label: "THE COLLECTION", path: "/collection" },
  { label: "THE ART STORY",  path: "/art-story" },
  { label: "nAia STYLIST",   path: "/ai-stylist" },
] as const;
