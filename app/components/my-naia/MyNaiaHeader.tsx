import type { RefObject } from "react";

interface Props {
  mobileMenuOpen: boolean;
  onToggle: () => void;
  hamburgerRef: RefObject<HTMLButtonElement>;
}

export default function MyNaiaHeader({ mobileMenuOpen, onToggle, hamburgerRef }: Props) {
  return (
    <header className="mn-header">
      <div className="mn-header-inner">
        <a href="/" className="mn-wordmark" aria-label="nAia home">
          n<span className="mn-wordmark-accent">A</span>ia
        </a>
        <div className="mn-header-right">
          <a href="/" className="mn-back-link" aria-label="Return to home">
            ← Home
          </a>
          <button
            ref={hamburgerRef}
            className="mn-hamburger"
            aria-expanded={mobileMenuOpen}
            aria-controls="mn-nav-overlay"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            onClick={onToggle}
          >
            {mobileMenuOpen ? "✕" : "≡"}
          </button>
        </div>
      </div>
    </header>
  );
}
