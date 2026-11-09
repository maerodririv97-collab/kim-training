import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api/client';
import type { Dashboard } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, EmptyState, ErrorState, Loading, occStatus, useSheet } from '../../components/ui';
import { fmtAgo, fmtDate, fmtLongDate, fmtMoneyShort, fmtTime } from '../../lib/format';
import { AttendeesSheet, ClassFormSheet } from './ClassSheets';
import { useAdminDisciplines } from './Disciplines';
import { useDone, usePlans, useStudents, useTeachers } from './hooks';
import { StudentSheet } from './StudentSheets';

function Kpi({ icon, bg, fg, num, label, delta }: { icon: string; bg: string; fg: string; num: string | number; label: string; delta?: number | null }) {
  return (
    <div className="kpi">
      <div className="top">
        <div className="ic" style={{ background: bg, color: fg }}><Icon name={icon} size={16} /></div>
        {delta != null && (
          <span className="delta" style={{ color: delta >= 0 ? 'var(--teal)' : '#C0392B' }} title="vs. mismo día de la semana pasada">
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
          </span>
        )}
      </div>
      <div className="num">{num}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

/** Guía de primeros pasos: se muestra hasta que el estudio tenga lo básico configurado. */
function SetupGuide() {
  const navigate = useNavigate();
  const { open } = useSheet();
  const disciplines = useAdminDisciplines();
  const teachers = useTeachers();
  const plans = usePlans();
  const students = useStudents();
  if (disciplines.isLoading || teachers.isLoading || plans.isLoading || students.isLoading) return null;
  const upcoming = (disciplines.data ?? []).reduce((a, d) => a + d.upcoming_classes, 0);
  const steps = [
    { done: (disciplines.data ?? []).some((d) => d.active), title: 'Crea las disciplinas', desc: 'Las modalidades o deportes que ofrece el estudio.', cta: 'Disciplinas', go: () => navigate('/admin/disciplinas') },
    { done: (teachers.data ?? []).some((t) => t.active), title: 'Registra a los profesores', desc: 'Y asígnales sus especialidades.', cta: 'Profesores', go: () => navigate('/admin/profesores') },
    { done: (plans.data ?? []).some((p) => p.active), title: 'Define los planes', desc: 'Número de clases, vigencia y precio.', cta: 'Planes', go: () => navigate('/admin/catalogo') },
    { done: upcoming > 0, title: 'Programa las clases', desc: 'Puedes crearlas recurrentes por semanas.', cta: 'Crear clase', go: () => open(<ClassFormSheet />) },
    { done: (students.data ?? []).length > 0, title: 'Inscribe a los estudiantes', desc: 'Con sus disciplinas habilitadas y su plan.', cta: 'Estudiantes', go: () => navigate('/admin/estudiantes') },
  ];
  const completed = steps.filter((x) => x.done).length;
  if (completed === steps.length) return null;
  const next = steps.findIndex((x) => !x.done);
  return (
    <div className="card pad-l" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <h3 style={{ fontSize: 16 }}>Configura tu estudio</h3>
        <span className="eyebrow">{completed}/{steps.length} completados</span>
      </div>
      {steps.map((x, i) => (
        <div key={x.title} className={`setup-step${x.done ? ' done' : ''}`}>
          <div className="num">{x.done ? <Icon name="check" size={14} /> : i + 1}</div>
          <div className="txt"><strong>{x.title}</strong><span>{x.desc}</span></div>
          {!x.done && <button className={`btn btn-sm ${i === next ? 'btn-pulse' : 'btn-ghost'}`} onClick={x.go}>{x.cta}</button>}
        </div>
      ))}
    </div>
  );
}

function DismissReset({ id }: { id: number }) {
  const done = useDone();
  const m = useMutation({ mutationFn: () => api.post(`/admin/password-resets/${id}/dismiss`), onSuccess: () => done('Solicitud descartada') });
  return <button className="btn btn-ghost btn-sm" disabled={m.isPending} onClick={() => m.mutate()}>Descartar</button>;
}

export function AdminDashboard() {
  const { open } = useSheet();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/admin/dashboard'),
    refetchInterval: 60_000,
  });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const k = data.kpis;
  const { soon, password_resets, low_plans, without_plan } = data.alerts;
  const longDate = fmtLongDate(data.date);

  return (
    <>
      <div className="greet">
        <div><h1>Panel general</h1><p>{longDate.charAt(0).toUpperCase() + longDate.slice(1)} · KIM Solutions - Training</p></div>
        <button className="btn btn-primary" onClick={() => open(<ClassFormSheet />)}><Icon name="plus" size={15} /> Crear clase</button>
      </div>

      <SetupGuide />

      <div className="grid-4">
        <Kpi icon="calendar" bg="var(--pulse-tint)" fg="var(--pulse-dark)" num={k.classes_today} label="Clases del día" />
        <Kpi icon="users" bg="var(--teal-tint)" fg="var(--teal)" num={k.bookings_today} label="Reservas del día" delta={k.bookings_delta_pct} />
        <Kpi icon="trend" bg="var(--amber-tint)" fg="#8A5A0F" num={`${k.occupancy_pct}%`} label="Ocupación" />
        <Kpi icon="bell" bg="var(--violet-tint)" fg="var(--violet)" num={k.waitlist} label="En lista de espera" />
      </div>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <Kpi icon="x" bg="#F1E2E2" fg="#96322A" num={k.cancellations_today} label="Cancelaciones hoy" />
        <Kpi icon="wallet" bg="var(--volt-tint)" fg="var(--volt-dark)" num={fmtMoneyShort(k.revenue_today)} label="Planes vendidos hoy (COP)" />
      </div>

      <div className="section-title">
        <h3>Agenda del día</h3>
        <Link className="link" to="/admin/calendario">Ver calendario <Icon name="chevron" size={13} /></Link>
      </div>
      <div className="card pad-l">
        {data.classes.length ? data.classes.map((c) => (
          <div key={c.id} className="agenda-row" style={{ opacity: c.cancelled ? 0.55 : 1 }}>
            <div className="tm">{fmtTime(c.starts_at)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5 }}>{c.discipline} — {c.teacher}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{c.location} · Nivel {c.level}</div>
            </div>
            <div className="occupancy-bar"><i style={{ width: `${Math.round((c.booked / c.capacity) * 100)}%` }} /></div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, width: 44, textAlign: 'right' }}>{c.booked}/{c.capacity}</div>
            {c.cancelled ? <Badge kind="cancel" /> : <Badge kind={occStatus(c)} />}
            <button className="btn btn-ghost btn-sm" onClick={() => open(<AttendeesSheet classId={c.id} />)}>Ver</button>
          </div>
        )) : <EmptyState icon="calendar" title="Sin clases hoy" desc="No hay clases programadas para hoy." />}
      </div>

      <div className="section-title"><h3>Alertas</h3></div>
      {!soon.length && !password_resets.length && !low_plans.length && !without_plan.length && (
        <div className="card pad-l"><p className="muted" style={{ fontSize: 13 }}>Todo en orden. No hay alertas por ahora.</p></div>
      )}
      {soon.map((c) => (
        <div key={c.id} className="card pad-l alert-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <strong style={{ fontSize: 13.5 }}>Clase en menos de 2 horas — {c.discipline}</strong>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{fmtTime(c.starts_at)} · {c.teacher} · {c.booked} estudiantes reservados</p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => open(<AttendeesSheet classId={c.id} />)}>Ver asistentes</button>
          </div>
        </div>
      ))}
      {password_resets.map((r) => (
        <div key={r.id} className="card pad-l alert-card info">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong style={{ fontSize: 13.5 }}>Solicitud de nueva contraseña — {r.name ?? r.email}</strong>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{r.email} · {fmtAgo(r.created_at)}</p>
            </div>
            <div className="inline-actions">
              {r.student_id && <button className="btn btn-primary btn-sm" onClick={() => open(<StudentSheet studentId={r.student_id!} />)}>Restablecer</button>}
              <DismissReset id={r.id} />
            </div>
          </div>
        </div>
      ))}
      {without_plan.length > 0 && (
        <div className="card pad-l alert-card info">
          <strong style={{ fontSize: 13.5 }}>Estudiantes sin plan asignado</strong>
          <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>No pueden reservar hasta que les registres un plan.</p>
          <div style={{ marginTop: 8 }}>
            {without_plan.map((s) => (
              <div key={s.student_id} className="mini-row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer' }}
                onClick={() => open(<StudentSheet studentId={s.student_id} />)}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</span>
                  {s.invited && <span className="muted" style={{ fontSize: 12 }}> · registrado con enlace</span>}
                </div>
                <span className="mono" style={{ fontSize: 12 }}>desde {fmtDate(s.joined_on)}</span>
                <button className="btn btn-primary btn-sm">Asignar plan</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {low_plans.length > 0 && (
        <div className="card pad-l alert-card danger">
          <strong style={{ fontSize: 13.5 }}>Planes por renovar</strong>
          <div style={{ marginTop: 8 }}>
            {low_plans.map((p) => (
              <div key={p.student_id} className="mini-row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer' }}
                onClick={() => open(<StudentSheet studentId={p.student_id} />)}>
                <div style={{ flex: 1 }}><span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</span> <span className="muted" style={{ fontSize: 12 }}>· {p.plan}</span></div>
                <span className="mono" style={{ fontSize: 12 }}>{p.remaining} disp. · vence {fmtDate(p.ends_on)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
