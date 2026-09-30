/**
 * Rotulos amigaveis para as colunas dos relatorios.
 *
 * Os builders de relatorio usam chaves tecnicas (`snake_case`) nas linhas e
 * colunas. Este mapa translate a chave para o rotulo exibido na tela e usado
 * tambem nos cabecalhos de CSV/XLSX, garantindo que tela e exportacao
 * falem exatamente a mesma lingua.
 */

const REPORT_COLUMN_LABELS: Record<string, string> = {
  venda: 'Venda',
  codigo_interno: 'Codigo interno',
  codigo_barras: 'Codigo de barras',
  preco_venda: 'Preco de venda',
  preco_custo: 'Preco de custo',
  margem_percent: 'Margem (%)',
  estoque_minimo: 'Estoque minimo',
  forma_pagamento: 'Pagamento',
  lucro_estimado: 'Lucro estimado',
  ticket_medio: 'Ticket medio',
  total_vendas: 'Vendas',
  total_produtos: 'Produtos',
  valor_estoque_custo: 'Valor (custo)',
  valor_estoque_venda: 'Valor (venda)',
  valor_preso: 'Valor parado',
  produtos_parados: 'Produtos parados',
  meses_analisados: 'Meses analisados',
  estoque_anterior: 'Estoque anterior',
  estoque_posterior: 'Estoque posterior',
  valor_inicial: 'Valor inicial',
  valor_abertura: 'Abertura',
  documentos: 'Documento',
  data: 'Data',
  tipo: 'Tipo',
  produto: 'Produto',
  quantidade: 'Quantidade',
  unidade: 'Unidade',
  motivo: 'Motivo',
  documento: 'Documento',
  responsavel: 'Responsavel',
  status: 'Status',
  entradas: 'Entradas',
  saidas: 'Saidas',
  esperado: 'Esperado',
  informado: 'Informado',
  diferenca: 'Diferenca',
  vendedor: 'Vendedor',
  usuario: 'Usuario',
  faturamento: 'Faturamento',
  descontos: 'Descontos',
  posicao: 'Posicao',
  quantidade_vendida: 'Quantidade vendida',
  nome: 'Nome',
  categoria: 'Categoria',
  estoque: 'Estoque',
  valor_custo: 'Valor de custo',
  valor_venda: 'Valor de venda',
  situacao: 'Situacao',
  estoque_anterior_texto: 'Estoque anterior',
  valor_estoque: 'Valor em estoque',
  dias_sem_saida: 'Dias sem saida',
};

/**
 * Traduz a chave tecnica de uma coluna para o rotulo exibido.
 * Chaves desconhecidas viram texto legivel ("estoque_minimo" -> "Estoque minimo").
 */
export function reportColumnLabel(key: string): string {
  const known = REPORT_COLUMN_LABELS[key];
  if (known) return known;

  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Cabecalhos amigaveis para uma lista de chaves de coluna. */
export function reportColumnLabels(keys: string[]): string[] {
  return keys.map(reportColumnLabel);
}