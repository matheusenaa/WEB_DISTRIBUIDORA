import type { CustomerDTO } from '@webdist/shared';
import { Users } from 'lucide-react';
import { ResourcePage } from './ResourcePage';
import { dateOnly } from '@/lib/format';

export function CustomersPage() {
  return (
    <ResourcePage<CustomerDTO>
      config={{
        path: '/api/customers',
        title: 'Clientes',
        description: 'Base de clientes para vincular as vendas.',
        icon: Users,
        canManage: 'customers:manage',
        primary: (row) => row.name,
        secondary: (row) =>
          [row.document, row.phone, row.email].filter(Boolean).join(' - ') ||
          `Cadastrado em ${dateOnly(row.createdAt)}`,
        fields: [
          { name: 'name', label: 'Nome / razao social', required: true, full: true },
          { name: 'document', label: 'CNPJ / CPF', placeholder: '00.000.000/0000-00' },
          { name: 'phone', label: 'Telefone', type: 'tel', placeholder: '(00) 00000-0000' },
          { name: 'email', label: 'E-mail', type: 'email' },
          { name: 'address', label: 'Endereco', full: true },
        ],
      }}
    />
  );
}