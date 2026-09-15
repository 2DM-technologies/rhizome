import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";
const SESSION_THEME_KEY = "rhizome.theme";
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

function readSessionTheme(): Theme | null {
  try {
    const theme = sessionStorage.getItem(SESSION_THEME_KEY);
    return theme === "light" || theme === "dark" ? theme : null;
  } catch {
    return null;
  }
}

/** The system remains authoritative until a command sets a tab-session override. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState(readSessionTheme);
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light",
  );

  useEffect(() => {
    const media = window.matchMedia(SYSTEM_THEME_QUERY);
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    if (override) document.documentElement.dataset.theme = override;
    else delete document.documentElement.dataset.theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [override]);

  function setTheme(theme: Theme) {
    setOverride(theme);
    try {
      sessionStorage.setItem(SESSION_THEME_KEY, theme);
    } catch {
      // A blocked session store still permits an override for this page's lifetime.
    }
  }

  return (
    <ThemeContext value={{ theme: override ?? systemTheme, setTheme }}>{children}</ThemeContext>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is required");
  return value;
}
