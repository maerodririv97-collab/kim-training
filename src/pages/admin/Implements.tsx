import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import type { Implement, ImplementKind, ImplementSchedule } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, EmptyState, ErrorState, Field, Loading, SheetHead, useSheet } from '../../components/ui';
import { addDays, dateKey, fmtDayShort, fmtTime, todayKey } from '../../lib/format';
import { useDisciplines, useDone, useImplements, usePlans } from './hooks';

export const KIND_LABEL: Record<ImplementKind, string> = { loan: 'Préstamo', rent: 'Alquiler' };

const SUGGESTIONS = ['Moto', 'Bicicleta', 'Guantes', 'Colchoneta', 'Mancuernas', 'Reformer', 'Kettlebell', 'Banda elástica'];

/** Semáforo de disponibilidad: libre, pocas unidades o agotado. */
function stockBadge(available: number, quantity: number) {
  if (available <= 0) return <Badge kind="full" label="Agotado" />;
  if (available <= Math.max(1, Math.floor(quantity * 0.2))) return <Badge kind="low" label={`Quedan ${available}`} />;
  return <Badge kind="open" label={`${available} libres`} />;
}

function ImplementSheet({ implement, existing = [] }: { implement?: Implement; existing?: string[] }) {
  const done = useDone();
  const disciplines = useDisciplines();
  const [f, setF] = useState({
    name: implement?.name ?? '',
    description: implement?.description ?? '',
    kind: implement?.kind ?? ('rent' as ImplementKind),
    quantity: implement?.quantity ?? 10,
    active: implement?.active ?? true,
  });
  const [chosen, setChosen] = useState<number[]>(implement?.discipline_ids ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, discipline_ids: chosen };
      return implement ? api.put(`/admin/implements/${implement.id}`, body) : api.post('/admin/implements', body);
    },
    onSuccess: () => done(implement ? 'Implemento actualizado' : `Implemento "${f.name.trim()}" creado`),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/admin/implements/${implement!.id}`),
    onSuccess: () => done('Implemento eliminado'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const suggestions = implement ? [] : SUGGESTIONS.filter((s) => !taken.has(s.toLowerCase())).slice(0, 6);
  const err = save.error ?? remove.error;
  const overbooked = implement && f.quantity < implement.peak_used;

  return (
    <form onSubmit={submit}>
      <SheetHead title={implement ? 'Editar implemento' : 'Nuevo implemento'} />
      {err && <div className="form-error">{err.message}</div>}

      <Field label="Nombre">
        <input value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Moto, Guantes, Reformer…" required autoFocus={!implement} />
      </Field>
      {suggestions.length > 0 && !f.name && (
        <div className="chip-row" style={{ flexWrap: 'wrap', marginTop: -6, marginBottom: 14 }}>
          {suggestions.map((s) => <button type="button" key={s} className="chip" onClick={() => setF({ ...f, name: s })}>{s}</button>)}
        </div>
      )}
      <div className="form-grid">
        <Field label="Tipo">
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ImplementKind })}>
            <option value="rent">Alquiler</option>
            <option value="loan">Préstamo</option>
          </select>
        </Field>
        <Field label="Unidades disponibles">
          <input type="number" min={0} max={1000} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} required />
        </Field>
      </div>
      {overbooked && (
        <p className="form-error" style={{ marginTop: -6 }}>
          Hay horarios de los próximos días con {implement.peak_used} unidades apartadas. Esas reservas se respetan, pero no se podrán hacer nuevas hasta que se liberen.
        </p>
      )}
      <Field label="Descripción (opcional)">
        <textarea value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ej. Bicicleta estática de la sala de spinning." />
      </Field>
      <div className="form-field">
        <label>Se usa en clases de (vacío = todas las disciplinas)</label>
        {(disciplines.data ?? []).filter((d) => d.active || chosen.includes(d.id)).map((d) => (
          <label key={d.id} className="check-row">
            <input type="checkbox" checked={chosen.includes(d.id)}
              onChange={() => setChosen((c) => (c.includes(d.id) ? c.filter((x) => x !== d.id) : [...c, d.id]))} />
            <DiscTag name={d.name} color={d.color} />
          </label>
        ))}
      </div>
      {implement && (
        <label className="check-row" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Activo (si se desactiva, las reservas nuevas no apartan unidades)
        </label>
      )}
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Para cobrarlo, inclúyelo en un plan desde <strong>Planes y promos</strong>. Cada reserva con ese plan aparta una unidad.
      </p>
      <button type="submit" className="btn btn-pulse btn-block" disabled={save.isPending}>
        {save.isPending ? <span className="spinner" /> : implement ? 'Guardar cambios' : 'Crear implemento'}
      </button>

      {implement && (confirmDelete ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setConfirmDelete(false)}>No, volver</button>
          <button type="button" className="btn btn-danger-ghost btn-block" disabled={remove.isPending} onClick={() => remove.mutate()}>Sí, eliminar</button>
        </div>
      ) : (
        <button type="button" className="btn btn-danger-ghost btn-block" style={{ marginTop: 10 }} onClick={() => setConfirmDelete(true)}>Eliminar implemento</button>
      ))}
    </form>
  );
}

/** Disponibilidad clase por clase en los próximos 7 días. */
function ScheduleSheet({ implement }: { implement: Implement }) {
  const { open } = useSheet();
  const [from, setFrom] = useState(todayKey());
  const to = addDays(from, 6);
  const { data, isLoading, error } = useQuery({
    queryKey: ['implement-schedule', implement.id, from],
    queryFn: () => api.get<ImplementSchedule>(`/admin/implements/${implement.id}/schedule${qs({ from, to })}`),
  });
  return (
    <>
      <SheetHead title={`${implement.name} · disponibilidad`} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFrom(addDays(from, -7))}>‹</button>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 700 }}>{fmtDayShort(from)} – {fmtDayShort(to)}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFrom(addDays(from, 7))}>›</button>
      </div>
      {isLoading ? <Loading /> : error || !data ? <ErrorState error={error} /> : data.classes.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {data.classes.map((c) => (
            <div key={c.class_id} className="mini-row" style={{ padding: '10px 4px', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <strong style={{ fontSize: 13.5 }}>{fmtDayShort(dateKey(c.starts_at))} · {fmtTime(c.starts_at)}</strong>
                  <DiscTag name={c.discipline} color={c.color} />
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {c.teacher} · {c.location} · {c.booked}/{c.capacity} reservados · {c.in_class} con {implement.name.toLowerCase()}
                  {c.used > c.in_class && ` · ${c.used - c.in_class} en clases a la misma hora`}
                </div>
              </div>
              <div className="mono" style={{ fontSize: 12.5, marginRight: 6 }}>{c.used}/{data.implement.quantity}</div>
              {stockBadge(c.available, data.implement.quantity)}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13, padding: '10px 0' }}>No hay clases en este rango donde se use este implemento.</p>
      )}
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 14 }} onClick={() => open(<ImplementSheet implement={implement} />)}>Editar implemento</button>
    </>
  );
}

export function AdminImplements() {
  const { open } = useSheet();
  const { data, isLoading, error, refetch } = useImplements();
  const disciplines = useDisciplines();
  const plans = usePlans();
  const names = (data ?? []).map((i) => i.name);
  const discNames = (ids: number[]) =>
    ids.length ? ids.map((id) => disciplines.data?.find((d) => d.id === id)?.name).filter(Boolean).join(', ') : 'Todas las disciplinas';
  const planNames = (ids: number[]) => ids.map((id) => plans.data?.find((p) => p.id === id)?.name).filter(Boolean).join(', ');

  return (
    <>
      <div className="greet">
        <div>
          <h1>Implementos</h1>
          <p>Equipos que se prestan o alquilan en las clases y cuántos quedan por horario</p>
        </div>
        <button className="btn btn-primary" onClick={() => open(<ImplementSheet existing={names} />)}><Icon name="plus" size={15} /> Nuevo implemento</button>
      </div>

      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : data?.length ? (
        <div className="grid-3">
          {data.map((i) => (
            <div key={i.id} className="card disc-card" style={{ opacity: i.active ? 1 : 0.6 }} onClick={() => open(<ScheduleSheet implement={i} />)}>
              <div className="disc-head">
                <span className="disc-sw tag-c-blue"><Icon name="box" size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4>{i.name}</h4>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Badge kind="booked" label={KIND_LABEL[i.kind]} />
                    {i.active ? stockBadge(i.quantity - i.peak_used, i.quantity) : <Badge kind="done" label="Inactivo" />}
                  </div>
                </div>
              </div>
              <div className="desc">
                {discNames(i.discipline_ids)}
                {i.plan_ids.length > 0 ? ` · Planes: ${planNames(i.plan_ids)}` : ' · Aún no está en ningún plan'}
              </div>
              <div className="disc-stats">
                <div><div className="n">{i.quantity}</div><div className="l">Unidades</div></div>
                <div><div className="n">{i.peak_used}</div><div className="l">Pico 7 días</div></div>
                <div><div className="n">{i.active_students}</div><div className="l">Estudiantes</div></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card pad-l">
          <EmptyState icon="box" title="Aún no hay implementos" desc="Registra los equipos que el estudio presta o alquila (motos, guantes, reformers…) con la cantidad disponible. Luego inclúyelos en un plan." />
          <div style={{ textAlign: 'center' }}>
            <button className="btn btn-pulse" onClick={() => open(<ImplementSheet existing={names} />)}><Icon name="plus" size={15} /> Crear el primer implemento</button>
          </div>
        </div>
      )}
    </>
  );
}
