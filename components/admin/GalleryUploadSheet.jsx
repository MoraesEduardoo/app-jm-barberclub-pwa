"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { FormField, TextInput, PrimaryButton } from "./FormField";
import { useBarber } from "@/lib/barber-context";
import { uploadGalleryPhoto } from "@/lib/actions/gallery";
import { compressImage } from "@/lib/image-compress";
import { GALLERY_CATEGORIES, MAX_TITLE_LENGTH } from "@/lib/constants/gallery";

const TIMEOUT_MS = 30000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function CategoryChips({ value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      {GALLERY_CATEGORIES.map((c) => {
        const active = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(c.value)}
            aria-pressed={active}
            className={`h-9 rounded-full px-3.5 text-xs font-medium border transition-all touch-manipulation select-none active:scale-95 ${
              active
                ? "bg-accent/15 border-accent/40 text-accent-light"
                : "bg-elevated border-zinc-700 text-zinc-300 active:bg-zinc-800"
            }`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

export default function GalleryUploadSheet({ open, onClose, onUploaded }) {
  const { barber, isChefe, team } = useBarber();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("degrade");
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lockRef = useRef(false); // bloqueia toque duplo antes do re-render
  const inputRef = useRef(null);

  // Zera o formulário sempre que abre.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTitle("");
    setCategory("degrade");
    setOwnerId(String(barber.id));
    setError("");
  }, [open, barber.id]);

  // Pré-visualização com revogação do object URL (sem vazar memória).
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (lockRef.current) return;
    setError("");

    if (!file) return setError("Selecione uma foto.");
    if (!title.trim()) return setError("Dê um título para a foto.");

    lockRef.current = true;
    setBusy(true);
    try {
      const { blob } = await compressImage(file);

      const form = new FormData();
      form.append("file", blob, blob.type === "image/webp" ? "foto.webp" : "foto.jpg");
      form.append("title", title);
      form.append("category", category);
      if (isChefe && ownerId && ownerId !== String(barber.id)) form.append("barberId", ownerId);

      const res = await withTimeout(uploadGalleryPhoto(form), TIMEOUT_MS);
      if (res?.error === "AUTH_EXPIRED") return window.location.assign("/login");
      if (res?.error) return setError(res.error);

      onUploaded?.(res.item);
      onClose();
    } catch (err) {
      setError(
        err?.message === "DECODE_FAILED"
          ? "Não consegui abrir essa imagem. Tente uma foto JPG, PNG ou WebP."
          : err?.message === "TIMEOUT"
            ? "A conexão demorou demais. Tente novamente."
            : "Não foi possível enviar. Verifique a internet e tente de novo.",
      );
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={busy ? () => {} : onClose} title="Nova foto de corte">
      <form onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            e.target.value = ""; // permite escolher o mesmo arquivo de novo
          }}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="relative mb-4 w-full aspect-[4/3] rounded-xl border border-dashed border-zinc-700 bg-elevated overflow-hidden flex flex-col items-center justify-center gap-2 text-zinc-500 active:bg-zinc-900"
        >
          {preview ? (
            <img src={preview} alt="Pré-visualização" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <>
              <Camera size={26} />
              <span className="text-xs">Tirar foto ou escolher da galeria</span>
            </>
          )}
        </button>

        <FormField label="Título">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="Ex.: Degradê navalhado"
            disabled={busy}
          />
        </FormField>

        <div className="mb-4">
          <span className="block text-xs font-medium text-zinc-400 mb-1.5">Categoria</span>
          <CategoryChips value={category} onChange={setCategory} disabled={busy} />
        </div>

        {isChefe && team.length > 1 && (
          <FormField label="Barbeiro responsável">
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              disabled={busy}
              className="w-full h-12 rounded-lg bg-elevated border border-zinc-700 px-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-accent touch-manipulation"
            >
              {team
                .filter((m) => m.active !== false)
                .map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.name}
                    {String(m.id) === String(barber.id) ? " (você)" : ""}
                  </option>
                ))}
            </select>
          </FormField>
        )}

        {error && (
          <p role="alert" className="text-accent-light text-xs mb-3">
            {error}
          </p>
        )}

        <PrimaryButton type="submit" disabled={busy} className="flex items-center justify-center gap-2">
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Enviando…
            </>
          ) : (
            "Publicar foto"
          )}
        </PrimaryButton>
      </form>
    </BottomSheet>
  );
}
