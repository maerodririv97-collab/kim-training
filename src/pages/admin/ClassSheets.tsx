import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Attendee, BookingStatus, CancelResult, ClassItem, ImplementUsage, PlanOption } from '../../api/types';
import { PlanPicker } from '../../components/PlanPicker';
import { Badge, DiscTag, EmptyState, ErrorState, Field, Loading, SheetHead, bookingBadge, occStatus, useSheet } from '../../components/ui';
import { dateKey, fmtDayShort, fmtTime, todayKey } from '../../lib/format';
import { LEVELS, useDisciplines, useDone, useStudents, useTeachers } from './hooks';
import { StudentSheet } from './StudentSheets';

const LOCATIONS = ['Studio 1', 'Studio 2', 'Studio 3', 'Sala Bici', 'Sala Pesas', 'Ring Norte'];

export function ClassFormSheet({ initial, defaultDate }: { initial?: ClassItem; defaultDate?: string }) {
  const done = useDone();
  const { open } = useSheet();
  const disciplines = useDisciplines();
  const teachers = useTeachers();
  const [f, setF] = useState(() => ({
    discipline_id: initial?.discipline_id ?? 0,
    teacher_id: initial?.teacher_id ?? 0,
    date: initial ? dateKey(initial.starts_at) : defaultDate ?? todayKey(),
    time: initial ? fmtTime(initial.starts_at) : '18:00',
    duration_min: initial?.duration_min ?? 60,
    capacity: initial?.capacity ?? 10,
    level: initial?.level ?? 'Todos',
    location: initial?.location ?? 'Studio 1',
    repeat_weeks: 0,
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const activeDisc = (disciplines.data ?? []).filter((d) => d.active || d.id === f.discipline_id);
  const discId = f.discipline_id || activeDisc[0]?.id || 0;
  const teacherList = (teachers.data ?? []).filter((t) => t.active || t.id === f.teacher_id);
  const specialists = teacherList.filter((t) => t.disciplines.some((d) => d.id === discId));
  const others = teacherList.filter((t) => !t.disciplines.some((d) => d.id === discId));
  const teacherId = f.teacher_id || specialists[0]?.id || teacherList[0]?.id || 0;

  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, discipline_id: discId, teacher_id: teacherId };
      return initial ? api.put(`/admin/classes/${initial.id}`, body) : api.post('/admin/classes', body);
    },
    onSuccess: () => done(initial ? 'Clase actualizada' : f.repeat_weeks ? `Se crearon ${f.repeat_weeks + 1} clases` : 'Clase creada correctamente'),
  });
  const cancel = useMutation({
    mutationFn: () => api.post<{ bookings_released: number }>(`/admin/classes/${initial!.id}/cancel`),
    onSuccess: (r) => done(`Clase cancelada · ${r.bookings_released} reservas liberadas`),
  });

  if (disciplines.isLoading || teachers.isLoading) return <><SheetHead title={initial ? 'Editar clase' : 'Crear clase'} /><Loading /></>;
  if (!activeDisc.length || !teacherList.length) {
    return (
      <>
        <SheetHead title="Crear clase" />
        <EmptyState
          icon="calendar"
          title="Falta configurar el estudio"
          desc={!activeDisc.length
            ? 'Primero crea al menos una disciplina activa en la sección Disciplinas.'
            : 'Primero registra al menos un profesor activo en la sección Profesores.'}
        />
      </>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  const err = m.error ?? cancel.error;

  return (
    <form onSubmit={submit}>
      <SheetHead title={initial ? 'Editar clase' : 'Crear clase'} />
      {err && <div className="form-error">{err.message}</div>}
      <Field label="Disciplina">
        <select value={discId} onChange={(e) => setF((s) => ({ ...s, discipline_id: Number(e.target.value), teacher_id: 0 }))}>
          {activeDisc.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="Profesor">
        <select value={teacherId} onChange={(e) => set('teacher_id', Number(e.target.value))}>
          {specialists.length > 0 && <optgroup label="Especialistas">{specialists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
          {others.length > 0 && <optgroup label="Otros profesores">{others.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Fecha"><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required /></Field>
        <Field label="Hora"><input type="time" value={f.time} onChange={(e) => set('time', e.target.value)} required /></Field>
      </div>
      <div className="form-grid">
        <Field label="Duración (min)"><input type="number" min={10} max={300} value={f.duration_min} onChange={(e) => set('duration_min', Number(e.target.value))} required /></Field>
        <Field label="Cupos"><input type="number" min={1} max={200} value={f.capacity} onChange={(e) => set('capacity', Number(e.target.value))} required /></Field>
      </div>
      <div className="form-grid">
        <Field label="Nivel">
          <select value={f.level} onChange={(e) => set('level', e.target.value)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
        </Field>
        <Field label="Ubicación">
          <input list="locations" value={f.location} onChange={(e) => set('location', e.target.value)} required />
          <datalist id="locations">{LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist>
        </Field>
      </div>
      {!initial && (
        <Field label="Clase recurrente">
          <select value={f.repeat_weeks} onChange={(e) => set('repeat_weeks', Number(e.target.value))}>
            <option value={0}>No repetir</option>
            <option value={3}>Repetir cada semana · 1 mes</option>
            <option value={7}>Repetir cada semana · 2 meses</option>
            <option value={11}>Repetir cada semana · 3 meses</option>
          </select>
        </Field>
      )}
      <button type="submit" className="btn btn-pulse btn-block" disabled={m.isPending}>
        {m.isPending ? <span className="spinner" /> : initial ? 'Guardar cambios' : 'Crear clase'}
      </button>
      {initial && (
        <>
          <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => open(<AttendeesSheet classId={initial.id} />)}>Ver asistentes</button>
          {!initial.cancelled && new Date(initial.starts_at) > new Date() && (
            <button type="button" className="btn btn-danger-ghost btn-block" style={{ marginTop: 8 }} disabled={cancel.isPending}
              onClick={() => cancel.mutate()}>Cancelar clase (devuelve las reservas)</button>
          )}
        </>
      )}
    </form>
  );
}

function AttendanceToggle({ a, base }: { a: Attendee; base: string }) {
  const done = useDone();
  const m = useMutation({
    mutationFn: (status: BookingStatus) => api.put(`${base}/bookings/${a.booking_id}/status`, { status }),
    onSuccess: () => done('Asistencia actualizada', { keepOpen: true }),
  });
  const attended = a.status === 'attended';
  const noshow = a.status === 'noshow';
  return (
    <div className="seg" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={attended ? 'on-ok' : ''} disabled={m.isPending} onClick={() => m.mutate(attended ? 'booked' : 'attended')}>Asistió</button>
      <button type="button" className={noshow ? 'on-bad' : ''} disabled={m.isPending} onClick={() => m.mutate(noshow ? 'booked' : 'noshow')}>No asistió</button>
    </div>
  );
}

/** Cancelación por el admin con confirmación en línea (sin diálogos del navegador). */
function CancelBookingButton({ a }: { a: Attendee }) {
  const done = useDone();
  const [confirming, setConfirming] = useState(false);
  const waitlist = a.status === 'waitlist';
  const m = useMutation({
    mutationFn: (refund: boolean) => api.post<CancelResult>(`/admin/bookings/${a.booking_id}/cancel`, { refund }),
    onSuccess: (r) => done(
      waitlist ? `${a.name} salió de la lista de espera` : r.refunded ? `Reserva de ${a.name} cancelada · clase devuelta al plan` : `Reserva de ${a.name} cancelada · clase descontada`,
      { keepOpen: true },
    ),
  });
  if (!confirming) {
    return (
      <button type="button" className="btn btn-danger-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setConfirming(true); }}>
        {waitlist ? 'Quitar' : 'Cancelar'}
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }} onClick={(e) => e.stopPropagation()}>
      {m.error && <div className="form-error" style={{ fontSize: 11.5 }}>{m.error.message}</div>}
      {waitlist ? (
        <button type="button" className="btn btn-danger-ghost btn-sm" disabled={m.isPending} onClick={() => m.mutate(true)}>Sí, quitar de la espera</button>
      ) : (
        <>
          <button type="button" className="btn btn-danger-ghost btn-sm" disabled={m.isPending} onClick={() => m.mutate(true)}>Cancelar y devolver la clase</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={m.isPending} onClick={() => m.mutate(false)}>Cancelar sin devolver</button>
        </>
      )}
      <button type="button" className="btn btn-ghost btn-sm" disabled={m.isPending} onClick={() => setConfirming(false)}>Volver</button>
    </div>
  );
}

function AddAttendee({ c }: { c: ClassItem }) {
  const done = useDone();
  const students = useStudents();
  const [studentId, setStudentId] = useState(0);
  const [planId, setPlanId] = useState(0);
  const plans = useQuery({
    queryKey: ['plan-options', c.id, studentId],
    queryFn: () => api.get<PlanOption[]>(`/admin/classes/${c.id}/plan-options?student_id=${studentId}`),
    enabled: studentId > 0,
  });
  const options = plans.data ?? [];
  const chosen = options.find((p) => p.id === planId) ?? options[0];
  const m = useMutation({
    mutationFn: () => api.post(`/admin/classes/${c.id}/attendees`, { student_id: studentId, plan_id: chosen?.id ?? null }),
    onSuccess: () => { setStudentId(0); setPlanId(0); done('Estudiante agregado a la clase', { keepOpen: true }); },
  });
  const eligible = (students.data ?? []).filter((s) => s.active && s.disciplines.some((d) => d.id === c.discipline_id));
  return (
    <div style={{ marginTop: 16 }}>
      <Field label="Agregar estudiante (reserva en su nombre)">
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={studentId} onChange={(e) => { setStudentId(Number(e.target.value)); setPlanId(0); }}>
            <option value={0}>Selecciona…</option>
            {eligible.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.remaining ?? 0} disp.</option>)}
          </select>
          <button type="button" className="btn btn-primary btn-sm" disabled={!studentId || plans.isLoading || m.isPending} onClick={() => m.mutate()}>Agregar</button>
        </div>
      </Field>
      {studentId > 0 && plans.data && (options.length === 0
        ? <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>No tiene un plan vigente con clases disponibles para esta fecha.</p>
        : <PlanPicker options={options} value={chosen?.id ?? 0} onChange={setPlanId} />)}
      {chosen && chosen.implements.length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
          {chosen.implements_available ? `Se apartará: ${chosen.implements.join(', ')}` : `Sin unidades libres de ${chosen.implements.join(', ')} en este horario`}
        </p>
      )}
      {m.error && <div className="form-error">{m.error.message}</div>}
    </div>
  );
}

/** Lista de asistentes. `mode="teacher"` usa /api/teacher y oculta acciones exclusivas del admin. */
export function AttendeesSheet({ classId, mode = 'admin' }: { classId: number; mode?: 'admin' | 'teacher' }) {
  const base = mode === 'admin' ? '/admin' : '/teacher';
  const isAdmin = mode === 'admin';
  const { open } = useSheet();
  const { data, isLoading, error } = useQuery({
    queryKey: ['attendees', mode, classId],
    queryFn: () => api.get<{ class: ClassItem; attendees: Attendee[]; implements: ImplementUsage[] }>(`${base}/classes/${classId}/attendees`),
  });
  if (isLoading) return <><SheetHead title="Asistentes" /><Loading /></>;
  if (error || !data) return <><SheetHead title="Asistentes" /><ErrorState error={error} /></>;
  const c = data.class;
  const started = new Date(c.starts_at) <= new Date();
  const future = !started && !c.cancelled;

  return (
    <>
      <SheetHead title={`${c.discipline} · ${fmtTime(c.starts_at)}`} />
      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
        {fmtDayShort(dateKey(c.starts_at))} · {c.teacher} · {c.location} · {c.booked}/{c.capacity} reservados
        {c.waitlist > 0 && ` · ${c.waitlist} en espera`}
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <DiscTag name={c.discipline} color={c.color} upper />
        {c.cancelled ? <Badge kind="cancel" label="Clase cancelada" /> : <Badge kind={occStatus(c)} />}
      </div>
      {!c.cancelled && data.implements.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 8px' }}>
          {data.implements.map((i) => (
            <span key={i.id} className="chip" title={i.used > i.in_class ? `${i.used - i.in_class} apartados en clases a la misma hora` : undefined}>
              {i.name}: {i.in_class} en esta clase · {i.available} de {i.quantity} libres
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {data.attendees.length ? data.attendees.map((a) => {
          const b = bookingBadge(a.status, c.starts_at);
          return (
            <div key={a.booking_id} className="mini-row" style={{ padding: '10px 4px', borderBottom: '1px solid var(--line-soft)', cursor: isAdmin ? 'pointer' : 'default' }}
              onClick={() => isAdmin && open(<StudentSheet studentId={a.student_id} />)}>
              <div className="mini-av">{a.initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {a.plan_name ?? 'Sin plan asignado'}
                  {a.implements.length > 0 && <> · <strong style={{ color: 'var(--ink)' }}>{a.implements.join(', ')}</strong></>}
                </div>
              </div>
              {started && ['booked', 'attended', 'noshow'].includes(a.status) && !c.cancelled
                ? <AttendanceToggle a={a} base={base} />
                : <Badge kind={b.kind} label={a.status === 'booked' ? 'Reservada' : b.label} />}
              {isAdmin && future && ['booked', 'waitlist'].includes(a.status) && <CancelBookingButton a={a} />}
            </div>
          );
        }) : <p style={{ fontSize: 13, color: 'var(--muted)', padding: '10px 0' }}>Aún no hay estudiantes reservados.</p>}
      </div>
      {started && !c.cancelled && data.attendees.length > 0 && (
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>Las reservas que no se marquen cuentan como asistidas.</p>
      )}
      {future && isAdmin && <AddAttendee c={c} />}
    </>
  );
}
