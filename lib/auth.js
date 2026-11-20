/**
 * Chaves canônicas de permissão individual por membro da equipe.
 * A regra de caixa individual é sempre preservada: mesmo com todas as chaves
 * desativadas, cada profissional continua vendo a própria agenda e o próprio caixa/comissões.
 */
export const PERMISSION_KEYS = {
  VIEW_ALL_SCHEDULES: 'view_all_schedules', // Ver agenda de toda a equipe
  VIEW_GLOBAL_FINANCE: 'view_global_finance', // Ver faturamento global / visão geral (mantendo caixa próprio)
  MANAGE_SERVICES: 'manage_services', // Editar serviços, preços e catálogo
  MANAGE_SCHEDULE_BLOCKS: 'manage_schedule_blocks', // Gerenciar expediente, folgas e bloqueios
  MANAGE_CROWDED_MODE: 'manage_crowded_mode', // Ativar/desativar Modo Lotado
  MANAGE_TEAM: 'manage_team', // Gerenciar equipe e permissões

  // Aliases legados mantidos para compatibilidade retroativa com o restante do painel
  VIEW_ALL_APPOINTMENTS: 'view_all_schedules',
  MANAGE_FINANCE: 'view_global_finance',
  MANAGE_SCHEDULE_OTHERS: 'manage_schedule_blocks',
};

export const CANONICAL_PERMISSION_KEYS = [
  PERMISSION_KEYS.VIEW_ALL_SCHEDULES,
  PERMISSION_KEYS.VIEW_GLOBAL_FINANCE,
  PERMISSION_KEYS.MANAGE_SERVICES,
  PERMISSION_KEYS.MANAGE_SCHEDULE_BLOCKS,
  PERMISSION_KEYS.MANAGE_CROWDED_MODE,
  PERMISSION_KEYS.MANAGE_TEAM,
];

/**
 * Mapeamento de chaves legadas -> chaves canônicas.
 */
export const LEGACY_TO_CANONICAL_KEY = {
  view_all_appointments: PERMISSION_KEYS.VIEW_ALL_SCHEDULES,
  manage_finance: PERMISSION_KEYS.VIEW_GLOBAL_FINANCE,
  manage_schedule_others: PERMISSION_KEYS.MANAGE_SCHEDULE_BLOCKS,
};

/**
 * Mapeamento reverso (canônica -> legada) para manter compatibilidade no JSONB salvo.
 */
export const CANONICAL_TO_LEGACY_KEY = {
  [PERMISSION_KEYS.VIEW_ALL_SCHEDULES]: 'view_all_appointments',
  [PERMISSION_KEYS.VIEW_GLOBAL_FINANCE]: 'manage_finance',
  [PERMISSION_KEYS.MANAGE_SCHEDULE_BLOCKS]: 'manage_schedule_others',
};

/**
 * Metadados descritivos exibidos na tela "Equipe & Permissões".
 */
export const PERMISSION_DEFINITIONS = [
  {
    key: PERMISSION_KEYS.VIEW_ALL_SCHEDULES,
    label: 'Agenda de toda a equipe',
    description: 'Ver e filtrar agendamentos de todos os barbeiros no painel.',
  },
  {
    key: PERMISSION_KEYS.VIEW_GLOBAL_FINANCE,
    label: 'Faturamento global da barbearia',
    description: 'Ver visão geral, despesas e acertos (cada barbeiro mantém seu caixa próprio).',
  },
  {
    key: PERMISSION_KEYS.MANAGE_SERVICES,
    label: 'Editar serviços e preços',
    description: 'Criar, editar, reordenar serviços, durações e produtos.',
  },
  {
    key: PERMISSION_KEYS.MANAGE_SCHEDULE_BLOCKS,
    label: 'Expediente, folgas e bloqueios',
    description: 'Gerenciar dias de funcionamento, horários e bloqueios de agenda.',
  },
  {
    key: PERMISSION_KEYS.MANAGE_CROWDED_MODE,
    label: 'Controlar Modo Lotado',
    description: 'Ativar ou desativar o aviso de movimento intenso no chatbot.',
  },
  {
    key: PERMISSION_KEYS.MANAGE_TEAM,
    label: 'Gerenciar equipe e permissões',
    description: 'Adicionar colaboradores, ajustar comissões, cargos e acessos.',
  },
];

export const DEFAULT_PERMISSIONS = {
  [PERMISSION_KEYS.VIEW_ALL_SCHEDULES]: false,
  [PERMISSION_KEYS.VIEW_GLOBAL_FINANCE]: false,
  [PERMISSION_KEYS.MANAGE_SERVICES]: false,
  [PERMISSION_KEYS.MANAGE_SCHEDULE_BLOCKS]: false,
  [PERMISSION_KEYS.MANAGE_CROWDED_MODE]: false,
  [PERMISSION_KEYS.MANAGE_TEAM]: false,
};

/**
 * Atalhos rápidos (presets) por perfil: Barbeiro, Gerente e Chefe/Admin.
 * Podem ser aplicados com um toque e depois ajustados livremente pelos switches individuais.
 */
export const ROLE_PERMISSION_PRESETS = {
  barber: {
    [PERMISSION_KEYS.VIEW_ALL_SCHEDULES]: false,
    [PERMISSION_KEYS.VIEW_GLOBAL_FINANCE]: false,
    [PERMISSION_KEYS.MANAGE_SERVICES]: false,
    [PERMISSION_KEYS.MANAGE_SCHEDULE_BLOCKS]: false,
    [PERMISSION_KEYS.MANAGE_CROWDED_MODE]: false,
    [PERMISSION_KEYS.MANAGE_TEAM]: false,
  },
  manager: {
    [PERMISSION_KEYS.VIEW_ALL_SCHEDULES]: true,
    [PERMISSION_KEYS.VIEW_GLOBAL_FINANCE]: false,
    [PERMISSION_KEYS.MANAGE_SERVICES]: true,
    [PERMISSION_KEYS.MANAGE_SCHEDULE_BLOCKS]: true,
    [PERMISSION_KEYS.MANAGE_CROWDED_MODE]: true,
    [PERMISSION_KEYS.MANAGE_TEAM]: false,
  },
  admin: {
    [PERMISSION_KEYS.VIEW_ALL_SCHEDULES]: true,
    [PERMISSION_KEYS.VIEW_GLOBAL_FINANCE]: true,
    [PERMISSION_KEYS.MANAGE_SERVICES]: true,
    [PERMISSION_KEYS.MANAGE_SCHEDULE_BLOCKS]: true,
    [PERMISSION_KEYS.MANAGE_CROWDED_MODE]: true,
    [PERMISSION_KEYS.MANAGE_TEAM]: true,
  },
};

export function resolveCanonicalPermissionKey(key) {
  if (!key) return null;
  if (CANONICAL_PERMISSION_KEYS.includes(key)) return key;
  return LEGACY_TO_CANONICAL_KEY[key] || null;
}

export function getRolePermissionPreset(role) {
  return { ...(ROLE_PERMISSION_PRESETS[role] || DEFAULT_PERMISSIONS) };
}

/**
 * Normaliza o JSONB `permissions` de um membro:
 * - Preserva metadados extras armazenados no JSONB (ex.: specialties, comissões, pix_key)
 * - Resolve cada chave canônica na ordem: valor explícito canônico -> valor legado -> preset do cargo -> false
 * - Mantém as chaves legadas sincronizadas com as canônicas.
 */
export function normalizePermissions(rawPermissions = {}, role = 'barber') {
  const source = rawPermissions && typeof rawPermissions === 'object' ? rawPermissions : {};
  const preset = getRolePermissionPreset(role);
  const resolved = { ...source };

  for (const canonicalKey of CANONICAL_PERMISSION_KEYS) {
    const legacyKey = CANONICAL_TO_LEGACY_KEY[canonicalKey];
    let val;

    if (typeof source[canonicalKey] === 'boolean') {
      val = source[canonicalKey];
    } else if (legacyKey && typeof source[legacyKey] === 'boolean') {
      val = source[legacyKey];
    } else {
      val = Boolean(preset[canonicalKey]);
    }

    resolved[canonicalKey] = val;
    if (legacyKey) {
      resolved[legacyKey] = val;
    }
  }

  return resolved;
}

/**
 * Monta o payload JSONB completo para persistência em `public.barbers.permissions`,
 * preservando metadados extras e sincronizando chaves canônicas + legadas.
 */
export function buildPermissionsPayload(existingPermissions = {}, updates = {}, role = 'barber') {
  const base = normalizePermissions(existingPermissions, role);
  const next = { ...base };

  for (const [rawKey, rawVal] of Object.entries(updates || {})) {
    const canonicalKey = resolveCanonicalPermissionKey(rawKey);
    if (canonicalKey) {
      const boolVal = Boolean(rawVal);
      next[canonicalKey] = boolVal;
      const legacyKey = CANONICAL_TO_LEGACY_KEY[canonicalKey];
      if (legacyKey) {
        next[legacyKey] = boolVal;
      }
      if (canonicalKey === PERMISSION_KEYS.VIEW_GLOBAL_FINANCE) {
        next.can_manage_finances = boolVal;
        next.can_view_global_finances = boolVal;
        next.can_register_expenses = boolVal;
      }
    } else {
      next[rawKey] = rawVal;
    }
  }

  return next;
}

/**
 * Verifica se as 6 permissões granulares de um membro diferem do preset padrão do seu cargo.
 */
export function hasCustomPermissions(permissions, role) {
  const normalized = normalizePermissions(permissions, role);
  const preset = getRolePermissionPreset(role);
  return CANONICAL_PERMISSION_KEYS.some((key) => Boolean(normalized[key]) !== Boolean(preset[key]));
}

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
    permissions: normalizePermissions(barber.permissions, barber.role),
  };
}

export function isChefe(barber) {
  return barber?.role === 'admin';
}

export function isManager(barber) {
  return barber?.role === 'manager';
}

export function isLeadership(barber) {
  return barber?.role === 'admin' || barber?.role === 'manager';
}

/**
 * Avalia estritamente as permissões individuais normalizadas do membro.
 * Respeita toggles ativados/desativados pelo Chefe/Admin para qualquer cargo,
 * mantendo fallback seguro para o preset do cargo caso uma chave ainda não exista no banco.
 */
export function hasPermission(barber, key) {
  if (!barber) return false;
  const canonicalKey = resolveCanonicalPermissionKey(key);
  if (!canonicalKey) {
    return Boolean(barber.permissions?.[key]);
  }
  const normalized = normalizePermissions(barber.permissions, barber.role);
  return Boolean(normalized[canonicalKey]);
}
