import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { StudentDetail } from '../../api/types';
import { Badge, DiscTag, ErrorState, Field, Loading, SheetHead, useSheet } from '../../components/ui';
import { fmtAgo, fmtDate, fmtMoney, todayKey } from '../../lib/format';
import { LEVELS, useDisciplines, useDone, usePlans } from './hooks';

function DisciplinesEditor({ studentId, initial }: { studentId: number; initial: number[] }) {
  const done = useDone();
  const disciplines = useDisciplines();
  const [chosen, setChosen] = useState<number[]>(initial);
  const m = useMutation({
    mutationFn: () => api.put(`/admin/students/${studentId}/disciplines`, { discipline_ids: chosen }),
    onSuccess: () => done('Disciplinas actualizadas', { keepOpen: true }),
  });
  const toggle = (id: number) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const dirty = chosen.length !== initial.length || chosen.some((id) => !initial.includes(id));
  return (
    <>
      <div className="section-title" style={{ margin: '20px 0 8px' }}><h3 style={{ fontSize: 14 }}>Disciplinas habilitadas</h3></div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        Solo verá y podrá reservar clases de las disciplinas marcadas aquí. Esta configuración se aplica en agenda, reservas,
        reprogramaciones, lista de espera, historial, progreso y promociones.
      </p>
      <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {(disciplines.data ?? []).filter((d) => d.active || chosen.includes(d.id)).map((d) => (
          <label key={d.id} className="check-row">
            <input type="checkbox" checked={chosen.includes(d.id)} onChange={() => toggle(d.id)} />
            <DiscTag name={d.name} color={d.color} />
          </label>
        ))}
      </div>
      {m.error && <div className="form-error">{m.error.message}</div>}
      <button className="btn btn-pulse btn-block" disabled={!dirty || m.isPending} onClick={() => m.mutate()}>Guardar disciplinas</button>
    </>
  );
}

function AssignPlan({ studentId }: { studentId: number }) {
  const done = useDone();
  const plans = usePlans();
  const [planId, setPlanId] = useState(0);
  const [start, setStart] = useState(todayKey());
  const active = (plans.data ?? []).filter((p) => p.active);
  const selected = planId || active[0]?.id || 0;
  const m = useMutation({
    mutationFn: () => api.post(`/admin/students/${studentId}/plans`, { plan_id: selected, starts_on: start }),
    onSuccess: () => done('Plan registrado', { keepOpen: true }),
  });
  return (
    <div className="pad-m" style={{ border: '1px dashed var(--line)', borderRadius: 'var(--radius-m)', marginTop: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 10 }}>Registrar plan (pago en el estudio)</div>
      <div className="form-grid">
        <Field label="Plan">
          <select value={selected} onChange={(e) => setPlanId(Number(e.target.value))}>
            {active.map((p) => <option key={p.id} value={p.id}>{p.name} · {fmtMoney(p.price)}</option>)}
          </select>
        </Field>
        <Field label="Inicia"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
      {m.error && <div className="form-error">{m.error.message}</div>}
      <button className="btn btn-primary btn-block btn-sm" disabled={!selected || m.isPending} onClick={() => m.mutate()}>Registrar plan</button>
    </div>
  );
}

function ResetPassword({ studentId, pending }: { studentId: number; pending: boolean }) {
  const done = useDone();
  const [password, setPassword] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/admin/students/${studentId}/password`, { password }),
    onSuccess: () => { setPassword(''); done('Contraseña restablecida. Compártela con el estudiante.', { keepOpen: true }); },
  });
  return (
    <>
      <div className="section-title" style={{ margin: '20px 0 8px' }}>
        <h3 style={{ fontSize: 14 }}>Contraseña</h3>
        {pending && <Badge kind="low" label="Solicitó restablecer" />}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="form-field" style={{ flex: 1, marginBottom: 0 }}>
          <input type="text" placeholder="Nueva contraseña temporal (mín. 8)" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn btn-ghost btn-sm" disabled={password.length < 8 || m.isPending} onClick={() => m.mutate()}>Restablecer</button>
      </div>
      {m.error && <div className="form-error" style={{ marginTop: 8 }}>{m.error.message}</div>}
    </>
  );
}

export function StudentSheet({ studentId }: { studentId: number }) {
  const { open, close } = useSheet();
  const { data, isLoading, error } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => api.get<StudentDetail>(`/admin/students/${studentId}`),
  });
  if (isLoading) return <><SheetHead title="Perfil del estudiante" /><Loading /></>;
  if (error || !data) return <><SheetHead title="Perfil del estudiante" /><ErrorState error={error} /></>;
  const s = data.student;
  const plan = data.plan;

  return (
    <>
      <SheetHead title="Perfil del estudiante" />
      <div className="profile-head" style={{ marginBottom: 16 }}>
        <div className="av-lg">{data.initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 16 }}>{s.name}</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>{s.email}</p>
          <div style={{ marginTop: 6 }}>{s.active ? <Badge kind="open" label="Activo" /> : <Badge kind="cancel" label="Inactivo" />}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => open(<StudentEditSheet detail={data} />)}>Editar</button>
      </div>
      <div className="sum-row"><span className="k">Plan actual</span><span className="v">{plan?.name ?? 'Sin plan vigente'}</span></div>
      {plan && <div className="sum-row"><span className="k">Clases disponibles</span><span className="v">{plan.remaining} de {plan.total_classes} · vence {fmtDate(plan.ends_on)}</span></div>}
      {plan && plan.implements.length > 0 && <div className="sum-row"><span className="k">Implementos</span><span className="v">{plan.implements.join(', ')}</span></div>}
      <div className="sum-row"><span className="k">Última asistencia</span><span className="v">{fmtAgo(s.last_attended_at)}</span></div>
      <div className="sum-row"><span className="k">Total de clases</span><span className="v">{s.attended}</span></div>
      <div className="sum-row"><span className="k">Asistencia</span><span className="v">{data.attendance_pct}%</span></div>
      <div className="sum-row"><span className="k">Objetivo</span><span className="v">{s.goal ?? '—'}</span></div>
      <div className="sum-row"><span className="k">Observaciones</span><span className="v">{s.notes ?? 'Ninguna'}</span></div>

      <DisciplinesEditor key={s.discipline_ids.join(',')} studentId={s.id} initial={s.discipline_ids} />

      <div className="section-title" style={{ margin: '20px 0 8px' }}><h3 style={{ fontSize: 14 }}>Planes</h3></div>
      {data.plans.length ? data.plans.slice(0, 5).map((p) => (
        <div key={p.id} className="sum-row">
          <span className="k">{p.name}<br /><span style={{ fontSize: 11.5 }}>{fmtDate(p.starts_on)} → {fmtDate(p.ends_on)}</span></span>
          <span className="v mono">{p.used}/{p.total_classes}</span>
        </div>
      )) : <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Sin planes registrados.</p>}
      <AssignPlan studentId={s.id} />

      <ResetPassword studentId={s.id} pending={s.reset_pending} />
      <button className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={close}>Cerrar</button>
    </>
  );
}

function StudentEditSheet({ detail }: { detail: StudentDetail }) {
  const done = useDone();
  const { open } = useSheet();
  const s = detail.student;
  const [f, setF] = useState({
    name: s.name, email: s.email, active: s.active, phone: s.phone ?? '', birth_date: s.birth_date ?? '',
    weight_kg: s.weight_kg?.toString() ?? '', height_m: s.height_m?.toString() ?? '', level: s.level ?? '',
    restrictions: s.restrictions ?? '', goal: s.goal ?? '', notes: s.notes ?? '',
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const m = useMutation({
    mutationFn: () => api.put(`/admin/students/${s.id}`, {
      ...f,
      weight_kg: f.weight_kg ? Number(f.weight_kg) : null,
      height_m: f.height_m ? Number(f.height_m) : null,
    }),
    onSuccess: () => { done('Datos guardados', { keepOpen: true }); open(<StudentSheet studentId={s.id} />); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };
  return (
    <form onSubmit={submit}>
      <SheetHead title="Editar estudiante" />
      {m.error && <div className="form-error">{m.error.message}</div>}
      <Field label="Nombre completo"><input value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
      <Field label="Correo (usuario de ingreso)"><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></Field>
      <div className="form-grid">
        <Field label="Teléfono"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Fecha de nacimiento"><input type="date" value={f.birth_date} onChange={(e) => set('birth_date', e.target.value)} /></Field>
      </div>
      <div className="form-grid">
        <Field label="Peso (kg)"><input type="number" step="0.1" value={f.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} /></Field>
        <Field label="Altura (m)"><input type="number" step="0.01" value={f.height_m} onChange={(e) => set('height_m', e.target.value)} /></Field>
      </div>
      <div className="form-grid">
        <Field label="Nivel">
          <select value={f.level} onChange={(e) => set('level', e.target.value)}>
            <option value="">—</option>
            {LEVELS.filter((l) => l !== 'Todos').map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Objetivo"><input value={f.goal} onChange={(e) => set('goal', e.target.value)} /></Field>
      </div>
      <Field label="Restricciones / lesiones"><input value={f.restrictions} onChange={(e) => set('restrictions', e.target.value)} /></Field>
      <Field label="Observaciones internas"><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      <label className="check-row" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
        Cuenta activa (si se desactiva, no podrá iniciar sesión)
      </label>
      <button type="submit" className="btn btn-pulse btn-block" disabled={m.isPending}>Guardar</button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => open(<StudentSheet studentId={s.id} />)}>Volver</button>
    </form>
  );
}

export function NewStudentSheet() {
  const done = useDone();
  const disciplines = useDisciplines();
  const plans = usePlans();
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '', goal: '', plan_id: 0 });
  const [chosen, setChosen] = useState<number[]>([]);
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }));
  const m = useMutation({
    mutationFn: () => api.post('/admin/students', { ...f, plan_id: f.plan_id || null, discipline_ids: chosen }),
    onSuccess: () => done(`Estudiante ${f.name.split(' ')[0]} creado`),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };
  return (
    <form onSubmit={submit}>
      <SheetHead title="Nuevo estudiante" />
      {m.error && <div className="form-error">{m.error.message}</div>}
      <Field label="Nombre completo"><input value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
      <Field label="Correo (usuario de ingreso)"><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></Field>
      <div className="form-grid">
        <Field label="Contraseña temporal"><input value={f.password} onChange={(e) => set('password', e.target.value)} required minLength={8} placeholder="mín. 8 caracteres" /></Field>
        <Field label="Teléfono"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
      </div>
      <Field label="Objetivo"><input value={f.goal} onChange={(e) => set('goal', e.target.value)} placeholder="Ej. Ganar fuerza" /></Field>
      <Field label="Plan inicial (opcional, inicia hoy)">
        <select value={f.plan_id} onChange={(e) => set('plan_id', Number(e.target.value))}>
          <option value={0}>Sin plan por ahora</option>
          {(plans.data ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {fmtMoney(p.price)}</option>)}
        </select>
      </Field>
      <div className="form-field">
        <label>Disciplinas habilitadas</label>
        {(disciplines.data ?? []).filter((d) => d.active).map((d) => (
          <label key={d.id} className="check-row">
            <input type="checkbox" checked={chosen.includes(d.id)}
              onChange={() => setChosen((c) => (c.includes(d.id) ? c.filter((x) => x !== d.id) : [...c, d.id]))} />
            <DiscTag name={d.name} color={d.color} />
          </label>
        ))}
      </div>
      <button type="submit" className="btn btn-pulse btn-block" disabled={m.isPending}>{m.isPending ? <span className="spinner" /> : 'Crear estudiante'}</button>
    </form>
  );
}
