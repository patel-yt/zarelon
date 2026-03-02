import type { ReactNode } from "react";
import "./layout.css";

interface Props {
  children: ReactNode;
}

export default function MainLayout({ children }: Props) {
  return (
    <div className="layout">
      <header className="header">
        <div className="container header-inner">
          <div className="logo gold-text">ZARELON</div>

          <nav className="nav">
            <a href="#">Shop</a>
            <a href="#">Collections</a>
            <a href="#">About</a>
          </nav>

          <div className="actions">
            <span>🔍</span>
            <span>👤</span>
            <span>🛒</span>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="footer">
        <div className="container footer-inner">
          <div className="gold-line"></div>
          <p>© {new Date().getFullYear()} ZARELON. All Rights Reserved.</p>
        </div>
      </footer>
    </div>
  );
}
