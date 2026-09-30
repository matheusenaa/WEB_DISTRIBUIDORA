import type { Permission } from '@webdist/shared';
import {
  ArrowLeftRight,
  BarChart3,
  Calculator,
  Boxes,
  LayoutDashboard,
  Package,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Tag,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Basta uma destas permissoes para o item aparecer. */
  permissions: Permission[];
  description: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operacao',
    items: [
      {
        to: '/',
        label: 'Dashboard',
        icon: LayoutDashboard,
        permissions: ['dashboard:read'],
        description: 'Visao geral de vendas, lucro e estoque',
      },
      {
        to: '/pdv',
        label: 'PDV',
        icon: ShoppingCart,
        permissions: ['sales:create'],
        description: 'Ponto de venda com leitor de codigo de barras',
      },
      {
        to: '/vendas',
        label: 'Vendas',
        icon: Receipt,
        permissions: ['sales:read'],
        description: 'Historico, detalhe e cancelamento',
      },
      {
        to: '/caixa',
        label: 'Caixa',
        icon: Wallet,
        permissions: ['cash:read'],
        description: 'Abertura, movimentos e fechamento',
      },
    ],
  },
  {
    label: 'Estoque',
    items: [
      {
        to: '/produtos',
        label: 'Produtos',
        icon: Package,
        permissions: ['products:read'],
        description: 'Cadastro, precos, codigo de barras e importacao',
      },
      {
        to: '/movimentacoes',
        label: 'Movimentacoes',
        icon: ArrowLeftRight,
        permissions: ['stock:read'],
        description: 'Entradas, saidas, ajustes e historico',
      },
      {
        to: '/alertas',
        label: 'Alertas de estoque',
        icon: Boxes,
        permissions: ['stock:read'],
        description: 'Itens zerados, criticos e abaixo do minimo',
      },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      {
        to: '/categorias',
        label: 'Categorias',
        icon: Tag,
        permissions: ['categories:read'],
        description: 'Familias de produtos',
      },
      {
        to: '/marcas',
        label: 'Marcas',
        icon: Tag,
        permissions: ['brands:read'],
        description: 'Fabricantes',
      },
      {
        to: '/fornecedores',
        label: 'Fornecedores',
        icon: Truck,
        permissions: ['suppliers:read'],
        description: 'Parceiros de abastecimento',
      },
      {
        to: '/clientes',
        label: 'Clientes',
        icon: Users,
        permissions: ['customers:read'],
        description: 'Base de clientes e dados de contato',
      },
      {
        to: '/usuarios',
        label: 'Usuarios',
        icon: Users,
        permissions: ['users:read'],
        description: 'Contas de acesso e permissoes',
      },
    ],
  },
  {
    label: 'Analise',
    items: [
      {
        to: '/relatorios',
        label: 'Relatorios',
        icon: BarChart3,
        permissions: ['reports:read'],
        description: 'Vendas, produtos, margem e caixa em CSV/XLSX',
      },
      {
        to: '/calculadora',
        label: 'Calculadora',
        icon: Calculator,
        permissions: ['products:read'],
        description: 'Margem, markup, custo e preco de equilibrio',
      },
    ],
  },
  {
    label: 'Administracao',
    items: [
      {
        to: '/auditoria',
        label: 'Auditoria',
        icon: ScrollText,
        permissions: ['audit:read'],
        description: 'Rastro de todas as operacoes relevantes',
      },
      {
        to: '/configuracoes',
        label: 'Configuracoes',
        icon: Settings,
        permissions: ['settings:read'],
        description: 'Parametros da empresa e do sistema',
      },
    ],
  },
];