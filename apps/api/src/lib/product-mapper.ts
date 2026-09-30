import type { Product } from '@prisma/client';
import type { ProductDTO, StockAlertLevel } from '@webdist/shared';
import { marginFromPrice } from '@webdist/shared';

/** Referencias usadas no DTO: basta o nome de cada relacao. */
export interface ProductWithRefs extends Product {
  category?: { name: string } | null;
  brand?: { name: string } | null;
  supplier?: { name: string } | null;
}

/**
 * Classifica o nivel de alerta de estoque.
 * - ZERADO: sem nenhuma unidade
 * - CRITICO: no minimo ou abaixo
 * - BAIXO: ate 25% acima do minimo (com piso de 1 unidade)
 */
export function computeAlertLevel(product: {
  stock: number;
  minStock: number;
}): StockAlertLevel | null {
  const { stock, minStock } = product;
  if (stock <= 0) return 'ZERADO';
  if (minStock <= 0) return null;
  if (stock <= minStock) return 'CRITICO';
  const threshold = Math.max(minStock + 1, Math.ceil(minStock * 1.25));
  if (stock <= threshold) return 'BAIXO';
  return null;
}

/** Quantidade sugerida para repor ate o estoque maximo (ou 2x o minimo). */
export function suggestRestock(product: { stock: number; minStock: number; maxStock: number | null }): number {
  const target = product.maxStock && product.maxStock > product.minStock ? product.maxStock : product.minStock * 2;
  return Math.max(0, target - product.stock);
}

export function toProductDTO(product: ProductWithRefs): ProductDTO {
  return {
    id: product.id,
    internalCode: product.internalCode,
    barcode: product.barcode,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? null,
    brandId: product.brandId,
    brandName: product.brand?.name ?? null,
    supplierId: product.supplierId,
    supplierName: product.supplier?.name ?? null,
    costPrice: product.costPrice,
    salePrice: product.salePrice,
    stock: product.stock,
    minStock: product.minStock,
    maxStock: product.maxStock,
    unit: product.unit,
    status: product.status as ProductDTO['status'],
    saleObservation: product.saleObservation,
    marginPercent: Number(marginFromPrice(product.salePrice, product.costPrice).toFixed(2)),
    profitCents: product.salePrice - product.costPrice,
    alertLevel: computeAlertLevel(product),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
