/**
 * Controle de acesso baseado em permissao (RBAC granular).
 *
 * Regra do projeto: toda rota da API valida a permissao no backend.
 * O frontend apenas oculta o que o usuario nao pode fazer, mas nunca
 * substitui essa validacao.
 */

export const ROLES = ['ADMIN', 'VENDEDOR'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Usuarios
  'users:read',
  'users:create',
  'users:update',
  'users:delete',

  // Catalogo
  'products:read',
  'products:create',
  'products:update',
  'products:delete',
  'categories:read',
  'categories:manage',
  'brands:read',
  'brands:manage',
  'suppliers:read',
  'suppliers:manage',
  'customers:read',
  'customers:manage',

  // Estoque
  'stock:read',
  'stock:adjust',
  'stock:receive',

  // Compras
  'purchases:read',
  'purchases:create',
  'purchases:receive',

  // Vendas
  'sales:read',
  'sales:read-all',
  'sales:create',
  'sales:cancel',

  // Caixa
  'cash:open',
  'cash:close',
  'cash:read',
  'cash:withdraw',

  //BI
  'reports:read',
  'dashboard:read',

  // Administracao
  'settings:read',
  'settings:manage',
  'audit:read',
  'logs:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VENDEDOR_PERMISSIONS: Permission[] = [
  'products:read',
  'categories:read',
  'brands:read',
  'suppliers:read',
  'customers:read',
  'customers:manage',
  'stock:read',
  'sales:read',
  'sales:create',
  'cash:open',
  'cash:close',
  'cash:read',
  'cash:withdraw',
  // O dashboard do vendedor e escopado as proprias vendas pelo backend.
  'dashboard:read',
];

const ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ADMIN_PERMISSIONS,
  VENDEDOR: VENDEDOR_PERMISSIONS,
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  VENDEDOR: 'Vendedor',
};
