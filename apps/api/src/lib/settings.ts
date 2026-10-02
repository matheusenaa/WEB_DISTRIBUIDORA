import { prisma } from './prisma.js';
import { config } from '../env.js';

/**
 * CONFIGURACOES DE REGRAS DE NEGOCIO
 *
 * Fonte unica da verdade. As regras vivem na tabela `system_settings`, que
 * o administrador edita pela tela de Configuracoes, e nao em variavel de
 * ambiente: exigiria reiniciar e redesenhar a aplicacao para mudar o
 * limite de desconto de um vendedor.
 *
 * O `.env` continua como PADRAO de fabrica, para o sistema subir mesmo com
 * a tabela vazia (instalacao nova, restauracao de backup parcial). A
 * precedencia e: valor gravado no banco, senao o padrao do `.env`.
 *
 * Consequencia importante: toda regra de negocio passa por
 * `getSettings()`. Ler `config.*` direto em uma rota faria a tela de
 * configuracoes virar decoracao, que foi exatamente o bug corrigido aqui.
 */

export type SettingType = 'text' | 'boolean' | 'number';

/** Secao da tela de Configuracoes. Vem do backend para o agrupamento. */
export type SettingGroup = 'EMPRESA' | 'VENDAS' | 'ESTOQUE' | 'CAIXA' | 'IMPRESSAO';

export interface SettingDefinition {
  key: string;
  label: string;
  group: SettingGroup;
  type: SettingType;
  defaultValue: string;
  /** Faixa aceita em `type: 'number'`. */
  min?: number;
  max?: number;
  /** Valores aceitos em `type: 'text'`. */
  options?: readonly string[];
  /** Texto curto explicando o efeito da regra. */
  help?: string;
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
group: 'EMPRESA',
    key: 'company.name',
    label: 'Nome da empresa',
    type: 'text',
    defaultValue: 'WEB DISTRIBUIDORA',
    help: 'Usado no cabecalho e no cupom.',
  },
  {
group: 'EMPRESA',
    key: 'company.document',
    label: 'CNPJ / CPF',
    type: 'text',
    defaultValue: '',
    help: 'Apenas documento. O CNPJ e validado comodigits.',
  },
{ key: 'company.phone', group: 'EMPRESA', label: 'Telefone', type: 'text', defaultValue: '' },
  { key: 'company.address', group: 'EMPRESA', label: 'Endereco', type: 'text', defaultValue: '' },
  {
group: 'VENDAS',
    key: 'sale.allowNegativeStock',
    label: 'Permitir venda com estoque negativo',
    type: 'boolean',
    defaultValue: 'false',
    help: 'Desligado, o servidor recusa a venda que deixaria o estoque abaixo de zero.',
  },
  {
group: 'VENDAS',
    key: 'sale.sellerMaxDiscount',
    label: 'Desconto maximo do vendedor (%)',
    type: 'number',
    defaultValue: String(config.SELLER_MAX_DISCOUNT_PERCENT),
    min: 0,
    max: 100,
    help: '0 impede qualquer desconto para o perfil VENDEDOR.',
  },
  {
group: 'VENDAS',
    key: 'sale.adminMaxDiscount',
    label: 'Desconto maximo do administrador (%)',
    type: 'number',
    defaultValue: String(config.ADMIN_MAX_DISCOUNT_PERCENT),
    min: 0,
    max: 100,
  },
  {
group: 'ESTOQUE',
    key: 'stock.defaultMinAlert',
    label: 'Estoque minimo padrao de alerta',
    type: 'number',
    defaultValue: '5',
    min: 0,
    max: 1_000_000,
    help: 'Usado como sugestao ao cadastrar um produto novo.',
  },
  {
group: 'CAIXA',
    key: 'cash.tolerance',
    label: 'Tolerancia de divergencia de caixa (R$)',
    type: 'number',
    defaultValue: String(config.CASH_TOLERANCE),
    min: 0,
    max: 10_000,
    help: 'Diferenca entre o caixa contado e o esperado que ainda fecha sem divergencia.',
  },
  {
group: 'IMPRESSAO',
    key: 'print.autoPrintReceipt',
    label: 'Imprimir cupom automaticamente',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
group: 'IMPRESSAO',
    key: 'print.receiptWidth',
    label: 'Largura do cupom (58mm/80mm)',
    type: 'text',
    defaultValue: '80mm',
    options: ['58mm', '80mm'],
  },
  {
group: 'CAIXA',
    key: 'pdv.requireOpenCash',
    label: 'Exigir caixa aberto para vender',
    type: 'boolean',
    defaultValue: 'true',
    help: 'Desligado, a venda e registrada sem movimentacao no caixa.',
  },
] as const;

const DEFINITIONS_BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return DEFINITIONS_BY_KEY.get(key);
}

/**
 * Normaliza um valor cru para a forma canonica da definicao.
 *
 * Retorna `null` quando o valor nao e utilizavel, para que uma gravacao
 * invalida seja recusada em vez de ser aceita e quebrar a regra depois.
 */
export function normalizeSettingValue(definition: SettingDefinition, raw: string): string | null {
  const value = raw.trim();

  if (definition.type === 'boolean') {
    if (['true', '1', 'sim', 'on'].includes(value.toLowerCase())) return 'true';
    if (['false', '0', 'nao', 'off'].includes(value.toLowerCase())) return 'false';
    return null;
  }

  if (definition.type === 'number') {
    // `Number('')` e 0 e `Number(' 12 ')` e 12; um texto vazio em campo
    // numerico viraria desconto de 0% silenciosamente.
    if (value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const { min, max } = definition;
    if (min !== undefined && parsed < min) return null;
    if (max !== undefined && parsed > max) return null;
    return String(parsed);
  }

  if (definition.options && !definition.options.includes(value)) return null;
  return value;
}

export interface ResolvedSettings {
  company: {
    name: string;
    document: string;
    phone: string;
    address: string;
  };
  allowNegativeStock: boolean;
  requireOpenCash: boolean;
  autoPrintReceipt: boolean;
  receiptWidth: '58mm' | '80mm';
  sellerMaxDiscountPercent: number;
  adminMaxDiscountPercent: number;
  defaultMinAlert: number;
  cashToleranceCents: number;
}

const asBoolean = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : value === 'true';

/**
 * Le um campo numerico respeitando a faixa da definicao.
 *
 * A gravacao ja valida, mas o banco pode ter sido editado por fora
 * (restauracao de backup de outra versao, `sqlite3` aberto a mao). Um valor
 * fora da faixa aqui viraria regra absurda em silencio: tolerancia de caixa
 * negativa faz todo fechamento acusar divergencia. Fora da faixa, vale o
 * padrao de fabrica.
 */
function readNumber(raw: Record<string, string>, key: string, fallback: number): number {
  const stored = raw[key];
  if (stored === undefined) return fallback;

  const parsed = Number(stored);
  if (!Number.isFinite(parsed)) return fallback;

  const definition = DEFINITIONS_BY_KEY.get(key);
  if (definition?.min !== undefined && parsed < definition.min) return fallback;
  if (definition?.max !== undefined && parsed > definition.max) return fallback;
  return parsed;
}

/**
 * Converte o mapa bruto do banco no objeto de regras.
 *
 * Pura de proposito: e aqui que mora a precedencia banco > padrao, e ela
 * precisa ser testavel sem subir o banco.
 */
export function resolveSettings(raw: Record<string, string>): ResolvedSettings {
  const text = (key: string, fallback = '') => raw[key] ?? fallback;
  const tolerance = readNumber(raw, 'cash.tolerance', config.CASH_TOLERANCE);
  const width = raw['print.receiptWidth'];

  return {
    company: {
      name: text('company.name', 'WEB DISTRIBUIDORA'),
      document: text('company.document'),
      phone: text('company.phone'),
      address: text('company.address'),
    },
    allowNegativeStock: asBoolean(raw['sale.allowNegativeStock'], config.ALLOW_NEGATIVE_STOCK),
    requireOpenCash: asBoolean(raw['pdv.requireOpenCash'], true),
    autoPrintReceipt: asBoolean(raw['print.autoPrintReceipt'], false),
    receiptWidth: width === '58mm' ? '58mm' : '80mm',
    sellerMaxDiscountPercent: readNumber(
      raw,
      'sale.sellerMaxDiscount',
      config.SELLER_MAX_DISCOUNT_PERCENT,
    ),
    adminMaxDiscountPercent: readNumber(
      raw,
      'sale.adminMaxDiscount',
      config.ADMIN_MAX_DISCOUNT_PERCENT,
    ),
    defaultMinAlert: readNumber(raw, 'stock.defaultMinAlert', 5),
    // Configurada em reais na tela; as regras operam em centavos.
    cashToleranceCents: Math.round(tolerance * 100),
  };
}

let cache: { value: ResolvedSettings; expiresAt: number } | null = null;

/** TTL curto: settings mudam uma vez por dia, nao uma vez por request. */
const CACHE_TTL_MS = 5_000;

/**
 * Le as regras vigentes.
 *
 * O cache existe para nao bater no banco a cada validacao de desconto de
 * uma venda. E invalidado explicitamente em `saveSettings`, entao quem
 * acaba de salvar ja le o valor novo.
 */
export async function getSettings(): Promise<ResolvedSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const rows = await prisma.systemSetting.findMany({
    select: { key: true, value: true },
  });
  const value = resolveSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** Invalida o cache. Chamar sempre depois de gravar. */
export function invalidateSettingsCache(): void {
  cache = null;
}

/** Limite de desconto do perfil, pelas regras vigentes. */
export function maxDiscountPercentForRole(
  role: 'ADMIN' | 'VENDEDOR',
  settings: ResolvedSettings,
): number {
  return role === 'ADMIN'
    ? settings.adminMaxDiscountPercent
    : settings.sellerMaxDiscountPercent;
}