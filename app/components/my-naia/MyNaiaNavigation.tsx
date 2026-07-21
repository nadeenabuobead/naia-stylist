import { Link } from "react-router";

interface NavItem {
  label: string;
  path?: string;
  tag?: "soon";
  subItems?: NavSubItem[];
}

interface NavSubItem {
  label: string;
  path?: string;
  tag?: "soon";
}

interface NavGroup {
  groupLabel: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    groupLabel: "MAIN",
    items: [
      { label: "OVERVIEW",      path: "/my-naia" },
      { label: "STYLE PASSPORT", path: "/full-style-profile" },
      { label: "MY CLOSET",      path: "/closet" },
      { label: "STYLEME",        path: "/style-me" },
      { label: "BUY OR SKIP",    path: "/buyskip" },
      { label: "MY TREND EDITS", tag: "soon" },
    ],
  },
  {
    groupLabel: "ACCOUNT",
    items: [
      { label: "SAVED",  tag: "soon" },
      { label: "ORDERS", tag: "soon" },
      {
        label: "PERSONALISATION",
        tag: "soon",
        subItems: [
          { label: "MY NAIA MODEL",            tag: "soon" },
          { label: "PERSONAL STYLING ANALYSIS", tag: "soon" },
          { label: "WHAT NAIA IS NOTICING",     tag: "soon" },
        ],
      },
      { label: "PLAN & USAGE",      tag: "soon" },
      { label: "SETTINGS & PRIVACY", tag: "soon" },
    ],
  },
];

function isActive(currentPath: string, path: string): boolean {
  if (path === "/my-naia") return currentPath === "/my-naia";
  return currentPath === path || currentPath.startsWith(path + "/");
}

interface Props {
  currentPath: string;
  onLinkClick?: () => void;
}

export default function MyNaiaNavigation({ currentPath, onLinkClick }: Props) {
  return (
    <nav aria-label="My nAia pages">
      {NAV.map((group) => (
        <div key={group.groupLabel} className="mn-nav-group">
          <p className="mn-nav-group-label">{group.groupLabel}</p>
          <ul className="mn-nav-list">
            {group.items.map((item) => (
              <li key={item.label}>
                {item.path ? (
                  <Link
                    to={item.path}
                    className="mn-nav-link"
                    aria-current={isActive(currentPath, item.path) ? "page" : undefined}
                    onClick={onLinkClick}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="mn-nav-static">
                    {item.label}
                    {item.tag === "soon" && (
                      <span className="mn-nav-tag">soon</span>
                    )}
                  </span>
                )}

                {item.subItems && (
                  <ul className="mn-nav-sub-list">
                    {item.subItems.map((sub) =>
                      sub.path ? (
                        <li key={sub.label}>
                          <Link
                            to={sub.path}
                            className="mn-nav-sub-link"
                            aria-current={isActive(currentPath, sub.path) ? "page" : undefined}
                            onClick={onLinkClick}
                          >
                            {sub.label}
                          </Link>
                        </li>
                      ) : (
                        <li key={sub.label}>
                          <span className="mn-nav-sub-static">
                            {sub.label}
                            {sub.tag === "soon" && (
                              <span className="mn-nav-tag">soon</span>
                            )}
                          </span>
                        </li>
                      )
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
