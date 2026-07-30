import { useState, useEffect, useRef } from "react";
import MyNaiaHeader from "./MyNaiaHeader";
import MyNaiaNavigation from "./MyNaiaNavigation";

interface Props {
  children: React.ReactNode;
  currentPath: string;
}

export default function MyNaiaLayout({ children, currentPath }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMobileOpen(false);
        hamburgerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  function handleClose() {
    setMobileOpen(false);
    hamburgerRef.current?.focus();
  }

  return (
    <div className="mn-page">
      <MyNaiaHeader
        mobileMenuOpen={mobileOpen}
        onToggle={() => setMobileOpen(v => !v)}
        hamburgerRef={hamburgerRef}
      />

      {/* Mobile nav overlay */}
      <div
        id="mn-nav-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={`mn-overlay${mobileOpen ? " mn-overlay--open" : ""}`}
      >
        <div className="mn-overlay-header">
          <span className="mn-overlay-wordmark">
            n<span className="mn-wordmark-accent">A</span>ia
          </span>
          <button
            className="mn-overlay-close"
            aria-label="Close navigation"
            onClick={handleClose}
          >
            ✕
          </button>
        </div>
        <div className="mn-overlay-nav">
          <MyNaiaNavigation currentPath={currentPath} onLinkClick={handleClose} />
        </div>
      </div>

      <div className="mn-body">
        <aside className="mn-sidebar" aria-label="My nAia navigation">
          <MyNaiaNavigation currentPath={currentPath} />
        </aside>
        <main className="mn-content">
          {children}
        </main>
      </div>
    </div>
  );
}
