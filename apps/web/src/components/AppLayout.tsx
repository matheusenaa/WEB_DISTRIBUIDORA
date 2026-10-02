import type { Permission } from '@webdist/shared';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Sun,
  UserCog,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge, Modal } from '@/components/ui';
import { NAV_GROUPS } from '@/config/navigation';
import { useAuth } from '@/lib/auth';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { useOnlineStatus } from '@/lib/useOnline';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { ROLE_LABELS } from '@webdist/shared';

/**
 * Estrutura da aplicacao: barra lateral por permissao + area de conteudo.
 * A filtragem por permissao aqui e apenas de exibicao - o backend
 * continua validando cada operacao.
 */

const SIDEBAR_KEY = 'wd.sidebarCollapsed';

export function AppLayout() {
  const { user, can, logout } = useAuth();
  const location = useLocation();
  const online = useOnlineStatus();

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === 'true',
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  }, [collapsed]);

  // Trocar de rota fecha o menu no celular.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const groups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          item.permissions.some((permission) => can(permission)),
        ),
      })).filter((group) => group.items.length > 0),
    [can],
  );

  // Ctrl+K (ou Cmd+K no macOS) abre a lista de atalhos.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // `metaKey` cobre o Cmd do macOS, que e o atalho que o usuario espera
      // la. Antes so o ctrlKey respondia.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        // Abre em vez de alternar: com um modal ja aberto, alternar fechava
        // o dialogo e deixava o operador onde estava, sem feedback nenhum.
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      {/* ---------------- Sidebar ---------------- */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200',
          collapsed ? 'w-16' : 'w-60',
          // No desktop a barra e sempre visivel; abaixo de lg ela e uma gaveta.
          // A variante lg: vence a classe sem prefixo, entao translate-x-0
          // prevalece em telas grandes mesmo com o menu marcado como fechado.
          'lg:translate-x-0',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center border-b border-sidebar-border px-3',
            collapsed && 'justify-center px-0',
          )}
        >
          {!collapsed ? (
            <>
              <img
                src="/logo-web-distribuidora.jpeg"
                alt="WEB DISTRIBUIDORA"
                className="h-8 w-auto shrink-0 rounded-md object-contain"
              />
              <div className="ml-2.5 min-w-0">
                <p className="truncate text-sm font-bold leading-tight">WEB DISTRIBUIDORA</p>
                <p className="truncate text-[11px] leading-tight text-sidebar-foreground/60">
                  Gestao comercial
                </p>
              </div>
            </>
          ) : (
            <img
              src="/logo-web-distribuidora.jpeg"
              alt="WEB DISTRIBUIDORA"
              className="h-8 w-auto shrink-0 rounded-md object-contain"
            />
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
          {groups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/45">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'flex touch-target items-center rounded-md text-sm font-medium transition-colors',
                          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
                          isActive
                            ? 'bg-accent text-accent-foreground'
                            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                        )
                      }
                    >
                      <item.icon className="h-4.5 w-4.5 shrink-0" style={{ height: 18, width: 18 }} aria-hidden />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          {user && (
            <NavLink
              to="/perfil"
              onClick={() => setMobileOpen(false)}
              title="Meu perfil"
              className={({ isActive }) =>
                cn(
                  'mb-1 flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent',
                  isActive && 'bg-sidebar-accent',
                )
              }
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-bold text-sidebar-foreground">
                {initials(user.name)}
              </div>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold leading-tight">{user.name}</p>
                    <p className="truncate text-[11px] leading-tight text-sidebar-foreground/60">
                      {ROLE_LABELS[user.role]}
                    </p>
                  </div>
                  <span className="rounded p-1 text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground">
                    <UserCog className="h-4 w-4" aria-hidden />
                  </span>
                </>
              )}
            </NavLink>
          )}
          {user && (
            <button
              type="button"
              onClick={() => void logout()}
              title="Sair"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-destructive"
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden />
              {!collapsed && <span>Sair</span>}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className={cn(
              'hidden w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent lg:flex',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronLeft className="h-4 w-4" aria-hidden />}
            {!collapsed && <span>Recolher</span>}
          </button>
        </div>
      </aside>

      {/* Sobreposicao do menu no celular. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* ---------------- Conteudo ---------------- */}
      <div className={cn('flex min-w-0 flex-1 flex-col transition-all duration-200', collapsed ? 'lg:pl-16' : 'lg:pl-60')}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>

          <Breadcrumb />

          <div className="ml-auto flex items-center gap-1.5">
            {/* Indicador de conexao: evita ficar tentando salvar offline sem aviso. */}
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium',
                online ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
              )}
              title={online ? 'Conectado' : 'Sem conexao com a API'}
            >
              {online ? <Wifi className="h-3.5 w-3.5" aria-hidden /> : <WifiOff className="h-3.5 w-3.5" aria-hidden />}
              <span className="hidden sm:inline">{online ? 'Online' : 'Offline'}</span>
            </span>

            <ThemeToggle />

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShortcutsOpen(true)}
              title="Atalhos de teclado (Ctrl+K)"
              aria-label="Atalhos de teclado"
            >
              <Keyboard className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

/* ---------------- Breadcrumb ---------------- */

function Breadcrumb() {
  const location = useLocation();
  const { can } = useAuth();

  const label = useMemo(() => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (!item.permissions.some((permission) => can(permission))) continue;
        if (item.to === '/') {
          if (location.pathname === '/') return item.label;
          continue;
        }
        if (location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)) {
          return item.label;
        }
      }
    }
    return null;
  }, [location.pathname, can]);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <img
        src="/logo-web-distribuidora.jpeg"
        alt="WEB DISTRIBUIDORA"
        className="h-6 w-auto shrink-0 rounded-md object-contain"
      />
      <span className="shrink-0 text-sm font-bold text-primary">WEB DISTRIBUIDORA</span>
      {label && (
        <>
          <span className="text-muted-foreground/50">/</span>
          <span className="truncate text-sm text-muted-foreground">{label}</span>
        </>
      )}
    </div>
  );
}

/* ---------------- Alternador de tema ---------------- */

/**
 * Alterna claro/escuro/sistema.
 *
 * Vai ate "sistema" em vez de alternar entre dois estados: quem trabalha de
 * noite e de dia no mesmo aparelho precisa disso, e sem a opcao o tema
 * ficava preso num dos lados.
 */
function ThemeToggle() {
  const { choice, theme, setChoice } = useTheme();

  const next: ThemeChoice = choice === 'claro' ? 'escuro' : choice === 'escuro' ? 'sistema' : 'claro';
  const label = { claro: 'claro', escuro: 'escuro', sistema: 'do sistema' }[choice];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setChoice(next)}
      title={`Tema ${label}. Clique para alternar.`}
      aria-label={`Tema ${label}. Clique para alternar.`}
    >
      {choice === 'sistema' ? (
        <Monitor className="h-4 w-4" aria-hidden />
      ) : theme === 'escuro' ? (
        <Moon className="h-4 w-4" aria-hidden />
      ) : (
        <Sun className="h-4 w-4" aria-hidden />
      )}
    </Button>
  );
}

/* ---------------- Atalhos ---------------- */

/* Atalhos globais e atalhos que valem apenas dentro do PDV. */
const SHORTCUTS: { keys: string[]; action: string; scope?: string; permission?: Permission }[] = [
  { keys: ['Ctrl', 'K'], action: 'Abrir esta lista' },
  { keys: ['Esc'], action: 'Fechar janela atual' },
  { keys: ['F2'], action: 'Iniciar nova venda', scope: 'PDV', permission: 'sales:create' },
  { keys: ['F4'], action: 'Abrir pagamento', scope: 'PDV', permission: 'sales:create' },
  { keys: ['F8'], action: 'Esvaziar carrinho', scope: 'PDV', permission: 'sales:create' },
  { keys: ['F9'], action: 'Abrir caixa', scope: 'PDV', permission: 'sales:create' },
];

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = useAuth();

  /**
   * Usa o `Modal` compartilhado em vez de um dialogo proprio. A versao
   * anterior anunciava "Esc fecha a janela" na propria lista de atalhos e nao
   * tratava Escape - so fechava pelo fundo, pelo X ou por um segundo Ctrl+K.
   * O Modal compartilhado ainda traz foco preso, retorno de foco e trava de
   * scroll de graca.
   */
  return (
    <Modal open={open} onClose={onClose} title="Atalhos de teclado" size="sm">
      <ul className="divide-y divide-border">
        {SHORTCUTS.filter((s) => !s.permission || can(s.permission)).map((shortcut) => (
          <li key={shortcut.action} className="flex items-center justify-between py-2">
            <span className="flex items-center gap-2 text-sm">
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {shortcut.action}
              {shortcut.scope && (
                <Badge tone="muted" className="ml-1">
                  {shortcut.scope}
                </Badge>
              )}
            </span>
            <span className="flex gap-1">
              {shortcut.keys.map((key) => (
                <kbd
                  key={key}
                  className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold"
                >
                  {key}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        O leitor de codigo de barras funciona automaticamente: basta bipar com o leitor conectado
        enquanto o PDV estiver aberto.
      </p>
    </Modal>
  );
}