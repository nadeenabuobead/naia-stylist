import { Link } from "react-router";

interface NavItem {
  label: string;
  path: string | null;
  indent?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "MAIN",
    items: [
      { label: "OVERVIEW",       path: "/my-naia" },
      { label: "STYLE PASSPORT", path: "/passport" },
      { label: "DIGITAL CLOSET", path: "/closet" },
      { label: "STYLEME",        path: "/style-me" },
      { label: "BUY OR SKIP",    path: "/buyskip" },
      { label: "MY TREND EDITS",            path: "/trends/my-edits" },
    ],
  },
  {
    title: "PERSONALISATION",
    items: [
      { label: "MY nAia MODEL",             path: "/my-naia-model" },
      { label: "WHAT nAia IS NOTICING",     path: "/my-naia/what-naia-notices" },
    ],
  },
  {
    title: "ACCOUNT",
    items: [
      { label: "PLAN & USAGE",              path: "/my-naia/plan-usage" },
      { label: "SETTINGS & PRIVACY",        path: "/settings" },
    ],
  },
];

// Flat list used by the test suite — must match the groups above exactly.
export const NAV_ITEMS_FLAT = NAV_GROUPS.flatMap((g) => g.items);

interface Props {
  currentPath: string;
  onLinkClick?: () => void;
}

export default function MyNaiaNavigation({ currentPath, onLinkClick }: Props) {
  return (
    <nav aria-label="My nAia pages" className="mn-nav-groups">
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="mn-nav-group">
          <span className="mn-nav-group-label">{group.title}</span>
          <ul className="mn-nav-list">
            {group.items.map((item) => {
              if (!item.path) {
                return (
                  <li key={item.label}>
                    <span className={`mn-nav-static${item.indent ? " mn-nav-link--indent" : ""}`}>
                      <span className="mn-nav-link-inner">
                        <span className="mn-nav-dash" aria-hidden />
                        {item.label}
                      </span>
                    </span>
                  </li>
                );
              }

              const isCurrent =
                currentPath === item.path ||
                (item.path !== "/my-naia" && currentPath.startsWith(item.path));

              return (
                <li key={item.label}>
                  <Link
                    to={item.path}
                    className={`mn-nav-link${item.indent ? " mn-nav-link--indent" : ""}`}
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={onLinkClick}
                  >
                    <span className="mn-nav-link-inner">
                      <span className="mn-nav-dash" aria-hidden />
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
