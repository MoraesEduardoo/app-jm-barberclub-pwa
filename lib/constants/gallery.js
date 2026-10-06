// Compartilhado entre cliente e servidor. Sem dependências.
export const GALLERY_TABLE = "haircut_gallery";
export const GALLERY_BUCKET = "haircut-gallery";

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // igual ao limite do bucket
export const MAX_TITLE_LENGTH = 60;

// Os valores precisam bater com o CHECK da migration 004.
export const GALLERY_CATEGORIES = [
  { value: "degrade", label: "Degradê" },
  { value: "social", label: "Social" },
  { value: "barba", label: "Barba" },
  { value: "infantil", label: "Infantil" },
  { value: "outros", label: "Outros" },
];

export const GALLERY_CATEGORY_VALUES = GALLERY_CATEGORIES.map((c) => c.value);

export function categoryLabel(value) {
  return GALLERY_CATEGORIES.find((c) => c.value === value)?.label || "Outros";
}
