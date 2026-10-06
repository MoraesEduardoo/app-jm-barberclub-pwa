// Constantes compartilhadas (NÃO é um arquivo 'use server' — arquivos
// server actions só podem exportar funções assíncronas, então esta lista
// precisa ficar separada de lib/actions/finance.js; exportar um array de lá
// quebra em runtime no client, mesmo sem erro no build).

export const EXPENSE_CATEGORIES = [
  { key: 'aluguel', label: 'Aluguel' },
  { key: 'produtos', label: 'Produtos & Estoque' },
  { key: 'contas', label: 'Contas (água/luz/internet)' },
  { key: 'manutencao', label: 'Manutenção & Equipamentos' },
  { key: 'salarios', label: 'Salários & Comissões' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'outros', label: 'Outros' },
];
