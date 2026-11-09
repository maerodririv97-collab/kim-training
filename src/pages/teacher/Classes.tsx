import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import type { ClassItem } from '../../api/types';
import { Icon } from '../../components/Icon';
import { EmptyState, ErrorState, Loading } from '../../components/ui';
import { addDays, dateKey, dayNum, fmtDayShort, fmtWeekday, todayKey, weekStart } from '../../lib/format';
import { TeacherClassCard } from './Home';

export function TeacherClasses() {
  const today = todayKey();
  const [week, setWeek] = useState(weekStart(today));
  const [day, setDay] = useState(today);
  const to = addDays(week, 6);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['teacher-classes', week, to],
    queryFn: () => api.get<ClassItem[]>(`/teacher/classes${qs({ from: week, to })}`),
  });
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    (data ?? []).forEach((c) => m.set(dateKey(c.starts_at), (m.get(dateKey(c.starts_at)) ?? 0) + 1));
    return m;
  }, [data]);
  const list = (data ?? []).filter((c) => dateKey(c.starts_at) === day);

  const moveWeek = (n: number) => {
    const w = addDays(week, n * 7);
    setWeek(w);
    setDay(w <= today && today <= addDays(w, 6) ? today : w);
  };

  return (
    <>
      <div className="greet"><h1>Mis clases</h1></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="week-nav">
          <button className="icon-btn" aria-label="Semana anterior" onClick={() => moveWeek(-1)}><span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" size={15} /></span></button>
          <button className="icon-btn" aria-label="Semana siguiente" onClick={() => moveWeek(1)}><Icon name="chevron" size={15} /></button>
          <span className="eyebrow">{fmtDayShort(week)} – {fmtDayShort(to)}</span>
        </div>
        {week !== weekStart(today) && <button className="btn btn-ghost btn-sm" onClick={() => { setWeek(weekStart(today)); setDay(today); }}>Hoy</button>}
      </div>
      <div className="day-strip">
        {days.map((d) => (
          <button key={d} className={`day-pill${d === day ? ' active' : ''}${counts.get(d) ? '' : ' has-none'}`} onClick={() => setDay(d)}>
            <div className="dow">{fmtWeekday(d)}</div>
            <div className="num">{dayNum(d)}</div>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
        {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : list.length
          ? list.map((c) => <TeacherClassCard key={c.id} c={c} />)
          : <EmptyState icon="calendar" title="Sin clases este día" desc="Elige otro día de la semana." />}
      </div>
    </>
  );
}
