import type { Permission, Role } from './permissions.js';
import type {
  SalePaymentMethod,
  SaleStatus,
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
  profitCents: number;
  alertLevel: StockAlertLevel | null;
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
  alertLevel: StockAlertLevel;
  suggestedRestock: number;
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
