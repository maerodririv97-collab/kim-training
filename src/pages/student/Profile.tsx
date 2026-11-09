import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { StudentProfile } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, EmptyState, ErrorState, Field, Loading, SheetHead, useSheet, useToast } from '../../components/ui';
import { age, fmtDate, fmtMoney, fmtMonthYear } from '../../lib/format';

type Info = StudentProfile['info'];

/** Edición de la información personal o física por parte del propio estudiante. */
function EditInfoSheet({ info, section }: { info: Info; section: 'personal' | 'fisica' }) {
  const qc = useQueryClient();
  const { close } = useSheet();
  const toast = useToast();
  const [f, setF] = useState({
    name: info.name, phone: info.phone ?? '', birth_date: info.birth_date ?? '', goal: info.goal ?? '',
    weight_kg: info.weight_kg?.toString() ?? '', height_m: info.height_m?.toString() ?? '',
    level: info.level ?? '', restrictions: info.restrictions ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const m = useMutation({
    mutationFn: () => api.put('/me/profile', {
      ...f,
      weight_kg: f.weight_kg ? Number(f.weight_kg.replace(',', '.')) : null,
      height_m: f.height_m ? Number(f.height_m.replace(',', '.')) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries();
      close();
      toast('Información actualizada');
    },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };

  return (
    <form onSubmit={submit}>
      <SheetHead title={section === 'personal' ? 'Información personal' : 'Información física'} />
      {m.error && <div className="form-error">{m.error.message}</div>}
      {section === 'personal' ? (
        <>
          <Field label="Nombre completo"><input value={f.name} onChange={(e) => set('name', e.target.value)} required minLength={3} autoComplete="name" /></Field>
          <div className="form-grid">
            <Field label="Teléfono"><input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" /></Field>
            <Field label="Fecha de nacimiento"><input type="date" value={f.birth_date} onChange={(e) => set('birth_date', e.target.value)} /></Field>
          </div>
          <Field label="Tu objetivo"><input value={f.goal} onChange={(e) => set('goal', e.target.value)} placeholder="Ej. Ganar fuerza" /></Field>
          <Field label="Correo (usuario de ingreso)"><input value={info.email} disabled /></Field>
          <p className="muted" style={{ fontSize: 11.5, marginTop: -6, marginBottom: 14 }}>Para cambiar tu correo, comunícate con el estudio.</p>
        </>
      ) : (
        <>
          <div className="form-grid">
            <Field label="Peso (kg)"><input type="number" inputMode="decimal" step="0.1" min={20} max={300} value={f.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} placeholder="Ej. 65" /></Field>
            <Field label="Altura (m)"><input type="number" inputMode="decimal" step="0.01" min={0.8} max={2.5} value={f.height_m} onChange={(e) => set('height_m', e.target.value)} placeholder="Ej. 1.70" /></Field>
          </div>
          <Field label="Nivel">
            <select value={f.level} onChange={(e) => set('level', e.target.value)}>
              <option value="">Sin definir</option>
              <option>Principiante</option>
              <option>Intermedio</option>
              <option>Avanzado</option>
            </select>
          </Field>
          <Field label="Restricciones, lesiones o condiciones médicas">
            <textarea value={f.restrictions} onChange={(e) => set('restrictions', e.target.value)} placeholder="Ej. Lesión de rodilla derecha, asma…" />
          </Field>
          <p className="muted" style={{ fontSize: 11.5, marginTop: -6, marginBottom: 14 }}>Tus profesores usan esta información para adaptar los ejercicios.</p>
        </>
      )}
      <button type="submit" className="btn btn-pulse btn-block" disabled={m.isPending}>{m.isPending ? <span className="spinner" /> : 'Guardar cambios'}</button>
    </form>
  );
}

function ChangePasswordSheet() {
  const { close } = useSheet();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/auth/change-password', { current_password: current, new_password: next }),
    onSuccess: () => { close(); toast('Contraseña actualizada'); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (next !== confirm) return setLocalError('Las contraseñas nuevas no coinciden');
    m.mutate();
  };
  const err = localError || (m.error instanceof Error ? m.error.message : '');
  return (
    <form onSubmit={submit}>
      <SheetHead title="Cambiar contraseña" />
      {err && <div className="form-error">{err}</div>}
      <Field label="Contraseña actual"><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
      <Field label="Nueva contraseña (mín. 8 caracteres)"><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></Field>
      <Field label="Confirmar nueva contraseña"><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
      <button type="submit" className="btn btn-pulse btn-block" disabled={m.isPending}>{m.isPending ? <span className="spinner" /> : 'Guardar'}</button>
    </form>
  );
}

export function StudentProfilePage() {
  const { open } = useSheet();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['profile'], queryFn: () => api.get<StudentProfile>('/me/profile') });
  if (isLoading) return <><div className="greet"><h1>Perfil</h1></div><Loading /></>;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const { info, plan } = data;

  return (
    <>
      <div className="greet"><h1>Perfil</h1></div>
      <div className="card pad-l profile-head">
        <div className="av-lg">{data.initials}</div>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 18 }}>{info.name}</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>Miembro desde {fmtMonthYear(info.joined_on)}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => open(<ChangePasswordSheet />)}>Cambiar contraseña</button>
      </div>

      <div className="section-title">
        <h3>Información personal</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => open(<EditInfoSheet info={info} section="personal" />)}><Icon name="gear" size={13} /> Editar</button>
      </div>
      <div className="card pad-l">
        <div className="field-row"><span className="k">Edad</span><span className="v">{age(info.birth_date)}</span></div>
        <div className="field-row"><span className="k">Correo</span><span className="v">{info.email}</span></div>
        <div className="field-row"><span className="k">Teléfono</span><span className="v">{info.phone ?? '—'}</span></div>
        <div className="field-row"><span className="k">Objetivo</span><span className="v">{info.goal ?? '—'}</span></div>
        <div className="field-row"><span className="k">Fecha de ingreso</span><span className="v">{fmtDate(info.joined_on)}</span></div>
      </div>

      <div className="section-title">
        <h3>Información física</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => open(<EditInfoSheet info={info} section="fisica" />)}><Icon name="gear" size={13} /> Editar</button>
      </div>
      <div className="card pad-l">
        <div className="field-row"><span className="k">Peso</span><span className="v">{info.weight_kg ? `${info.weight_kg} kg` : '—'}</span></div>
        <div className="field-row"><span className="k">Altura</span><span className="v">{info.height_m ? `${info.height_m.toFixed(2)} m` : '—'}</span></div>
        <div className="field-row"><span className="k">Nivel</span><span className="v">{info.level ?? '—'}</span></div>
        <div className="field-row"><span className="k">Restricciones</span><span className="v">{info.restrictions ?? 'Ninguna registrada'}</span></div>
      </div>

      <div className="section-title"><h3>Mis disciplinas</h3><span className="eyebrow">Habilitadas por tu administrador</span></div>
      <div className="card pad-l">
        {data.disciplines.length ? (
          <div className="grid-2">
            {data.disciplines.map((d) => (
              <div key={d.id} className="pad-m" style={{ border: '1px solid var(--line-soft)', borderRadius: 'var(--radius-m)', background: 'var(--paper)' }}>
                <DiscTag name={d.name} color={d.color} upper />
                <div style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span><strong style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{d.classes}</strong> clases realizadas</span>
                  <span><strong style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{d.attendance_pct}%</strong> asistencia</span>
                  <span>Inicio: {fmtMonthYear(d.since)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState icon="tag" title="Sin disciplinas habilitadas" desc="Tu administrador aún no te ha dado acceso a ninguna disciplina." />}
      </div>

      <div className="section-title"><h3>Mis planes</h3></div>
      <div className="card pad-l" style={{ marginBottom: 14 }}>
        {plan ? (
          <>
            <div className="field-row"><span className="k">Plan actual</span><span className="v">{plan.name}</span></div>
            <div className="field-row"><span className="k">Clases utilizadas</span><span className="v">{plan.used}</span></div>
            <div className="field-row"><span className="k">Clases restantes</span><span className="v">{plan.remaining}</span></div>
            <div className="field-row"><span className="k">Vence</span><span className="v">{fmtDate(plan.ends_on)}</span></div>
          </>
        ) : <EmptyState icon="wallet" title="Sin plan vigente" desc="Comunícate con el estudio para activar o renovar tu plan." />}
      </div>
      {data.plans.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Plan</th><th>Fecha</th><th>Precio</th><th>Clases</th><th>Estado</th></tr></thead>
            <tbody>
              {data.plans.map(({ plan: p, status }) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{fmtDate(p.starts_on)}</td>
                  <td>{fmtMoney(p.price)}</td>
                  <td>{p.used}/{p.total_classes} clases</td>
                  <td>{status === 'Activo' ? <Badge kind="open" label="Activo" /> : status === 'Programado' ? <Badge kind="wait" label="Programado" /> : <Badge kind="done" label="Finalizado" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title"><h3>Promociones para ti</h3></div>
      {data.promotions.length ? (
        <div className="grid-3">
          {data.promotions.map((p) => (
            <div key={p.id} className={`promo-card ${p.style}`}>
              <div><span className="p-badge">{p.badge}</span><h4>{p.title}</h4><p>{p.description}</p></div>
              <div>
                <div className="exp">{p.expires_on ? `Vence ${fmtDate(p.expires_on)}` : 'Sin fecha límite'}</div>
                <button className="btn btn-block" style={{ background: 'rgba(255,255,255,.92)', color: 'var(--ink)', marginTop: 10 }}
                  onClick={() => toast('Pregunta por esta promoción en recepción', 'gift')}>Aprovechar</button>
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState icon="gift" title="Sin promociones por ahora" desc="Cuando haya promociones para tus disciplinas, aparecerán aquí." />}
    </>
  );
}
