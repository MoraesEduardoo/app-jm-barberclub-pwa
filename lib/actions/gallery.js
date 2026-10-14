"use server";

import { randomUUID } from "node:crypto";
import { requireBarber } from "@/lib/auth-server";
import { isChefe } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { galleryPublicUrl } from "@/lib/gallery-url";
import {
  GALLERY_BUCKET,
  GALLERY_CATEGORY_VALUES,
  GALLERY_TABLE,
  MAX_TITLE_LENGTH,
  MAX_UPLOAD_BYTES,
} from "@/lib/constants/gallery";

/*
 * Regras:
 *  - qualquer barbeiro ativo VÊ o catálogo e SOBE fotos (ficam no nome dele);
 *  - editar / ocultar / excluir: só o dono da foto ou o chefe;
 *  - o chefe pode subir em nome de outro barbeiro.
 * As escritas usam client com fallback seguro.
 * Todas as ações devolvem { ... } ou { error } — nunca lançam.
 */

const COLUMNS = "id, title, category, barber_id, image_path, is_active, created_at";
const AUTH_EXPIRED = { error: "AUTH_EXPIRED" };

function getGalleryClient(ctx) {
  try {
    return createAdminClient();
  } catch {
    return ctx?.supabase || null;
  }
}

// Confere os "magic bytes": não confia no Content-Type enviado pelo cliente.
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", mime: "image/png" };
  }
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

function cleanTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validateMeta(title, category) {
  if (!title) return "Dê um título para a foto.";
  if (title.length > MAX_TITLE_LENGTH) return `O título pode ter no máximo ${MAX_TITLE_LENGTH} caracteres.`;
  if (!GALLERY_CATEGORY_VALUES.includes(category)) return "Escolha uma categoria válida.";
  return null;
}

function canEdit(ctx, row) {
  return isChefe(ctx.barber) || String(row.barber_id) === String(ctx.barber.id);
}

function decorate(row, ctx, namesById) {
  return {
    ...row,
    image_url: galleryPublicUrl(row.image_path),
    barber_name: namesById.get(String(row.barber_id)) || "",
    can_edit: canEdit(ctx, row),
  };
}

async function loadNames(client) {
  if (!client) return new Map();
  try {
    const { data } = await client.from("barbers").select("id, name");
    return new Map((data || []).map((b) => [String(b.id), b.name]));
  } catch {
    return new Map();
  }
}

/** Catálogo para o painel. Tratamento seguro e resiliente que não quebra a interface. */
export async function listGallery() {
  const ctx = await requireBarber();
  if (ctx.error) return AUTH_EXPIRED;

  try {
    const client = getGalleryClient(ctx);
    if (!client) return { items: [] };

    const { data, error } = await client
      .from(GALLERY_TABLE)
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(300);

    // Se a tabela não existir ainda ou retornar erro (ex: 42P01), retorna lista vazia amigável
    if (error) {
      console.warn("[listGallery] Consulta retornou erro, exibindo catálogo vazio:", error.message);
      return { items: [] };
    }

    const names = await loadNames(client);
    const items = (data || []).map((r) => decorate(r, ctx, names)).filter((i) => i.is_active || i.can_edit);
    return { items };
  } catch (e) {
    console.warn("[listGallery] Exceção capturada, exibindo estado amigável:", e?.message);
    return { items: [] };
  }
}

/** FormData: file (Blob já comprimido), title, category e, só para o chefe, barberId. */
export async function uploadGalleryPhoto(formData) {
  const ctx = await requireBarber();
  if (ctx.error) return AUTH_EXPIRED;

  let storedPath = null;
  let client = null;
  try {
    const file = formData.get("file");
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return { error: "Selecione uma foto." };
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return { error: "A foto precisa ter até 3 MB." };
    }

    const title = cleanTitle(formData.get("title"));
    const category = String(formData.get("category") || "");
    const metaError = validateMeta(title, category);
    if (metaError) return { error: metaError };

    client = getGalleryClient(ctx);
    if (!client) return { error: "Cliente de banco de dados indisponível." };

    // Dono da foto: o próprio barbeiro; só o chefe pode escolher outro (e ele precisa existir).
    let ownerId = String(ctx.barber.id);
    const requestedOwner = String(formData.get("barberId") || "");
    if (requestedOwner && requestedOwner !== ownerId) {
      if (!isChefe(ctx.barber)) return { error: "Sem permissão para esta ação." };
      const { data: owner } = await client.from("barbers").select("id").eq("id", requestedOwner).maybeSingle();
      if (!owner) return { error: "Barbeiro não encontrado." };
      ownerId = String(owner.id);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const kind = sniffImage(buffer);
    if (!kind) return { error: "Formato não suportado. Use JPG, PNG ou WebP." };

    const path = `${ownerId}/${randomUUID()}.${kind.ext}`;
    const { error: uploadError } = await client.storage.from(GALLERY_BUCKET).upload(path, buffer, {
      contentType: kind.mime,
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadError) throw uploadError;
    storedPath = path;

    const { data: row, error: insertError } = await client
      .from(GALLERY_TABLE)
      .insert({ title, category, barber_id: ownerId, image_path: path })
      .select(COLUMNS)
      .single();
    if (insertError) throw insertError;

    storedPath = null;
    const names = await loadNames(client);
    return { item: decorate(row, ctx, names) };
  } catch (e) {
    console.error("[uploadGalleryPhoto]", e);
    if (storedPath && client) {
      try {
        await client.storage.from(GALLERY_BUCKET).remove([storedPath]);
      } catch {}
    }
    return { error: "Não foi possível enviar a foto. Verifique a configuração do storage." };
  }
}

async function loadEditable(ctx, client, id) {
  const { data: row, error } = await client.from(GALLERY_TABLE).select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row) return { error: "Foto não encontrada." };
  if (!canEdit(ctx, row)) return { error: "Sem permissão para esta foto." };
  return { row };
}

/** Edita título, categoria e visibilidade (is_active=false oculta dos clientes). */
export async function updateGalleryItem(id, { title, category, is_active } = {}) {
  const ctx = await requireBarber();
  if (ctx.error) return AUTH_EXPIRED;

  try {
    const cleaned = cleanTitle(title);
    const metaError = validateMeta(cleaned, category);
    if (metaError) return { error: metaError };

    const client = getGalleryClient(ctx);
    if (!client) return { error: "Cliente indisponível." };

    const found = await loadEditable(ctx, client, id);
    if (found.error) return { error: found.error };

    const { data: row, error } = await client
      .from(GALLERY_TABLE)
      .update({ title: cleaned, category, is_active: Boolean(is_active), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(COLUMNS)
      .single();
    if (error) throw error;

    const names = await loadNames(client);
    return { item: decorate(row, ctx, names) };
  } catch (e) {
    console.error("[updateGalleryItem]", e);
    return { error: "Não foi possível salvar as alterações." };
  }
}

/** Remove a foto (registro + arquivo). Agendamentos que a usavam ficam sem referência. */
export async function deleteGalleryItem(id) {
  const ctx = await requireBarber();
  if (ctx.error) return AUTH_EXPIRED;

  try {
    const client = getGalleryClient(ctx);
    if (!client) return { error: "Cliente indisponível." };

    const found = await loadEditable(ctx, client, id);
    if (found.error) return { error: found.error };

    const { error } = await client.from(GALLERY_TABLE).delete().eq("id", id);
    if (error) throw error;

    try {
      await client.storage.from(GALLERY_BUCKET).remove([found.row.image_path]);
    } catch {}

    return { ok: true };
  } catch (e) {
    console.error("[deleteGalleryItem]", e);
    return { error: "Não foi possível remover a foto." };
  }
}
