import { Link } from "react-router";

interface NavItem {
  label: string;
  path: string | null;
  tag?: "soon" | "shopify";
}

const NAV_ITEMS: NavItem[] = [
  { label: "OVERVIEW",                   path: "/my-naia" },
  { label: "STYLE PASSPORT",             path: "/passport" },
  { label: "DIGITAL CLOSET",             path: "/closet" },
  { label: "STYLEME",                    path: "/style-me" },
  { label: "BUY OR SKIP",               path: "/buyskip" },
  { label: "MY nAia MODEL",             path: "/my-naia-model" },
  { label: "PERSONAL STYLING ANALYSIS", path: "/passport/selfie" },
  { label: "MY TREND EDITS",            path: "/trends" },
  { label: "SAVED",                      path: "/my-naia/saved" },
  { label: "ORDERS",                     path: null, tag: "shopify" },
  { label: "SETTINGS & PRIVACY",        path: "/settings" },
];

interface Props {
  currentPath: string;
  onLinkClick?: () => void;
}

export default function MyNaiaNavigation({ currentPath, onLinkClick }: Props) {
  return (
    <nav aria-label="My nAia pages">
      <p className="mn-nav-eyebrow">My nAia</p>
      <ul className="mn-nav-list">
        {NAV_ITEMS.map((item) => {
          if (!item.path) {
            return (
              <li key={item.label}>
                <span className="mn-nav-static">
                  {item.label}
                  {item.tag === "soon" && (
                    <span className="mn-nav-tag">soon</span>
                  )}
                  {item.tag === "shopify" && (
                    <span className="mn-nav-tag mn-nav-tag--shopify">shopify</span>
                  )}
                </span>
              </li>
            );
          }

          const isCurrent = currentPath === item.path ||
            (item.path !== "/my-naia" && currentPath.startsWith(item.path));

          return (
            <li key={item.label}>
              <Link
                to={item.path}
                className="mn-nav-link"
                aria-current={isCurrent ? "page" : undefined}
                onClick={onLinkClick}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
