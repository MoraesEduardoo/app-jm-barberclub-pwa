'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { GALLERY_BUCKET } from '@/lib/constants/gallery';
import { galleryPublicUrl } from '@/lib/gallery-url';
import { isConvenienceProduct } from '@/lib/commission';

const CONVENIENCE_DESC_PREFIX = '[CONVENIENCIA] ';

const DEFAULT_CONVENIENCE_ITEMS = [
  {
    id: 'conv-default-agua-500ml',
    name: 'Água Mineral 500ml',
    description: 'Água mineral gelada sem gás',
    price: 4.0,
    cost_price: 1.5,
    stock_quantity: 30,
    display_order: 100,
    category: 'conveniencia',
    is_convenience: true,
    is_active: true,
  },
  {
    id: 'conv-default-refri-350ml',
    name: 'Refrigerante Lata 350ml',
    description: 'Coca-Cola, Guaraná ou Zero gelado',
    price: 6.0,
    cost_price: 3.0,
    stock_quantity: 24,
    display_order: 101,
    category: 'conveniencia',
    is_convenience: true,
    is_active: true,
  },
  {
    id: 'conv-default-cerveja-330ml',
    name: 'Cerveja Long Neck 330ml',
    description: 'Heineken / Budweiser / Corona gelada',
    price: 10.0,
    cost_price: 5.5,
    stock_quantity: 24,
    display_order: 102,
    category: 'conveniencia',
    is_convenience: true,
    is_active: true,
  },
  {
    id: 'conv-default-energetico-250ml',
    name: 'Energético Lata 250ml',
    description: 'Red Bull / Monster gelado',
    price: 12.0,
    cost_price: 6.5,
    stock_quantity: 15,
    display_order: 103,
    category: 'conveniencia',
    is_convenience: true,
    is_active: true,
  },
  {
    id: 'conv-default-snack-chips',
    name: 'Snack / Batata Chips',
    description: 'Porção individual salgada',
    price: 7.0,
    cost_price: 3.5,
    stock_quantity: 15,
    display_order: 104,
    category: 'conveniencia',
    is_convenience: true,
    is_active: true,
  },
];

// Fallback em memória caso a tabela public.products ainda não tenha sido criada no Supabase remoto
const fallbackProductsStore = new Map();

/**
 * Retorna a lista de clientes Supabase ordenada por privilégio de escrita.
 */
async function getProductsWriteClients() {
  const clients = [];
  const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (hasServiceRole) {
    try {
      clients.push(createAdminClient());
    } catch {}
  }

  try {
    const sessionClient = await createClient();
    if (sessionClient) clients.push(sessionClient);
  } catch {}

  if (!hasServiceRole) {
    try {
      clients.push(createAdminClient());
    } catch {}
  }

  return clients;
}

function parseCostAndCleanDescription(rawDesc, explicitCostPrice = null) {
  const str = rawDesc ? String(rawDesc) : '';
  const costMatch = str.match(/\[CUSTO:([0-9.]+)\]/i);
  const parsedCostFromDesc = costMatch ? parseFloat(costMatch[1]) || 0 : 0;

  const cleanDescription = str
    .replace(/^\[CONVENIENCIA\]\s*/i, '')
    .replace(/^\[CONVENIÊNCIA\]\s*/i, '')
    .replace(/\[CUSTO:[0-9.]+\]\s*/gi, '')
    .trim();

  const resolvedCost =
    explicitCostPrice !== null &&
    explicitCostPrice !== undefined &&
    Number(explicitCostPrice) > 0
      ? Number(Number(explicitCostPrice).toFixed(2))
      : Number(parsedCostFromDesc.toFixed(2));

  return {
    cleanDescription: cleanDescription || null,
    costPrice: Math.max(0, resolvedCost),
  };
}

function encodeDescriptionWithMetadata(cleanDesc, isConv, costPrice) {
  const clean = String(cleanDesc || '')
    .replace(/^\[CONVENIENCIA\]\s*/i, '')
    .replace(/^\[CONVENIÊNCIA\]\s*/i, '')
    .replace(/\[CUSTO:[0-9.]+\]\s*/gi, '')
    .trim();

  const costNum = Math.max(0, Number(costPrice || 0));
  const costTag = costNum > 0 ? `[CUSTO:${costNum.toFixed(2)}] ` : '';
  const convTag = isConv ? CONVENIENCE_DESC_PREFIX : '';
  const combined = `${convTag}${costTag}${clean}`.trim();
  return combined || null;
}

function normalizeProductRow(p, idx = 0) {
  const isConv = isConvenienceProduct(p);
  const { cleanDescription, costPrice } = parseCostAndCleanDescription(
    p?.description,
    p?.cost_price
  );
  const salePrice = Number(p?.price ?? 0);
  const unitProfit = Math.max(0, Number((salePrice - costPrice).toFixed(2)));
  const marginPercent =
    salePrice > 0 ? Math.round(((salePrice - costPrice) / salePrice) * 100) : 0;

  return {
    ...p,
    price: salePrice,
    cost_price: costPrice,
    unit_profit: unitProfit,
    margin_percent: marginPercent,
    stock_quantity: Number(p?.stock_quantity ?? 0),
    is_active:
      p?.is_active !== undefined
        ? Boolean(p.is_active)
        : p?.active !== undefined
        ? Boolean(p.active)
        : true,
    display_order: p?.display_order ?? idx,
    image_url: p?.image_url || p?.storage_url || p?.photo_url || null,
    category: isConv ? 'conveniencia' : 'barbearia',
    is_convenience: isConv,
    description: cleanDescription,
  };
}

/**
 * Lista todos os produtos registados em public.products (incluindo Preço de Venda, Preço de Custo e Margem)
 */
export async function listProducts() {
  try {
    let productsData = [];
    const clients = await getProductsWriteClients();

    for (const db of clients) {
      try {
        const { data, error } = await db.from('products').select('*');
        if (!error && Array.isArray(data)) {
          productsData = data;
          if (data.length > 0) break;
        }
      } catch {}
    }

    if (fallbackProductsStore.size > 0) {
      const existingNames = new Set(
        productsData.map((p) => String(p?.name || '').toLowerCase().trim())
      );
      for (const item of fallbackProductsStore.values()) {
        const cleanName = String(item?.name || '').toLowerCase().trim();
        if (!existingNames.has(cleanName)) {
          productsData.push(item);
        }
      }
    }

    productsData = [...productsData].sort((a, b) => {
      const orderA = Number.isFinite(Number(a?.display_order)) ? Number(a.display_order) : 9999;
      const orderB = Number.isFinite(Number(b?.display_order)) ? Number(b.display_order) : 9999;
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR');
    });

    return productsData.map((p, idx) => normalizeProductRow(p, idx));
  } catch (err) {
    console.error('[listProducts] Falha global tratada:', err?.message);
    return Array.from(fallbackProductsStore.values()).map((p, idx) =>
      normalizeProductRow(p, idx)
    );
  }
}

/**
 * Regista um novo produto (Barbearia ou Conveniência) na tabela public.products com Preço de Venda (price) e Preço de Custo (cost_price)
 */
export async function createProduct({
  name,
  description = '',
  price = 0,
  cost_price = 0,
  stock_quantity = 0,
  image_url = null,
  is_active = true,
  category = 'barbearia',
  is_convenience = false,
  display_order = null,
}) {
  if (!name || !String(name).trim()) {
    throw new Error('Informe o nome do produto.');
  }

  const clients = await getProductsWriteClients();
  const cleanName = String(name).trim();
  const cleanPrice = Math.max(0, Number(price || 0));
  const cleanCostPrice = Math.max(0, Number(cost_price || 0));
  const cleanStock = Math.max(0, Math.floor(Number(stock_quantity || 0)));
  const isConv = Boolean(
    is_convenience || String(category || '').toLowerCase() === 'conveniencia'
  );
  const storedDesc = encodeDescriptionWithMetadata(description, isConv, cleanCostPrice);

  let nextOrder =
    display_order !== null && Number.isFinite(Number(display_order))
      ? Number(display_order)
      : isConv
      ? 100
      : 0;

  if (display_order === null && clients.length > 0) {
    try {
      const { data: maxRow } = await clients[0]
        .from('products')
        .select('display_order')
        .order('display_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxRow && Number.isFinite(Number(maxRow.display_order))) {
        nextOrder = Number(maxRow.display_order) + 1;
      }
    } catch {}
  }

  const payloadVariants = [
    {
      name: cleanName,
      description: storedDesc,
      price: Number(cleanPrice.toFixed(2)),
      cost_price: Number(cleanCostPrice.toFixed(2)),
      stock_quantity: cleanStock,
      image_url: image_url || null,
      is_active: Boolean(is_active),
      display_order: nextOrder,
      category: isConv ? 'conveniencia' : 'barbearia',
      is_convenience: isConv,
    },
    {
      name: cleanName,
      description: storedDesc,
      price: Number(cleanPrice.toFixed(2)),
      stock_quantity: cleanStock,
      image_url: image_url || null,
      is_active: Boolean(is_active),
      display_order: nextOrder,
      category: isConv ? 'conveniencia' : 'barbearia',
      is_convenience: isConv,
    },
    {
      name: cleanName,
      description: storedDesc,
      price: Number(cleanPrice.toFixed(2)),
      stock_quantity: cleanStock,
      image_url: image_url || null,
      is_active: Boolean(is_active),
      display_order: nextOrder,
    },
    {
      name: cleanName,
      description: storedDesc,
      price: Number(cleanPrice.toFixed(2)),
      stock_quantity: cleanStock,
      is_active: Boolean(is_active),
    },
  ];

  let created = null;
  let lastError = null;

  for (const db of clients) {
    for (const variant of payloadVariants) {
      try {
        const { data, error } = await db
          .from('products')
          .insert(variant)
          .select()
          .single();
        if (!error && data) {
          created = data;
          break;
        }
        lastError = error;
      } catch (err) {
        lastError = err;
      }
    }
    if (created) break;
  }

  if (!created) {
    const fallbackItem = {
      id: randomUUID(),
      name: cleanName,
      description: storedDesc,
      price: Number(cleanPrice.toFixed(2)),
      cost_price: Number(cleanCostPrice.toFixed(2)),
      stock_quantity: cleanStock,
      image_url: image_url || null,
      is_active: Boolean(is_active),
      display_order: nextOrder,
      category: isConv ? 'conveniencia' : 'barbearia',
      is_convenience: isConv,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    fallbackProductsStore.set(fallbackItem.id, fallbackItem);
    created = fallbackItem;
    if (lastError) {
      console.warn('[createProduct] Usando fallback em memória:', lastError?.message);
    }
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/produtos');
  revalidatePath('/admin/agenda');
  revalidatePath('/admin/financeiro');
  return normalizeProductRow({ ...created, cost_price: cleanCostPrice });
}

/**
 * Atualiza um produto existente em public.products (incluindo cost_price)
 */
export async function updateProduct(
  id,
  {
    name,
    description,
    price,
    cost_price,
    stock_quantity,
    image_url,
    is_active,
    display_order,
    category,
    is_convenience,
  }
) {
  if (!id) throw new Error('ID do produto é obrigatório.');

  const clients = await getProductsWriteClients();
  const payload = {
    updated_at: new Date().toISOString(),
  };

  const hasCategoryUpdate = category !== undefined || is_convenience !== undefined;
  const isConv = hasCategoryUpdate
    ? Boolean(is_convenience || String(category || '').toLowerCase() === 'conveniencia')
    : undefined;

  if (name !== undefined) payload.name = String(name).trim();
  if (price !== undefined) {
    payload.price = Number(Math.max(0, Number(price || 0)).toFixed(2));
  }
  if (stock_quantity !== undefined) {
    payload.stock_quantity = Math.max(0, Math.floor(Number(stock_quantity || 0)));
  }
  if (image_url !== undefined) payload.image_url = image_url;
  if (is_active !== undefined) payload.is_active = Boolean(is_active);
  if (display_order !== undefined) payload.display_order = Number(display_order);

  if (description !== undefined || isConv !== undefined || cost_price !== undefined) {
    payload.description = encodeDescriptionWithMetadata(
      description,
      Boolean(isConv),
      cost_price
    );
  }

  const fullExtendedPayload = {
    ...payload,
    ...(cost_price !== undefined
      ? { cost_price: Number(Math.max(0, Number(cost_price || 0)).toFixed(2)) }
      : {}),
    ...(isConv !== undefined
      ? {
          category: isConv ? 'conveniencia' : 'barbearia',
          is_convenience: isConv,
        }
      : {}),
  };

  let updated = null;
  let lastError = null;

  for (const db of clients) {
    const { data, error } = await db
      .from('products')
      .update(fullExtendedPayload)
      .eq('id', id)
      .select()
      .single();

    if (!error && data) {
      updated = data;
      break;
    }

    const retryRes = await db
      .from('products')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (!retryRes.error && retryRes.data) {
      updated = retryRes.data;
      break;
    }
    lastError = retryRes.error || error;
  }

  if (!updated && fallbackProductsStore.has(id)) {
    const existing = fallbackProductsStore.get(id);
    const merged = {
      ...existing,
      ...fullExtendedPayload,
    };
    fallbackProductsStore.set(id, merged);
    updated = merged;
  }

  if (!updated) {
    throw new Error(
      `Não foi possível atualizar o produto: ${lastError?.message || 'Erro desconhecido'}`
    );
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/produtos');
  revalidatePath('/admin/agenda');
  revalidatePath('/admin/financeiro');
  return normalizeProductRow({
    ...updated,
    ...(cost_price !== undefined
      ? { cost_price: Number(Math.max(0, Number(cost_price || 0)).toFixed(2)) }
      : {}),
  });
}

/**
 * Carrega os itens padrão de Conveniência (Bebidas & Snacks) com Preço de Venda e Preço de Custo
 */
export async function seedDefaultConvenienceProducts() {
  const existing = await listProducts();
  const existingByName = new Map(
    existing.map((p) => [String(p.name || '').toLowerCase().trim(), p])
  );

  const resultItems = [];

  for (const item of DEFAULT_CONVENIENCE_ITEMS) {
    const key = item.name.toLowerCase().trim();
    if (existingByName.has(key)) {
      resultItems.push(existingByName.get(key));
      continue;
    }

    try {
      const created = await createProduct({
        name: item.name,
        description: item.description,
        price: item.price,
        cost_price: item.cost_price,
        stock_quantity: item.stock_quantity,
        display_order: item.display_order,
        is_active: true,
        category: 'conveniencia',
        is_convenience: true,
      });
      if (created) {
        resultItems.push(created);
      }
    } catch {
      const fallbackNormalized = normalizeProductRow({
        ...item,
        description: encodeDescriptionWithMetadata(
          item.description,
          true,
          item.cost_price
        ),
      });
      fallbackProductsStore.set(fallbackNormalized.id, fallbackNormalized);
      resultItems.push(fallbackNormalized);
    }
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/agenda');
  return {
    success: true,
    count: resultItems.length,
    items: resultItems,
  };
}

/**
 * Remove um produto de public.products
 */
export async function deleteProduct(id) {
  if (!id) throw new Error('ID do produto é obrigatório.');

  fallbackProductsStore.delete(id);
  const clients = await getProductsWriteClients();
  let deleted = false;
  let lastError = null;

  for (const db of clients) {
    const { error } = await db.from('products').delete().eq('id', id);
    if (!error) {
      deleted = true;
      break;
    }
    lastError = error;
  }

  if (!deleted && lastError) {
    throw new Error(`Não foi possível remover o produto: ${lastError.message}`);
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/produtos');
  revalidatePath('/admin/agenda');
  return { success: true };
}

const PRODUCTS_BUCKET = 'product-images';

async function ensureProductsBucket(admin) {
  try {
    const { data: bucket } = await admin.storage.getBucket(PRODUCTS_BUCKET);
    if (!bucket) {
      await admin.storage.createBucket(PRODUCTS_BUCKET, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
      });
    }
  } catch {}
}

export async function uploadProductPhoto(productId, formData) {
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    throw new Error('Nenhum ficheiro enviado.');
  }

  const admin = createAdminClient();
  await ensureProductsBucket(admin);

  const fileExt = file.name?.split('.').pop()?.toLowerCase() || 'webp';
  const filePath = `products/${productId}-${randomUUID()}.${fileExt}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let targetBucket = PRODUCTS_BUCKET;
  let { error: uploadError } = await admin.storage
    .from(PRODUCTS_BUCKET)
    .upload(filePath, buffer, {
      contentType: file.type || 'image/webp',
      upsert: true,
    });

  if (uploadError) {
    targetBucket = GALLERY_BUCKET;
    const fallbackRes = await admin.storage
      .from(GALLERY_BUCKET)
      .upload(filePath, buffer, {
        contentType: file.type || 'image/webp',
        upsert: true,
      });
    uploadError = fallbackRes.error;
  }

  if (uploadError) {
    throw new Error(`Falha no upload da foto: ${uploadError.message}`);
  }

  const { data: pubData } = admin.storage.from(targetBucket).getPublicUrl(filePath);
  const publicUrl = pubData?.publicUrl || galleryPublicUrl(filePath);

  const clients = await getProductsWriteClients();
  for (const db of clients) {
    const { error: updateErr } = await db
      .from('products')
      .update({
        image_url: publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId);
    if (!updateErr) break;
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/produtos');
  return { success: true, imageUrl: publicUrl, filePath };
}

export async function removeProductPhoto(productId) {
  const clients = await getProductsWriteClients();
  for (const db of clients) {
    const { error } = await db
      .from('products')
      .update({
        image_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId);
    if (!error) break;
  }

  revalidatePath('/admin/servicos');
  revalidatePath('/admin/produtos');
  return { success: true };
}
