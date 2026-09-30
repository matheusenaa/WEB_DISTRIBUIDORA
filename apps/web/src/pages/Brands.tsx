import type { BrandDTO } from '@webdist/shared';
import { Tag } from 'lucide-react';
import { ResourcePage } from './ResourcePage';

export function BrandsPage() {
  return (
    <ResourcePage<BrandDTO>
      config={{
        path: '/api/brands',
        title: 'Marcas',
        description: 'Fabricantes dos produtos comercializados.',
        icon: Tag,
        canManage: 'brands:manage',
        primary: (row) => row.name,
        fields: [{ name: 'name', label: 'Nome da marca', required: true, placeholder: 'Ex.: Brahma' }],
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