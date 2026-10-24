import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import type { AccountGateProps, StoredWorkspace } from '../workspace-types';
import { validStoredWorkspace } from '../workspace-types';
import './account-gate.css';

type Phase = 'loading' | 'error' | 'login' | 'setup' | 'ready';
interface ReadyState { authRequired: boolean; user: { username: string } | null; initialWorkspace: StoredWorkspace | null; initialRevision: number }
const localSession: ReadyState = { authRequired: false, user: null, initialWorkspace: null, initialRevision: 0 };
const standalone = window.location.protocol === 'file:' || Boolean((window as Window & { __CAP_STANDALONE__?: boolean }).__CAP_STANDALONE__);

async function apiJson(path: string, options: RequestInit = {}) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body && typeof body.error === 'string' ? body.error : 'La connexion au serveur n’a pas abouti. Réessayez dans un instant.');
  return body;
}

export default function AccountGate({ children }: AccountGateProps) {
  const [phase, setPhase] = useState<Phase>(standalone ? 'ready' : 'loading');
  const [ready, setReady] = useState<ReadyState>(localSession);
  const [setupAvailable, setSetupAvailable] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);

  const refreshSession = useCallback(async () => {
    if (standalone) { setReady(localSession); setPhase('ready'); return; }
    const id = ++generation.current;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPhase('loading'); setError('');
    try {
      const session = await apiJson('/api/auth/session', { signal: current.signal });
      if (!session || typeof session.authenticated !== 'boolean' || typeof session.authRequired !== 'boolean') throw new Error('Le serveur n’a pas renvoyé un état de connexion valide.');
      if (id !== generation.current) return;
      if (!session.authRequired) { setReady(localSession); setPhase('ready'); return; }
      if (!session.authenticated) {
        setSetupAvailable(session.setupAvailable === true);
        setPhase(session.setupRequired ? 'setup' : 'login');
        return;
      }
      if (!session.user || typeof session.user.username !== 'string' || !session.user.username.trim()) throw new Error('Le profil de connexion est incomplet.');
      const remote = await apiJson('/api/workspace', { signal: current.signal });
      if (!remote || !Number.isSafeInteger(remote.revision) || remote.revision < 0 || (remote.workspace !== null && !validStoredWorkspace(remote.workspace))) throw new Error('La sauvegarde reçue ne peut pas être chargée. Vos données n’ont pas été remplacées.');
      if (id === generation.current) {
        setReady({ authRequired: true, user: { username: session.user.username }, initialWorkspace: remote.workspace, initialRevision: remote.revision });
        setPhase('ready');
      }
    } catch (problem) {
      if (id !== generation.current || current.signal.aborted) return;
      setError(problem instanceof Error && !['TypeError', 'TimeoutError'].includes(problem.name) ? problem.message : 'Le serveur est inaccessible. Vérifiez votre connexion puis réessayez.');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void refreshSession();
    return () => { active.current = false; generation.current += 1; controller.current?.abort(); };
  }, [refreshSession]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (phase === 'setup' && password !== confirmation) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    setBusy(true); setError('');
    const id = ++generation.current;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      await apiJson(phase === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: current.signal,
        body: JSON.stringify({ username: username.trim(), password, ...(phase === 'setup' ? { setupCode } : {}) }),
      });
      if (id !== generation.current) return;
      setPassword(''); setConfirmation(''); setSetupCode('');
      await refreshSession();
    } catch (problem) {
      if (id !== generation.current || current.signal.aborted) return;
      setError(problem instanceof Error && !['TypeError', 'TimeoutError'].includes(problem.name) ? problem.message : 'La connexion au serveur a été interrompue. Réessayez.');
    } finally { if (active.current) setBusy(false); }
  }

  const logout = useCallback(async () => {
    await apiJson('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    try { localStorage.removeItem('cap.workspace.v1'); } catch { /* The gate does not require local storage. */ }
    setReady(localSession); setPassword(''); setConfirmation(''); setSetupCode(''); setUsername('');
    await refreshSession();
  }, [refreshSession]);

  if (phase === 'ready') return <>{children({ ...ready, onLogout: logout })}</>;
  const setup = phase === 'setup';
  return <main className="account-gate">
    <div className="account-brand"><span><Sparkles size={27} /></span>cap<span className="account-brand-dot">.</span></div>
    <section className="account-card" aria-labelledby="account-heading">
      <span className="account-mark"><LockKeyhole size={25} /></span>
      {phase === 'loading' ? <div className="account-loading" role="status"><h1 id="account-heading">Retrouver votre espace.</h1><p>Nous vérifions votre connexion et votre dernière sauvegarde.</p><LoaderCircle size={23} className="account-spinner" /></div>
        : phase === 'error' ? <><p className="account-eyebrow">VOTRE ESPACE RESTE PRIVÉ</p><h1 id="account-heading">La connexion est interrompue.</h1><p className="account-error" role="alert">{error}</p><button className="account-button" onClick={() => void refreshSession()}><RefreshCw size={17} /> Réessayer la connexion</button><p className="account-footnote">Aucune donnée locale n’a été envoyée ou effacée pour contourner cette erreur.</p></>
        : <><p className="account-eyebrow">VOTRE VIE. VOTRE DIRECTION.</p><h1 id="account-heading">{setup ? 'Créons votre espace privé.' : 'Content de vous retrouver.'}</h1><p className="account-intro">{setup ? 'Choisissez vos identifiants pour accéder à CAP depuis vos appareils.' : 'Connectez-vous pour retrouver vos objectifs, votre budget et vos conversations.'}</p>
          {setup && !setupAvailable ? <><div className="account-unavailable"><KeyRound size={21} /><p>La création du compte doit d’abord être activée sur le serveur avec un code de configuration privé. Demandez à la personne qui héberge CAP de terminer cette étape.</p></div><button className="account-button" onClick={() => void refreshSession()}><RefreshCw size={16} /> Vérifier à nouveau</button></>
            : <form onSubmit={submit} className="account-form">
              <label htmlFor="account-username">Identifiant<input id="account-username" name="username" autoComplete="username" pattern="(?:[A-Za-z0-9_.@]|-){3,80}" title="3 à 80 caractères : lettres, chiffres, point, tiret, souligné ou @." minLength={3} maxLength={80} required value={username} disabled={busy} onChange={event => setUsername(event.target.value)} placeholder="Votre identifiant personnel" autoCapitalize="none" spellCheck={false} /></label>
              <label htmlFor="account-password">Mot de passe<input id="account-password" name="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 12 : undefined} maxLength={128} required value={password} disabled={busy} onChange={event => setPassword(event.target.value)} placeholder={setup ? 'Au moins 12 caractères' : 'Votre mot de passe'} /></label>
              {setup && <><label htmlFor="account-confirmation">Confirmer le mot de passe<input id="account-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label><label htmlFor="account-setup-code">Code de configuration privé<input id="account-setup-code" name="setupCode" type="password" autoComplete="off" minLength={16} maxLength={256} required value={setupCode} disabled={busy} onChange={event => setSetupCode(event.target.value)} placeholder="Fourni lors de la configuration du serveur" /></label><p className="account-field-note">Ce code sert une seule fois à créer le compte propriétaire. Il ne s’agit pas de votre clé IA.</p></>}
              {error && <p className="account-error" role="alert">{error}</p>}
              <button type="submit" className="account-button" disabled={busy}>{busy ? <><LoaderCircle size={17} className="account-spinner" /> Connexion en cours…</> : <>{setup ? 'Créer mon compte privé' : 'Entrer dans mon espace'}<ArrowRight size={17} /></>}</button>
            </form>}
          <div className="account-security"><ShieldCheck size={17} /><span>Vos identifiants restent privés. Ne partagez jamais votre mot de passe dans une conversation.</span></div>
        </>}
    </section>
    <p className="account-caption">Les grandes vies se construisent un petit pas à la fois.</p>
  </main>;
}
