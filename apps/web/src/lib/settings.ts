import { api } from './api.js';

interface CompanySettings {
  name: string;
  document: string;
  phone: string;
  address: string;
}

interface PrintSettings {
  receiptWidth: '58' | '80';
  autoPrintReceipt: boolean;
}

interface SettingsCache {
  company: CompanySettings;
  print: PrintSettings;
}

let cache: SettingsCache | null = null;
let promise: Promise<SettingsCache> | null = null;

export async function getSettings(): Promise<SettingsCache> {
  if (cache) return cache;
  if (promise) return promise;

  promise = (async () => {
    try {
      const res = await api.get<{ data: Record<string, string> }>('/api/settings', { perPage: 100 });
      const data = res.data ?? {};
      cache = {
        company: {
          name: data['company.name'] ?? 'WEB DISTRIBUIDORA',
          document: data['company.document'] ?? '',
          phone: data['company.phone'] ?? '',
          address: data['company.address'] ?? '',
        },
        print: {
          receiptWidth: (data['print.receiptWidth'] as '58' | '80') ?? '80',
          autoPrintReceipt: data['print.autoPrintReceipt'] === 'true',
        },
      };
    } catch {
      cache = {
        company: { name: 'WEB DISTRIBUIDORA', document: '', phone: '', address: '' },
        print: { receiptWidth: '80', autoPrintReceipt: false },
      };
    }
    return cache;
  })();

  return promise;
}

export function invalidateSettingsCache(): void {
  cache = null;
  promise = null;
}