import { GALLERY_BUCKET } from "@/lib/constants/gallery";

/** URL pública da foto (bucket público). Funciona no servidor e no cliente. */
export function galleryPublicUrl(imagePath) {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const safePath = String(imagePath || "").split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${GALLERY_BUCKET}/${safePath}`;
}
