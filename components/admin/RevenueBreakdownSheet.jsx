"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Scissors,
  Package,
  Coffee,
  TrendingUp,
  Calendar,
  User,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import BottomSheet from "@/components/admin/BottomSheet";
import { getRevenueBreakdown } from "@/lib/actions/finance";
import { parseAttachedProductsSummary } from "@/lib/commission";

function formatBRL(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

function cleanLabelName(rawLabel, fallback = "Item") {
  if (!rawLabel) return fallback;
  const cleaned = String(rawLabel)
    .replace(/^\d+x\s+/i, "")
    .replace(/\s*\(R\$\s*[0-9.,]+\)\s*$/i, "")
    .trim();
  return cleaned || fallback;
}

/**
 * Fallback local caso o resumo em cache ainda não possua `detalhamentoFaturado` pré-computado.
 */
function buildFallbackBreakdown(summary) {
  if (!summary) {
    return {
      totalFaturado: 0,
      pagosCount: 0,
      servicos: { subtotal: 0, cmv: 0, lucroBruto: 0, count: 0, items: [] },
      produtos: { subtotal: 0, cmv: 0, lucroBruto: 0, count: 0, items: [] },
      conveniencia: { subtotal: 0, cmv: 0, lucroBruto: 0, count: 0, items: [] },
    };
  }

  if (summary.detalhamentoFaturado) {
    return {
      totalFaturado: Number(summary.totalFaturado || 0),
      pagosCount: Array.isArray(summary.pagos)
        ? summary.pagos.length
        : Number(summary.pagosCount || 0),
      servicos: summary.detalhamentoFaturado.servicos || {
        subtotal: Number(summary.servicosFaturadoBruto || 0),
        cmv: 0,
        lucroBruto: Number(summary.servicosFaturadoBruto || 0),
        count: 0,
        items: [],
      },
      produtos: summary.detalhamentoFaturado.produtos || {
        subtotal: Number(summary.produtosFaturadoBruto || 0),
        cmv: Number(summary.cmvProdutos || 0),
        lucroBruto: Number(summary.lucroBrutoProdutos || summary.produtosFaturadoBruto || 0),
        count: 0,
        items: [],
      },
      conveniencia: summary.detalhamentoFaturado.conveniencia || {
        subtotal: Number(summary.convenienciaFaturadoBruto || 0),
        cmv: Number(summary.cmvConveniencia || 0),
        lucroBruto: Number(
          summary.lucroBrutoConveniencia || summary.convenienciaFaturadoBruto || 0
        ),
        count: 0,
        items: [],
      },
    };
  }

  const pagos = Array.isArray(summary.pagos) ? summary.pagos : [];
  const servicosMap = new Map();
  const produtosMap = new Map();
  const convenienciaMap = new Map();

  let servicosSubtotal = 0;
  let produtosSubtotal = 0;
  let convenienciaSubtotal = 0;
  let cmvProdutos = 0;
  let cmvConveniencia = 0;
  let servicosCount = 0;
  let produtosCount = 0;
  let convenienciaCount = 0;

  for (const appt of pagos) {
    const parsed = parseAttachedProductsSummary(appt.notes);
    const serviceVal = Number(appt.service_amount ?? 0);
    const prodVal = Number(appt.products_amount ?? parsed.regularProductsSubtotal ?? 0);
    const convVal = Number(appt.convenience_amount ?? parsed.convenienceSubtotal ?? 0);

    if (serviceVal > 0) {
      servicosSubtotal = Number((servicosSubtotal + serviceVal).toFixed(2));
      servicosCount += 1;
      const sName = String(appt.service || appt.services?.name || "Serviço").trim();
      const sKey = sName.toLowerCase();
      const curr = servicosMap.get(sKey) || { name: sName, quantity: 0, subtotal: 0 };
      curr.quantity += 1;
      curr.subtotal = Number((curr.subtotal + serviceVal).toFixed(2));
      servicosMap.set(sKey, curr);
    }

    produtosSubtotal = Number((produtosSubtotal + prodVal).toFixed(2));
    convenienciaSubtotal = Number((convenienciaSubtotal + convVal).toFixed(2));

    const items = Array.isArray(appt.product_items) ? appt.product_items : parsed.items;
    for (const item of items) {
      const qty = Number(item.quantity || 1);
      const sub = Number(item.subtotal || 0);
      const cost = Number(item.totalCost || (item.unitCostPrice || 0) * qty || 0);
      const profit = Math.max(0, Number((sub - cost).toFixed(2)));
      const name = cleanLabelName(
        item.label,
        item.isConvenience ? "Conveniência" : "Produto"
      );
      const key = `${item.productId || name.toLowerCase()}`;

      if (item.isConvenience) {
        convenienciaCount += qty;
        cmvConveniencia = Number((cmvConveniencia + cost).toFixed(2));
        const curr = convenienciaMap.get(key) || {
          name,
          quantity: 0,
          subtotal: 0,
          cmv: 0,
          lucroBruto: 0,
        };
        curr.quantity += qty;
        curr.subtotal = Number((curr.subtotal + sub).toFixed(2));
        curr.cmv = Number((curr.cmv + cost).toFixed(2));
        curr.lucroBruto = Number((curr.lucroBruto + profit).toFixed(2));
        convenienciaMap.set(key, curr);
      } else {
        produtosCount += qty;
        cmvProdutos = Number((cmvProdutos + cost).toFixed(2));
        const curr = produtosMap.get(key) || {
          name,
          quantity: 0,
          subtotal: 0,
          cmv: 0,
          lucroBruto: 0,
        };
        curr.quantity += qty;
        curr.subtotal = Number((curr.subtotal + sub).toFixed(2));
        curr.cmv = Number((curr.cmv + cost).toFixed(2));
        curr.lucroBruto = Number((curr.lucroBruto + profit).toFixed(2));
        produtosMap.set(key, curr);
      }
    }
  }

  return {
    totalFaturado: Number(
      (servicosSubtotal + produtosSubtotal + convenienciaSubtotal).toFixed(2)
    ),
    pagosCount: pagos.length,
    servicos: {
      subtotal: servicosSubtotal,
      cmv: 0,
      lucroBruto: servicosSubtotal,
      count: servicosCount,
      items: Array.from(servicosMap.values()).sort((a, b) => b.subtotal - a.subtotal),
    },
    produtos: {
      subtotal: produtosSubtotal,
      cmv: cmvProdutos,
      lucroBruto: Math.max(0, Number((produtosSubtotal - cmvProdutos).toFixed(2))),
      count: produtosCount,
      items: Array.from(produtosMap.values()).sort((a, b) => b.subtotal - a.subtotal),
    },
    conveniencia: {
      subtotal: convenienciaSubtotal,
      cmv: cmvConveniencia,
      lucroBruto: Math.max(0, Number((convenienciaSubtotal - cmvConveniencia).toFixed(2))),
      count: convenienciaCount,
      items: Array.from(convenienciaMap.values()).sort((a, b) => b.subtotal - a.subtotal),
    },
  };
}

export default function RevenueBreakdownSheet({
  open,
  onClose,
  summary,
  from,
  to,
  scopeBarberId,
  periodLabel,
  barberLabel,
}) {
  const [freshData, setFreshData] = useState(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open || !from || !to) return;
    let cancelled = false;
    setFetching(true);

    getRevenueBreakdown({ from, to, scopeBarberId })
      .then((res) => {
        if (cancelled) return;
        setFreshData(res);
        setFetching(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, from, to, scopeBarberId]);

  useEffect(() => {
    setFreshData(null);
  }, [from, to, scopeBarberId]);

  const breakdown = useMemo(() => {
    if (freshData?.detalhamentoFaturado) {
      return {
        totalFaturado: Number(freshData.totalFaturado || 0),
        pagosCount: Number(freshData.pagosCount || 0),
        servicos: freshData.detalhamentoFaturado.servicos,
        produtos: freshData.detalhamentoFaturado.produtos,
        conveniencia: freshData.detalhamentoFaturado.conveniencia,
      };
    }
    return buildFallbackBreakdown(summary);
  }, [freshData, summary]);

  const total = Number(breakdown.totalFaturado || 0);
  const totalMercadoriasBruto = Number(
    (
      Number(breakdown.produtos?.subtotal || 0) +
      Number(breakdown.conveniencia?.subtotal || 0)
    ).toFixed(2)
  );
  const totalCmv = Number(
    (
      Number(breakdown.produtos?.cmv || 0) +
      Number(breakdown.conveniencia?.cmv || 0)
    ).toFixed(2)
  );
  const totalLucroMercadorias = Math.max(
    0,
    Number((totalMercadoriasBruto - totalCmv).toFixed(2))
  );

  const categories = useMemo(() => {
    const calcPct = (val) => {
      if (!total || total <= 0) return 0;
      return Math.round((Number(val || 0) / total) * 100);
    };

    return [
      {
        key: "servicos",
        title: "Serviços",
        subtitle: "Cortes, barbas, sobrancelhas e acabamentos",
        icon: Scissors,
        accentText: "text-blue-400",
        accentBg: "bg-blue-500/12 border-blue-500/25",
        barColor: "bg-blue-500",
        badgeBg: "bg-blue-500/10 text-blue-300 border-blue-500/20",
        unitSingular: "atendimento",
        unitPlural: "atendimentos",
        hasCmv: false,
        data: breakdown.servicos,
        percent: calcPct(breakdown.servicos?.subtotal),
      },
      {
        key: "produtos",
        title: "Produtos",
        subtitle: "Pomadas, óleos, pós-barba e acessórios",
        icon: Package,
        accentText: "text-amber-400",
        accentBg: "bg-amber-500/12 border-amber-500/25",
        barColor: "bg-amber-500",
        badgeBg: "bg-amber-500/10 text-amber-300 border-amber-500/20",
        unitSingular: "unidade",
        unitPlural: "unidades",
        hasCmv: true,
        data: breakdown.produtos,
        percent: calcPct(breakdown.produtos?.subtotal),
      },
      {
        key: "conveniencia",
        title: "Conveniência",
        subtitle: "Bebidas geladas, cafés, energéticos e snacks",
        icon: Coffee,
        accentText: "text-emerald-400",
        accentBg: "bg-emerald-500/12 border-emerald-500/25",
        barColor: "bg-emerald-500",
        badgeBg: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
        unitSingular: "item",
        unitPlural: "itens",
        hasCmv: true,
        data: breakdown.conveniencia,
        percent: calcPct(breakdown.conveniencia?.subtotal),
      },
    ];
  }, [breakdown, total]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Detalhamento do Faturamento"
    >
      <div className="space-y-4">
        {/* Cabeçalho de Contexto (Filtros Ativos + Total Consolidado no Caixa) */}
        <div className="rounded-2xl bg-zinc-950 border border-zinc-800/90 p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] font-medium text-zinc-300">
                <Calendar size={11} className="text-blue-400 shrink-0" />
                <span>{periodLabel || "Período atual"}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] font-medium text-zinc-300">
                <User size={11} className="text-emerald-400 shrink-0" />
                <span>{barberLabel || "Todos"}</span>
              </span>
            </div>

            {fetching && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-500">
                <RefreshCw size={11} className="animate-spin text-zinc-400" />
                Sincronizando
              </span>
            )}
          </div>

          <div className="flex items-end justify-between gap-3 pt-1 border-t border-zinc-900">
            <div>
              <p className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                <TrendingUp size={12} className="text-emerald-400" />
                Total Faturado no Caixa (Preço de Venda)
              </p>
              <p className="text-2xl font-bold text-white font-mono tabular-nums tracking-tight mt-0.5">
                {formatBRL(total)}
              </p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-[11px] font-semibold text-emerald-400">
                <CheckCircle2 size={11} />
                {breakdown.pagosCount}{" "}
                {breakdown.pagosCount === 1 ? "pagamento" : "pagamentos"}
              </span>
            </div>
          </div>

          {total > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="h-2 w-full rounded-full bg-zinc-900 overflow-hidden flex gap-0.5">
                {categories.map((cat) => {
                  const sub = Number(cat.data?.subtotal || 0);
                  if (sub <= 0) return null;
                  const widthPct = Math.max(4, (sub / total) * 100);
                  return (
                    <div
                      key={cat.key}
                      style={{ width: `${widthPct}%` }}
                      className={`h-full ${cat.barColor} transition-all duration-300`}
                    />
                  );
                })}
              </div>
              <div className="flex items-center justify-between text-[10px] text-zinc-400 font-medium">
                {categories.map((cat) => (
                  <span key={cat.key} className="inline-flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 rounded-full ${cat.barColor}`} />
                    {cat.title}: {cat.percent}%
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Cards de Detalhamento por Categoria */}
        <div className="space-y-3">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const subtotal = Number(cat.data?.subtotal || 0);
            const cmv = Number(cat.data?.cmv || 0);
            const lucroBruto = Math.max(0, Number((subtotal - cmv).toFixed(2)));
            const count = Number(cat.data?.count || 0);
            const items = Array.isArray(cat.data?.items) ? cat.data.items : [];

            return (
              <div
                key={cat.key}
                className="rounded-2xl bg-zinc-950/90 border border-zinc-800/90 p-3.5 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${cat.accentBg}`}
                    >
                      <Icon size={17} className={cat.accentText} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white truncate">
                          {cat.title}
                        </h4>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cat.badgeBg}`}
                        >
                          {count} {count === 1 ? cat.unitSingular : cat.unitPlural}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                        {cat.subtitle}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-white font-mono tabular-nums">
                      {formatBRL(subtotal)}
                    </p>
                    <p className="text-[10px] text-zinc-500 font-medium">
                      Faturado · {cat.percent}%
                    </p>
                  </div>
                </div>

                {/* Indicador analítico de CMV e Lucro Bruto para Produtos e Conveniência */}
                {cat.hasCmv && subtotal > 0 && (
                  <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-zinc-900/90 text-[11px]">
                    <div className="rounded-lg bg-zinc-900/70 px-2.5 py-1.5 flex items-center justify-between">
                      <span className="text-zinc-400">CMV (Custo):</span>
                      <span className="font-mono tabular-nums font-semibold text-amber-400">
                        {formatBRL(cmv)}
                      </span>
                    </div>
                    <div className="rounded-lg bg-emerald-950/25 border border-emerald-500/20 px-2.5 py-1.5 flex items-center justify-between">
                      <span className="text-zinc-300">Lucro Bruto:</span>
                      <span className="font-mono tabular-nums font-bold text-emerald-400">
                        {formatBRL(lucroBruto)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Lista de itens da categoria */}
                {items.length > 0 ? (
                  <div className="pt-2 border-t border-zinc-900 space-y-1.5">
                    {items.map((item, idx) => (
                      <div
                        key={`${cat.key}-${idx}-${item.name}`}
                        className="flex items-center justify-between gap-2 text-xs py-1.5 px-2.5 rounded-lg bg-zinc-900/60"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded bg-zinc-800 text-[10px] font-mono font-bold text-zinc-300 shrink-0">
                            {item.quantity}x
                          </span>
                          <div className="min-w-0">
                            <span className="text-zinc-200 font-medium truncate block">
                              {item.name}
                            </span>
                            {cat.hasCmv && Number(item.cmv || 0) > 0 && (
                              <span className="text-[10px] text-zinc-500 font-mono tabular-nums block">
                                Custo: {formatBRL(item.cmv)} · Lucro: {formatBRL(item.lucroBruto)}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-zinc-200 font-mono tabular-nums font-semibold shrink-0">
                          {formatBRL(item.subtotal)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pt-2 border-t border-zinc-900/80">
                    <p className="text-[11px] text-zinc-500 italic">
                      Nenhum lançamento faturado em {cat.title.toLowerCase()} neste período.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bloco Analítico de CMV & Lucro de Mercadorias (Produtos + Conveniência) */}
        {totalMercadoriasBruto > 0 && (
          <div className="rounded-2xl bg-zinc-950 border border-zinc-800/90 p-3.5 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Apuração Analítica: Produtos & Conveniência (CMV)
            </p>
            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Receita Bruta (Venda no Caixa):</span>
                <span className="font-mono tabular-nums font-semibold text-white">
                  {formatBRL(totalMercadoriasBruto)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">(-) Custo das Mercadorias (CMV):</span>
                <span className="font-mono tabular-nums font-semibold text-amber-400">
                  - {formatBRL(totalCmv)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-zinc-900">
                <span className="text-emerald-400 font-semibold">
                  (=) Lucro Bruto de Mercadorias:
                </span>
                <span className="font-mono tabular-nums font-bold text-emerald-400">
                  {formatBRL(totalLucroMercadorias)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Rodapé de Fechamento e Consistência Contábil */}
        <div className="rounded-xl bg-zinc-900/70 border border-zinc-800 px-3.5 py-2.5 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">
            Soma do Caixa (Serv. + Prod. + Conv.)
          </span>
          <span className="text-sm font-bold text-emerald-400 font-mono tabular-nums">
            {formatBRL(total)}
          </span>
        </div>
      </div>
    </BottomSheet>
  );
}
