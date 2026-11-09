import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { AdminPromotion, Plan } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, ErrorState, Field, Loading, SheetHead, useSheet } from '../../components/ui';
import { fmtDate, fmtMoney } from '../../lib/format';
import { useDisciplines, useDone, usePlans } from './hooks';

function PlanSheet({ plan }: { plan?: Plan }) {
  const done = useDone();
  const [f, setF] = useState({
    name: plan?.name ?? '', total_classes: plan?.total_classes ?? 12, duration_days: plan?.duration_days ?? 30,
    price: plan?.price ?? 0, active: plan?.active ?? true,
  });
  const m = useMutation({
    mutationFn: () => (plan ? api.put(`/admin/plans/${plan.id}`, f) : api.post('/admin/plans', f)),
    onSuccess: () => done(plan ? 'Plan actualizado' : 'Plan creado'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };
  return (
    <form onSubmit={submit}>
      <SheetHead title={plan ? 'Editar plan' : 'Nuevo plan'} />
      {m.error && <div className="form-error">{m.error.message}</div>}
      <Field label="Nombre"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <div className="form-grid">
        <Field label="Clases incluidas"><input type="number" min={1} value={f.total_classes} onChange={(e) => setF({ ...f, total_classes: Number(e.target.value) })} required /></Field>
        <Field label="Vigencia (días)"><input type="number" min={1} value={f.duration_days} onChange={(e) => setF({ ...f, duration_days: Number(e.target.value) })} required /></Field>
      </div>
      <Field label="Precio (COP)"><input type="number" min={0} step={1000} value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} required /></Field>
      <label className="check-row" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Disponible para asignar
      </label>
      {plan && <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Los cambios no afectan los planes ya asignados a estudiantes.</p>}
      <button type="submit" className="btn btn-pulse btn-block" disabled={m.isPending}>Guardar</button>
    </form>
  );
}

function PromotionSheet({ promo }: { promo?: AdminPromotion }) {
  const done = useDone();
  const disciplines = useDisciplines();
  const [f, setF] = useState({
    badge: promo?.badge ?? '', title: promo?.title ?? '', description: promo?.description ?? '',
    style: promo?.style ?? 'promo-1', expires_on: promo?.expires_on ?? '', active: promo?.active ?? true,
  });
  const [chosen, setChosen] = useState<number[]>(promo?.discipline_ids ?? []);
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, expires_on: f.expires_on || null, discipline_ids: chosen };
      return promo ? api.put(`/admin/promotions/${promo.id}`, body) : api.post('/admin/promotions', body);
    },
    onSuccess: () => done(promo ? 'Promoción actualizada' : 'Promoción creada'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };
  return (
    <form onSubmit={submit}>
      <SheetHead title={promo ? 'Editar promoción' : 'Nueva promoción'} />
      {m.error && <div className="form-error">{m.error.message}</div>}
      <div className={`promo-card ${f.style}`} style={{ minHeight: 110, marginBottom: 14 }}>
        <div><span className="p-badge">{f.badge || 'ETIQUETA'}</span><h4>{f.title || 'Título de la promoción'}</h4><p>{f.description}</p></div>
      </div>
      <div className="form-grid">
        <Field label="Etiqueta"><input value={f.badge} onChange={(e) => setF({ ...f, badge: e.target.value })} placeholder="20% OFF" required /></Field>
        <Field label="Estilo">
          <select value={f.style} onChange={(e) => setF({ ...f, style: e.target.value as AdminPromotion['style'] })}>
            <option value="promo-1">Verde</option><option value="promo-2">Naranja</option><option value="promo-3">Violeta</option>
          </select>
        </Field>
      </div>
      <Field label="Título"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
      <Field label="Descripción"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Vence (opcional)"><input type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} /></Field>
      <div className="form-field">
        <label>Visible para estudiantes de (vacío = todos)</label>
        {(disciplines.data ?? []).filter((d) => d.active || chosen.includes(d.id)).map((d) => (
          <label key={d.id} className="check-row">
            <input type="checkbox" checked={chosen.includes(d.id)}
              onChange={() => setChosen((c) => (c.includes(d.id) ? c.filter((x) => x !== d.id) : [...c, d.id]))} />
            <DiscTag name={d.name} color={d.color} />
          </label>
        ))}
      </div>
      <label className="check-row" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activa
      </label>
      <button type="submit" className="btn btn-pulse btn-block" disabled={m.isPending}>Guardar</button>
    </form>
  );
}

export function AdminCatalog() {
  const { open } = useSheet();
  const plans = usePlans();
  const disciplines = useDisciplines();
  const promos = useQuery({ queryKey: ['promotions'], queryFn: () => api.get<AdminPromotion[]>('/admin/promotions') });
  const discName = (id: number) => disciplines.data?.find((d) => d.id === id);

  return (
    <>
      <div className="greet"><h1>Planes y promociones</h1></div>

      <div className="section-title">
        <h3>Planes</h3>
        <button className="btn btn-primary btn-sm" onClick={() => open(<PlanSheet />)}><Icon name="plus" size={13} /> Nuevo plan</button>
      </div>
      {plans.isLoading ? <Loading /> : plans.error ? <ErrorState error={plans.error} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Plan</th><th>Clases</th><th>Vigencia</th><th>Precio</th><th>Estudiantes activos</th><th>Estado</th><th></th></tr></thead>
            <tbody>{plans.data?.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong></td><td className="mono">{p.total_classes}</td><td className="mono">{p.duration_days} días</td>
                <td className="mono">{fmtMoney(p.price)}</td><td className="mono">{p.active_students}</td>
                <td>{p.active ? <Badge kind="open" label="Activo" /> : <Badge kind="done" label="Inactivo" />}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => open(<PlanSheet plan={p} />)}>Editar</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="section-title">
        <h3>Promociones</h3>
        <button className="btn btn-primary btn-sm" onClick={() => open(<PromotionSheet />)}><Icon name="plus" size={13} /> Nueva promoción</button>
      </div>
      {promos.isLoading ? <Loading /> : promos.error ? <ErrorState error={promos.error} /> : (
        <div className="grid-3">
          {promos.data?.map((p) => (
            <div key={p.id} className={`promo-card ${p.style}`} style={{ opacity: p.active ? 1 : 0.55, cursor: 'pointer' }} onClick={() => open(<PromotionSheet promo={p} />)}>
              <div><span className="p-badge">{p.badge}</span><h4>{p.title}</h4><p>{p.description}</p></div>
              <div className="exp">
                {p.active ? '' : 'INACTIVA · '}{p.expires_on ? `Vence ${fmtDate(p.expires_on)}` : 'Sin fecha límite'}
                {' · '}{p.discipline_ids.length ? p.discipline_ids.map((id) => discName(id)?.name).filter(Boolean).join(', ') : 'Todos'}
              </div>
            </div>
          ))}
        </div>
      )}

    </>
  );
}
