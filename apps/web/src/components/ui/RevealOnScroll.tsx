import { useEffect, useRef, useState, type ReactNode } from "react";

export const RevealOnScroll = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Mobile/browser safety fallback: never keep content hidden if observer is unavailable or delayed.
    if (typeof window === "undefined") return;
    if (typeof window.IntersectionObserver !== "function") {
      setVisible(true);
      return;
    }
    if (!ref.current) return;

    const hardFallback = window.setTimeout(() => setVisible(true), 1400);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          window.clearTimeout(hardFallback);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(ref.current);
    return () => {
      window.clearTimeout(hardFallback);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-500 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
      }`}
      style={{ transitionDuration: "600ms" }}
    >
      {children}
    </div>
  );
};
