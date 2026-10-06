"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { FormField, TextInput, PrimaryButton, GhostButton } from "./FormField";
import { CategoryChips } from "./GalleryUploadSheet";
import { deleteGalleryItem, updateGalleryItem } from "@/lib/actions/gallery";
import { categoryLabel, MAX_TITLE_LENGTH } from "@/lib/constants/gallery";

/** Detalhe da foto. Quem pode editar (dono ou chefe) também vê título, categoria, visibilidade e excluir. */
export default function GalleryItemSheet({ item, onClose, onChanged, onRemoved }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("outros");
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lockRef = useRef(false);

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setCategory(item.category);
    setVisible(item.is_active);
    setError("");
  }, [item]);

  async function run(task) {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await task();
      if (res?.error === "AUTH_EXPIRED") return window.location.assign("/login");
      if (res?.error) return setError(res.error);
      return res;
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    const res = await run(() => updateGalleryItem(item.id, { title, category, is_active: visible }));
    if (res?.item) {
      onChanged?.(res.item);
      onClose();
    }
  }

  async function handleDelete() {
    if (!confirm(`Remover a foto "${item.title}"? Essa ação não pode ser desfeita.`)) return;
    const res = await run(() => deleteGalleryItem(item.id));
    if (res?.ok) {
      onRemoved?.(item.id);
      onClose();
    }
  }

  if (!item) return null;

  return (
    <BottomSheet open={Boolean(item)} onClose={busy ? () => {} : onClose} title={item.can_edit ? "Editar foto" : item.title}>
      <img
        src={item.image_url}
        alt={item.title}
        className="w-full max-h-[45vh] object-contain rounded-xl bg-black border border-zinc-800 mb-4"
      />

      {!item.can_edit ? (
        <p className="text-zinc-400 text-sm">
          {categoryLabel(item.category)}
          {item.barber_name ? ` · por ${item.barber_name}` : ""}
        </p>
      ) : (
        <form onSubmit={handleSave}>
          <FormField label="Título">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_TITLE_LENGTH} disabled={busy} />
          </FormField>

          <div className="mb-4">
            <span className="block text-xs font-medium text-zinc-400 mb-1.5">Categoria</span>
            <CategoryChips value={category} onChange={setCategory} disabled={busy} />
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => setVisible((v) => !v)}
            className="w-full flex items-center justify-between rounded-xl border border-zinc-800 bg-elevated px-4 py-3 mb-4"
          >
            <span className="flex items-center gap-2 text-sm text-white">
              {visible ? <Eye size={15} className="text-emerald-400" /> : <EyeOff size={15} className="text-zinc-500" />}
              {visible ? "Visível para os clientes" : "Oculta dos clientes"}
            </span>
            <span
              role="switch"
              aria-checked={visible}
              className={`relative w-9 h-5 rounded-full transition-colors ${visible ? "bg-accent" : "bg-zinc-700"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                  visible ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </span>
          </button>

          {error && (
            <p role="alert" className="text-accent-light text-xs mb-3">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <PrimaryButton type="submit" disabled={busy} className="flex items-center justify-center gap-2">
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Salvando…
                </>
              ) : (
                "Salvar alterações"
              )}
            </PrimaryButton>
            <GhostButton type="button" onClick={handleDelete} disabled={busy} className="flex items-center justify-center gap-1.5">
              <Trash2 size={14} /> Remover foto
            </GhostButton>
          </div>
        </form>
      )}
    </BottomSheet>
  );
}
