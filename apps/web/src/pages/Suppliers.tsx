import type { SupplierDTO } from '@webdist/shared';
import { Truck } from 'lucide-react';
import { ResourcePage } from './ResourcePage';
import { dateOnly } from '@/lib/format';

export function SuppliersPage() {
  return (
    <ResourcePage<SupplierDTO>
      config={{
        path: '/api/suppliers',
        title: 'Fornecedores',
        description: 'Parceiros de abastecimento e contato comercial.',
        icon: Truck,
        canManage: 'suppliers:manage',
        primary: (row) => row.name,
        secondary: (row) =>
          [row.document, row.phone, row.email].filter(Boolean).join(' - ') ||
          `Cadastrado em ${dateOnly(row.createdAt)}`,
        fields: [
          { name: 'name', label: 'Razao social / nome', required: true, full: true },
          { name: 'document', label: 'CNPJ / CPF', placeholder: '00.000.000/0000-00' },
          { name: 'phone', label: 'Telefone', type: 'tel', placeholder: '(00) 00000-0000' },
          { name: 'email', label: 'E-mail', type: 'email', placeholder: 'contato@empresa.com' },
          { name: 'address', label: 'Endereco', full: true },
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