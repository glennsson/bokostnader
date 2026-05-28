export const THEME_STORAGE_KEY = "bokostnader-theme";

export function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") {
      return saved;
    }
  } catch {
    // localStorage utilgjengelig
  }

  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

export function applyThemeToDocument(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}
