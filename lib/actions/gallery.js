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

const AUTH_EXPIRED = { error: "AUTH_EXPIRED" };
const FALLBACK_BUCKET = "portfolio-images";
const FALLBACK_TABLE = "portfolio_items";

function getGalleryClient(ctx) {
  try {
    return createAdminClient();
  } catch {
    return ctx?.supabase || null;
  }
}

// Confere os magic bytes da imagem (JPG, PNG, WebP)
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
  const rawPath = row.image_path || row.image_url || row.storage_url || "";
  return {
    id: row.id,
    title: row.title || "Corte JM Barberclub",
    category: row.category || "degrade",
    barber_id: row.barber_id,
    image_path: rawPath,
    image_url: galleryPublicUrl(rawPath),
    is_active: row.is_active !== undefined ? Boolean(row.is_active) : true,
    created_at: row.created_at,
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

    // Tenta primeiro a tabela haircut_gallery
    let { data, error } = await client
      .from(GALLERY_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);

    // Se falhar (ex: relation does not exist), tenta portfolio_items
    if (error) {
      console.warn(`[listGallery] Falha em ${GALLERY_TABLE}, tentando ${FALLBACK_TABLE}:`, error.message);
      const fallbackRes = await client
        .from(FALLBACK_TABLE)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);

      if (!fallbackRes.error && fallbackRes.data) {
        data = fallbackRes.data;
        error = null;
      }
    }

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

/** FormData: file (Blob comprimido), title, category e, para o chefe, barberId. */
export async function uploadGalleryPhoto(formData) {
  const ctx = await requireBarber();
  if (ctx.error) return AUTH_EXPIRED;

  let storedBucket = GALLERY_BUCKET;
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

    // Dono da foto
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

    const fileName = `${ownerId}/${randomUUID()}.${kind.ext}`;
    let uploadSuccess = false;

    // 1. Tenta upload no bucket principal (haircut-gallery)
    let uploadRes = await client.storage.from(GALLERY_BUCKET).upload(fileName, buffer, {
      contentType: kind.mime,
      cacheControl: "31536000",
      upsert: true,
    });

    if (!uploadRes.error) {
      uploadSuccess = true;
      storedBucket = GALLERY_BUCKET;
      storedPath = fileName;
    } else {
      console.warn(`[uploadGalleryPhoto] Falha no upload no bucket ${GALLERY_BUCKET}:`, uploadRes.error.message);

      // Se o bucket não existir, tenta auto-provisionar
      if (uploadRes.error.message?.includes("not found") || uploadRes.error.statusCode === "404" || uploadRes.error.statusCode === 404) {
        try {
          await client.storage.createBucket(GALLERY_BUCKET, { public: true });
          const retry = await client.storage.from(GALLERY_BUCKET).upload(fileName, buffer, {
            contentType: kind.mime,
            cacheControl: "31536000",
            upsert: true,
          });
          if (!retry.error) {
            uploadSuccess = true;
            storedBucket = GALLERY_BUCKET;
            storedPath = fileName;
          }
        } catch {}
      }

      // Se ainda não teve sucesso, tenta o bucket de compatibilidade (portfolio-images)
      if (!uploadSuccess) {
        const fallbackUpload = await client.storage.from(FALLBACK_BUCKET).upload(fileName, buffer, {
          contentType: kind.mime,
          cacheControl: "31536000",
          upsert: true,
        });

        if (!fallbackUpload.error) {
          uploadSuccess = true;
          storedBucket = FALLBACK_BUCKET;
          storedPath = fileName;
        } else {
          console.error("[uploadGalleryPhoto] Falha definitiva no upload nos buckets:", fallbackUpload.error.message);
          return {
            error: `Erro ao enviar arquivo para o Storage: ${uploadRes.error.message || fallbackUpload.error.message}`,
          };
        }
      }
    }

    // Calcula URL pública
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
    const safePath = storedPath.split("/").map(encodeURIComponent).join("/");
    const publicUrl = `${base}/storage/v1/object/public/${storedBucket}/${safePath}`;

    // 2. Gravação de Metadados no Banco
    const insertPayload = {
      title,
      category,
      barber_id: ownerId,
      image_path: storedPath,
      image_url: publicUrl,
      storage_url: publicUrl,
      is_active: true,
    };

    let targetTable = GALLERY_TABLE;
    let { data: row, error: insertError } = await client
      .from(GALLERY_TABLE)
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError) {
      console.warn(`[uploadGalleryPhoto] Falha ao inserir em ${GALLERY_TABLE}:`, insertError.message);

      // Tenta com payload reduzido (apenas colunas básicas caso alguma adicional não exista)
      const simplePayload = {
        title,
        category,
        barber_id: ownerId,
        image_path: storedPath,
      };

      const retryInsert = await client.from(GALLERY_TABLE).insert(simplePayload).select("*").single();

      if (!retryInsert.error && retryInsert.data) {
        row = retryInsert.data;
        insertError = null;
      } else {
        // Tenta na tabela de compatibilidade portfolio_items
        const fallbackInsert = await client
          .from(FALLBACK_TABLE)
          .insert({
            title,
            category,
            barber_id: ownerId,
            image_url: publicUrl,
            storage_url: publicUrl,
          })
          .select("*")
          .single();

        if (!fallbackInsert.error && fallbackInsert.data) {
          row = fallbackInsert.data;
          insertError = null;
          targetTable = FALLBACK_TABLE;
        }
      }
    }

    if (insertError) {
      console.error("[uploadGalleryPhoto] Erro definitivo ao gravar no banco:", insertError);
      // Remove o arquivo órfão do storage
      if (storedPath && client) {
        try {
          await client.storage.from(storedBucket).remove([storedPath]);
        } catch {}
      }
      return { error: `Erro ao salvar registro da foto no banco: ${insertError.message}` };
    }

    const names = await loadNames(client);
    return { item: decorate(row, ctx, names) };
  } catch (e) {
    console.error("[uploadGalleryPhoto] Exceção capturada:", e);
    if (storedPath && client) {
      try {
        await client.storage.from(storedBucket).remove([storedPath]);
      } catch {}
    }
    return { error: e?.message || "Não foi possível enviar a foto. Tente novamente." };
  }
}

async function loadEditable(ctx, client, id) {
  let { data: row, error } = await client.from(GALLERY_TABLE).select("*").eq("id", id).maybeSingle();
  if (error || !row) {
    const fallbackRes = await client.from(FALLBACK_TABLE).select("*").eq("id", id).maybeSingle();
    if (!fallbackRes.error && fallbackRes.data) {
      row = fallbackRes.data;
      error = null;
    }
  }

  if (error) throw error;
  if (!row) return { error: "Foto não encontrada." };
  if (!canEdit(ctx, row)) return { error: "Sem permissão para esta foto." };
  return { row };
}

/** Edita título, categoria e visibilidade. */
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

    let { data: row, error } = await client
      .from(GALLERY_TABLE)
      .update({ title: cleaned, category, is_active: Boolean(is_active), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      const fallbackUpdate = await client
        .from(FALLBACK_TABLE)
        .update({ title: cleaned, category, is_active: Boolean(is_active), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (!fallbackUpdate.error && fallbackUpdate.data) {
        row = fallbackUpdate.data;
        error = null;
      }
    }

    if (error) throw error;

    const names = await loadNames(client);
    return { item: decorate(row, ctx, names) };
  } catch (e) {
    console.error("[updateGalleryItem]", e);
    return { error: "Não foi possível salvar as alterações." };
  }
}

/** Remove a foto (registro + arquivo). */
export async function deleteGalleryItem(id) {
  const ctx = await requireBarber();
  if (ctx.error) return AUTH_EXPIRED;

  try {
    const client = getGalleryClient(ctx);
    if (!client) return { error: "Cliente indisponível." };

    const found = await loadEditable(ctx, client, id);
    if (found.error) return { error: found.error };

    let { error } = await client.from(GALLERY_TABLE).delete().eq("id", id);
    if (error) {
      await client.from(FALLBACK_TABLE).delete().eq("id", id);
    }

    const rawPath = found.row.image_path || found.row.image_url || found.row.storage_url || "";
    if (rawPath && !rawPath.startsWith("http")) {
      try {
        await client.storage.from(GALLERY_BUCKET).remove([rawPath]);
        await client.storage.from(FALLBACK_BUCKET).remove([rawPath]);
      } catch {}
    }

    return { ok: true };
  } catch (e) {
    console.error("[deleteGalleryItem]", e);
    return { error: "Não foi possível remover a foto." };
  }
}
