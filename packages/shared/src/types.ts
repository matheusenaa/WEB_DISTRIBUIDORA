import type { Permission, Role } from './permissions.js';
import type {
  BackupKind,
  BackupStatus,
  ConfidenceLevel,
  PurchaseStatus,
  ReplenishmentReason,
  SalePaymentMethod,
  SaleStatus,
  SeasonalityPeriod,
  StockAlertLevel,
  StockMovementType,
} from './enums.js';

/* ---------------- Envelope de resposta da API ---------------- */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

/* ---------------- Sessao ---------------- */

export interface SessionUser {
  id: number;
  name: string;
  username: string;
  email: string;
  role: Role;
  status: 'ATIVO' | 'BLOQUEADO';
  permissions: readonly Permission[];
  lastAccessAt: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export interface LoginResponse {
  user: SessionUser;
  tokens: AuthTokens;
}

export interface RefreshResponse {
  user: SessionUser;
  tokens: AuthTokens;
}

/* ---------------- Catalogo ---------------- */

export interface CategoryDTO {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  productCount?: number;
  createdAt: string;
}

export interface BrandDTO {
  id: number;
  name: string;
  active: boolean;
  productCount?: number;
}

export interface SupplierDTO {
  id: number;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
  productCount?: number;
  /** Prazo medio de entrega em dias (0 = nao informado). */
  leadTimeDays?: number;
  /** Quantidade minima aceita por pedido (0 = sem minimo). */
  minOrderQuantity?: number;
  lastPurchasePrice?: number | null;
  lastPurchaseAt?: string | null;
  createdAt: string;
}

export interface CustomerDTO {
  id: number;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
  createdAt: string;
}

export interface ProductDTO {
  id: number;
  internalCode: string | null;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: number | null;
  categoryName: string | null;
  brandId: number | null;
  brandName: string | null;
  supplierId: number | null;
  supplierName: string | null;
  costPrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  maxStock: number | null;
  unit: string;
  status: 'ATIVO' | 'INATIVO';
  saleObservation: string | null;
  marginPercent: number;
  /** Percentual sobre o custo. NAO confundir com margem, que e sobre a venda. */
  markupPercent: number;
  profitCents: number;
  alertLevel: StockAlertLevel | null;
  /** Endereco no deposito (corredor/prateleira/caixa). */
  location: string | null;
  /** Ultima venda concluida; null se nunca vendeu. */
  lastSaleAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BarcodeLookupDTO {
  found: boolean;
  product: ProductDTO | null;
}

/* ---------------- Estoque ---------------- */

export interface StockMovementDTO {
  id: number;
  type: StockMovementType;
  productId: number;
  productName: string;
  productUnit: string;
  quantity: number;
  previousStock: number;
  resultingStock: number;
  reason: string;
  documentNumber: string | null;
  unitCost: number | null;
  userId: number;
  userName: string;
  createdAt: string;
}

export interface StockAlertDTO {
  productId: number;
  code: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  maxStock: number | null;
  alertLevel: StockAlertLevel;
  suggestedRestock: number;
  /** Custo unitario vigente, para estimar o desembolso da recompra. */
  costPrice: number;
  /** Custo x quantidade sugerida. null quando o custo nao e conhecido. */
  estimatedCostCents: number | null;
  supplierId: number | null;
  supplierName: string | null;
  /** Dias ate zerar no ritmo de venda dos ultimos 30 dias. null = sem venda. */
  daysOfCoverage: number | null;
}

/** Resumo por fornecedor para transformar alertas em pedidos de compra. */
export interface RestockGroupDTO {
  supplierId: number | null;
  supplierName: string;
  productCount: number;
  totalUnits: number;
  totalCents: number;
  /** Quantidade de produtos sem fornecedor definido. */
  withoutSupplier: number;
}

export interface StockAlertsReport {
  data: StockAlertDTO[];
  total: number;
  summary: {
    byLevel: Record<StockAlertLevel, number>;
    totalUnitsToRestock: number;
    /** null = parte dos produtos nao tem custo conhecido. */
    estimatedTotalCents: number | null;
    productsWithoutCost: number;
  };
  groups: RestockGroupDTO[];
}

/* ---------------- Vendas ---------------- */

export interface SaleItemDTO {
  id: number;
  productId: number;
  productName: string;
  productUnit: string;
  barcode: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  subtotal: number;
  costPrice: number;
  profitCents: number;
}

export interface SaleDTO {
  id: number;
  number: number;
  sellerId: number;
  sellerName: string;
  userId: number;
  userName: string;
  customerId: number | null;
  customerName: string | null;
  subtotal: number;
  discountCents: number;
  total: number;
  costTotal: number;
  profitCents: number;
  paymentMethod: SalePaymentMethod;
  amountPaidCents: number;
  changeCents: number;
  status: SaleStatus;
  itemsCount: number;
  totalQuantity: number;
  notes: string | null;
  createdAt: string;
  canceledAt: string | null;
  cancelReason: string | null;
  items?: SaleItemDTO[];
}

/* ---------------- Caixa ---------------- */

export interface CashMovementDTO {
  id: number;
  type: 'ENTRADA' | 'SAIDA';
  kind: string;
  amountCents: number;
  description: string;
  saleId: number | null;
  saleNumber: number | null;
  userId: number;
  userName: string;
  createdAt: string;
}

export interface CashSessionDTO {
  id: number;
  status: 'ABERTO' | 'FECHADO';
  userId: number;
  userName: string;
  initialAmountCents: number;
  expectedAmountCents: number;
  reportedAmountCents: number | null;
  differenceCents: number | null;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
  entriesTotalCents?: number;
  exitsTotalCents?: number;
  salesTotalCents?: number;
}

export interface CashSessionDetailDTO extends CashSessionDTO {
  movements: CashMovementDTO[];
}

/* ---------------- Dashboard ---------------- */

export interface DashboardKPI {
  salesCount: number;
  revenueCents: number;
  itemsSold: number;
  ticketAverageCents: number;
  profitCents: number;
  canceledCount: number;
  averageSaleItems: number;
}

export interface TimeSeriesPoint {
  date: string;
  label: string;
  salesCount: number;
  revenueCents: number;
  profitCents: number;
}

export interface NamedValue {
  id: number | string;
  label: string;
  value: number;
  secondaryValue?: number;
  count?: number;
}

export interface DashboardPayload {
  range: {
    kind: string;
    from: string;
    to: string;
    label: string;
  };
  kpi: DashboardKPI;
  comparison?: {
    previousFrom: string;
    previousTo: string;
    salesCount: number;
    revenueCents: number;
    /** O periodo comparado ainda esta em andamento (ex.: mes corrente). */
    partial: boolean;
  };
  series: {
    daily: TimeSeriesPoint[];
    byPaymentMethod: NamedValue[];
    bySeller: NamedValue[];
    topProducts: NamedValue[];
    byCategory: NamedValue[];
  };
  stock: {
    alerts: StockAlertDTO[];
    totalProducts: number;
    outOfStock: number;
    lowStock: number;
    stockValueCents: number;
    retailValueCents: number;
  };
}

/* ---------------- Auditoria ---------------- */

export interface AuditLogDTO {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  description: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

/* ---------------- Compras ---------------- */

export interface PurchaseItemDTO {
  id: number;
  productId: number;
  productName: string;
  productUnit: string;
  barcode: string | null;
  quantity: number;
  unitCost: number;
  receivedQuantity: number | null;
  subtotal: number;
}

export interface PurchaseOrderDTO {
  id: number;
  number: number;
  supplierId: number;
  supplierName: string;
  userId: number;
  userName: string;
  status: PurchaseStatus;
  documentNumber: string | null;
  orderedAt: string;
  receivedAt: string | null;
  notes: string | null;
  itemsCount: number;
  totalQuantity: number;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  items?: PurchaseItemDTO[];
}

export interface PurchaseCreateItemInput {
  productId: number;
  quantity: number;
  unitCost: number;
}

/* ---------------- Backups ---------------- */

export interface BackupRecordDTO {
  fileName: string;
  sizeBytes: number;
  sizeLabel: string;
  kind: BackupKind;
  status: BackupStatus;
  userName: string | null;
  note: string | null;
  createdAt: string;
  /** Presente quando o arquivo esta em disco e pode ser restaurado. */
  available: boolean;
}

export interface BackupCreateResult {
  ok: true;
  fileName: string;
  sizeBytes: number;
  sizeLabel: string;
  path: string;
  durationMs: number;
}

export interface RestorePrepareResult {
  ok: true;
  /** true = restaurado imediatamente; false = agendado para o proximo start. */
  applied: boolean;
  fileName: string;
  message: string;
  requiresRestart: boolean;
}

/* ---------------- Inteligecia: reposicao ---------------- */

export interface ReplenishmentItem {
  productId: number;
  internalCode: string | null;
  barcode: string | null;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  maxStock: number | null;
  /** Media diaria de venda na janela analisada. */
  averageDailySales: number;
  /** Consumo medio no periodo de cobertura do fornecedor. */
  consumptionAtLeadTime: number;
  /** Quanto falta para cobrir o estoque minimo + o prazo do fornecedor. */
  suggestedQuantity: number;
  /** Dias ate zerar o estoque no ritmo de venda atual. null = sem venda. */
  daysOfCoverage: number | null;
  reason: ReplenishmentReason;
  confidence: ConfidenceLevel;
  supplierId: number | null;
  supplierName: string | null;
  leadTimeDays: number | null;
  minOrderQuantity: number | null;
  /** Ultimo preco pago, para estimar o custo da reposicao. */
  estimatedUnitCost: number | null;
  estimatedTotalCents: number | null;
}

export interface ReplenishmentReport {
  items: ReplenishmentItem[];
  summary: {
    productCount: number;
    totalEstimatedCents: number;
    byReason: Record<string, number>;
  };
  /** Explicita a base do calculo, conforme o documento exige. */
  basis: string;
  windowDays: number;
  generatedAt: string;
}

/* ---------------- Inteligecia: produtos parados ---------------- */

export interface StagnantProduct {
  productId: number;
  internalCode: string | null;
  barcode: string | null;
  name: string;
  categoryName: string | null;
  unit: string;
  stock: number;
  costPrice: number;
  salePrice: number;
  lastSaleAt: string | null;
  daysWithoutSale: number | null;
  /** Valor de capital imobilizado no estoque deste produto. */
  tiedUpValueCents: number;
  suggestedAction: 'PROMOVER' | 'REPOR' | 'DESATIVAR' | 'AVALIAR';
}

export interface StagnantReport {
  items: StagnantProduct[];
  periods: { days: number; label: string; count: number; tiedUpValueCents: number }[];
  totalTiedUpValueCents: number;
  basis: string;
  generatedAt: string;
}

/* ---------------- Inteligeencia: sazonalidade ---------------- */

export interface SeasonalityRow {
  period: string;
  label: string;
  salesCount: number;
  revenueCents: number;
  itemsSold: number;
  ticketAverageCents: number;
  /** Variacao percentual vs. o mesmo periodo do ano anterior. null = sem base. */
  variationPercent: number | null;
}

export interface SeasonalityReport {
  period: SeasonalityPeriod;
  groupBy: 'MES' | 'CATEGORIA' | 'PRODUTO' | 'VENDEDOR';
  rows: SeasonalityRow[];
  totals: {
    salesCount: number;
    revenueCents: number;
    itemsSold: number;
  };
  /** true quando ha dados do ano anterior para comparar. */
  hasComparison: boolean;
  basis: string;
  generatedAt: string;
}

/* ---------------- Inteligecia: previsao de caixa ---------------- */

export interface CashForecastPoint {
  date: string;
  label: string;
  expectedInCents: number;
  expectedOutCents: number;
  expectedNetCents: number;
  /** Saldo projetado se as entradas e saidas planejadas occurrem. */
  projectedBalanceCents: number;
  basis: 'HISTORICO' | 'SEM_HISTORICO';
}

export interface CashForecastReport {
  currentBalanceCents: number;
  openSessionId: number | null;
  points: CashForecastPoint[];
  averages: {
    dailyInCents: number;
    dailyOutCents: number;
    dailySalesCents: number;
    daysAnalyzed: number;
  };
  confidence: ConfidenceLevel;
  basis: string;
  generatedAt: string;
}

/* ---------------- Configuracoes ---------------- */

/** Secao da tela de configuracoes. Vem do backend para o agrupamento. */
export type SettingGroup = 'EMPRESA' | 'VENDAS' | 'ESTOQUE' | 'CAIXA' | 'IMPRESSAO';

export type SettingType = 'text' | 'boolean' | 'number';

/**
 * Uma configuracao como a API a descreve.
 *
 * A tela de Configuracoes e gerada a partir desta lista: o backend e quem
 * decide quais regras existem, e nao a tela. Sem isso os dois lados
 * divergem em silencio e a tela mostra campos que a API nao conhece.
 */
export interface SettingDTO {
  key: string;
  label: string;
  group: SettingGroup;
  type: SettingType;
  /** Explicacao curta do efeito da regra. */
  help: string | null;
  /** Valores aceitos quando `type` e 'text' com opcoes. */
  options: string[] | null;
  /** Valor vigente, ja normalizado. */
  value: string;
  /** Padrao de fabrica, usado quando nada foi gravado. */
  defaultValue: string;
  /** false quando a regra ainda esta no padrao (nada gravado no banco). */
  saved: boolean;
}

export interface SettingsResponse {
  data: SettingDTO[];
}

export interface SettingsSaveResult {
  ok: boolean;
  updated: number;
  /** Configuracoes recusadas com o motivo. */
  rejected: Array<{ key: string; reason: string }>;
  message: string;
}
