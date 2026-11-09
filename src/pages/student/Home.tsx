import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api/client';
import type { ClassItem, Overview } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, Dial, DiscTag, EmptyState, ErrorState, Loading, useSheet } from '../../components/ui';
import { dateKey, firstName, fmtDate, fmtRelativeDay, fmtTime } from '../../lib/format';
import { CancelSheet, ClassDetailSheet, RescheduleSheet } from './sheets';

export function ReservedClassCard({ c }: { c: ClassItem }) {
  const { open } = useSheet();
  const waiting = c.my_status === 'waitlist';
  return (
    <div className="class-card">
      <div className="time-block"><div className="t">{fmtTime(c.starts_at)}</div><div className="d">{c.duration_min} min</div></div>
      <div className="body">
        <DiscTag name={c.discipline} color={c.color} />
        <h4 style={{ marginTop: 6 }}>{c.discipline}</h4>
        <div className="sub">
          <span><Icon name="user" size={12} /> {c.teacher}</span>
          <span><Icon name="location" size={12} /> {c.location}</span>
          <span><Icon name="calendar" size={12} /> {fmtRelativeDay(dateKey(c.starts_at))}</span>
        </div>
      </div>
      <div className="right">
        <Badge kind={waiting ? 'wait' : 'booked'} />
        <div className="row-actions">
          {waiting ? (
            <button className="btn btn-ghost btn-sm" onClick={() => open(<ClassDetailSheet classId={c.id} />)}>Detalle</button>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => open(<RescheduleSheet bookingId={c.my_booking_id!} c={c} />)}>Reprogramar</button>
              <button className="btn btn-danger-ghost btn-sm" onClick={() => open(<CancelSheet bookingId={c.my_booking_id!} c={c} />)}>Cancelar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function StudentHome() {
  const navigate = useNavigate();
  const { open } = useSheet();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/me/overview') });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;

  const next = data.upcoming.find((c) => c.my_status === 'booked');
  const plan = data.plan;
  const pct = plan ? Math.round((plan.used / plan.total_classes) * 100) : 0;

  return (
    <>
      <div className="greet">
        <div><h1>Hola, {firstName(data.student.name)} 👋</h1><p>Aquí tienes tu resumen de hoy</p></div>
        <div className="avatar">{data.student.initials}</div>
      </div>

      {next ? (
        <div className="hero-next">
          <div className="eyebrow">Tu próxima clase</div>
          <h2>{next.discipline} — {next.teacher}</h2>
          <div className="meta">
            <span><Icon name="calendar" size={15} /> {fmtRelativeDay(dateKey(next.starts_at))}</span>
            <span><Icon name="clock" size={15} /> {fmtTime(next.starts_at)} · {next.duration_min} min</span>
            <span><Icon name="location" size={15} /> {next.location}</span>
          </div>
          <div className="actions">
            <button className="btn btn-pulse" onClick={() => open(<ClassDetailSheet classId={next.id} />)}>Ver detalle</button>
            <button className="btn btn-ghost" style={{ background: 'transparent', borderColor: 'rgba(255,255,255,.3)', color: '#fff' }}
              onClick={() => open(<RescheduleSheet bookingId={next.my_booking_id!} c={next} />)}>Reprogramar</button>
          </div>
        </div>
      ) : (
        <div className="hero-next">
          <div className="eyebrow">Tu próxima clase</div>
          <h2>Aún no tienes clases reservadas</h2>
          <div className="meta"><span>Explora la agenda y aparta tu cupo.</span></div>
          <div className="actions">
            <button className="btn btn-pulse" onClick={() => navigate('/agenda')}>Ver agenda</button>
          </div>
        </div>
      )}

      <div className="section-title"><h3>Tu plan actual</h3></div>
      {plan ? (
        <div className="card pad-l plan-card">
          <Dial percent={pct} size={74} stroke={7} color="--teal" />
          <div className="info">
            <div style={{ fontWeight: 800, fontSize: 15 }}>{plan.name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {plan.used} / {plan.total_classes} clases utilizadas
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <strong style={{ color: 'var(--pulse-dark)' }}>{plan.remaining} clases disponibles</strong> · vence {fmtDate(plan.ends_on)}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/agenda')}>Reservar clase</button>
        </div>
      ) : (
        <div className="card pad-l">
          <EmptyState icon="wallet" title="No tienes un plan vigente" desc="Comunícate con el estudio para activar o renovar tu plan y poder reservar clases." />
        </div>
      )}

      <div className="section-title">
        <h3>Próximas clases</h3>
        <Link className="link" to="/mis-clases">Ver todas <Icon name="chevron" size={13} /></Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.upcoming.length
          ? data.upcoming.slice(0, 5).map((c) => <ReservedClassCard key={c.id} c={c} />)
          : <EmptyState icon="calendar" title="Sin reservas próximas" desc="Explora la agenda y reserva tu próxima clase." />}
      </div>

      <div className="section-title"><h3>Accesos rápidos</h3></div>
      <div className="quick-grid">
        <button className="quick-btn" onClick={() => navigate('/agenda')}><span className="qicon" style={{ background: 'var(--pulse-tint)', color: 'var(--pulse-dark)' }}><Icon name="calendar" /></span><span>Reservar clase</span></button>
        <button className="quick-btn" onClick={() => navigate('/mis-clases')}><span className="qicon" style={{ background: 'var(--teal-tint)', color: 'var(--teal)' }}><Icon name="clock" /></span><span>Mi calendario</span></button>
        <button className="quick-btn" onClick={() => navigate('/perfil')}><span className="qicon" style={{ background: 'var(--volt-tint)', color: 'var(--volt-dark)' }}><Icon name="wallet" /></span><span>Mis planes</span></button>
        <button className="quick-btn" onClick={() => navigate('/progreso')}><span className="qicon" style={{ background: 'var(--violet-tint)', color: 'var(--violet)' }}><Icon name="trend" /></span><span>Mi progreso</span></button>
      </div>
    </>
  );
}
