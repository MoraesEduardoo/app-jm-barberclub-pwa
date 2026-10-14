'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, Lock, ArrowUpDown, Check, Loader2 } from 'lucide-react';
import { Reorder, useDragControls } from 'framer-motion';
import { listServices, reorderServices } from '@/lib/actions/services';
import ServiceRow from '@/components/admin/ServiceRow';
import ServiceFormSheet from '@/components/admin/ServiceFormSheet';
import { useBarber } from '@/lib/barber-context';
import { PERMISSION_KEYS } from '@/lib/auth';

function ReorderableServiceRow({ service, onEdit }) {
  const dragControls = useDragControls();
  const [isDragging, setIsDragging] = useState(false);

  return (
    <Reorder.Item
      value={service}
      id={service.id}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      whileDrag={{
        scale: 1.03,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(220, 38, 38, 0.3)',
        zIndex: 50,
      }}
      transition={{ duration: 0.2 }}
      className="relative select-none touch-none list-none"
    >
      <ServiceRow
        service={service}
        dragControls={dragControls}
        isDragging={isDragging}
        onClick={() => onEdit(service)}
      />
    </Reorder.Item>
  );
}

export default function ServicosPage() {
  const { can } = useBarber();
  const canManage = can(PERMISSION_KEYS.MANAGE_SERVICES);

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null); // 'saving' | 'saved' | null
  const saveTimeoutRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listServices();
      setServices(data || []);
    } catch (err) {
      console.error('Erro ao carregar serviços:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleClose() {
    setSheetOpen(false);
    setEditing(null);
    load();
  }

  // Tratamento da reordenação flutuante com persistência atômica no Supabase
  const handleReorder = async (newOrder) => {
    setServices(newOrder);
    setSaveStatus('saving');

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce leve para persistência rápida ao soltar o item
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const ids = newOrder.map((s) => s.id);
        await reorderServices(ids);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(null), 2000);
      } catch (err) {
        console.error('Falha ao persistir ordenação:', err);
        setSaveStatus(null);
      }
    }, 400);
  };

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center px-8 pt-24 text-center gap-3">
        <Lock className="text-zinc-600" size={28} />
        <p className="text-zinc-500 text-sm">
          Você não tem permissão para gerenciar serviços e preços. Fale com o barbeiro
          chefe para liberar esse acesso.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-24">
      {/* Cabeçalho e Botão de Novo Serviço */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-zinc-400 text-xs font-medium">
            {services.length} serviço{services.length !== 1 ? 's' : ''} no catálogo
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-full px-2.5 py-1 animate-pulse">
              <Loader2 size={12} className="animate-spin text-accent" /> Salvando ordem…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-900/60 rounded-full px-2.5 py-1">
              <Check size={12} /> Ordem salva
            </span>
          )}
          <button
            onClick={() => {
              setEditing(null);
              setSheetOpen(true);
            }}
            className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-full pl-2.5 pr-3 py-1.5 active:scale-95 active:bg-accent-dark transition-all touch-manipulation select-none shadow-sm"
          >
            <Plus size={14} /> Novo
          </button>
        </div>
      </div>

      {/* Dica visual de reordenação */}
      {services.length > 1 && (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-3 px-1">
          <ArrowUpDown size={12} className="text-accent-light shrink-0" />
          <span>Segure a alça <strong className="text-zinc-400 font-semibold">⠿</strong> e arraste para definir a ordem oficial</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-[68px] rounded-xl bg-surface animate-pulse" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="flex flex-col items-center justify-center pt-16 text-center gap-2">
          <p className="text-zinc-500 text-sm">
            Nenhum serviço cadastrado ainda. Toque em “Novo” para começar.
          </p>
        </div>
      ) : (
        <Reorder.Group
          axis="y"
          values={services}
          onReorder={handleReorder}
          className="space-y-2.5"
        >
          {services.map((service) => (
            <ReorderableServiceRow
              key={service.id}
              service={service}
              onEdit={(srv) => {
                setEditing(srv);
                setSheetOpen(true);
              }}
            />
          ))}
        </Reorder.Group>
      )}

      <ServiceFormSheet
        key={editing?.id || (sheetOpen ? 'new-service' : 'none')}
        open={sheetOpen}
        onClose={handleClose}
        service={editing}
      />
    </div>
  );
}
