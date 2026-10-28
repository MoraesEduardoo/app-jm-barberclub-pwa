'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { GALLERY_BUCKET } from '@/lib/constants/gallery';
import { galleryPublicUrl } from '@/lib/gallery-url';

async function getProductsSupabaseClient() {
  try {
    return await createClient();
  } catch {
    return createAdminClient();
  }
}

/**
 * Lista todos os produtos registados em public.products
 */
export async function listProducts() {
  const supabase = await getProductsSupabaseClient();
  const admin = createAdminClient();

  let productsData = null;
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error || !data) {
    try {
      const { data: adminData } = await admin
        .from('products')
        .select('*')
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });
      productsData = adminData || [];
    } catch {
      productsData = [];
    }
  } else {
    productsData = data;
  }

  return (productsData || []).map((p, idx) => ({
    ...p,
    price: Number(p.price ?? 0),
    stock_quantity: Number(p.stock_quantity ?? 0),
    is_active: p.is_active !== undefined ? Boolean(p.is_active) : true,
    display_order: p.display_order ?? idx,
    image_url: p.image_url || null,
  }));
}

/**
 * Regista um novo produto na tabela public.products
 */
export async function createProduct({
  name,
  description = '',
  price = 0,
  stock_quantity = 0,
  image_url = null,
  is_active = true,
}) {
  if (!name || !String(name).trim()) {
    throw new Error('Informe o nome do produto.');
  }

  const admin = createAdminClient();
  const cleanPrice = Math.max(0, Number(price || 0));
  const cleanStock = Math.max(0, Math.floor(Number(stock_quantity || 0)));

  const { data: maxRow } = await admin
    .from('products')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxRow?.display_order ?? -1) + 1;

  const payload = {
    name: String(name).trim(),
    description: description ? String(description).trim() : null,
    price: Number(cleanPrice.toFixed(2)),
    stock_quantity: cleanStock,
    image_url: image_url || null,
    is_active: Boolean(is_active),
    display_order: nextOrder,
  };

  const { data, error } = await admin
    .from('products')
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(`Não foi possível guardar o produto: ${error.message}`);
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/produtos');
  return data;
}

/**
 * Atualiza um produto existente em public.products
 */
export async function updateProduct(
  id,
  { name, description, price, stock_quantity, image_url, is_active, display_order }
) {
  if (!id) throw new Error('ID do produto é obrigatório.');

  const admin = createAdminClient();
  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (name !== undefined) payload.name = String(name).trim();
  if (description !== undefined) {
    payload.description = description ? String(description).trim() : null;
  }
  if (price !== undefined) {
    payload.price = Number(Math.max(0, Number(price || 0)).toFixed(2));
  }
  if (stock_quantity !== undefined) {
    payload.stock_quantity = Math.max(0, Math.floor(Number(stock_quantity || 0)));
  }
  if (image_url !== undefined) payload.image_url = image_url;
  if (is_active !== undefined) payload.is_active = Boolean(is_active);
  if (display_order !== undefined) payload.display_order = Number(display_order);

  const { data, error } = await admin
    .from('products')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Não foi possível atualizar o produto: ${error.message}`);
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/produtos');
  return data;
}

/**
 * Remove um produto de public.products
 */
export async function deleteProduct(id) {
  if (!id) throw new Error('ID do produto é obrigatório.');

  const admin = createAdminClient();
  const { error } = await admin.from('products').delete().eq('id', id);

  if (error) {
    throw new Error(`Não foi possível remover o produto: ${error.message}`);
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/produtos');
  return { success: true };
}

/**
 * Faz o upload da foto do produto para o Supabase Storage e guarda image_url em public.products
 */
export async function uploadProductPhoto(productId, formData) {
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    throw new Error('Nenhum ficheiro enviado.');
  }

  const admin = createAdminClient();
  const fileExt = file.name?.split('.').pop()?.toLowerCase() || 'webp';
  const filePath = `products/${productId}-${randomUUID()}.${fileExt}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await admin.storage
    .from(GALLERY_BUCKET)
    .upload(filePath, buffer, {
      contentType: file.type || 'image/webp',
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Falha no upload da foto: ${uploadError.message}`);
  }

  const { data: pubData } = admin.storage.from(GALLERY_BUCKET).getPublicUrl(filePath);
  const publicUrl = pubData?.publicUrl || galleryPublicUrl(filePath);

  const { error: updateErr } = await admin
    .from('products')
    .update({
      image_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', productId);

  if (updateErr) {
    console.warn('[uploadProductPhoto] Aviso ao atualizar image_url em products:', updateErr.message);
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/produtos');
  return { success: true, imageUrl: publicUrl, filePath };
}

/**
 * Remove a foto de um produto
 */
export async function removeProductPhoto(productId) {
  const admin = createAdminClient();
  await admin
    .from('products')
    .update({
      image_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', productId);

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/produtos');
  return { success: true };
}
