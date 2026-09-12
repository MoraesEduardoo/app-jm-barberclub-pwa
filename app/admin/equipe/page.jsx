'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Lock } from 'lucide-react';
import { useBarber } from '@/lib/barber-context';
import { listTeam } from '@/lib/actions/team';
import TeamMemberCard from '@/components/admin/TeamMemberCard';
import AddMemberSheet from '@/components/admin/AddMemberSheet';

export default function EquipePage() {
  const { isChefe } = useBarber();
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    const data = await listTeam();
    setTeam(data);
    setLoading(false);
  }, []);

  const handleMemberRemoved = useCallback((memberId) => {
    setTeam((prev) => prev.filter((item) => item.id !== memberId));
  }, []);

  useEffect(() => {
    if (isChefe) load();
  }, [isChefe, load]);

  if (!isChefe) {
    return (
      <div className="flex flex-col items-center justify-center px-8 pt-24 text-center gap-3">
        <Lock className="text-zinc-600" size={28} />
        <p className="text-zinc-500 text-sm">
          Somente o barbeiro chefe pode gerenciar a equipe e as permissões de acesso.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-zinc-500 text-xs">
          {team.length} pessoa{team.length !== 1 ? 's' : ''} na equipe
        </p>
        <button
          onClick={() => setSheetOpen(true)}
          className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-full pl-2.5 pr-3 py-1.5 active:bg-accent-dark"
        >
          <Plus size={14} /> Adicionar
        </button>
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
            <TeamMemberCard key={member.id} member={member} onChanged={handleMemberRemoved} />
          ))}
        </div>
      )}

      <AddMemberSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          load({ silent: true });
        }}
      />
    </div>
  );
}
