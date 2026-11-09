import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ApiError, api } from '../api/client';
import type { InviteInfo, Me } from '../api/types';
import { Icon } from '../components/Icon';
import { DiscTag, Loading, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { dateKey, firstName, fmtDate } from '../lib/format';
import { homeFor } from '../lib/roles';

function Brand() {
  return <div className="login-logo"><img src="/logo-kim.png" alt="KIM Solutions" /><span className="brand-sub">Training</span></div>;
}

export function RegisterPage() {
  const { token = '' } = useParams();
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InviteInfo>(`/invites/${encodeURIComponent(token)}`),
    retry: false,
  });
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', phone: '', birth_date: '', goal: '' });
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  if (me) return <Navigate to={homeFor(me)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (f.password !== f.confirm) return setError('Las contraseñas no coinciden');
    setLoading(true);
    try {
      const profile = await api.post<Me>(`/invites/${encodeURIComponent(token)}/register`, {
        name: f.name, email: f.email, password: f.password, phone: f.phone, birth_date: f.birth_date, goal: f.goal,
      });
      setMe(profile);
      toast(`¡Bienvenido, ${firstName(profile.user.name)}!`);
      navigate('/inicio', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
      if (err instanceof ApiError && err.code === 'invite_invalid') invite.refetch();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-visual">
        <div className="glow glow-1" />
        <div className="glow glow-2" />
        <div className="lv-brand"><span className="lv-logo"><img src="/logo-kim.png" alt="KIM Solutions" /></span><span>Training</span></div>
        <div className="lv-msg">
          <div className="eyebrow">Bienestar · Movimiento · Comunidad</div>
          <h2>Tu entrenamiento empieza aquí.</h2>
          <p>Crea tu cuenta para reservar clases, seguir tu progreso y recibir las novedades del estudio.</p>
        </div>
        <div />
      </div>

      <div className="login-form-col">
        <div className="login-card">
          <Brand />
          {invite.isLoading ? <Loading /> : invite.error ? (
            <>
              <h1>Enlace no válido</h1>
              <p className="sub">{invite.error.message}</p>
              <Link className="btn btn-ghost btn-block" to="/login">Ir a iniciar sesión</Link>
            </>
          ) : (
            <form onSubmit={submit}>
              <h1>Crea tu cuenta 🏁</h1>
              <p className="sub">
                {invite.data?.label ? <><strong style={{ color: 'var(--ink)' }}>{invite.data.label}</strong> · </> : null}
                Te invitaron a KIM Solutions - Training. Este enlace vence el {fmtDate(dateKey(invite.data!.expires_at))}.
              </p>
              {invite.data!.disciplines.length > 0 && (
                <div style={{ marginTop: -12, marginBottom: 18 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Tendrás acceso a:</div>
                  <div className="tag-list">{invite.data!.disciplines.map((d) => <DiscTag key={d.name} name={d.name} color={d.color} />)}</div>
                </div>
              )}

              {error && <div className="lf-banner show"><Icon name="x" size={15} /><span>{error}</span></div>}

              <div className="lf-field">
                <label htmlFor="rName">Nombre completo</label>
                <div className="lf-input-wrap"><input id="rName" autoComplete="name" value={f.name} onChange={(e) => set('name', e.target.value)} required minLength={3} /></div>
              </div>
              <div className="lf-field">
                <label htmlFor="rEmail">Correo electrónico</label>
                <div className="lf-input-wrap"><input id="rEmail" type="email" autoComplete="email" placeholder="correo@ejemplo.com" value={f.email} onChange={(e) => set('email', e.target.value)} required /></div>
              </div>
              <div className="lf-field">
                <label htmlFor="rPass">Contraseña (mínimo 8 caracteres)</label>
                <div className="lf-input-wrap">
                  <input id="rPass" type={showPass ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} required minLength={8} />
                  <button type="button" className="toggle-eye" onClick={() => setShowPass((v) => !v)} aria-label="Mostrar contraseña"><Icon name={showPass ? 'eyeOff' : 'eye'} size={17} /></button>
                </div>
              </div>
              <div className="lf-field">
                <label htmlFor="rConfirm">Confirmar contraseña</label>
                <div className="lf-input-wrap"><input id="rConfirm" type={showPass ? 'text' : 'password'} autoComplete="new-password" value={f.confirm} onChange={(e) => set('confirm', e.target.value)} required /></div>
              </div>
              <div className="form-grid">
                <div className="lf-field">
                  <label htmlFor="rPhone">Teléfono (opcional)</label>
                  <div className="lf-input-wrap"><input id="rPhone" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
                </div>
                <div className="lf-field">
                  <label htmlFor="rBirth">Fecha de nacimiento (opcional)</label>
                  <div className="lf-input-wrap"><input id="rBirth" type="date" value={f.birth_date} onChange={(e) => set('birth_date', e.target.value)} /></div>
                </div>
              </div>
              <div className="lf-field">
                <label htmlFor="rGoal">Tu objetivo (opcional)</label>
                <div className="lf-input-wrap"><input id="rGoal" placeholder="Ej. Mejorar mi técnica" value={f.goal} onChange={(e) => set('goal', e.target.value)} /></div>
              </div>

              <button type="submit" className="btn btn-pulse btn-block" disabled={loading}>
                {loading ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="spinner" />Creando cuenta...</span> : 'Crear mi cuenta'}
              </button>
              <p className="muted" style={{ fontSize: 12, marginTop: 14, textAlign: 'center' }}>
                ¿Ya tienes cuenta? <Link className="lf-link" to="/login">Inicia sesión</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
