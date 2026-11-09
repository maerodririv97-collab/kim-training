import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import type { ClassItem } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, EmptyState, ErrorState, Loading, occStatus, useSheet } from '../../components/ui';
import { addDays, dateKey, dayNum, fmtDayShort, fmtTime, fmtWeekday, todayKey, weekStart } from '../../lib/format';
import { AttendeesSheet, ClassFormSheet } from './ClassSheets';
import { useDone, useTeachers } from './hooks';

function DuplicateButton({ c }: { c: ClassItem }) {
  const done = useDone();
  const m = useMutation({
    mutationFn: () => api.post<{ date: string }>(`/admin/classes/${c.id}/duplicate`, {}),
    onSuccess: (r) => done(`Clase duplicada para el ${fmtDayShort(r.date)}`),
    onError: (e) => done(e.message, { keepOpen: true, icon: 'x' }),
  });
  return <button className="btn btn-ghost btn-sm" disabled={m.isPending} onClick={() => m.mutate()}>Duplicar</button>;
}

export function AdminCalendar() {
  const { open } = useSheet();
  const today = todayKey();
  const [week, setWeek] = useState(weekStart(today));
  const [day, setDay] = useState(today);
  const [teacher, setTeacher] = useState<number | null>(null);
  const teachers = useTeachers();
  const to = addDays(week, 6);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['classes', week, to, teacher],
    queryFn: () => api.get<ClassItem[]>(`/admin/classes${qs({ from: week, to, teacher_id: teacher })}`),
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
      <div className="greet">
        <h1>Calendario</h1>
        <button className="btn btn-primary" onClick={() => open(<ClassFormSheet defaultDate={day >= today ? day : today} />)}><Icon name="plus" size={15} /> Crear clase</button>
      </div>
      <div className="chip-row">
        <button className={`chip${teacher === null ? ' active' : ''}`} onClick={() => setTeacher(null)}>Todos los profesores</button>
        {(teachers.data ?? []).filter((t) => t.active).map((t) => (
          <button key={t.id} className={`chip${teacher === t.id ? ' active' : ''}`} onClick={() => setTeacher(t.id)}>{t.name}</button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
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
        {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : list.length ? list.map((c) => (
          <div key={c.id} className={`class-card${c.cancelled ? ' is-cancelled' : ''}`}>
            <div className="time-block"><div className="t">{fmtTime(c.starts_at)}</div><div className="d">{c.duration_min} min</div></div>
            <div className="body">
              <DiscTag name={c.discipline} color={c.color} upper />
              <h4 style={{ marginTop: 6 }}>{c.discipline} — {c.teacher}</h4>
              <div className="sub"><span><Icon name="location" size={12} /> {c.location}</span><span>Nivel {c.level}</span>{c.waitlist > 0 && <span>{c.waitlist} en espera</span>}</div>
            </div>
            <div className="right">
              {c.cancelled ? <Badge kind="cancel" /> : <Badge kind={occStatus(c)} />}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{c.booked}/{c.capacity} cupos</div>
              <div className="row-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => open(<AttendeesSheet classId={c.id} />)}>Asistentes</button>
                <button className="btn btn-ghost btn-sm" onClick={() => open(<ClassFormSheet initial={c} />)}>Editar</button>
                <DuplicateButton c={c} />
              </div>
            </div>
          </div>
        )) : <EmptyState icon="calendar" title="Sin clases este día" desc="Crea una clase o elige otro día de la semana." />}
      </div>
    </>
  );
}
