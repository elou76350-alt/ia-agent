import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoredWorkspace } from './workspace-types';

export type SyncStatus = 'local' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';
interface Options { enabled: boolean; workspace: StoredWorkspace; initialRevision: number; onAuthExpired?: () => void }

export function useWorkspaceSync({ enabled, workspace, initialRevision, onAuthExpired }: Options) {
  const serialized = JSON.stringify(workspace);
  const [status, setStatus] = useState<SyncStatus>(enabled ? 'saved' : 'local');
  const [error, setError] = useState('');
  const latest = useRef(workspace);
  const latestJson = useRef(serialized);
  const savedJson = useRef(latestJson.current);
  const revision = useRef(initialRevision);
  const mounted = useRef(true);
  const enabledRef = useRef(enabled);
  const blocked = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authExpired = useRef(onAuthExpired);
  latest.current = workspace;
  latestJson.current = serialized;
  enabledRef.current = enabled;
  authExpired.current = onAuthExpired;

  const stopTimer = useCallback(() => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } }, []);

  const save = useCallback((): Promise<boolean> => {
    stopTimer();
    if (!enabledRef.current) return Promise.resolve(true);
    if (blocked.current || !mounted.current) return Promise.resolve(false);
    if (inFlight.current) return inFlight.current;
    if (latestJson.current === savedJson.current) return Promise.resolve(true);
    const task = (async () => {
      while (mounted.current && enabledRef.current && !blocked.current && latestJson.current !== savedJson.current) {
        const sent = latest.current;
        const sentJson = latestJson.current;
        const current = new AbortController();
        controller.current = current;
        setStatus('saving'); setError('');
        try {
          const response = await fetch('/api/workspace', {
            method: 'PUT', credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace: sent, expectedRevision: revision.current }),
            signal: AbortSignal.any([current.signal, AbortSignal.timeout(20000)]),
          });
          const body = await response.json().catch(() => null);
          if (!mounted.current || current.signal.aborted) return false;
          if (response.status === 401) {
            blocked.current = true; setStatus('error');
            setError('Votre session a expiré. Vos modifications récentes n’ont pas été synchronisées. Exportez-les avant de vous reconnecter.');
            authExpired.current?.();
            return false;
          }
          if (response.status === 409) {
            blocked.current = true; setStatus('conflict');
            setError('Votre espace a été modifié sur un autre appareil. Exportez vos changements locaux avant de charger la dernière sauvegarde.');
            return false;
          }
          if (!response.ok) throw new Error(body && typeof body.error === 'string' ? body.error : 'La sauvegarde n’a pas abouti. Vous pouvez réessayer.');
          if (!body || !Number.isSafeInteger(body.revision) || body.revision <= revision.current) throw new Error('La sauvegarde n’a pas pu être confirmée par le serveur.');
          revision.current = body.revision;
          savedJson.current = sentJson;
        } catch (problem) {
          if (!mounted.current || current.signal.aborted) return false;
          const offline = !navigator.onLine || problem instanceof TypeError;
          setStatus(offline ? 'offline' : 'error');
          setError(offline ? 'Vous êtes hors connexion ou le serveur est inaccessible. Vos changements attendent une connexion pour être sauvegardés.' : problem instanceof Error && problem.name !== 'TimeoutError' ? problem.message : 'Le serveur met trop de temps à répondre. Vos changements ne sont pas encore synchronisés.');
          return false;
        } finally { if (controller.current === current) controller.current = null; }
      }
      if (mounted.current && enabledRef.current && !blocked.current) { setStatus('saved'); setError(''); }
      return !blocked.current;
    })();
    inFlight.current = task;
    void task.finally(() => { if (inFlight.current === task) inFlight.current = null; });
    return task;
  }, [stopTimer]);

  const retry = useCallback(() => {
    // A conflict or expired session requires an explicit reload/reconnection,
    // never a blind retry with a newer revision that could replace remote work.
    if (blocked.current) return;
    void save();
  }, [save]);
  const flush = useCallback(() => save(), [save]);
  const reload = useCallback(() => window.location.reload(), []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopTimer(); controller.current?.abort(); };
  }, [stopTimer]);

  useEffect(() => {
    if (!enabled) { setStatus('local'); stopTimer(); return; }
    if (latestJson.current === savedJson.current || blocked.current) return;
    stopTimer();
    setStatus(navigator.onLine ? 'saving' : 'offline');
    timer.current = setTimeout(() => { timer.current = null; void save(); }, 800);
    return stopTimer;
  }, [enabled, serialized, save, stopTimer]);

  useEffect(() => {
    if (!enabled) return;
    const reconnect = () => { if (!blocked.current) void save(); };
    const warnIfUnsaved = (event: BeforeUnloadEvent) => {
      if (latestJson.current !== savedJson.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('online', reconnect);
    window.addEventListener('beforeunload', warnIfUnsaved);
    return () => { window.removeEventListener('online', reconnect); window.removeEventListener('beforeunload', warnIfUnsaved); };
  }, [enabled, save]);

  return { status, error, reload, retry, flush };
}
