"use client";

// Redimensiona e comprime a foto NO CELULAR antes do upload: uma foto de 6 MB vira
// ~200-400 KB (WebP). Isso cabe no limite de body das Server Actions e poupa o 4G.

function loadViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("DECODE_FAILED"));
    };
    img.src = url;
  });
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" respeita a rotação EXIF (foto de celular em pé não sai deitada)
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* cai no <img> */
    }
  }
  return loadViaImageElement(file);
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 * Lança Error("DECODE_FAILED") quando o formato não é suportado (ex.: HEIC em navegador antigo).
 */
export async function compressImage(file, { maxSide = 1600, quality = 0.82 } = {}) {
  const source = await decode(file);
  const srcW = source.width;
  const srcH = source.height;
  if (!srcW || !srcH) throw new Error("DECODE_FAILED");

  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const width = Math.round(srcW * scale);
  const height = Math.round(srcH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000"; // fundo para PNG transparente virar JPEG sem ficar estranho
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  source.close?.();

  // Safari antigo devolve PNG quando não sabe WebP: confere o tipo e cai para JPEG.
  let blob = await toBlob(canvas, "image/webp", quality);
  if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
  if (!blob) throw new Error("ENCODE_FAILED");

  return { blob, width, height };
}
