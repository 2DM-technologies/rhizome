import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import lightWallpaper from "../assets/brand/wallpaper.png";
import darkWallpaper from "../assets/brand/wallpaper-dark.png";
import type { Theme } from "../theme.tsx";

/** Temporary wallpaper layers; the desktop's CSS background handles the settled theme. */
export function DesktopWallpaper({ theme }: { theme?: Theme }) {
  const root = useRef<HTMLDivElement>(null);
  const previousTheme = useRef(theme);
  const animation = useRef<Animation | null>(null);
  const generation = useRef(0);

  const clear = useCallback(() => {
    generation.current++;
    animation.current?.cancel();
    animation.current = null;
    root.current?.replaceChildren();
    root.current?.removeAttribute("data-wallpaper-transition");
  }, []);

  useLayoutEffect(() => {
    const previous = previousTheme.current;
    previousTheme.current = theme;
    if (previous === theme) return;
    const container = root.current;
    if (
      !container ||
      !previous ||
      !theme ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      clear();
      return;
    }

    const request = ++generation.current;
    let dark = container.lastElementChild as HTMLDivElement | null;
    if (!dark) {
      const light = document.createElement("div");
      light.className = "desktop-wallpaper-layer desktop-wallpaper-light";
      dark = document.createElement("div");
      dark.className = "desktop-wallpaper-layer desktop-wallpaper-dark";
      dark.style.opacity = previous === "dark" ? "1" : "0";
      container.append(light, dark);
      container.dataset.wallpaperTransition = "active";
    }

    // Freeze the visible blend before reversing an in-flight fade.
    const opacity = Number(getComputedStyle(dark).opacity);
    animation.current?.cancel();
    animation.current = null;
    dark.style.opacity = String(opacity);
    const target = theme === "dark" ? 1 : 0;
    if (opacity === target) {
      clear();
      return;
    }

    // Keep the previous wallpaper visible until the incoming image is decoded.
    const incoming = new Image();
    incoming.src = theme === "dark" ? darkWallpaper : lightWallpaper;
    void incoming
      .decode()
      .catch(() => {})
      .then(() => {
        if (generation.current !== request || !container.isConnected) return;
        const fade = dark.animate([{ opacity }, { opacity: target }], {
          duration: 250,
          easing: "ease-in-out",
          fill: "forwards",
        });
        animation.current = fade;
        fade.onfinish = () => {
          if (animation.current === fade) clear();
        };
      });
  }, [theme, clear]);

  useEffect(() => {
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      if (reducedMotion.matches) clear();
    };
    reducedMotion.addEventListener("change", change);
    return () => {
      reducedMotion.removeEventListener("change", change);
      clear();
    };
  }, [clear]);

  return <div ref={root} className="desktop-wallpaper-transition" aria-hidden="true" />;
}
