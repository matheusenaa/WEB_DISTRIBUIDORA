export const PRODUCT_UNITS = ['UN', 'CX', 'PCT', 'KG', 'G', 'L', 'ML', 'M', 'PAR', 'DZ'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const PRODUCT_STATUSES = ['ATIVO', 'INATIVO'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const STOCK_MOVEMENT_TYPES = [
  'ENTRADA',
  'SAIDA',
  'VENDA',
  'CANCELAMENTO',
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
  VENDA: 'Venda',
  CANCELAMENTO: 'Cancelamento',
  AJUSTE: 'Ajuste',
  DEVOLUCAO: 'Devolucao',
  PERDA: 'Perda',
  TRANSFERENCIA_SAIDA: 'Transferencia (saida)',
  TRANSFERENCIA_ENTRADA: 'Transferencia (entrada)',
};

/** Tipos de movimentacao que aumentam o saldo. */
export const INBOUND_MOVEMENT_TYPES = [
  'ENTRADA',
  'DEVOLUCAO',
  'TRANSFERENCIA_ENTRADA',
] as const satisfies readonly StockMovementType[];

/** Tipos de movimentacao que reduzem o saldo. */
export const OUTBOUND_MOVEMENT_TYPES = [
  'SAIDA',
  'VENDA',
  'PERDA',
  'TRANSFERENCIA_SAIDA',
] as const satisfies readonly StockMovementType[];

/** Tipos em que o sinal e definido pelo estoque final desejado. */
export const ADJUSTMENT_MOVEMENT_TYPES = ['AJUSTE'] as const satisfies readonly StockMovementType[];

/**
 * Tipos documentais: NAO alteram o saldo.
 *
 * `CANCELAMENTO` registra que uma venda foi cancelada sem repor os itens
 * em estoque (a mercadoria nao volta ao balcao). E lancado com o estoque
 * real antes e depois, que sao iguais, para deixar o cancelamento visivel
 * no historico sem inventar uma saida de mercadoria que nao aconteceu.
 *
 * Antes este tipo estava em `OUTBOUND_MOVEMENT_TYPES`, o que faria a API
 * descontar a quantidade do saldo e potentially gerar estoque negativo.
 */
export const DOCUMENTAL_MOVEMENT_TYPES = ['CANCELAMENTO'] as const satisfies readonly StockMovementType[];

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
  'BACKUP_CREATE',
  'BACKUP_RESTORE_PREPARED',
  'BACKUP_RESTORE_COMPLETED',
  'BACKUP_DELETE',
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

/* ---------------- Compras ---------------- */

export const PURCHASE_STATUSES = ['ABERTO', 'RECEBIDO', 'CANCELADO'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  ABERTO: 'Aberto',
  RECEBIDO: 'Recebido',
  CANCELADO: 'Cancelado',
};

/* ---------------- Backups ---------------- */

export const BACKUP_KINDS = ['MANUAL', 'AUTOMATICO', 'PRE_RESTORE'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

export const BACKUP_STATUSES = ['VALIDO', 'INVALIDO', 'RESTAURADO'] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

/* ---------------- Analises ---------------- */

/** Motivo pelo qual um produto entrou na lista de reposicao. */
export type ReplenishmentReason = 'SEM_ESTOQUE' | 'ABAIXO_DO_MINIMO' | 'ESTOQUE_NEGATIVO';

/** Confianca da analise, derivada da quantidade de dados disponiveis. */
export type ConfidenceLevel = 'ALTA' | 'MEDIA' | 'BAIXA' | 'SEM_DADOS';

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  ALTA: 'Alta confianca',
  MEDIA: 'Confianca media',
  BAIXA: 'Baixa confianca',
  SEM_DADOS: 'Sem dados suficientes',
};

/** Granularidade da analise de sazonalidade. */
export const SEASONALITY_PERIODS = ['MENSAL', 'TRIMESTRAL', 'ANUAL'] as const;
export type SeasonalityPeriod = (typeof SEASONALITY_PERIODS)[number];

/* ---------------- Impressao ---------------- */

export const RECEIPT_WIDTHS = [58, 80] as const;
export type ReceiptWidth = (typeof RECEIPT_WIDTHS)[number];
