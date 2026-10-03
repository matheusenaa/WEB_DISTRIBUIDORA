import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton, Spinner } from './skeleton-basic';
import { TableSkeleton, CardSkeleton, ListSkeleton, StatCardSkeleton, DashboardSkeleton } from './skeleton-advanced';

export { Skeleton, Spinner, TableSkeleton, CardSkeleton, ListSkeleton, StatCardSkeleton, DashboardSkeleton };

/* ---------------- Card ---------------- */

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3', className)}>
      <div className="space-y-0.5">
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-base font-semibold leading-tight', className)}>{children}</h2>;
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-4', className)} {...props}>
      {children}
    </div>
  );
}

/* ---------------- Badge ---------------- */

type Tone = 'default' | 'success' | 'warning' | 'destructive' | 'muted' | 'accent';

const TONES: Record<Tone, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/15 text-destructive',
  muted: 'bg-muted text-muted-foreground',
  accent: 'bg-accent/20 text-accent-foreground',
};

export function Badge({
  tone = 'default',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------- Modal ---------------- */

/* ---------------- Pilha de modais ---------------- */

/**
 * Modais abertos, do mais antigo para o mais novo.
 *
 * Sem isto, cada modal registra o proprio listener de Escape no `window` e
 * um unico aperto fecha todos de uma vez. No PDV isso acontece de verdade: o
 * modal de pagamento e o de caixa ficam montados ao mesmo tempo.
 */
const modalStack: string[] = [];

/** Quantos modais estao abertos (para travar o scroll do fundo uma vez). */
function lockScroll(): void {
  if (modalStack.length === 1) document.body.style.overflow = 'hidden';
}

function unlockScroll(): void {
  if (modalStack.length === 0) document.body.style.overflow = '';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const id = titleId;
    modalStack.push(id);
    lockScroll();

    // Elemento que tinha o foco antes do modal abrir. Guardado aqui, e nao
    // em um ref externo, porque o foco pode ter mudado entre a ordenacao e
    // o clique que abriu o modal.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // O painel precisa receber o foco para que Tab\e possa circular dentro
    // dele. Sem isso, Tab comeca no documento e o foco vai para tras do
    // overlay.
    panelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      // Apenas o modal do topo reage: um Escape fecha uma camada por vez.
      if (modalStack[modalStack.length - 1] !== id) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      // Tab no ultimo / Shift+Tab no primeiro volta para o comeco do painel,
      // em vez de escapar para a pagina de tras.
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey, true);

    return () => {
      window.removeEventListener('keydown', onKey, true);
      const index = modalStack.indexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
      unlockScroll();
      // Devolve o foco para onde o operador estava. Sem isso o foco cai no
      // <body> e o proximo Tab recomeca do topo da pagina.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose, titleId]);

  if (!open) return null;

  const widths = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
    full: 'max-w-[95vw]',
  } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg border border-border bg-card shadow-xl outline-none sm:rounded-lg',
          'animate-fade-in',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="space-y-0.5">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Estados de lista ---------------- */

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ---------------- DataTable ---------------- */

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Alinhamento e largura fixos quando necessarios. */
  className?: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  emptyState,
  loading,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  loading?: boolean;
}) {
  if (loading) {
    /**
     * Esqueleto com a mesma quantidade de linhas e colunas da tabela, em vez
     * de um "Carregando..." centralizado. O formato da tabela fica reservado
     * enquanto os dados chegam, entao nao ha o salto de layout que faz a
     * pagina pular a cada busca.
     */
    const rowCount = Math.max(3, Math.min(rows.length || 8, 12));
    return (
      <div className="overflow-x-auto">
        <table className="table-compact w-full border-collapse">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={column.className} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    <Skeleton
                      className={cn(
                        'h-4',
                        // A primeira coluna costuma ser o nome: um bloco mais
                        // largo imita melhor o conteudo real.
                        column.key === columns[0]?.key ? 'w-full max-w-[14rem]' : 'w-12 ml-auto',
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sr-only" role="status">
          Carregando...
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return <>{emptyState ?? <EmptyState title="Nenhum registro encontrado" />}</>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="table-compact w-full border-collapse">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer' : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.className}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Confirm dialog ---------------- */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  destructive = false,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-white shadow-sm transition-colors disabled:opacity-50',
              destructive ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90',
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-foreground">{message}</div>
    </Modal>
  );
}

/* ---------------- Pagination ---------------- */

export function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span>{total} registro(s)</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
      <span>
        Pagina {page} de {totalPages} - {total} registro(s)
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="h-8 rounded-md border border-input px-3 font-medium transition-colors hover:bg-muted disabled:opacity-40"
        >
          Anterior
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="h-8 rounded-md border border-input px-3 font-medium transition-colors hover:bg-muted disabled:opacity-40"
        >
          Proxima
        </button>
      </div>
    </div>
  );
}