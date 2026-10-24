import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, KeyRound, LoaderCircle } from 'lucide-react';
import './password-settings.css';

export default function PasswordSettings({ onSessionExpired }: { onSessionExpired?: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const currentRequest = useRef<AbortController | null>(null);
  useEffect(() => () => currentRequest.current?.abort(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setSuccess(false); setError('');
    if (newPassword !== confirmation) { setError('Les deux nouveaux mots de passe ne correspondent pas.'); return; }
    if (newPassword.length < 12 || newPassword.length > 128) { setError('Choisissez un nouveau mot de passe de 12 à 128 caractères.'); return; }
    if (newPassword === currentPassword) { setError('Choisissez un mot de passe différent du mot de passe actuel.'); return; }
    setBusy(true);
    const controller = new AbortController();
    currentRequest.current = controller;
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      });
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401 && body?.code === 'AUTH_REQUIRED') onSessionExpired?.();
        throw new Error(body && typeof body.error === 'string' ? body.error : 'Le mot de passe n’a pas pu être modifié. Réessayez dans un instant.');
      }
      setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setSuccess(true);
    } catch (problem) {
      if (controller.signal.aborted) return;
      setError(problem instanceof Error && !['TypeError', 'TimeoutError'].includes(problem.name) ? problem.message : 'Le serveur ne répond pas. Votre changement de mot de passe n’a pas été confirmé.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <section className="card settings-card password-settings" aria-labelledby="password-settings-heading">
    <div className="password-settings-title"><KeyRound size={18} /><h2 id="password-settings-heading">Mon mot de passe</h2></div>
    <p>Gardez un mot de passe unique pour votre espace personnel. Après le changement, les autres appareils devront se reconnecter.</p>
    <form onSubmit={submit}>
      <label htmlFor="current-password">Mot de passe actuel<input id="current-password" type="password" name="currentPassword" autoComplete="current-password" maxLength={128} required value={currentPassword} disabled={busy} onChange={event => setCurrentPassword(event.target.value)} /></label>
      <label htmlFor="new-password">Nouveau mot de passe<input id="new-password" type="password" name="newPassword" autoComplete="new-password" minLength={12} maxLength={128} required value={newPassword} disabled={busy} onChange={event => setNewPassword(event.target.value)} placeholder="Au moins 12 caractères" /></label>
      <label htmlFor="confirm-new-password">Confirmer le nouveau mot de passe<input id="confirm-new-password" type="password" name="confirmNewPassword" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
      {error && <p className="password-error" role="alert">{error}</p>}
      {success && <p className="password-success" role="status"><Check size={17} />Mot de passe modifié. Les autres sessions ont été déconnectées.</p>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={16} /> Modification en cours…</> : <><KeyRound size={16} /> Modifier mon mot de passe</>}</button>
    </form>
  </section>;
}
