import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import type { BookingItem } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, EmptyState, ErrorState, Loading, bookingBadge, useSheet } from '../../components/ui';
import { dateKey, fmtDayShort, fmtTime } from '../../lib/format';
import { CancelSheet, RescheduleSheet } from './sheets';

const TABS = [
  ['proximas', 'Próximas'],
  ['realizadas', 'Realizadas'],
  ['canceladas', 'Canceladas'],
  ['noasistidas', 'No asistidas'],
] as const;

export function StudentMyClasses() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('proximas');
  const { open } = useSheet();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['bookings', tab],
    queryFn: () => api.get<BookingItem[]>(`/me/bookings${qs({ tab })}`),
  });

  return (
    <>
      <div className="greet"><h1>Mis clases</h1></div>
      <div className="chip-row">
        {TABS.map(([id, label]) => (
          <button key={id} className={`chip${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : data?.length ? data.map((b) => {
          const badge = bookingBadge(b.status, b.starts_at, b.class_cancelled);
          const c = { id: b.class_id, discipline: b.discipline, color: b.color, teacher: b.teacher, starts_at: b.starts_at, duration_min: b.duration_min, location: b.location };
          return (
            <div key={b.booking_id} className="class-card">
              <div className="time-block"><div className="t">{fmtTime(b.starts_at)}</div><div className="d">{b.duration_min} min</div></div>
              <div className="body">
                <DiscTag name={b.discipline} color={b.color} />
                <h4 style={{ marginTop: 6 }}>{b.discipline}</h4>
                <div className="sub">
                  <span><Icon name="user" size={12} /> {b.teacher}</span>
                  <span><Icon name="calendar" size={12} /> {fmtDayShort(dateKey(b.starts_at))}</span>
                  {b.rescheduled && <span><Icon name="swap" size={12} /> Reprogramada</span>}
                </div>
              </div>
              <div className="right">
                <Badge kind={badge.kind} label={b.rescheduled && b.status === 'cancelled' ? 'Reprogramada' : badge.label} />
                {tab === 'proximas' && (
                  <div className="row-actions">
                    {b.status === 'booked' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => open(<RescheduleSheet bookingId={b.booking_id} c={c} />)}>Reprogramar</button>
                    )}
                    <button className="btn btn-danger-ghost btn-sm" onClick={() => open(<CancelSheet bookingId={b.booking_id} c={c} waitlist={b.status === 'waitlist'} />)}>
                      {b.status === 'waitlist' ? 'Salir' : 'Cancelar'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        }) : (
          <EmptyState icon="clock" title="Nada por aquí todavía" desc="Cuando tengas actividad en esta categoría, aparecerá listada." />
        )}
      </div>
    </>
  );
}
