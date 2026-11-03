'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Lock } from 'lucide-react';
import { useBarber } from '@/lib/barber-context';
import { listTeam } from '@/lib/actions/team';
import TeamMemberCard from '@/components/admin/TeamMemberCard';
import AddMemberSheet from '@/components/admin/AddMemberSheet';

export default function EquipePage() {
  const { barber, isChefe } = useBarber();
  const canManageTeam = Boolean(isChefe && barber?.role === 'admin');
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await listTeam();
      setTeam(data || []);
    } catch {
      setTeam([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMemberRemoved = useCallback((memberId) => {
    if (!memberId) return;
    setTeam((prev) => prev.filter((item) => item.id !== memberId));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-zinc-500 text-xs">
          {team.length} pessoa{team.length !== 1 ? 's' : ''} na equipe
        </p>
        {canManageTeam ? (
          <button
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-full pl-2.5 pr-3 py-1.5 active:scale-95 active:bg-accent-dark transition-all touch-manipulation select-none"
          >
            <Plus size={14} /> Adicionar
          </button>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/90 px-2.5 py-1 text-[10.5px] font-medium text-zinc-400">
            <Lock size={11} className="text-zinc-500" /> Somente leitura (Chefe edita)
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-surface animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {team.map((member) => (
            <TeamMemberCard
              key={member.id}
              member={member}
              onChanged={handleMemberRemoved}
              onUpdated={() => load({ silent: true })}
            />
          ))}
        </div>
      )}

      {canManageTeam && (
        <AddMemberSheet
          open={sheetOpen}
          onClose={() => {
            setSheetOpen(false);
            load({ silent: true });
          }}
        />
      )}
    </div>
  );
}
