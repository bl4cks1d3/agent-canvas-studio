"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "agent-canvas.theme";

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // sem persistencia: vale so nesta aba
  }
}

/** Tema atual do dashboard (escuro por padrao); reage a mudancas do atributo data-theme. */
export function useTheme(): Theme {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    setThemeState(current());
    const el = document.documentElement;
    const observer = new MutationObserver(() => setThemeState(current()));
    observer.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
