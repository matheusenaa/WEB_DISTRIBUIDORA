import { z } from 'zod';
import {
  PRODUCT_STATUSES,
  PRODUCT_UNITS,
  PURCHASE_STATUSES,
  SALE_PAYMENT_METHODS,
  STOCK_MOVEMENT_TYPES,
} from './enums.js';
import { ROLES } from './permissions.js';

/* ------------------------------------------------------------------ */
/* Primitivos                                                          */
/* ------------------------------------------------------------------ */

export const moneySchema = z.coerce
  .number()
  .finite('Valor monetario invalido')
  .min(-1_000_000_000, 'Valor muito negativo')
  .max(1_000_000_000, 'Valor muito alto');

export const nonNegativeMoneySchema = moneySchema.min(0, 'Valor nao pode ser negativo');

export const percentSchema = z.coerce
  .number()
  .finite()
  .min(-100, 'Percentual invalido')
  .max(100, 'Percentual invalido');

/** Aceita string numerica ou number. Para campos monetarios de entrada. */
export const moneyInputSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const s = typeof v === 'string' ? v.trim() : v;
    if (s === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valor obrigatorio' });
      return z.NEVER;
    }
    const n = typeof s === 'number' ? s : Number(s.replace(',', '.'));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valor monetario invalido' });
      return z.NEVER;
    }
    return Math.round(n * 100);
  });

export const idParamSchema = z.coerce.number().int().positive();
export const barcodeSchema = z
  .string()
  .trim()
  .min(6, 'Codigo de barras muito curto')
  .max(64, 'Codigo de barras muito longo');

export const emailSchema = z.string().trim().toLowerCase().email('E-mail invalido').max(180);
export const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const documentSchema = z
  .string()
  .trim()
  .max(20)
  .optional()
  .transform((v) => (v === '' || v === undefined ? undefined : v));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(25),
});

/* ------------------------------------------------------------------ */
/* Autenticacao                                                        */
/* ------------------------------------------------------------------ */

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Informe o usuario').max(64),
  password: z.string().min(1, 'Informe a senha').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).max(2000),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual'),
  newPassword: z
    .string()
    .min(8, 'A nova senha deve ter no minimo 8 caracteres')
    .max(200)
    .refine((v) => /[a-zA-Z]/.test(v), 'A senha deve conter ao menos uma letra')
    .refine((v) => /\d/.test(v), 'A senha deve conter ao menos um numero'),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/* ------------------------------------------------------------------ */
/* Usuarios                                                            */
/* ------------------------------------------------------------------ */

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Usuario deve ter no minimo 3 caracteres')
    .max(64)
    .regex(/^[a-z0-9._-]+$/, 'Usuario aceita apenas letras, numeros, ponto, hifen e underline'),
  email: emailSchema,
  password: z
    .string()
    .min(8, 'A senha deve ter no minimo 8 caracteres')
    .max(200)
    .refine((v) => /[a-zA-Z]/.test(v), 'A senha deve conter ao menos uma letra')
    .refine((v) => /\d/.test(v), 'A senha deve conter ao menos um numero'),
  role: z.enum(ROLES),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: emailSchema.optional(),
    role: z.enum(ROLES).optional(),
    status: z.enum(['ATIVO', 'BLOQUEADO']).optional(),
    password: z
      .string()
      .min(8, 'A senha deve ter no minimo 8 caracteres')
      .max(200)
      .refine((v) => /[a-zA-Z]/.test(v), 'A senha deve conter ao menos uma letra')
      .refine((v) => /\d/.test(v), 'A senha deve conter ao menos um numero')
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo para atualizar');
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/* ------------------------------------------------------------------ */
/* Cadastros base (categoria, marca, fornecedor, cliente, pagamento)   */
/* ------------------------------------------------------------------ */

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(80),
  description: z.string().trim().max(300).optional().or(z.literal('')),
  active: z.boolean().default(true),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const brandSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(80),
  active: z.boolean().default(true),
});
export type BrandInput = z.infer<typeof brandSchema>;

export const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  document: documentSchema,
  email: z.union([emailSchema, z.literal('')]).optional(),
  phone: phoneSchema,
  address: z.string().trim().max(300).optional().or(z.literal('')),
  active: z.boolean().default(true),
  /** Prazo medio de entrega em dias. Alimenta a sugestao de recompra. */
  leadTimeDays: z.coerce.number().int().min(0, 'Prazo nao pode ser negativo').max(365).default(0),
  /** Quantidade minima aceita por pedido (0 = sem minimo). */
  minOrderQuantity: z.coerce.number().int().min(0, 'Quantidade nao pode ser negativa').max(1_000_000).default(0),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  document: documentSchema,
  email: z.union([emailSchema, z.literal('')]).optional(),
  phone: phoneSchema,
  address: z.string().trim().max(300).optional().or(z.literal('')),
  active: z.boolean().default(true),
});
export type CustomerInput = z.infer<typeof customerSchema>;

/* ------------------------------------------------------------------ */
/* Produtos                                                            */
/* ------------------------------------------------------------------ */

export const productCreateSchema = z
  .object({
    internalCode: z.string().trim().max(40).optional().or(z.literal('')),
    barcode: barcodeSchema.optional().or(z.literal('')),
    name: z.string().trim().min(2, 'Informe o nome do produto').max(160),
    description: z.string().trim().max(600).optional().or(z.literal('')),
    categoryId: z.coerce.number().int().positive().optional(),
    brandId: z.coerce.number().int().positive().optional(),
    supplierId: z.coerce.number().int().positive().optional(),
    costPrice: moneyInputSchema,
    salePrice: moneyInputSchema,
    stock: z.coerce.number().int().min(0, 'Estoque nao pode ser negativo').default(0),
    minStock: z.coerce.number().int().min(0).default(0),
    maxStock: z.coerce.number().int().min(0).optional(),
    unit: z.enum(PRODUCT_UNITS).default('UN'),
    status: z.enum(PRODUCT_STATUSES).default('ATIVO'),
    saleObservation: z.string().trim().max(300).optional().or(z.literal('')),
    location: z.string().trim().max(80).optional().or(z.literal('')),
  })
  .refine((v) => !v.barcode || /^[0-9A-Za-z\-_.]+$/.test(v.barcode), {
    message: 'Codigo de barras invalido',
    path: ['barcode'],
  })
  .refine((v) => v.maxStock === undefined || v.maxStock >= v.minStock, {
    message: 'Estoque maximo deve ser maior ou igual ao minimo',
    path: ['maxStock'],
  });
export type ProductCreateInput = z.input<typeof productCreateSchema>;

export const productUpdateSchema = z
  .object({
    internalCode: z.string().trim().max(40).optional().or(z.literal('')),
    barcode: barcodeSchema.optional().or(z.literal('')),
    name: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(600).optional().or(z.literal('')),
    categoryId: z.coerce.number().int().positive().nullable().optional(),
    brandId: z.coerce.number().int().positive().nullable().optional(),
    supplierId: z.coerce.number().int().positive().nullable().optional(),
    costPrice: moneyInputSchema.optional(),
    salePrice: moneyInputSchema.optional(),
    minStock: z.coerce.number().int().min(0).optional(),
    maxStock: z.coerce.number().int().min(0).nullable().optional(),
    unit: z.enum(PRODUCT_UNITS).optional(),
    status: z.enum(PRODUCT_STATUSES).optional(),
    saleObservation: z.string().trim().max(300).optional().or(z.literal('')),
    location: z.string().trim().max(80).optional().or(z.literal('')),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Informe ao menos um campo para atualizar',
  });
export type ProductUpdateInput = z.input<typeof productUpdateSchema>;

export const productQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  brandId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  stock: z.enum(['TODOS', 'ZERADO', 'BAIXO', 'CRITICO', 'DISPONIVEL']).optional(),
  sortBy: z
    .enum(['name', 'internalCode', 'salePrice', 'costPrice', 'stock', 'createdAt'])
    .default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

/* ------------------------------------------------------------------ */
/* Estoque                                                             */
/* ------------------------------------------------------------------ */

export const stockMovementSchema = z.object({
  type: z.enum(STOCK_MOVEMENT_TYPES),
  quantity: z.coerce.number().int().positive('Quantidade deve ser maior que zero'),
  productId: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3, 'Informe o motivo').max(300),
  unitCost: moneyInputSchema.optional(),
  documentNumber: z.string().trim().max(60).optional().or(z.literal('')),
});
export type StockMovementInput = z.infer<typeof stockMovementSchema>;

export const stockQuerySchema = paginationSchema.extend({
  productId: z.coerce.number().int().positive().optional(),
  type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  userId: z.coerce.number().int().positive().optional(),
});
export type StockQuery = z.infer<typeof stockQuerySchema>;

/* ------------------------------------------------------------------ */
/* Compras                                                             */
/* ------------------------------------------------------------------ */

export const purchaseItemSchema = z.object({
  productId: z.coerce.number().int().positive('Produto invalido'),
  quantity: z.coerce.number().int().positive('Quantidade deve ser maior que zero'),
  unitCost: moneyInputSchema,
});
export type PurchaseItemInput = z.infer<typeof purchaseItemSchema>;

export const purchaseCreateSchema = z
  .object({
    supplierId: z.coerce.number().int().positive('Selecione o fornecedor'),
    items: z.array(purchaseItemSchema).min(1, 'Adicione ao menos um item'),
    documentNumber: z.string().trim().max(60).optional().or(z.literal('')),
    notes: z.string().trim().max(600).optional().or(z.literal('')),
    /** Quando true, o recebimento (baixa de estoque) ocorre na criacao. */
    receiveNow: z.boolean().default(false),
  })
  .refine(
    (v) => new Set(v.items.map((i) => i.productId)).size === v.items.length,
    { message: 'O mesmo produto nao pode aparecer duas vezes no pedido', path: ['items'] },
  );
export type PurchaseCreateInput = z.input<typeof purchaseCreateSchema>;

export const purchaseReceiveSchema = z
  .object({
    /** Quantidade efetivamente recebida por item. Ausente = quantidade pedida. */
    items: z
      .array(
        z.object({
          productId: z.coerce.number().int().positive(),
          receivedQuantity: z.coerce.number().int().min(0, 'Quantidade nao pode ser negativa'),
        }),
      )
      .optional(),
    documentNumber: z.string().trim().max(60).optional().or(z.literal('')),
    notes: z.string().trim().max(600).optional().or(z.literal('')),
  })
  .refine((v) => v.items === undefined || v.items.length > 0, {
    message: 'Informe ao menos um item para receber',
    path: ['items'],
  });
export type PurchaseReceiveInput = z.input<typeof purchaseReceiveSchema>;

export const purchaseQuerySchema = paginationSchema.extend({
  supplierId: z.coerce.number().int().positive().optional(),
  status: z.enum(PURCHASE_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(120).optional(),
});
export type PurchaseQuery = z.infer<typeof purchaseQuerySchema>;

/* ------------------------------------------------------------------ */
/* Vendas / PDV                                                        */
/* ------------------------------------------------------------------ */

export const saleItemSchema = z.object({
  productId: z.coerce.number().int().positive('Produto invalido'),
  quantity: z.coerce.number().int().positive('Quantidade deve ser maior que zero'),
  unitPrice: moneyInputSchema.optional(),
  discountPercent: percentSchema.default(0),
});
export type SaleItemInput = z.infer<typeof saleItemSchema>;

export const saleCreateSchema = z.object({
  items: z
    .array(saleItemSchema)
    .min(1, 'Adicione ao menos um item a venda')
    .max(500, 'Venda com itens em excesso'),
  paymentMethod: z.enum(SALE_PAYMENT_METHODS),
  customerId: z.coerce.number().int().positive().optional(),
  discountPercent: percentSchema.default(0),
  globalDiscountCents: z.coerce.number().int().min(0).default(0),
  amountPaidCents: z.coerce.number().int().min(0).default(0),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});
export type SaleCreateInput = z.input<typeof saleCreateSchema>;

export const saleQuerySchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sellerId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  status: z.enum(['CONCLUIDA', 'CANCELADA']).optional(),
  paymentMethod: z.enum(SALE_PAYMENT_METHODS).optional(),
  search: z.string().trim().max(60).optional(),
  minTotal: z.coerce.number().int().min(0).optional(),
  maxTotal: z.coerce.number().int().min(0).optional(),
});
export type SaleQuery = z.infer<typeof saleQuerySchema>;

export const saleCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Informe o motivo do cancelamento').max(300),
  restock: z.boolean().default(true),
});
export type SaleCancelInput = z.infer<typeof saleCancelSchema>;

/* ------------------------------------------------------------------ */
/* Caixa                                                               */
/* ------------------------------------------------------------------ */

export const cashOpenSchema = z.object({
  initialAmountCents: z.coerce.number().int().min(0, 'Valor inicial invalido'),
});
export type CashOpenInput = z.infer<typeof cashOpenSchema>;

export const cashEntrySchema = z.object({
  kind: z.enum(['OUTRA_ENTRADA']),
  amountCents: z.coerce.number().int().positive('Valor deve ser maior que zero'),
  description: z.string().trim().min(3, 'Descreva a entrada').max(200),
});
export type CashEntryInput = z.infer<typeof cashEntrySchema>;

export const cashExitSchema = z.object({
  kind: z.enum(['DESPESA', 'PAGAMENTO', 'RETIRADA', 'SANGRIA', 'SUPRIMENTO', 'ESTORNO']),
  amountCents: z.coerce.number().int().positive('Valor deve ser maior que zero'),
  description: z.string().trim().min(3, 'Descreva a saida').max(200),
});
export type CashExitInput = z.infer<typeof cashExitSchema>;

export const cashCloseSchema = z.object({
  reportedAmountCents: z.coerce.number().int().min(0, 'Valor informado invalido'),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});
export type CashCloseInput = z.infer<typeof cashCloseSchema>;

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export const dashboardQuerySchema = z.object({
  range: z
    .enum(['HOJE', 'ONTEM', 'ULTIMOS_7', 'ULTIMOS_30', 'MES_ATUAL', 'MES_ANTERIOR', 'PERSONALIZADO'])
    .default('HOJE'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/* ------------------------------------------------------------------ */
/* Relatorios                                                          */
/* ------------------------------------------------------------------ */

export const reportQuerySchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sellerId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const auditQuerySchema = paginationSchema.extend({
  userId: z.coerce.number().int().positive().optional(),
  action: z.string().trim().max(40).optional(),
  entity: z.string().trim().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(120).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
