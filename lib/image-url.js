/**
 * Utilitário de Otimização de URLs do Supabase Storage
 * 
 * Retorna diretamente a URL pública original do objeto (/storage/v1/object/public/...),
 * garantindo compatibilidade total e eliminando erros 403 Forbidden no console
 * em instâncias sem suporte a Image Transformation (/storage/v1/render/image/).
 */

export function getOptimizedStorageUrl(rawUrl, { width = 400, quality = 80, resize = "cover" } = {}) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  // Se já for uma URL do endpoint render/image, normaliza de volta para object/public
  if (trimmed.includes("/storage/v1/render/image/public/")) {
    return trimmed.replace("/storage/v1/render/image/public/", "/storage/v1/object/public/").split("?")[0];
  }

  // Retorna diretamente a URL de objeto pública existente (zero 403)
  return trimmed;
}
