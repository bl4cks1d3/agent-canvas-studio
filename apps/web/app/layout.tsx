import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Canvas",
  description: "Um canvas onde agentes de IA são nós ligados por fios",
};

// Aplica o tema salvo (escuro por padrao) antes da primeira pintura, sem "flash".
const THEME_SCRIPT = "try{var t=localStorage.getItem('agent-canvas.theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
