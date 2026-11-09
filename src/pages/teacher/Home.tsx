import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { ClassItem, TeacherOverview } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Badge, DiscTag, EmptyState, ErrorState, Loading, occStatus, useSheet } from '../../components/ui';
import { dateKey, firstName, fmtLongDate, fmtRelativeDay, fmtTime } from '../../lib/format';
import { AttendeesSheet } from '../admin/ClassSheets';

export function TeacherClassCard({ c, showDay }: { c: ClassItem; showDay?: boolean }) {
  const { open } = useSheet();
  const started = new Date(c.starts_at) <= new Date();
  return (
    <div className={`class-card${c.cancelled ? ' is-cancelled' : ''}`}>
      <div className="time-block"><div className="t">{fmtTime(c.starts_at)}</div><div className="d">{c.duration_min} min</div></div>
      <div className="body">
        <DiscTag name={c.discipline} color={c.color} upper />
        <h4 style={{ marginTop: 6 }}>{c.discipline}{c.level !== 'Todos' ? ` · Nivel ${c.level.toLowerCase()}` : ''}</h4>
        <div className="sub">
          <span><Icon name="location" size={12} /> {c.location}</span>
          {showDay && <span><Icon name="calendar" size={12} /> {fmtRelativeDay(dateKey(c.starts_at))}</span>}
          {c.waitlist > 0 && <span>{c.waitlist} en espera</span>}
        </div>
      </div>
      <div className="right">
        {c.cancelled ? <Badge kind="cancel" /> : <Badge kind={occStatus(c)} />}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{c.booked}/{c.capacity} cupos</div>
        <button className={`btn btn-sm ${started && !c.cancelled ? 'btn-pulse' : 'btn-ghost'}`} onClick={() => open(<AttendeesSheet classId={c.id} mode="teacher" />)}>
          {started && !c.cancelled ? 'Tomar asistencia' : 'Asistentes'}
        </button>
      </div>
    </div>
  );
}

export function TeacherHome() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['teacher-overview'],
    queryFn: () => api.get<TeacherOverview>('/teacher/overview'),
    refetchInterval: 60_000,
  });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const longDate = fmtLongDate(data.today);
  const studentsToday = data.today_classes.filter((c) => !c.cancelled).reduce((a, c) => a + c.booked, 0);

  return (
    <>
      <div className="greet">
        <div>
          <h1>Hola, {firstName(data.teacher.name)} 👋</h1>
          <p>{longDate.charAt(0).toUpperCase() + longDate.slice(1)}</p>
        </div>
        <div className="avatar">{data.teacher.initials}</div>
      </div>

      <div className="grid-4">
        <div className="stat-box"><div className="num">{data.today_classes.filter((c) => !c.cancelled).length}</div><div className="lbl">Clases hoy</div></div>
        <div className="stat-box"><div className="num">{studentsToday}</div><div className="lbl">Estudiantes hoy</div></div>
        <div className="stat-box"><div className="num">{data.week_classes.filter((c) => !c.cancelled).length}</div><div className="lbl">Próximos 7 días</div></div>
        <div className="stat-box"><div className="num">{data.pending_attendance}</div><div className="lbl">Asistencias por marcar</div></div>
      </div>

      {data.disciplines.length > 0 && (
        <div className="tag-list" style={{ marginTop: 14 }}>
          {data.disciplines.map((d) => <DiscTag key={d.id} name={d.name} color={d.color} />)}
        </div>
      )}

      <div className="section-title"><h3>Tus clases de hoy</h3></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.today_classes.length
          ? data.today_classes.map((c) => <TeacherClassCard key={c.id} c={c} />)
          : <EmptyState icon="calendar" title="Sin clases hoy" desc="No tienes clases programadas para hoy." />}
      </div>

      <div className="section-title">
        <h3>Próximos 7 días</h3>
        <Link className="link" to="/profesor/clases">Ver calendario <Icon name="chevron" size={13} /></Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.week_classes.length
          ? data.week_classes.map((c) => <TeacherClassCard key={c.id} c={c} showDay />)
          : <EmptyState icon="clock" title="Sin clases próximas" desc="El administrador aún no te ha asignado clases esta semana." />}
      </div>
    </>
  );
}
