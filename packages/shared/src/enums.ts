export const PRODUCT_UNITS = ['UN', 'CX', 'PCT', 'KG', 'G', 'L', 'ML', 'M', 'PAR', 'DZ'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const PRODUCT_STATUSES = ['ATIVO', 'INATIVO'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const STOCK_MOVEMENT_TYPES = [
  'ENTRADA',
  'SAIDA',
  'AJUSTE',
  'DEVOLUCAO',
  'PERDA',
  'TRANSFERENCIA_SAIDA',
  'TRANSFERENCIA_ENTRADA',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saida',
  AJUSTE: 'Ajuste',
  DEVOLUCAO: 'Devolucao',
  PERDA: 'Perda',
  TRANSFERENCIA_SAIDA: 'Transferencia (saida)',
  TRANSFERENCIA_ENTRADA: 'Transferencia (entrada)',
};

export const SALE_STATUSES = ['CONCLUIDA', 'CANCELADA'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_PAYMENT_METHODS = [
  'DINHEIRO',
  'PIX',
  'CREDITO',
  'DEBITO',
  'CARTAO_CREDITO',
  'CARTAO_DEBITO',
  'BOLETO',
  'TRANSFERENCIA',
  'OUTRO',
] as const;
export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<SalePaymentMethod, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  CREDITO: 'Credito (loja)',
  DEBITO: 'Debito',
  CARTAO_CREDITO: 'Cartao de credito',
  CARTAO_DEBITO: 'Cartao de debito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferencia',
  OUTRO: 'Outro',
};

export const CASH_ENTRY_KINDS = ['VENDA', 'OUTRA_ENTRADA'] as const;
export type CashEntryKind = (typeof CASH_ENTRY_KINDS)[number];

export const CASH_EXIT_KINDS = [
  'DESPESA',
  'PAGAMENTO',
  'RETIRADA',
  'SANGRIA',
  'SUPRIMENTO',
  'ESTORNO',
] as const;
export type CashExitKind = (typeof CASH_EXIT_KINDS)[number];

export const CASH_EXIT_LABELS: Record<CashExitKind, string> = {
  DESPESA: 'Despesa',
  PAGAMENTO: 'Pagamento',
  RETIRADA: 'Retirada',
  SANGRIA: 'Sangria',
  SUPRIMENTO: 'Suprimento',
  ESTORNO: 'Estorno',
};

export const USER_STATUSES = ['ATIVO', 'BLOQUEADO'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'STOCK_ADJUST',
  'SALE_CREATE',
  'SALE_CANCEL',
  'CASH_OPEN',
  'CASH_CLOSE',
  'CASH_ENTRY',
  'CASH_EXIT',
  'EXPORT',
  'PASSWORD_CHANGE',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const DASHBOARD_RANGES = [
  'HOJE',
  'ONTEM',
  'ULTIMOS_7',
  'ULTIMOS_30',
  'MES_ATUAL',
  'MES_ANTERIOR',
  'PERSONALIZADO',
] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  HOJE: 'Hoje',
  ONTEM: 'Ontem',
  ULTIMOS_7: 'Ultimos 7 dias',
  ULTIMOS_30: 'Ultimos 30 dias',
  MES_ATUAL: 'Mes atual',
  MES_ANTERIOR: 'Mes anterior',
  PERSONALIZADO: 'Periodo personalizado',
};

export type StockAlertLevel = 'ZERADO' | 'CRITICO' | 'BAIXO';

export const STOCK_ALERT_LABELS: Record<StockAlertLevel, string> = {
  ZERADO: 'Estoque zerado',
  CRITICO: 'Estoque critico',
  BAIXO: 'Estoque baixo',
};
