import { useState, useEffect, useRef } from "react";
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

      {/* Mobile-only sticky bar: wordmark + hamburger trigger */}
      <div className="mn-mobile-bar">
        <a href="/my-naia" className="mn-wordmark" aria-label="nAia home">
          MY <em>n<span className="mn-wordmark-accent">A</span>ia.</em>
        </a>
        <button
          ref={hamburgerRef}
          className="mn-hamburger"
          aria-expanded={mobileOpen}
          aria-controls="mn-nav-overlay"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileOpen(v => !v)}
        >
          {mobileOpen ? "✕" : "≡"}
        </button>
      </div>

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
            MY <em>n<span className="mn-wordmark-accent">A</span>ia.</em>
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

      {/* Large editorial "MY nAia." heading — below mobile bar, above sidebar+content */}
      <div className="mn-page-heading">
        <div className="mn-page-heading-meta">
          <span className="mn-page-heading-preview">Preview</span>
        </div>
        <h1 className="mn-page-heading-title">
          MY <em>nAia.</em>
        </h1>
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
