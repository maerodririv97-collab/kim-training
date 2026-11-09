import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Teacher } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, EmptyState, ErrorState, Field, Loading, SheetHead, useSheet } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useDisciplines, useDone, useTeachers } from './hooks';

function TeacherSheet({ teacher }: { teacher?: Teacher }) {
  const done = useDone();
  const disciplines = useDisciplines();
  const [f, setF] = useState({
    name: teacher?.name ?? '', email: teacher?.email ?? '', phone: teacher?.phone ?? '', active: teacher?.active ?? true,
    password: '',
    is_admin: teacher?.is_admin ?? false,
  });
  const { me } = useAuth();
  const isSelf = !!teacher && me?.teacher_id === teacher.id;
  const [showPass, setShowPass] = useState(false);
  const needsPassword = !teacher || !teacher.has_login;
  const [chosen, setChosen] = useState<number[]>(teacher?.disciplines.map((d) => d.id) ?? []);
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, discipline_ids: chosen };
      return teacher ? api.put(`/admin/teachers/${teacher.id}`, body) : api.post('/admin/teachers', body);
    },
    onSuccess: () => done(teacher ? 'Profesor actualizado' : `Profesor creado · ya puede ingresar con ${f.email.trim()}`),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };
  return (
    <form onSubmit={submit}>
      <SheetHead title={teacher ? 'Editar profesor' : 'Nuevo profesor'} />
      {m.error && <div className="form-error">{m.error.message}</div>}
      <Field label="Nombre completo"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label="Teléfono"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>

      <div className="pad-m" style={{ border: '1px dashed var(--line)', borderRadius: 'var(--radius-m)', marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 4 }}>Acceso a la plataforma</div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Con estos datos el profesor inicia sesión para ver sus clases y tomar asistencia.
        </p>
        <Field label="Correo de acceso">
          <input type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required placeholder="profesor@correo.com" />
        </Field>
        <Field label={needsPassword ? 'Contraseña (mín. 8 caracteres)' : 'Nueva contraseña (déjala vacía para no cambiarla)'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type={showPass ? 'text' : 'password'} autoComplete="new-password" value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })} required={needsPassword} minLength={8} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPass((v) => !v)} aria-label="Mostrar contraseña">
              <Icon name={showPass ? 'eyeOff' : 'eye'} size={15} />
            </button>
          </div>
        </Field>
        <label className="check-row" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <input type="checkbox" checked={f.is_admin} disabled={isSelf} onChange={(e) => setF({ ...f, is_admin: e.target.checked })} />
          <span>
            También es administrador
            <span className="muted" style={{ display: 'block', fontSize: 11.5, fontWeight: 500 }}>
              {isSelf ? 'No puedes quitarte este permiso a ti mismo.' : 'Podrá entrar al panel de administración además de su vista de profesor.'}
            </span>
          </span>
        </label>
        {teacher && !teacher.has_login && <p style={{ fontSize: 12, color: '#8A5A0F', marginTop: -6 }}>Este profesor aún no tiene acceso: asígnale una contraseña.</p>}
      </div>
      <div className="form-field">
        <label>Especialidades</label>
        {(disciplines.data ?? []).filter((d) => d.active || chosen.includes(d.id)).map((d) => (
          <label key={d.id} className="check-row">
            <input type="checkbox" checked={chosen.includes(d.id)}
              onChange={() => setChosen((c) => (c.includes(d.id) ? c.filter((x) => x !== d.id) : [...c, d.id]))} />
            <DiscTag name={d.name} color={d.color} />
          </label>
        ))}
      </div>
      {teacher && (
        <label className="check-row" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={f.active} disabled={isSelf} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Activo (si se desactiva no podrá iniciar sesión ni aparecerá al crear clases)
        </label>
      )}
      <button type="submit" className="btn btn-pulse btn-block" disabled={m.isPending}>{teacher ? 'Guardar cambios' : 'Crear profesor'}</button>
    </form>
  );
}

export function AdminTeachers() {
  const { open } = useSheet();
  const { data, isLoading, error, refetch } = useTeachers();
  return (
    <>
      <div className="greet">
        <h1>Profesores</h1>
        <button className="btn btn-primary" onClick={() => open(<TeacherSheet />)}><Icon name="plus" size={15} /> Nuevo profesor</button>
      </div>
      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : data?.length ? (
        <div className="grid-3">
          {data.map((t) => (
            <div key={t.id} className="card teacher-card" style={{ opacity: t.active ? 1 : 0.6, cursor: 'pointer' }} onClick={() => open(<TeacherSheet teacher={t} />)}>
              <div className="av-lg" style={{ background: 'linear-gradient(135deg,var(--pulse),var(--amber))' }}>{t.initials}</div>
              <h4>{t.name}</h4>
              {!t.active && <div style={{ marginTop: 6 }}><Badge kind="done" label="Inactivo" /></div>}
              {t.active && !t.has_login && <div style={{ marginTop: 6 }}><Badge kind="low" label="Sin acceso" /></div>}
              {t.is_admin && <div style={{ marginTop: 6 }}><Badge kind="wait" label="Administrador" /></div>}
              {t.email && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t.email}</div>}
              <div className="specs">{t.disciplines.map((d) => <DiscTag key={d.id} name={d.name} color={d.color} />)}</div>
              <div className="stats-row">
                <div><div className="n">{t.classes_week}</div><div className="l">Clases/sem</div></div>
                <div><div className="n">{t.students_30d}</div><div className="l">Estudiantes (30d)</div></div>
                <div><div className="n">{t.occupancy_30d}%</div><div className="l">Ocupación</div></div>
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState icon="users" title="Sin profesores" desc="Crea el primer profesor para empezar a programar clases." />}
    </>
  );
}
