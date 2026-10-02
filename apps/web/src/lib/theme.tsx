import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * TEMA CLARO / ESCURO / SISTEMA
 *
 * O `darkMode: ['class']` do Tailwind exige a classe `dark` no <html>, entao
 * a aplicar e no elemento raiz e nao em um container - se ficasse em uma
 * div, os portais (modais, toasts) ficariam fora do tema.
 *
 * A escolha fica em localStorage e vale como padrao; com "sistema", o
 * navegador decide e a aplicacao so acompanha a mudanca.
 */

export type ThemeChoice = 'claro' | 'escuro' | 'sistema';

const STORAGE_KEY = 'wd.theme';

/** Tema efetivo, ja resolvido a partir da escolha do usuario. */
export type ResolvedTheme = 'claro' | 'escuro';

interface ThemeContextValue {
  /** O que o usuario escolheu. */
  choice: ThemeChoice;
  /** O que esta valendo agora, ja resolvendo "sistema". */
  theme: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'claro' || stored === 'escuro' || stored === 'sistema') return stored;
  } catch {
    /* modo privado: cai no padrao */
  }
  return 'sistema';
}

function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'escuro');

  // A barra do navegador mobile ainda ficava na cor do tema claro.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'escuro' ? '#131c26' : '#0f2942';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  // Acompanha a mudanca do sistema apenas para reagir quando a escolha e
  // "sistema". Registrar sempre seria trabalho inutil, mas inofensivo: o
  // efeito abaixo so reaplica quando `choice` muda.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const theme: ResolvedTheme = choice === 'sistema' ? (systemDark ? 'escuro' : 'claro') : choice;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* modo privado: vale so nesta sessao */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, theme, setChoice }),
    [choice, theme, setChoice],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme precisa estar dentro de <ThemeProvider>.');
  return context;
}

/**
 * Aplica o tema salvo antes da primeira pintura.
 *
 * Sem isso a pagina aparece clara e so escurece depois do primeiro render do
 * React - o "flash" de tema, bem visivel em quem escolheu o escuro.
 */
export function initTheme(): void {
  applyTheme(readChoice() === 'sistema' ? (prefersDark() ? 'escuro' : 'claro') : (readChoice() as ResolvedTheme));
}