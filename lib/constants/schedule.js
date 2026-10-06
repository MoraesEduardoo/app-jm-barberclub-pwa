// Constantes compartilhadas (NÃO é um arquivo 'use server' — arquivos
// server actions só podem exportar funções assíncronas, então esta lista
// precisa ficar separada de lib/actions/schedule.js).
//
// ATENÇÃO: "day_of_week" é texto no banco, não um número 0-6. Os valores
// abaixo (domingo, segunda, terca...) são a suposição mais comum — CONFIRME
// com os dados já gravados em barber_schedules e ajuste o campo "value" de
// cada item se for diferente.
// Intervalo (em minutos) usado para gerar a grade de horários disponíveis
// na agenda (ex.: 09:00, 09:10, 09:20...). Trocar esse número muda a grade
// inteira do sistema de uma vez só — não tem outro lugar com esse valor
// "hardcoded".
export const SLOT_STEP_MINUTES = 10;

export const WEEKDAYS = [
  { value: 'domingo', label: 'Domingo', short: 'Dom' },
  { value: 'segunda', label: 'Segunda', short: 'Seg' },
  { value: 'terca', label: 'Terça', short: 'Ter' },
  { value: 'quarta', label: 'Quarta', short: 'Qua' },
  { value: 'quinta', label: 'Quinta', short: 'Qui' },
  { value: 'sexta', label: 'Sexta', short: 'Sex' },
  { value: 'sabado', label: 'Sábado', short: 'Sáb' },
];

// Converte uma data (ou string "YYYY-MM-DD") no "value" de day_of_week usado
// em barber_schedules — evita espalhar essa conta pelo código todo.
export function dayOfWeekFromDate(dateOrISOString) {
  const date =
    typeof dateOrISOString === 'string'
      ? new Date(`${dateOrISOString}T00:00:00`)
      : dateOrISOString;
  return WEEKDAYS[date.getDay()].value;
}
