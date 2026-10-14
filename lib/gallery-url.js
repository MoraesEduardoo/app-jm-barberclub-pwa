import { GALLERY_BUCKET } from "@/lib/constants/gallery";

/** 
 * URL pública da foto (bucket público).
 * Funciona tanto no servidor quanto no cliente.
 * Suporta caminhos relativos do storage (ex: "ownerId/uuid.webp") ou URLs já completas.
 */
export function galleryPublicUrl(imagePathOrUrl) {
  if (!imagePathOrUrl) return "";
  const raw = String(imagePathOrUrl).trim();
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) {
    return raw;
  }
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  // Remove eventual barra inicial para não duplicar
  const cleanPath = raw.replace(/^\/+/, "");
  const safePath = cleanPath.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${GALLERY_BUCKET}/${safePath}`;
}
