import { useEffect, useRef } from "react";
import gsap from "gsap";

export const useRevealAnimation = () => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }
      );
    }, ref);

    return () => context.revert();
  }, []);

  return ref;
};
