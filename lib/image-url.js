/**
 * Utilitário de Otimização de URLs do Supabase Storage
 * Converte URLs de objetos brutos (/storage/v1/object/public/...) para o endpoint
 * de transformação de imagens (/storage/v1/render/image/public/...), aplicando
 * dimensões exatas e qualidade adequada, evitando o download de arquivos gigantes de câmeras.
 */

export function getOptimizedStorageUrl(rawUrl, { width = 400, quality = 80, resize = "cover" } = {}) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  if (trimmed.includes("/storage/v1/object/public/")) {
    try {
      const parsed = new URL(trimmed);
      parsed.pathname = parsed.pathname.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/"
      );
      if (width) parsed.searchParams.set("width", String(width));
      if (quality) parsed.searchParams.set("quality", String(quality));
      if (resize) parsed.searchParams.set("resize", resize);
      return parsed.toString();
    } catch {
      const transformed = trimmed.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/"
      );
      const sep = transformed.includes("?") ? "&" : "?";
      return `${transformed}${sep}width=${width}&quality=${quality}&resize=${resize}`;
    }
  }

  if (trimmed.includes("/storage/v1/render/image/public/")) {
    try {
      const parsed = new URL(trimmed);
      if (width && !parsed.searchParams.has("width")) parsed.searchParams.set("width", String(width));
      if (quality && !parsed.searchParams.has("quality")) parsed.searchParams.set("quality", String(quality));
      return parsed.toString();
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}
