/**
 * Chaves de permissão que o barbeiro chefe (role = 'admin') pode conceder
 * aos demais barbeiros (role = 'barber'). O chefe sempre tem todas elas,
 * de forma implícita e não editável.
 */
export const PERMISSION_KEYS = {
  MANAGE_SERVICES: 'manage_services', // criar/editar serviços, preços e duração
  MANAGE_SCHEDULE_OTHERS: 'manage_schedule_others', // editar expediente de outros barbeiros
  VIEW_ALL_APPOINTMENTS: 'view_all_appointments', // ver agenda de todos, não só a própria
  MANAGE_FINANCE: 'manage_finance', // ver faturamento e caixa completo (não só o próprio)
};

export const DEFAULT_PERMISSIONS = {
  [PERMISSION_KEYS.MANAGE_SERVICES]: false,
  [PERMISSION_KEYS.MANAGE_SCHEDULE_OTHERS]: false,
  [PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS]: false,
  [PERMISSION_KEYS.MANAGE_FINANCE]: false,
};

/**
 * Busca o registro do barbeiro pelo telefone (chave de login usada no
 * fluxo público de agendamento). Compara apenas os dígitos dos dois lados
 * (via RPC get_barber_by_phone), então funciona mesmo com o telefone
 * salvo formatado, ex.: "(83) 99664-6306".
 */
export async function getBarberByPhone(supabase, phone) {
  const cleanPhone = (phone || '').replace(/\D/g, '');
  if (!cleanPhone) return null;

  const { data, error } = await supabase.rpc('get_barber_by_phone', {
    phone_input: cleanPhone,
  });

  if (error || !data || data.length === 0) return null;

  const barber = data[0];
  return {
    ...barber,
    permissions: { ...DEFAULT_PERMISSIONS, ...(barber.permissions || {}) },
  };
}

export function isChefe(barber) {
  return barber?.role === 'admin';
}

export function hasPermission(barber, key) {
  if (!barber) return false;
  if (isChefe(barber)) return true;
  return Boolean(barber.permissions?.[key]);
}
