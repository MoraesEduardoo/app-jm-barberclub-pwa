'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Lock } from 'lucide-react';
import { listServices } from '@/lib/actions/services';
import ServiceRow from '@/components/admin/ServiceRow';
import ServiceFormSheet from '@/components/admin/ServiceFormSheet';
import { useBarber } from '@/lib/barber-context';
import { PERMISSION_KEYS } from '@/lib/auth';

export default function ServicosPage() {
  const { can } = useBarber();
  const canManage = can(PERMISSION_KEYS.MANAGE_SERVICES);

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listServices();
    setServices(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleClose() {
    setSheetOpen(false);
    setEditing(null);
    load();
  }

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
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-zinc-500 text-xs">
          {services.length} serviço{services.length !== 1 ? 's' : ''} cadastrado
          {services.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => setSheetOpen(true)}
          className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-full pl-2.5 pr-3 py-1.5 active:bg-accent-dark"
        >
          <Plus size={14} /> Novo
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-[68px] rounded-xl bg-surface animate-pulse" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <p className="text-zinc-600 text-sm text-center mt-16">
          Nenhum serviço cadastrado ainda. Toque em “Novo” para começar.
        </p>
      ) : (
        <div className="space-y-2">
          {services.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              onClick={() => {
                setEditing(service);
                setSheetOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <ServiceFormSheet open={sheetOpen} onClose={handleClose} service={editing} />
    </div>
  );
}
