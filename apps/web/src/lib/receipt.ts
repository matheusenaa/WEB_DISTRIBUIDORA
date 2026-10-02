import { money, qty } from './format.js';
import { getSettings } from './settings.js';
import type { ProductUnit } from '@webdist/shared';

export interface ReceiptLine {
  name: string;
  quantity: number;
  unit: ProductUnit;
  unitPriceCents: number;
  totalCents: number;
  discountPercent?: number;
}

export interface ReceiptData {
  saleNumber: number;
  date: string;
  items: ReceiptLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paymentMethod: string;
  amountPaidCents: number;
  changeCents: number;
  customerName?: string;
  notes?: string;
}

interface SettingsCache {
  company: { name: string; document: string; phone: string; address: string };
  print: { receiptWidth: '58' | '80'; autoPrintReceipt: boolean };
}

/**
 * Gera o HTML do cupom para impressao 80mm/58mm.
 */
function generateReceiptHtml(data: ReceiptData, settings: SettingsCache): string {
  const width = settings.print.receiptWidth === '58' ? '58mm' : '80mm';
  const fontSize = settings.print.receiptWidth === '58' ? '10px' : '12px';
  const company = settings.company;

  const linesHtml = data.items
    .map((item) => {
      const discount = item.discountPercent && item.discountPercent > 0
        ? `<div class="discount">Desc: ${item.discountPercent}%</div>`
        : '';
      return `
        <tr>
          <td class="name" colspan="3">${item.name}${discount}</td>
        </tr>
        <tr>
          <td class="qty">${qty(item.quantity)} ${item.unit}</td>
          <td class="price">${money(item.unitPriceCents)}</td>
          <td class="total">${money(item.totalCents)}</td>
        </tr>
      `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Cupom #${data.saleNumber}</title>
  <style>
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: ${fontSize};
      width: ${width};
      margin: 0; padding: 2mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header { text-align: center; margin-bottom: 2mm; }
    .header h1 { font-size: ${parseInt(fontSize) + 2}px; margin: 0 0 1mm; font-weight: bold; }
    .header p { margin: 0.5mm 0; }
    .divider { border-top: 1px dashed #000; margin: 1mm 0; }
    table { width: 100%; border-collapse: collapse; margin: 1mm 0; }
    td { padding: 0.5mm 0; vertical-align: top; }
    .name { font-weight: bold; }
    .qty { white-space: nowrap; }
    .price, .total { text-align: right; white-space: nowrap; }
    .discount { font-size: ${parseInt(fontSize) - 1}px; color: #666; }
    .totals { margin-top: 2mm; }
    .totals tr td { padding: 0.5mm 0; }
    .totals .label { text-align: left; }
    .totals .value { text-align: right; font-weight: bold; }
    .total-row .value { font-size: ${parseInt(fontSize) + 2}px; }
    .payment { margin-top: 2mm; font-size: ${parseInt(fontSize) - 1}px; }
    .footer { text-align: center; margin-top: 3mm; font-size: ${parseInt(fontSize) - 1}px; color: #666; }
    @media print {
      @page { margin: 0; }
      body { margin: 0; padding: 2mm; }
      .no-print { display: none !important; }
    }
    @media screen {
      body { border: 1px solid #ccc; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${company.name || 'WEB DISTRIBUIDORA'}</h1>
    ${company.document ? `<p>${company.document}</p>` : ''}
    ${company.address ? `<p>${company.address}</p>` : ''}
    ${company.phone ? `<p>${company.phone}</p>` : ''}
  </div>
  <div class="divider"></div>
  <p><strong>CUPOM NAO FISCAL</strong></p>
  <p>Venda: #${data.saleNumber} &nbsp; Data: ${data.date}</p>
  ${data.customerName ? `<p>Cliente: ${data.customerName}</p>` : ''}
  <div class="divider"></div>
  <table>
    <thead>
      <tr>
        <td class="name">Item</td>
        <td class="price">Vl. Unit.</td>
        <td class="total">Total</td>
      </tr>
    </thead>
    <tbody>
      ${linesHtml}
    </tbody>
  </table>
  <div class="divider"></div>
  <table class="totals">
    <tr><td class="label">Subtotal</td><td class="value">${money(data.subtotalCents)}</td></tr>
    ${data.discountCents > 0 ? `<tr><td class="label">Desconto</td><td class="value">-${money(data.discountCents)}</td></tr>` : ''}
    <tr class="total-row"><td class="label">TOTAL</td><td class="value">${money(data.totalCents)}</td></tr>
  </table>
  <div class="payment">
    <p>Pagamento: ${data.paymentMethod}</p>
    ${data.amountPaidCents > data.totalCents ? `<p>Recebido: ${money(data.amountPaidCents)}</p>` : ''}
    ${data.changeCents > 0 ? `<p>Troco: ${money(data.changeCents)}</p>` : ''}
  </div>
  ${data.notes ? `<div class="divider"></div><p>Obs: ${data.notes}</p>` : ''}
  <div class="divider"></div>
  <div class="footer">
    <p>Obrigado pela preferencia!</p>
    <p>${company.name || 'WEB DISTRIBUIDORA'}</p>
  </div>
  <script>
    if (window.matchMedia('print').matches || document.readyState === 'complete') {
      window.print();
    }
  </script>
</body>
</html>
  `.trim();
}

/**
 * Abre uma nova janela com o cupom e imprime.
 */
export async function printReceipt(data: ReceiptData): Promise<Window | null> {
  if (typeof window === 'undefined') return null;

  const settings = await getSettings();
  const html = generateReceiptHtml(data, settings);
  const printWindow = window.open('', '_blank', 'width=400,height=600');
  if (!printWindow) return null;

  printWindow.document.write(html);
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };

  return printWindow;
}

/**
 * Gera link wa.me para compartilhar o cupom via WhatsApp.
 */
export async function whatsappReceiptLink(data: ReceiptData, phone?: string): Promise<string> {
  const settings = await getSettings();
  const lines = data.items
    .map((i) => `- ${i.name}: ${qty(i.quantity)} ${i.unit} x ${money(i.unitPriceCents)} = ${money(i.totalCents)}`)
    .join('%0A');

  const text = [
    `*${settings.company.name || 'WEB DISTRIBUIDORA'}*`,
    `Venda #${data.saleNumber} - ${data.date}`,
    data.customerName ? `Cliente: ${data.customerName}` : '',
    lines,
    `*Total: ${money(data.totalCents)}*`,
    `Pagamento: ${data.paymentMethod}`,
    data.changeCents > 0 ? `Troco: ${money(data.changeCents)}` : '',
    '',
    'Obrigado pela preferencia!',
  ]
    .filter(Boolean)
    .join('%0A');

  const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
  const base = cleanPhone ? `https://wa.me/${cleanPhone}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}