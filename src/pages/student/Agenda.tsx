import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import type { ClassItem, Overview } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, EmptyState, ErrorState, Loading, occStatus, useSheet } from '../../components/ui';
import { addDays, dateKey, dayNum, fmtRelativeDay, fmtTime, fmtWeekday, todayKey } from '../../lib/format';
import { BookingSheet, ClassDetailSheet, WaitlistSheet } from './sheets';

const DAYS = 14;
type Mode = 'dia' | 'semana' | 'lista';

function AgendaClassCard({ c }: { c: ClassItem }) {
  const { open } = useSheet();
  const st = occStatus(c);
  const left = Math.max(0, c.capacity - c.booked);
  let badge = <Badge kind={st} />;
  let cta = st === 'full'
    ? <button className="btn btn-ghost btn-sm" onClick={() => open(<WaitlistSheet c={c} />)}>Lista de espera</button>
    : <button className="btn btn-pulse btn-sm" onClick={() => open(<BookingSheet c={c} />)}>Reservar</button>;
  if (c.my_status === 'booked') {
    badge = <Badge kind="booked" />;
    cta = <button className="btn btn-ghost btn-sm" onClick={() => open(<ClassDetailSheet classId={c.id} />)}>Detalle</button>;
  } else if (c.my_status === 'waitlist') {
    badge = <Badge kind="wait" />;
    cta = <button className="btn btn-ghost btn-sm" onClick={() => open(<ClassDetailSheet classId={c.id} />)}>Detalle</button>;
  }
  return (
    <div className="class-card">
      <div className="time-block"><div className="t">{fmtTime(c.starts_at)}</div><div className="d">{c.duration_min} min</div></div>
      <div className="body">
        <DiscTag name={c.discipline} color={c.color} upper />
        <h4 style={{ marginTop: 6 }}>{c.discipline}{c.level !== 'Todos' ? ` · Nivel ${c.level.toLowerCase()}` : ''}</h4>
        <div className="sub">
          <span><Icon name="user" size={12} /> {c.teacher}</span>
          <span><Icon name="location" size={12} /> {c.location}</span>
          <span><Icon name="calendar" size={12} /> {fmtRelativeDay(dateKey(c.starts_at))}</span>
        </div>
      </div>
      <div className="right">
        {badge}
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{left} cupos</div>
        {cta}
      </div>
    </div>
  );
}

export function StudentAgenda() {
  const today = todayKey();
  const [mode, setMode] = useState<Mode>('dia');
  const [day, setDay] = useState(today);
  const [disc, setDisc] = useState<number | null>(null);

  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/me/overview') });
  const from = today;
  const to = addDays(today, DAYS - 1);
  const agenda = useQuery({
    queryKey: ['agenda', from, to],
    queryFn: () => api.get<ClassItem[]>(`/me/agenda${qs({ from, to })}`),
  });

  const enabled = overview.data?.disciplines ?? [];
  const filtered = useMemo(
    () => (agenda.data ?? []).filter((c) => disc === null || c.discipline_id === disc),
    [agenda.data, disc],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, ClassItem[]>();
    for (const c of filtered) {
      const k = dateKey(c.starts_at);
      map.set(k, [...(map.get(k) ?? []), c]);
    }
    return map;
  }, [filtered]);

  if (overview.isLoading || agenda.isLoading) return <><div className="greet"><h1>Agenda de clases</h1></div><Loading /></>;
  if (overview.error || agenda.error) return <ErrorState error={overview.error ?? agenda.error} onRetry={() => { overview.refetch(); agenda.refetch(); }} />;

  if (!enabled.length) {
    return (
      <>
        <div className="greet"><h1>Agenda de clases</h1></div>
        <EmptyState icon="calendar" title="Sin disciplinas habilitadas" desc="Tu administrador aún no te ha habilitado ninguna disciplina. Escríbele para que active tu acceso." />
      </>
    );
  }

  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i));
  const visibleDays = mode === 'dia' ? [day] : mode === 'semana' ? days.slice(0, 7) : days;
  const groups = visibleDays.map((d) => [d, byDay.get(d) ?? []] as const).filter(([, list]) => mode === 'dia' || list.length);

  return (
    <>
      <div className="greet"><h1>Agenda de clases</h1></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="view-toggle">
          <button className={mode === 'dia' ? 'active' : ''} onClick={() => setMode('dia')}>Día</button>
          <button className={mode === 'semana' ? 'active' : ''} onClick={() => setMode('semana')}>Semana</button>
          <button className={mode === 'lista' ? 'active' : ''} onClick={() => setMode('lista')}>Lista</button>
        </div>
      </div>
      <div className="section-title" style={{ marginTop: 14, marginBottom: 6 }}><h3 style={{ fontSize: 13 }}>Mis disciplinas</h3></div>
      <div className="chip-row">
        <button className={`chip${disc === null ? ' active' : ''}`} onClick={() => setDisc(null)}>Todas ({enabled.length})</button>
        {enabled.map((d) => (
          <button key={d.id} className={`chip${disc === d.id ? ' active' : ''}`} onClick={() => setDisc(d.id)}>{d.name}</button>
        ))}
      </div>

      {mode === 'dia' && (
        <div className="day-strip">
          {days.map((d) => (
            <button key={d} className={`day-pill${d === day ? ' active' : ''}${byDay.has(d) ? '' : ' has-none'}`} onClick={() => setDay(d)}>
              <div className="dow">{d === today ? 'Hoy' : fmtWeekday(d)}</div>
              <div className="num">{dayNum(d)}</div>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: mode === 'dia' ? 6 : 14 }}>
        {groups.length && groups.some(([, l]) => l.length) ? groups.map(([d, list]) => (
          <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mode !== 'dia' && <div className="agenda-day-head">{fmtRelativeDay(d)}</div>}
            {list.map((c) => <AgendaClassCard key={c.id} c={c} />)}
          </div>
        )) : (
          <EmptyState icon="calendar" title="Sin clases disponibles" desc="No hay clases programadas para esta disciplina en las fechas seleccionadas." />
        )}
      </div>
    </>
  );
}
