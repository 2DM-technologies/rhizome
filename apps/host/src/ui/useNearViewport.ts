import { useEffect, useRef, useState } from "react";

const cardActivators = new WeakMap<Element, () => void>();
let cardObserver: IntersectionObserver | undefined;

function nearViewportObserver(): IntersectionObserver | undefined {
  if (typeof IntersectionObserver === "undefined") return undefined;
  cardObserver ??= new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        cardActivators.get(entry.target)?.();
        cardActivators.delete(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "320px 0px" },
  );
  return cardObserver;
}

export function useNearViewport<T extends HTMLElement = HTMLLIElement>() {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (active) return;
    const element = ref.current;
    const observer = nearViewportObserver();
    if (!element || !observer) {
      setActive(true);
      return;
    }
    cardActivators.set(element, () => setActive(true));
    observer.observe(element);
    return () => {
      cardActivators.delete(element);
      observer.unobserve(element);
    };
  }, [active]);

  return { active, ref };
}
