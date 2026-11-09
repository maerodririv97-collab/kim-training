import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Progress } from '../../api/types';
import { EmptyState, ErrorState, Loading, SWATCH } from '../../components/ui';
import { fmtMonthYear, monthInitial, monthShort } from '../../lib/format';

export function MonthlyBars({ data, height = 110 }: { data: { month: string; count: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bars" style={{ height }}>
      {data.map((d) => (
        <div key={d.month} className="bar" title={`${monthShort(d.month)}: ${d.count}`}
          style={{ height: `${Math.max(2, (d.count / max) * (height - 10))}px`, opacity: d.count ? 1 : 0.25 }}>
          <span>{monthInitial(d.month)}</span>
        </div>
      ))}
    </div>
  );
}

export function StudentProgress() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['progress'], queryFn: () => api.get<Progress>('/me/progress') });
  if (isLoading) return <><div className="greet"><h1>Mi progreso</h1></div><Loading /></>;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const first = data.monthly[0]?.month;
  const last = data.monthly[data.monthly.length - 1]?.month;

  return (
    <>
      <div className="greet"><h1>Mi progreso</h1></div>
      <div className="grid-4">
        <div className="stat-box"><div className="num">{data.attended}</div><div className="lbl">Clases realizadas</div></div>
        <div className="stat-box"><div className="num">{data.attendance_pct}%</div><div className="lbl">Asistencia</div></div>
        <div className="stat-box"><div className="num">{data.disciplines_count}</div><div className="lbl">Disciplinas</div></div>
        <div className="stat-box"><div className="num">{data.months_active}</div><div className="lbl">Meses activo</div></div>
      </div>

      <div className="section-title">
        <h3>Tu evolución</h3>
        {first && last && <span className="eyebrow">{monthShort(first)} {first.slice(0, 4)} → {monthShort(last)} {last.slice(0, 4)}</span>}
      </div>
      <div className="card pad-l" style={{ paddingBottom: 34 }}>
        <MonthlyBars data={data.monthly} />
      </div>

      <div className="section-title"><h3>Por disciplina</h3><span className="eyebrow">Solo tus disciplinas habilitadas</span></div>
      <div className="card pad-l">
        {data.disciplines.length ? data.disciplines.map((d) => (
          <div key={d.id} className="disc-row">
            <div className="sw" style={{ background: SWATCH[d.color] ?? 'var(--teal)' }} />
            <div className="d-info"><h4>{d.name}</h4><p>Desde {fmtMonthYear(d.since)} · Asistencia {d.attendance_pct}%</p></div>
            <div className="d-num">{d.classes} clases</div>
          </div>
        )) : (
          <EmptyState icon="chart" title="Sin disciplinas habilitadas" desc="Pídele a tu administrador que habilite al menos una disciplina." />
        )}
      </div>

      <div className="section-title"><h3>Objetivos</h3></div>
      <div className="tag-list">
        {data.goal && <span className="obj-tag">💪 {data.goal}</span>}
        <span className="obj-tag">🔥 Mantener condición física</span>
      </div>
    </>
  );
}
