"use server";

import { revalidatePath } from "next/cache";
import { requireBarber } from "@/lib/auth-server";
import { hasPermission, PERMISSION_KEYS, isLeadership } from "@/lib/auth";
import bcrypt from "bcryptjs";

const OFFICIAL_CATALOG = [
  { name: "Degradê", description: "Corte degradê navalhado ou disfarçado moderno", price: 25.0, duration: 30, category: "cabelo", order: 1 },
  { name: "Corte SÓ Tesoura", description: "Corte clássico 100% tesoura com acabamento preciso", price: 25.0, duration: 40, category: "cabelo", order: 2 },
  { name: "Lowfade ou Americano", description: "Corte moderno com fade baixo ou afunilado americano", price: 25.0, duration: 30, category: "cabelo", order: 3 },
  { name: "Barboterapia", description: "Tratamento completo com toalha quente, óleos e navalha", price: 20.0, duration: 30, category: "barba", order: 4 },
  { name: "Corte e Barboterapia", description: "Combo completo corte de cabelo + barba com toalha quente", price: 40.0, duration: 60, category: "combo", order: 5 },
  { name: "Corte + Barba Simples", description: "Corte alinhado acompanhado de barba e contorno simples", price: 35.0, duration: 50, category: "combo", order: 6 },
  { name: "Barba (Design Simples)", description: "Alinhamento e contorno de barba ou cavanhaque", price: 15.0, duration: 20, category: "barba", order: 7 },
];

const MATHEUS_ID = "b949db29-efb1-4131-8234-873195068328";
const WILLIAM_ID = "9ebcd15c-b747-4d0b-b12f-5de9465363f9";

/**
 * Consulta o estado atual da base de dados para orientar o Bootstrap Manual ou Assistido
 * quando o banco acabou de passar por um reset total (0 registos).
 */
export async function getShopBootstrapStatus() {
  const ctx = await requireBarber();
  if (ctx.error) return { error: ctx.error };

  try {
    const [barbersRes, servicesRes, schedulesRes] = await Promise.all([
      ctx.supabase.from("barbers").select("id, name, phone, role, active, is_active"),
      ctx.supabase.from("services").select("id", { count: "exact", head: true }),
      ctx.supabase.from("barber_schedules").select("id", { count: "exact", head: true }),
    ]);

    const barbers = (barbersRes.data || []).filter((b) => b.active !== false && b.is_active !== false);
    const servicesCount = servicesRes.count ?? 0;
    const schedulesCount = schedulesRes.count ?? 0;

    const hasMatheus = barbers.some(
      (b) =>
        b.id === MATHEUS_ID ||
        b.name?.toLowerCase().includes("matheus") ||
        (b.phone || "").replace(/\D/g, "").endsWith("996646306")
    );
    const hasWilliam = barbers.some(
      (b) =>
        b.id === WILLIAM_ID ||
        b.name?.toLowerCase().includes("william") ||
        (b.phone || "").replace(/\D/g, "").endsWith("991751875")
    );

    const teamReady = barbers.length >= 2 && hasMatheus && hasWilliam;
    const servicesReady = servicesCount > 0;
    const schedulesReady = schedulesCount >= barbers.length * 6 && schedulesCount > 0;

    return {
      barbersCount: barbers.length,
      hasMatheus,
      hasWilliam,
      servicesCount,
      schedulesCount,
      teamReady,
      servicesReady,
      schedulesReady,
      isFullyBootstrapped: teamReady && servicesReady && schedulesReady,
    };
  } catch (err) {
    return {
      barbersCount: 1,
      hasMatheus: false,
      hasWilliam: false,
      servicesCount: 0,
      schedulesCount: 0,
      teamReady: false,
      servicesReady: false,
      schedulesReady: false,
      isFullyBootstrapped: false,
    };
  }
}

/**
 * 1. Regista ou completa os barbeiros oficiais (Matheus - Chefe/Admin e William - Gerente)
 * com as permissões RBAC exatas e as escalas semanais padrão.
 */
export async function bootstrapInitialTeamAction() {
  const ctx = await requireBarber();
  if (ctx.error) return { error: ctx.error };
  if (!isLeadership(ctx.barber)) {
    return { error: "Apenas a liderança pode inicializar a equipe." };
  }

  try {
    const { data: existingBarbers } = await ctx.supabase
      .from("barbers")
      .select("id, name, phone, role");

    const list = existingBarbers || [];

    const hasMatheus = list.some(
      (b) =>
        b.id === MATHEUS_ID ||
        (b.phone || "").replace(/\D/g, "").endsWith("996646306")
    );
    const hasWilliam = list.some(
      (b) =>
        b.id === WILLIAM_ID ||
        (b.phone || "").replace(/\D/g, "").endsWith("991751875")
    );

    if (!hasMatheus) {
      const matheusHash = await bcrypt.hash("Matheus123", 10);
      await ctx.supabase.from("barbers").upsert(
        {
          id: MATHEUS_ID,
          name: "Matheus",
          phone: "83996646306",
          email: "matheus@jmbarberclub.com",
          role: "admin",
          is_active: true,
          active: true,
          commission_percent: 50.0,
          password_hash: matheusHash,
          permissions: {
            manage_services: true,
            manage_schedule_others: true,
            view_all_appointments: true,
            manage_finance: true,
          },
        },
        { onConflict: "id" }
      );
    }

    if (!hasWilliam) {
      const williamHash = await bcrypt.hash("William123", 10);
      await ctx.supabase.from("barbers").upsert(
        {
          id: WILLIAM_ID,
          name: "William",
          phone: "83991751875",
          email: "william@jmbarberclub.com",
          role: "manager",
          is_active: true,
          active: true,
          commission_percent: 50.0,
          password_hash: williamHash,
          permissions: {
            manage_services: true,
            manage_schedule_others: true,
            view_all_appointments: true,
            manage_finance: false,
            can_manage_finances: false,
            can_view_global_finances: false,
            can_register_expenses: false,
          },
        },
        { onConflict: "id" }
      );
    }

    await bootstrapInitialSchedulesAction();

    revalidatePath("/admin/equipe");
    revalidatePath("/admin/agenda");
    return { success: true };
  } catch (err) {
    return { error: err?.message || "Erro ao inicializar a equipe." };
  }
}

/**
 * 2. Popula o catálogo inicial de serviços do JM BarberClub quando a tabela `services` está vazia
 * e vincula todos os serviços aos barbeiros ativos em `barber_services`.
 */
export async function bootstrapInitialServicesCatalogAction() {
  const ctx = await requireBarber(PERMISSION_KEYS.MANAGE_SERVICES);
  if (ctx.error) return { error: "Sem permissão para inicializar o catálogo de serviços." };

  try {
    const { data: existingServices } = await ctx.supabase
      .from("services")
      .select("id, name");

    const existingNames = new Set(
      (existingServices || []).map((s) => s.name?.trim().toLowerCase())
    );

    const toInsert = OFFICIAL_CATALOG.filter(
      (item) => !existingNames.has(item.name.toLowerCase())
    ).map((item) => ({
      name: item.name,
      description: item.description,
      price: item.price,
      price_in_cents: Math.round(item.price * 100),
      duration_minutes: item.duration,
      default_duration_minutes: item.duration,
      category: item.category,
      display_order: item.order,
      is_active: true,
      active: true,
      image_url: null,
    }));

    if (toInsert.length > 0) {
      const { error: insertErr } = await ctx.supabase.from("services").insert(toInsert);
      if (insertErr) throw insertErr;
    }

    // Vincula todos os serviços ativos a todos os barbeiros ativos em barber_services
    const [{ data: allBarbers }, { data: allServices }] = await Promise.all([
      ctx.supabase.from("barbers").select("id, active, is_active"),
      ctx.supabase.from("services").select("id, active, is_active"),
    ]);

    const activeBarbers = (allBarbers || []).filter((b) => b.active !== false && b.is_active !== false);
    const activeServices = (allServices || []).filter((s) => s.active !== false && s.is_active !== false);

    if (activeBarbers.length && activeServices.length) {
      const relations = [];
      for (const b of activeBarbers) {
        for (const s of activeServices) {
          relations.push({
            barber_id: b.id,
            service_id: s.id,
            is_active: true,
          });
        }
      }
      try {
        await ctx.supabase
          .from("barber_services")
          .upsert(relations, { onConflict: "barber_id,service_id" });
      } catch {}
    }

    revalidatePath("/admin/servicos");
    revalidatePath("/admin/agenda");
    return { success: true, insertedCount: toInsert.length };
  } catch (err) {
    return { error: err?.message || "Erro ao inicializar o catálogo de serviços." };
  }
}

/**
 * 3. Inicializa a escala semanal oficial do JM BarberClub (Dom 09:00-12:30, Seg 14:30-19:00, Ter-Sáb 09:00-19:00)
 * para todos os barbeiros ativos que ainda não possuam horários gravados em `barber_schedules`.
 */
export async function bootstrapInitialSchedulesAction() {
  const ctx = await requireBarber();
  if (ctx.error) return { error: ctx.error };

  try {
    const { data: allBarbers } = await ctx.supabase
      .from("barbers")
      .select("id, active, is_active");

    const activeBarbers = (allBarbers || []).filter((b) => b.active !== false && b.is_active !== false);

    if (activeBarbers.length === 0) {
      return { error: "Nenhum barbeiro ativo encontrado para gerar escala." };
    }

    for (const barber of activeBarbers) {
      const { data: existing } = await ctx.supabase
        .from("barber_schedules")
        .select("day_of_week")
        .eq("barber_id", barber.id);

      if (!existing || existing.length === 0) {
        const rows = [
          { barber_id: barber.id, day_of_week: 0, start_time: "09:00:00", end_time: "12:30:00", is_working: true, is_working_day: true },
          { barber_id: barber.id, day_of_week: 1, start_time: "14:30:00", end_time: "19:00:00", is_working: true, is_working_day: true },
          { barber_id: barber.id, day_of_week: 2, start_time: "09:00:00", end_time: "19:00:00", is_working: true, is_working_day: true },
          { barber_id: barber.id, day_of_week: 3, start_time: "09:00:00", end_time: "19:00:00", is_working: true, is_working_day: true },
          { barber_id: barber.id, day_of_week: 4, start_time: "09:00:00", end_time: "19:00:00", is_working: true, is_working_day: true },
          { barber_id: barber.id, day_of_week: 5, start_time: "09:00:00", end_time: "19:00:00", is_working: true, is_working_day: true },
          { barber_id: barber.id, day_of_week: 6, start_time: "09:00:00", end_time: "19:00:00", is_working: true, is_working_day: true },
        ];
        await ctx.supabase.from("barber_schedules").insert(rows);
      }
    }

    revalidatePath("/admin/expediente");
    revalidatePath("/admin/agenda");
    return { success: true };
  } catch (err) {
    return { error: err?.message || "Erro ao inicializar escalas de trabalho." };
  }
}
