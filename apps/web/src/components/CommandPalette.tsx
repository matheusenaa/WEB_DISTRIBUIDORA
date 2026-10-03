import { Search, Plus, ShoppingCart, CreditCard, FileText, Settings, ScanBarcode, Calculator, Database, X, Monitor, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import { NAV_GROUPS } from '@/config/navigation';
import { useAuth } from '@/lib/auth';
import type { Permission } from '@webdist/shared';

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  shortcut?: string[];
  action: () => void;
  category: string;
  permission?: Permission;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [commands, setCommands] = useState<Command[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build commands list based on permissions and current context
  useEffect(() => {
    const allCommands: Command[] = [
      // Navigation commands
      ...NAV_GROUPS.flatMap((group) =>
        group.items
          .filter((item) => item.permissions.some((p) => can(p)))
          .map((item) => ({
            id: `nav-${item.to}`,
            label: item.label,
            description: `Navegar para ${group.label}`,
            icon: item.icon as unknown as React.ReactNode,
            action: () => {
              navigate(item.to);
              onClose();
            },
            category: 'Navegação',
            permission: item.permissions[0],
          }))
      ),
      // Global actions
      {
        id: 'action-new-product',
        label: 'Novo produto',
        description: 'Cadastrar um novo produto',
        icon: <Plus className="h-4 w-4" />,
        shortcut: ['Ctrl', 'N'],
        action: () => {
          navigate('/produtos');
          onClose();
        },
        category: 'Ações',
        permission: 'products:create',
      },
      {
        id: 'action-new-sale',
        label: 'Nova venda (PDV)',
        description: 'Abrir ponto de venda para nova venda',
        icon: <ShoppingCart className="h-4 w-4" />,
        shortcut: ['F2'],
        action: () => {
          navigate('/pdv');
          onClose();
        },
        category: 'Ações',
        permission: 'sales:create',
      },
      {
        id: 'action-open-cash',
        label: 'Abrir caixa',
        description: 'Abrir sessão de caixa',
        icon: <CreditCard className="h-4 w-4" />,
        shortcut: ['F9'],
        action: () => {
          navigate('/caixa');
          onClose();
        },
        category: 'Ações',
        permission: 'cash:open',
      },
      {
        id: 'action-search-products',
        label: 'Buscar produtos',
        description: 'Pesquisar produtos por nome ou código',
        icon: <Search className="h-4 w-4" />,
        shortcut: ['F3'],
        action: () => {
          navigate('/produtos');
          onClose();
        },
        category: 'Ações',
        permission: 'products:read',
      },
      {
        id: 'action-view-reports',
        label: 'Ver relatórios',
        description: 'Abrir relatórios e análises',
        icon: <FileText className="h-4 w-4" />,
        action: () => {
          navigate('/relatorios');
          onClose();
        },
        category: 'Ações',
        permission: 'reports:read',
      },
      {
        id: 'action-settings',
        label: 'Configurações',
        description: 'Abrir configurações do sistema',
        icon: <Settings className="h-4 w-4" />,
        shortcut: ['Ctrl', ','],
        action: () => {
          navigate('/configuracoes');
          onClose();
        },
        category: 'Ações',
        permission: 'settings:read',
      },
      {
        id: 'action-barcode-test',
        label: 'Testar leitor de código de barras',
        description: 'Abrir ferramenta de diagnóstico do scanner',
        icon: <ScanBarcode className="h-4 w-4" />,
        action: () => {
          navigate('/teste-leitor');
          onClose();
        },
        category: 'Ferramentas',
        permission: 'products:read',
      },
      {
        id: 'action-calculator',
        label: 'Calculadora de margem/markup',
        description: 'Calcular preços, margens e markups',
        icon: <Calculator className="h-4 w-4" />,
        action: () => {
          navigate('/calculadora');
          onClose();
        },
        category: 'Ferramentas',
        permission: 'products:read',
      },
      {
        id: 'action-import-nfe',
        label: 'Importar NF-e (XML)',
        description: 'Importar produtos de arquivo XML da NF-e',
        icon: <FileText className="h-4 w-4" />,
        action: () => {
          navigate('/produtos');
          onClose();
        },
        category: 'Ferramentas',
        permission: 'products:create',
      },
      {
        id: 'action-backup',
        label: 'Criar backup',
        description: 'Gerar backup do banco de dados',
        icon: <Database className="h-4 w-4" />,
        action: () => {
          navigate('/configuracoes');
          onClose();
        },
        category: 'Sistema',
        permission: 'settings:manage',
      },
      {
        id: 'action-theme-toggle',
        label: 'Alternar tema',
        description: 'Mudar entre claro, escuro e sistema',
        icon: <Monitor className="h-4 w-4" />,
        shortcut: ['Ctrl', 'Shift', 'T'],
        action: () => {
          onClose();
        },
        category: 'Sistema',
      },
      // Shortcuts as commands
      {
        id: 'shortcut-new-sale',
        label: 'Nova venda (atalho F2)',
        description: 'Iniciar nova venda no PDV',
        icon: <Zap className="h-4 w-4" />,
        shortcut: ['F2'],
        action: () => {
          navigate('/pdv');
          onClose();
        },
        category: 'Atalhos',
        permission: 'sales:create',
      },
      {
        id: 'shortcut-payment',
        label: 'Abrir pagamento (atalho F4)',
        description: 'Finalizar venda no PDV',
        icon: <Zap className="h-4 w-4" />,
        shortcut: ['F4'],
        action: () => {
          onClose();
        },
        category: 'Atalhos',
        permission: 'sales:create',
      },
      {
        id: 'shortcut-clear-cart',
        label: 'Esvaziar carrinho (atalho F8)',
        description: 'Limpar todos os itens do carrinho',
        icon: <Zap className="h-4 w-4" />,
        shortcut: ['F8'],
        action: () => {
          onClose();
        },
        category: 'Atalhos',
        permission: 'sales:create',
      },
      {
        id: 'shortcut-cash',
        label: 'Abrir caixa (atalho F9)',
        description: 'Abrir sessão de caixa',
        icon: <Zap className="h-4 w-4" />,
        shortcut: ['F9'],
        action: () => {
          navigate('/caixa');
          onClose();
        },
        category: 'Atalhos',
        permission: 'cash:read',
      },
      {
        id: 'shortcut-close',
        label: 'Fechar janela/modal (Esc)',
        description: 'Fechar janela atual',
        icon: <X className="h-4 w-4" />,
        shortcut: ['Esc'],
        action: () => {
          onClose();
        },
        category: 'Atalhos',
      },
    ];

    const filtered = allCommands.filter((cmd) => !cmd.permission || can(cmd.permission));
    setCommands(filtered);
  }, [can, navigate, onClose]);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description?.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q) ||
        cmd.shortcut?.some((k) => k.toLowerCase().includes(q))
    );
  }, [commands, query]);

  // Group commands by category
  const groupedCommands = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    for (const cmd of filteredCommands) {
      const cat = cmd.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(cmd);
    }
    return groups;
  }, [filteredCommands]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const total = filteredCommands.length;
      if (total === 0) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % total);
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + total) % total);
          break;
        case 'Enter':
          event.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
          }
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, filteredCommands, selectedIndex, onClose]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="" size="lg">
      <div className="flex flex-col h-full max-h-[80vh]">
        {/* Search Input */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Digite um comando ou procure uma ação... (Ctrl+K para fechar)"
            className="w-full pl-10 h-12 text-lg rounded-md border border-input bg-background px-4 py-3"
            autoFocus
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-mono bg-muted rounded border">
            Ctrl+K
          </kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-lg">Nenhum comando encontrado</p>
              <p className="text-sm">Tente ajustar sua busca</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedCommands).map(([category, cmds]) => (
                <div key={category} className="space-y-2">
                  <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {category}
                  </p>
                  {cmds.map((cmd) => {
                    const isSelected = filteredCommands.indexOf(cmd) === selectedIndex;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        onClick={() => cmd.action()}
                        onMouseEnter={() => setSelectedIndex(filteredCommands.indexOf(cmd))}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                          isSelected
                            ? 'bg-accent text-accent-foreground'
                            : 'hover:bg-muted text-foreground',
                          'touch-target'
                        )}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                          {cmd.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{cmd.label}</p>
                          {cmd.description && (
                            <p className="text-xs text-muted-foreground truncate">{cmd.description}</p>
                          )}
                        </div>
                        {cmd.shortcut && (
                          <span className="flex gap-1 opacity-70">
                            {cmd.shortcut.map((key) => (
                              <kbd
                                key={key}
                                className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold"
                              >
                                {key}
                              </kbd>
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>↑↓ Navegar • Enter Executar • Esc Fechar</span>
          <span>Ctrl+K para abrir/fechar</span>
        </div>
      </div>
    </Modal>
  );
}