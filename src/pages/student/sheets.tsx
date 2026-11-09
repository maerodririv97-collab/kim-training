import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError, api } from '../../api/client';
import type { BookingResult, CancelResult, ClassItem, Overview, WaitlistResult } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, ErrorState, Loading, SheetHead, occStatus, useSheet, useToast } from '../../components/ui';
import { dateKey, fmtDayShort, fmtRelativeDay, fmtTime, hoursUntil } from '../../lib/format';

const CANCEL_WINDOW_HOURS = 4;
const WAITLIST_HOURS = 3;

/** Datos mínimos de clase que necesitan los sheets. */
export type ClassLike = Pick<ClassItem, 'id' | 'discipline' | 'color' | 'teacher' | 'starts_at' | 'duration_min' | 'location'>;

const when = (c: Pick<ClassItem, 'starts_at'>) => `${fmtDayShort(dateKey(c.starts_at))} · ${fmtTime(c.starts_at)}`;

function useAfterMutation() {
  const qc = useQueryClient();
  const { close } = useSheet();
  const toast = useToast();
  return (msg: string, icon = 'check') => {
    qc.invalidateQueries();
    close();
    toast(msg, icon);
  };
}

function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="form-error" style={{ marginTop: 12 }}>{error instanceof Error ? error.message : 'Error inesperado'}</div>;
}

// ---------------------------------------------------------------- Detalle

export function ClassDetailSheet({ classId }: { classId: number }) {
  const { data: c, isLoading, error } = useQuery({
    queryKey: ['class', classId],
    queryFn: () => api.get<ClassItem>(`/me/classes/${classId}`),
  });
  const { open } = useSheet();
  if (isLoading) return <><SheetHead title="Detalle de la clase" /><Loading /></>;
  if (error || !c) return <><SheetHead title="Detalle de la clase" /><ErrorState error={error} /></>;

  const st = occStatus(c);
  const mine = c.my_status;
  const isFuture = new Date(c.starts_at) > new Date();
  return (
    <>
      <SheetHead title="Detalle de la clase" />
      <DiscTag name={c.discipline} color={c.color} upper />
      <h3 style={{ marginTop: 10 }}>{c.discipline} · {fmtDayShort(dateKey(c.starts_at))}</h3>
      <div className="sum-row"><span className="k">Horario</span><span className="v">{fmtTime(c.starts_at)} ({c.duration_min} min)</span></div>
      <div className="sum-row"><span className="k">Profesor</span><span className="v">{c.teacher}</span></div>
      <div className="sum-row"><span className="k">Nivel</span><span className="v">{c.level}</span></div>
      <div className="sum-row"><span className="k">Ubicación</span><span className="v">{c.location}</span></div>
      <div className="sum-row"><span className="k">Cupos</span><span className="v">{c.booked}/{c.capacity}</span></div>
      <div className="sum-row"><span className="k">Estado</span><span className="v">
        {c.cancelled ? <Badge kind="cancel" label="Clase cancelada" /> : mine === 'booked' ? <Badge kind="booked" /> : mine === 'waitlist' ? <Badge kind="wait" /> : <Badge kind={st} />}
      </span></div>
      {!c.cancelled && isFuture && (
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          {mine === 'booked' && c.my_booking_id && (
            <>
              <button className="btn btn-ghost btn-block" onClick={() => open(<RescheduleSheet bookingId={c.my_booking_id!} c={c} />)}>Reprogramar</button>
              <button className="btn btn-danger-ghost btn-block" onClick={() => open(<CancelSheet bookingId={c.my_booking_id!} c={c} />)}>Cancelar</button>
            </>
          )}
          {mine === 'waitlist' && c.my_booking_id && (
            <button className="btn btn-danger-ghost btn-block" onClick={() => open(<CancelSheet bookingId={c.my_booking_id!} c={c} waitlist />)}>Salir de la lista de espera</button>
          )}
          {!mine && (st === 'full'
            ? <button className="btn btn-primary btn-block" onClick={() => open(<WaitlistSheet c={c} />)}>Unirme a lista de espera</button>
            : <button className="btn btn-pulse btn-block" onClick={() => open(<BookingSheet c={c} />)}>Reservar</button>)}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Reservar

export function BookingSheet({ c }: { c: ClassLike }) {
  const done = useAfterMutation();
  const { open, close } = useSheet();
  const navigate = useNavigate();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/me/overview') });
  const plan = overview.data?.plan;
  const m = useMutation({
    mutationFn: () => api.post<BookingResult>('/me/bookings', { class_id: c.id }),
    onSuccess: () => done(`Reserva confirmada · ${c.discipline}`),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'class_full') open(<WaitlistSheet c={c} />);
    },
  });
  const noPlan = m.error instanceof ApiError && m.error.code === 'no_plan';

  return (
    <>
      <SheetHead title="Confirmar reserva" />
      <DiscTag name={c.discipline} color={c.color} upper />
      <h3 style={{ marginTop: 10 }}>{c.discipline}</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{when(c)}</p>
      <div className="sum-row"><span className="k">Profesora/Profesor</span><span className="v">{c.teacher}</span></div>
      <div className="sum-row"><span className="k">Duración</span><span className="v">{c.duration_min} min</span></div>
      <div className="sum-row"><span className="k">Ubicación</span><span className="v">{c.location}</span></div>
      <div className="deduct-box">
        <div className="ic"><Icon name="bolt" size={18} /></div>
        <p>
          Se descontará
          <strong>1 clase de tu plan{plan ? ` (${plan.name})` : ''}</strong>
          {plan && <>Te quedarán {Math.max(0, plan.remaining - 1)} clases disponibles.</>}
        </p>
      </div>
      <ErrorBox error={m.error} />
      {noPlan ? (
        <button className="btn btn-ghost btn-block" onClick={() => { close(); navigate('/perfil'); }}>Ver mis planes</button>
      ) : (
        <button className="btn btn-pulse btn-block" disabled={m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? <span className="spinner" /> : 'Confirmar reserva'}
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Lista de espera

export function WaitlistSheet({ c }: { c: ClassLike }) {
  const done = useAfterMutation();
  const m = useMutation({
    mutationFn: () => api.post<WaitlistResult>('/me/waitlist', { class_id: c.id }),
    onSuccess: (r) => done(`Estás #${r.position} en la lista de espera`, 'bell'),
  });
  return (
    <>
      <SheetHead title="Clase llena" />
      <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
        {c.discipline} con {c.teacher} · {when(c)} ya no tiene cupos disponibles.
      </p>
      <div className="deduct-box" style={{ background: 'var(--violet-tint)' }}>
        <div className="ic" style={{ background: 'var(--violet)' }}><Icon name="bell" size={18} /></div>
        <p style={{ color: 'var(--violet)' }}>
          Si se libera un cupo te reservamos automáticamente y se descuenta 1 clase de tu plan. Si no se libera en{' '}
          <strong style={{ display: 'inline' }}>{WAITLIST_HOURS} horas</strong>, tu solicitud se cancelará automáticamente.
        </p>
      </div>
      <ErrorBox error={m.error} />
      <button className="btn btn-primary btn-block" disabled={m.isPending} onClick={() => m.mutate()}>
        {m.isPending ? <span className="spinner" /> : 'Unirme a lista de espera'}
      </button>
    </>
  );
}

// ---------------------------------------------------------------- Reprogramar

export function RescheduleSheet({ bookingId, c }: { bookingId: number; c: ClassLike }) {
  const done = useAfterMutation();
  const tooLate = hoursUntil(c.starts_at) < CANCEL_WINDOW_HOURS;
  const options = useQuery({
    queryKey: ['reschedule-options', bookingId],
    queryFn: () => api.get<ClassItem[]>(`/me/bookings/${bookingId}/reschedule-options`),
    enabled: !tooLate,
  });
  const m = useMutation({
    mutationFn: (classId: number) => api.post<BookingResult>(`/me/bookings/${bookingId}/reschedule`, { class_id: classId }),
    onSuccess: (_r, classId) => {
      const o = options.data?.find((x) => x.id === classId);
      done(o ? `Clase reprogramada a ${fmtRelativeDay(dateKey(o.starts_at))} · ${fmtTime(o.starts_at)}` : 'Clase reprogramada');
    },
  });

  return (
    <>
      <SheetHead title="Reprogramar clase" />
      {tooLate ? (
        <div className="deduct-box" style={{ background: 'var(--amber-tint)' }}>
          <div className="ic" style={{ background: 'var(--amber)' }}><Icon name="clock" size={18} /></div>
          <p style={{ color: '#8A5A0F' }}>Solo puedes reprogramar con al menos <strong style={{ display: 'inline' }}>{CANCEL_WINDOW_HOURS} horas</strong> de anticipación.</p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 12 }}>
            Selecciona una nueva fecha y horario para tu clase de {c.discipline}.
          </p>
          {options.isLoading && <Loading />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {options.data?.length ? options.data.map((o) => {
              const st = occStatus(o);
              return (
                <button key={o.id} className="class-card" disabled={st === 'full' || m.isPending}
                  style={{ width: '100%', textAlign: 'left', border: '1px solid var(--line)', background: 'var(--paper)' }}
                  onClick={() => m.mutate(o.id)}>
                  <div className="time-block"><div className="t">{fmtTime(o.starts_at)}</div><div className="d">{o.duration_min} min</div></div>
                  <div className="body"><h4>{fmtRelativeDay(dateKey(o.starts_at))}</h4><div className="sub"><span><Icon name="user" size={12} /> {o.teacher}</span></div></div>
                  <div className="right"><Badge kind={st} /></div>
                </button>
              );
            }) : !options.isLoading && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No hay otros horarios compatibles por ahora.</p>}
          </div>
          <ErrorBox error={m.error} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Cancelar

export function CancelSheet({ bookingId, c, waitlist }: { bookingId: number; c: ClassLike; waitlist?: boolean }) {
  const done = useAfterMutation();
  const { close } = useSheet();
  const onTime = hoursUntil(c.starts_at) >= CANCEL_WINDOW_HOURS;
  const m = useMutation({
    mutationFn: () => api.post<CancelResult>(`/me/bookings/${bookingId}/cancel`),
    onSuccess: (r) => done(
      waitlist ? 'Saliste de la lista de espera' : r.refunded ? 'Reserva cancelada · clase devuelta a tu plan' : 'Reserva cancelada · la clase no se devuelve',
    ),
  });
  return (
    <>
      <SheetHead title={waitlist ? 'Salir de la lista de espera' : 'Cancelar reserva'} />
      <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
        ¿Confirmas la cancelación de <strong style={{ color: 'var(--ink)' }}>{c.discipline}</strong> el {fmtDayShort(dateKey(c.starts_at))} a las {fmtTime(c.starts_at)}?
      </p>
      {!waitlist && (onTime ? (
        <div className="deduct-box" style={{ background: 'var(--teal-tint)' }}>
          <div className="ic" style={{ background: 'var(--teal)' }}><Icon name="check" size={18} /></div>
          <p style={{ color: 'var(--teal)' }}>Cancelas dentro del tiempo permitido (mín. {CANCEL_WINDOW_HOURS} horas antes). <strong>La clase se devolverá a tu plan.</strong></p>
        </div>
      ) : (
        <div className="deduct-box" style={{ background: '#F1E2E2' }}>
          <div className="ic" style={{ background: '#C0392B' }}><Icon name="x" size={18} /></div>
          <p style={{ color: '#96322A' }}>Faltan menos de {CANCEL_WINDOW_HOURS} horas para la clase. <strong>La clase no se devolverá a tu plan.</strong></p>
        </div>
      ))}
      <ErrorBox error={m.error} />
      <div style={{ display: 'flex', gap: 10, marginTop: waitlist ? 16 : 0 }}>
        <button className="btn btn-ghost btn-block" onClick={close}>Volver</button>
        <button className="btn btn-danger-ghost btn-block" disabled={m.isPending} onClick={() => m.mutate()}>Sí, cancelar</button>
      </div>
    </>
  );
}
