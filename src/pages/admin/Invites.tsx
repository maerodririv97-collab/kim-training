import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Invite } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, Field, Loading, SheetHead, useToast } from '../../components/ui';
import { dateKey, fmtDate } from '../../lib/format';
import { useDisciplines, useDone } from './hooks';

export const inviteUrl = (token: string) => `${window.location.origin}/registro/${token}`;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyLink({ token }: { token: string }) {
  const toast = useToast();
  const url = inviteUrl(token);
  const shareText = `Te invito a registrarte en KIM Solutions - Training: ${url}`;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <input readOnly value={url} onFocus={(e) => e.target.select()}
        style={{ flex: '1 1 220px', minWidth: 0, padding: '9px 11px', borderRadius: 10, border: '1px solid var(--line)', fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--paper)' }} />
      <button type="button" className="btn btn-primary btn-sm" onClick={async () => toast((await copy(url)) ? 'Enlace copiado' : 'No se pudo copiar; selecciónalo y cópialo', 'check')}>
        Copiar
      </button>
      <a className="btn btn-ghost btn-sm" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
        WhatsApp
      </a>
    </div>
  );
}

function NewInviteForm({ onCreated }: { onCreated: (token: string) => void }) {
  const done = useDone();
  const disciplines = useDisciplines();
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(7);
  const [maxUses, setMaxUses] = useState<number | ''>('');
  const [chosen, setChosen] = useState<number[]>([]);
  const m = useMutation({
    mutationFn: () => api.post<{ id: number; token: string }>('/admin/invites', {
      label, expires_days: days, max_uses: maxUses === '' ? null : maxUses, discipline_ids: chosen,
    }),
    onSuccess: (r) => { onCreated(r.token); done('Enlace de invitación creado', { keepOpen: true }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };
  const active = (disciplines.data ?? []).filter((d) => d.active);

  return (
    <form onSubmit={submit} className="pad-m" style={{ border: '1px dashed var(--line)', borderRadius: 'var(--radius-m)' }}>
      <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 10 }}>Nuevo enlace</div>
      {m.error && <div className="form-error">{m.error.message}</div>}
      <Field label="Nombre interno (opcional)">
        <input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="Ej. Grupo Stunt noviembre" />
      </Field>
      <div className="form-grid">
        <Field label="Vigencia">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 día</option>
            <option value={7}>7 días</option>
            <option value={15}>15 días</option>
            <option value={30}>30 días</option>
            <option value={90}>90 días</option>
          </select>
        </Field>
        <Field label="Máximo de registros">
          <select value={maxUses} onChange={(e) => setMaxUses(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Sin límite</option>
            <option value={1}>1 persona</option>
            <option value={5}>5 personas</option>
            <option value={10}>10 personas</option>
            <option value={30}>30 personas</option>
            <option value={100}>100 personas</option>
          </select>
        </Field>
      </div>
      {active.length > 0 && (
        <div className="form-field">
          <label>Disciplinas que quedarán habilitadas (opcional)</label>
          <div className="tag-list">
            {active.map((d) => {
              const on = chosen.includes(d.id);
              return (
                <button type="button" key={d.id} className={`disc-tag tag-c-${d.color}`}
                  style={{ cursor: 'pointer', border: on ? '2px solid var(--ink)' : '2px solid transparent', opacity: on ? 1 : 0.6, fontSize: 12, padding: '6px 10px' }}
                  onClick={() => setChosen((c) => (on ? c.filter((x) => x !== d.id) : [...c, d.id]))}>
                  {on && '✓ '}{d.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <p className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        Quien se registre quedará sin plan; tú se lo asignas después desde su perfil.
      </p>
      <button type="submit" className="btn btn-pulse btn-block" disabled={m.isPending}>{m.isPending ? <span className="spinner" /> : 'Generar enlace'}</button>
    </form>
  );
}

function RevokeButton({ id }: { id: number }) {
  const done = useDone();
  const [confirm, setConfirm] = useState(false);
  const m = useMutation({ mutationFn: () => api.post(`/admin/invites/${id}/revoke`), onSuccess: () => done('Enlace desactivado', { keepOpen: true }) });
  if (!confirm) return <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setConfirm(true)}>Desactivar</button>;
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>No</button>
      <button type="button" className="btn btn-danger-ghost btn-sm" disabled={m.isPending} onClick={() => m.mutate()}>Sí, desactivar</button>
    </span>
  );
}

function inviteStatus(i: Invite): { kind: 'open' | 'done' | 'cancel'; label: string } {
  if (i.revoked) return { kind: 'cancel', label: 'Desactivado' };
  if (new Date(i.expires_at) <= new Date()) return { kind: 'done', label: 'Vencido' };
  if (i.max_uses !== null && i.uses >= i.max_uses) return { kind: 'done', label: 'Completo' };
  return { kind: 'open', label: 'Activo' };
}

export function InvitesSheet() {
  const [fresh, setFresh] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['invites'], queryFn: () => api.get<Invite[]>('/admin/invites') });

  return (
    <>
      <SheetHead title="Invitar estudiantes" />
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Comparte un enlace para que los estudiantes creen su propia cuenta. Podrán reservar cuando les asignes un plan.
      </p>

      {fresh && (
        <div className="deduct-box" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="check" size={16} /> <strong style={{ display: 'inline' }}>Enlace listo para compartir</strong></p>
          <CopyLink token={fresh} />
        </div>
      )}

      {showForm || (!isLoading && !data?.length) ? (
        <NewInviteForm onCreated={(t) => { setFresh(t); setShowForm(false); }} />
      ) : (
        <button type="button" className="btn btn-pulse btn-block" onClick={() => { setShowForm(true); setFresh(null); }}>
          <Icon name="plus" size={15} /> Generar nuevo enlace
        </button>
      )}

      <div className="section-title" style={{ margin: '22px 0 8px' }}><h3 style={{ fontSize: 14 }}>Enlaces creados</h3></div>
      {isLoading ? <Loading /> : data?.length ? data.map((i) => {
        const st = inviteStatus(i);
        return (
          <div key={i.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line-soft)', opacity: st.kind === 'open' ? 1 : 0.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <strong style={{ fontSize: 13.5 }}>{i.label || `Enlace del ${fmtDate(dateKey(i.created_at))}`}</strong>
              <Badge kind={st.kind} label={st.label} />
            </div>
            <div className="muted mono" style={{ fontSize: 11.5, marginBottom: 6 }}>
              {i.uses}{i.max_uses !== null ? `/${i.max_uses}` : ''} registros · vence {fmtDate(dateKey(i.expires_at))}
              {i.pending_plan > 0 && <span style={{ color: '#8A5A0F' }}> · {i.pending_plan} sin plan</span>}
            </div>
            {i.disciplines.length > 0 && (
              <div className="tag-list" style={{ marginBottom: 8 }}>{i.disciplines.map((d) => <DiscTag key={d.id} name={d.name} color={d.color} />)}</div>
            )}
            {st.kind === 'open' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <CopyLink token={i.token} />
                <div><RevokeButton id={i.id} /></div>
              </div>
            )}
          </div>
        );
      }) : <p className="muted" style={{ fontSize: 12.5 }}>Aún no has creado enlaces.</p>}
    </>
  );
}
