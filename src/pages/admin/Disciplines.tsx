import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { AdminDiscipline } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, EmptyState, ErrorState, Field, Loading, SWATCH, SheetHead, useSheet } from '../../components/ui';
import { COLORS, useDone } from './hooks';

const COLOR_NAMES: Record<string, string> = {
  teal: 'Verde azulado', violet: 'Violeta', pulse: 'Coral', amber: 'Ámbar',
  volt: 'Lima', red: 'Rojo', blue: 'Azul', brown: 'Café',
};

const SUGGESTIONS = ['Pilates', 'Yoga', 'Boxeo', 'Spinning', 'Funcional', 'HIIT', 'Stretching', 'Fuerza', 'CrossFit', 'Natación', 'Danza', 'Kickboxing'];

export const useAdminDisciplines = () =>
  useQuery({ queryKey: ['admin-disciplines'], queryFn: () => api.get<AdminDiscipline[]>('/admin/disciplines') });

export function DisciplineSheet({ discipline, existing = [] }: { discipline?: AdminDiscipline; existing?: string[] }) {
  const done = useDone();
  const [f, setF] = useState({
    name: discipline?.name ?? '',
    color: discipline?.color ?? COLORS[existing.length % COLORS.length],
    description: discipline?.description ?? '',
    active: discipline?.active ?? true,
  });
  const save = useMutation({
    mutationFn: () => (discipline ? api.put(`/admin/disciplines/${discipline.id}`, f) : api.post('/admin/disciplines', f)),
    onSuccess: () => done(discipline ? 'Disciplina actualizada' : `Disciplina "${f.name.trim()}" creada`),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/admin/disciplines/${discipline!.id}`),
    onSuccess: () => done('Disciplina eliminada'),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const suggestions = discipline ? [] : SUGGESTIONS.filter((s) => !taken.has(s.toLowerCase())).slice(0, 8);
  const err = save.error ?? remove.error;

  return (
    <form onSubmit={submit}>
      <SheetHead title={discipline ? 'Editar disciplina' : 'Nueva disciplina'} />
      {err && <div className="form-error">{err.message}</div>}

      <div className="card pad-m" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, background: 'var(--paper)' }}>
        <span className={`disc-sw tag-c-${f.color}`} style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
          {(f.name.trim()[0] ?? '?').toUpperCase()}
        </span>
        <div style={{ minWidth: 0 }}>
          <DiscTag name={f.name.trim() || 'Nombre de la disciplina'} color={f.color} upper />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Así se verá en la agenda y en los perfiles</div>
        </div>
      </div>

      <Field label="Nombre de la disciplina o modalidad">
        <input value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Pilates, Boxeo, Natación…" required autoFocus={!discipline} />
      </Field>
      {suggestions.length > 0 && !f.name && (
        <div className="chip-row" style={{ flexWrap: 'wrap', marginTop: -6, marginBottom: 14 }}>
          {suggestions.map((s) => (
            <button type="button" key={s} className="chip" onClick={() => setF({ ...f, name: s })}>{s}</button>
          ))}
        </div>
      )}
      <Field label="Descripción (opcional)">
        <textarea value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="Ej. Entrenamiento de bajo impacto enfocado en core, postura y flexibilidad." />
      </Field>
      <div className="form-field">
        <label>Color</label>
        <div className="color-pick">
          {COLORS.map((c) => (
            <button type="button" key={c} title={COLOR_NAMES[c]} aria-label={COLOR_NAMES[c]}
              className={f.color === c ? 'on' : ''} style={{ background: SWATCH[c] }} onClick={() => setF({ ...f, color: c })} />
          ))}
        </div>
      </div>
      {discipline && (
        <label className="check-row" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Activa (si se desactiva, no se podrán programar clases nuevas ni la verán los estudiantes)
        </label>
      )}
      <button type="submit" className="btn btn-pulse btn-block" disabled={save.isPending}>
        {save.isPending ? <span className="spinner" /> : discipline ? 'Guardar cambios' : 'Crear disciplina'}
      </button>

      {discipline && (
        discipline.total_classes > 0 ? (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Tiene {discipline.total_classes} clases registradas, por eso no se puede eliminar. Desactívala para ocultarla sin perder el historial.
          </p>
        ) : confirmDelete ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setConfirmDelete(false)}>No, volver</button>
            <button type="button" className="btn btn-danger-ghost btn-block" disabled={remove.isPending} onClick={() => remove.mutate()}>Sí, eliminar</button>
          </div>
        ) : (
          <button type="button" className="btn btn-danger-ghost btn-block" style={{ marginTop: 10 }} onClick={() => setConfirmDelete(true)}>Eliminar disciplina</button>
        )
      )}
    </form>
  );
}

export function AdminDisciplines() {
  const { open } = useSheet();
  const { data, isLoading, error, refetch } = useAdminDisciplines();
  const names = (data ?? []).map((d) => d.name);
  const active = (data ?? []).filter((d) => d.active).length;

  return (
    <>
      <div className="greet">
        <div>
          <h1>Disciplinas</h1>
          <p>{data ? `${active} activas · ${data.length} en total` : 'Modalidades y deportes que ofrece el estudio'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => open(<DisciplineSheet existing={names} />)}><Icon name="plus" size={15} /> Nueva disciplina</button>
      </div>

      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : data?.length ? (
        <div className="grid-3">
          {data.map((d) => (
            <div key={d.id} className="card disc-card" style={{ opacity: d.active ? 1 : 0.6 }} onClick={() => open(<DisciplineSheet discipline={d} existing={names} />)}>
              <div className="disc-head">
                <span className={`disc-sw tag-c-${d.color}`}>{d.name[0]?.toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4>{d.name}</h4>
                  {d.active ? <Badge kind="open" label="Activa" /> : <Badge kind="done" label="Inactiva" />}
                </div>
              </div>
              <div className="desc">{d.description || <span style={{ fontStyle: 'italic' }}>Sin descripción</span>}</div>
              <div className="disc-stats">
                <div><div className="n">{d.teachers}</div><div className="l">Profesores</div></div>
                <div><div className="n">{d.students}</div><div className="l">Estudiantes</div></div>
                <div><div className="n">{d.upcoming_classes}</div><div className="l">Próx. clases</div></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card pad-l">
          <EmptyState icon="bolt" title="Aún no hay disciplinas" desc="Crea las modalidades o deportes que ofrece el estudio (Pilates, Yoga, Boxeo…). Son la base para profesores, clases y planes." />
          <div style={{ textAlign: 'center' }}>
            <button className="btn btn-pulse" onClick={() => open(<DisciplineSheet existing={names} />)}><Icon name="plus" size={15} /> Crear la primera disciplina</button>
          </div>
        </div>
      )}
    </>
  );
}
