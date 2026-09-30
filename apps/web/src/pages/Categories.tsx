import type { CategoryDTO } from '@webdist/shared';
import { Tag } from 'lucide-react';
import { ResourcePage } from './ResourcePage';
import { dateOnly } from '@/lib/format';

export function CategoriesPage() {
  return (
    <ResourcePage<CategoryDTO>
      config={{
        path: '/api/categories',
        title: 'Categorias',
        description: 'Familias usadas para organizar e filtrar o catalogo.',
        icon: Tag,
        canManage: 'categories:manage',
        primary: (row) => row.name,
        secondary: (row) => row.description || `Criada em ${dateOnly(row.createdAt)}`,
        fields: [
          { name: 'name', label: 'Nome', required: true, placeholder: 'Ex.: Bebidas' },
          {
            name: 'description',
            label: 'Descricao',
            type: 'textarea',
            full: true,
            placeholder: 'Observacao interna',
          },
        ],
        extraColumns: [
          {
            key: 'products',
            header: 'Produtos',
            className: 'w-24 text-right',
            render: (row) => <span className="tabular-nums">{row.productCount ?? 0}</span>,
          },
        ],
      }}
    />
  );
}