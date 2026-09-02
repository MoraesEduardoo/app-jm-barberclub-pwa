// Constantes compartilhadas (NÃO é um arquivo 'use server' — arquivos
// server actions só podem exportar funções assíncronas, então esta lista
// precisa ficar separada de lib/actions/schedule.js).
//
// ATENÇÃO: "day_of_week" é texto no banco, não um número 0-6. Os valores
// abaixo (domingo, segunda, terca...) são a suposição mais comum — CONFIRME
// com os dados já gravados em barber_schedules e ajuste o campo "value" de
// cada item se for diferente.
export const WEEKDAYS = [
  { value: 'domingo', label: 'Domingo', short: 'Dom' },
  { value: 'segunda', label: 'Segunda', short: 'Seg' },
  { value: 'terca', label: 'Terça', short: 'Ter' },
  { value: 'quarta', label: 'Quarta', short: 'Qua' },
  { value: 'quinta', label: 'Quinta', short: 'Qui' },
  { value: 'sexta', label: 'Sexta', short: 'Sex' },
  { value: 'sabado', label: 'Sábado', short: 'Sáb' },
];
