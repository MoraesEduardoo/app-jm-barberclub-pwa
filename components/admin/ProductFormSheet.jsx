'use client';

import { useState, useEffect, useRef } from 'react';
import BottomSheet from './BottomSheet';
import { FormField, TextInput, PrimaryButton, GhostButton } from './FormField';
import {
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductPhoto,
  removeProductPhoto,
} from '@/lib/actions/products';
import { compressImage } from '@/lib/image-compress';
import { Upload, X, Package, Coffee, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useBarber } from '@/lib/barber-context';
import { isChefe } from '@/lib/auth';
import { isConvenienceProduct, isOwnerBarber } from '@/lib/commission';

export default function ProductFormSheet({
  open,
  onClose,
  product,
  defaultCategory = 'barbearia', // 'barbearia' | 'conveniencia'
}) {
  const { barber } = useBarber();
  const isChief = isChefe(barber) || isOwnerBarber(barber);

  const isEditing = Boolean(product && product.id);
  const fileInputRef = useRef(null);

  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [price, setPrice] = useState(
    product?.price !== undefined && product?.price !== null ? String(product.price) : ''
  );
  const [stockQuantity, setStockQuantity] = useState(
    product?.stock_quantity !== undefined && product?.stock_quantity !== null
      ? String(product.stock_quantity)
      : '0'
  );
  const [category, setCategory] = useState(() => {
    if (product && isConvenienceProduct(product)) return 'conveniencia';
    return defaultCategory === 'conveniencia' && isChief ? 'conveniencia' : 'barbearia';
  });
  const [isActive, setIsActive] = useState(
    product?.is_active !== undefined ? Boolean(product.is_active) : true
  );

  const [previewUrl, setPreviewUrl] = useState(product?.image_url || null);
  const [pendingBlob, setPendingBlob] = useState(null);
  const [isPhotoRemoved, setIsPhotoRemoved] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      if (product) {
        setName(product.name || '');
        setDescription(product.description || '');
        setPrice(
          product.price !== undefined && product.price !== null ? String(product.price) : ''
        );
        setStockQuantity(
          product.stock_quantity !== undefined && product.stock_quantity !== null
            ? String(product.stock_quantity)
            : '0'
        );
        setCategory(
          isConvenienceProduct(product) && isChief ? 'conveniencia' : 'barbearia'
        );
        setIsActive(product.is_active !== undefined ? Boolean(product.is_active) : true);
        setPreviewUrl(product.image_url || null);
      } else {
        setName('');
        setDescription('');
        setPrice('');
        setStockQuantity('10');
        setCategory(defaultCategory === 'conveniencia' && isChief ? 'conveniencia' : 'barbearia');
        setIsActive(true);
        setPreviewUrl(null);
      }
      setPendingBlob(null);
      setIsPhotoRemoved(false);
      setError('');
    } else {
      setPreviewUrl((prev) => {
        if (prev && typeof prev === 'string' && prev.startsWith('blob:')) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
      setPendingBlob(null);
      setIsPhotoRemoved(false);
      setError('');
    }
  }, [open, product, defaultCategory, isChief]);

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!(file instanceof Blob) || (file.type && !file.type.startsWith('image/'))) {
      setError('Selecione um arquivo de imagem válido (JPG, PNG ou WebP).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setError('');
    setCompressing(true);
    try {
      const compressedResult = await compressImage(file, { maxSide: 1024, quality: 0.85 });
      const finalBlob = compressedResult?.blob || compressedResult;

      if (!finalBlob || !(finalBlob instanceof Blob)) {
        throw new Error('Falha ao processar a imagem selecionada.');
      }

      setPreviewUrl((prev) => {
        if (prev && typeof prev === 'string' && prev.startsWith('blob:')) {
          URL.revokeObjectURL(prev);
        }
        return URL.createObjectURL(finalBlob);
      });

      setPendingBlob(finalBlob);
      setIsPhotoRemoved(false);
    } catch (err) {
      console.error('Falha ao processar imagem do produto:', err);
      setError('Não foi possível processar a imagem.');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setCompressing(false);
    }
  }

  function handleRemovePhoto() {
    setPreviewUrl((prev) => {
      if (prev && typeof prev === 'string' && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setPendingBlob(null);
    setIsPhotoRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim() || price === '') {
      setError('Preencha o nome e o preço do item.');
      return;
    }

    const isConv = isChief && category === 'conveniencia';

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        price: Number(price),
        stock_quantity: Math.max(0, Math.floor(Number(stockQuantity || 0))),
        is_active: isActive,
        category: isConv ? 'conveniencia' : 'barbearia',
        is_convenience: isConv,
      };

      let targetProductId = product?.id;

      if (isEditing) {
        await updateProduct(targetProductId, payload);
      } else {
        const created = await createProduct(payload);
        targetProductId = created?.id;
      }

      if (pendingBlob && targetProductId) {
        const formData = new FormData();
        const ext = pendingBlob.type === 'image/jpeg' ? 'jpg' : 'webp';
        formData.append('file', pendingBlob, `${targetProductId}.${ext}`);
        await uploadProductPhoto(targetProductId, formData);
      } else if (isPhotoRemoved && targetProductId) {
        await removeProductPhoto(targetProductId);
      }

      toast.success(
        isEditing
          ? isConv
            ? 'Item de conveniência atualizado!'
            : 'Produto atualizado!'
          : isConv
          ? 'Item de conveniência guardado!'
          : 'Produto guardado com sucesso!'
      );
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao guardar o produto.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!product || !confirm(`Remover "${product.name}"?`)) return;
    setSaving(true);
    try {
      await deleteProduct(product.id);
      toast.success('Item removido.');
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao remover o item.');
      setSaving(false);
    }
  }

  const isConvenience = isChief && category === 'conveniencia';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={
        isEditing
          ? isConvenience
            ? 'Editar item de conveniência'
            : 'Editar produto'
          : isConvenience
          ? 'Registar conveniência'
          : 'Registar produto'
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Seletor de Categoria (Exclusivo para o Barbeiro Chefe) */}
        {isChief && (
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-zinc-400">
              Tipo de Item
            </span>
            <div className="grid grid-cols-2 gap-1.5 bg-surface border border-zinc-800 rounded-xl p-1">
              <button
                type="button"
                onClick={() => setCategory('barbearia')}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                  category === 'barbearia'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Package size={14} />
                <span>Produto Barbearia</span>
              </button>
              <button
                type="button"
                onClick={() => setCategory('conveniencia')}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                  category === 'conveniencia'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Coffee size={14} />
                <span>Conveniência</span>
              </button>
            </div>
            {isConvenience && (
              <p className="text-[11px] text-emerald-400 px-1">
                Exclusivo Chefe: valores de Conveniência ficam 100% no caixa geral (sem comissão de colaboradores).
              </p>
            )}
          </div>
        )}

        {/* Foto do Produto (Supabase Storage) */}
        <div className="bg-surface/60 border border-zinc-800/80 rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
              {isConvenience ? (
                <Coffee size={13} className="text-emerald-400" />
              ) : (
                <Package size={13} className="text-accent" />
              )}
              {isConvenience ? 'Foto da Conveniência' : 'Foto do Produto'}
            </span>
            {previewUrl && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                className="text-[11px] text-accent-light hover:underline flex items-center gap-1"
              >
                <X size={12} /> Remover foto
              </button>
            )}
          </div>

          <div className="flex items-center gap-3.5">
            <div className="relative h-20 w-20 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-700/80 shrink-0 flex items-center justify-center">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Prévia do produto"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover object-center rounded-xl"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-zinc-600 gap-1 text-center p-1">
                  {isConvenience ? <Coffee size={20} /> : <Package size={20} />}
                  <span className="text-[10px] text-zinc-500">Sem foto</span>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
                id="product-photo-input"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={compressing || saving}
                className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl bg-zinc-900 border border-zinc-700/80 hover:border-accent text-xs font-semibold text-white active:scale-95 transition-all touch-manipulation disabled:opacity-50"
              >
                {compressing ? (
                  <Loader2 size={14} className="animate-spin text-accent" />
                ) : (
                  <Upload size={14} className="text-accent" />
                )}
                {compressing ? 'Processando…' : previewUrl ? 'Trocar foto' : 'Enviar foto'}
              </button>
              <p className="text-[10px] text-zinc-500 leading-tight">
                A foto será guardada automaticamente no Supabase Storage.
              </p>
            </div>
          </div>
        </div>

        <FormField label={isConvenience ? 'Nome da bebida / snack' : 'Nome do produto'}>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              isConvenience
                ? 'Ex.: Refrigerante Lata 350ml / Água Mineral'
                : 'Ex.: Pomada Modeladora Efeito Mate'
            }
            autoFocus={!isEditing}
            required
          />
        </FormField>

        <FormField label="Descrição / Detalhes">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              isConvenience
                ? 'Ex.: Bebida gelada 350ml'
                : 'Ex.: Fixação forte, acabamento seco, 120g'
            }
            rows={2}
            className="w-full rounded-xl bg-surface border border-zinc-800 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-accent transition-colors resize-none"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Preço (R$)">
            <TextInput
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={isConvenience ? '6,00' : '35,00'}
              required
            />
          </FormField>

          <FormField label="Quantidade (Stock)">
            <TextInput
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={stockQuantity}
              onChange={(e) => setStockQuantity(e.target.value)}
              placeholder="15"
              required
            />
          </FormField>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-surface border border-zinc-800 px-3.5 py-2.5">
          <div>
            <p className="text-xs font-semibold text-white">Item ativo</p>
            <p className="text-[11px] text-zinc-500">
              {isActive ? 'Visível e ativo no catálogo' : 'Inativo / oculto'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => setIsActive((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              isActive ? 'bg-accent' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                isActive ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {error && <p className="text-accent-light text-xs">{error}</p>}

        <div className="flex flex-col gap-2 pt-2">
          <PrimaryButton type="submit" disabled={saving || compressing}>
            {saving
              ? 'Guardando…'
              : isEditing
              ? 'Salvar alterações'
              : isConvenience
              ? 'Guardar item de conveniência'
              : 'Guardar produto'}
          </PrimaryButton>
          {isEditing && (
            <GhostButton type="button" onClick={handleDelete} disabled={saving || compressing}>
              Remover item
            </GhostButton>
          )}
        </div>
      </form>
    </BottomSheet>
  );
}
