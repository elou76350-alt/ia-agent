import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, Compass, Download, Heart, HelpCircle, LayoutDashboard, Leaf, Menu, MessageCircle, Plus, Send, Settings2, ShieldCheck, Sparkles, Target, Trash2, Wallet, X, BriefcaseBusiness } from 'lucide-react';
import type { AppData, Message, Section } from './types';
import { chatHistory, demoData, emptyData, euro, validData } from './data';
import FinanceView from './components/FinanceView';
import CareerView from './components/CareerView';
import WellbeingView from './components/WellbeingView';
import GoalsView from './components/GoalsView';
import InstallPanel from './components/InstallPanel';
import PasswordSettings from './components/PasswordSettings';
import { useWorkspaceSync } from './useWorkspaceSync';
import type { StoredWorkspace } from './workspace-types';
import './components/workspace-views.css';

const STORAGE_KEY = 'cap.workspace.v1';
const standalone = window.location.protocol === 'file:' || Boolean((window as Window & { __CAP_STANDALONE__?: boolean }).__CAP_STANDALONE__);
const today = () => new Date().toLocaleDateString('en-CA');
const welcome: Message = { id: 'welcome', role: 'assistant', content: 'Bienvenue dans votre espace. On peut faire le point sur votre budget, préparer votre prochaine étape professionnelle ou simplement mettre des mots sur votre journée. Par quoi aimeriez-vous commencer ?', mode: 'discovery' };

function loadWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.version === 1 && validData(saved.data)) {
      const savedData: AppData = saved.data;
      const messages: Message[] = Array.isArray(saved.messages) ? saved.messages.filter((m: Message) => m && typeof m.id === 'string' && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length <= 12000).slice(-60) : [];
      return { data: { ...savedData, habits: saved.habitDate === today() ? savedData.habits : savedData.habits.map(h => ({ ...h, done: false })) }, isDemo: !!saved.isDemo, messages: messages.length ? messages : [welcome] };
    }
  } catch { /* A fresh workspace also works without browser storage. */ }
  return { data: demoData(), isDemo: true, messages: [welcome] };
}

const nav = [
  { id: 'dashboard', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { id: 'chat', label: 'Mon assistant', icon: Sparkles },
  { id: 'finance', label: 'Mes finances', icon: Wallet },
  { id: 'career', label: 'Ma carrière', icon: BriefcaseBusiness },
  { id: 'wellbeing', label: 'Mon bien-être', icon: Heart },
  { id: 'goals', label: 'Mes objectifs', icon: Target },
] as const;

type AppProps = { initialWorkspace?: StoredWorkspace | null; initialRevision?: number; account?: { username: string } | null; authRequired?: boolean; onLogout?: () => Promise<void> };

export default function App({ initialWorkspace, initialRevision = 0, account = null, authRequired = false, onLogout }: AppProps) {
  const [initial] = useState(() => {
    if (!authRequired) return loadWorkspace();
    if (!initialWorkspace) return { data: emptyData(), isDemo: false, messages: [welcome] };
    const remoteData = initialWorkspace.data;
    return { data: { ...remoteData, habits: initialWorkspace.habitDate === today() ? remoteData.habits : remoteData.habits.map(h => ({ ...h, done: false })) }, isDemo: initialWorkspace.isDemo, messages: initialWorkspace.messages.length ? initialWorkspace.messages : [welcome] };
  });
  const [data, setData] = useState<AppData>(initial.data);
  const [isDemo, setIsDemo] = useState(initial.isDemo);
  const [messages, setMessages] = useState<Message[]>(initial.messages);
  const [section, setSection] = useState<Section>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [serverMode, setServerMode] = useState<'loading' | 'discovery' | 'connected' | 'unavailable' | 'offline'>(standalone ? 'offline' : 'loading');
  const [modelInfo, setModelInfo] = useState<{ model: string; reasoningEffort: string | null } | null>(null);
  const [providerVerified, setProviderVerified] = useState(false);
  const [providerLabel, setProviderLabel] = useState('OpenAI');
  const [freePlan, setFreePlan] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(30);
  const [shareContext, setShareContext] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  const isMounted = useRef(true);
  const chatAbortRef = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const helpDialogRef = useRef<HTMLElement>(null);
  const lastHabitDay = useRef(today());
  const workspace = useMemo<StoredWorkspace>(() => ({ version: 1, data, messages, isDemo, habitDate: lastHabitDay.current }), [data, messages, isDemo]);
  const handleAuthExpired = useCallback(() => setSessionExpired(true), []);
  const sync = useWorkspaceSync({ enabled: authRequired && !standalone, workspace, initialRevision, onAuthExpired: handleAuthExpired });

  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; requestGeneration.current += 1; chatAbortRef.current?.abort(); }; }, []);
  useEffect(() => {
    if (standalone) return;
    const ctrl = new AbortController();
    fetch('/api/status', { signal: ctrl.signal }).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(s => { if (s.mode !== 'connected' && s.mode !== 'discovery') throw Error('Statut inconnu'); setServerMode(s.mode); if (typeof s.provider === 'string') setProviderLabel(s.provider.slice(0, 120)); setFreePlan(s.freePlan === true); if (s.freePlan === true) setProviderLabel('Cloudflare Workers AI'); if (Number.isSafeInteger(s.dailyChatLimit)) setDailyLimit(s.dailyChatLimit); if (typeof s.model === 'string') setModelInfo({ model: s.model, reasoningEffort: typeof s.reasoningEffort === 'string' ? s.reasoningEffort : null }); }).catch(e => { if (e.name !== 'AbortError') setServerMode('unavailable'); });
    return () => ctrl.abort();
  }, []);
  useEffect(() => {
    if (authRequired) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, data, isDemo, messages, habitDate: lastHabitDay.current })); setStorageError(false); }
    catch { setStorageError(true); }
  }, [data, isDemo, messages, authRequired]);
  useEffect(() => {
    const resetHabitsForNewDay = () => {
      const currentDay = today();
      if (currentDay === lastHabitDay.current) return;
      lastHabitDay.current = currentDay;
      setData(previous => ({ ...previous, habits: previous.habits.map(habit => ({ ...habit, done: false })) }));
    };
    resetHabitsForNewDay();
    const timer = window.setInterval(resetHabitsForNewDay, 30000);
    window.addEventListener('focus', resetHabitsForNewDay);
    document.addEventListener('visibilitychange', resetHabitsForNewDay);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', resetHabitsForNewDay); document.removeEventListener('visibilitychange', resetHabitsForNewDay); };
  }, []);
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!help) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = helpDialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') || []);
    focusable()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setHelp(false); }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', trapFocus);
    return () => { window.removeEventListener('keydown', trapFocus); previouslyFocused?.focus(); };
  }, [help]);

  function navigate(next: Section) { setSection(next); setMobileOpen(false); headingRef.current?.focus(); }
  function ask(text: string) { setDraft(text); setChatError(''); navigate('chat'); }
  const expenses = data.finance.expenses.reduce((total, e) => total + e.amount, 0);
  const remaining = data.finance.monthlyIncome - expenses;
  const complete = data.goals.filter(g => g.done).length;
  const ratio = data.goals.length ? Math.round(complete / data.goals.length * 100) : 0;
  const viewProps = { data, onChange: setData, onAsk: ask };
  const modeLabel = standalone ? 'Tableau de bord autonome' : serverMode === 'connected' ? (providerVerified ? 'IA connectée' : 'IA configurée') : serverMode === 'loading' ? 'Connexion…' : serverMode === 'unavailable' ? 'Serveur indisponible' : freePlan ? 'IA gratuite à configurer' : 'Mode découverte';

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (standalone || !draft.trim() || busy || chatAbortRef.current) return;
    const text = draft.trim().slice(0, 4000);
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const next: Message[] = [...messages, { id: crypto.randomUUID(), role: 'user', content: text }];
    setMessages(next); setDraft(''); setBusy(true); setChatError('');
    try {
      const context = shareContext ? { profile: { firstName: data.profile.firstName.slice(0, 80), profession: data.profile.profession.slice(0, 120), country: data.profile.country.slice(0, 80) }, context: { monthlyIncome: data.finance.monthlyIncome, monthlyExpenses: expenses, savings: data.finance.savings, goals: data.goals.filter(g => !g.done && g.title.trim()).slice(0, 8).map(g => g.title.slice(0, 200)) } } : {};
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: chatHistory(next), ...context }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(110000)]) });
      const answer = await res.json();
      if (!res.ok) { if (res.status === 401) setSessionExpired(true); throw Error(answer.error || 'Votre message n’a pas pu être traité. Réessayez dans un instant.'); }
      if (typeof answer.message !== 'string' || !answer.message.trim() || answer.message.length > 12000 || (answer.mode !== 'discovery' && answer.mode !== 'connected')) throw Error('Réponse du serveur illisible.');
      const reply: Message = { id: crypto.randomUUID(), role: 'assistant', content: answer.message, mode: answer.mode };
      if (isMounted.current && generation === requestGeneration.current) { setMessages(prev => [...prev, reply].slice(-60)); setServerMode(answer.mode); setProviderVerified(answer.mode === 'connected'); if (typeof answer.provider === 'string') setProviderLabel(answer.provider.slice(0, 120)); }
    } catch (err) {
      if (isMounted.current && generation === requestGeneration.current) { setChatError(err instanceof Error && !['TimeoutError', 'TypeError'].includes(err.name) ? err.message : 'Le service ne répond pas. Vérifiez la connexion puis réessayez.'); setDraft(text); setMessages(prev => prev.filter(m => m.id !== next.at(-1)?.id)); }
    } finally { if (isMounted.current && generation === requestGeneration.current) { setBusy(false); chatAbortRef.current = null; } }
  }

  function exportData() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data, messages }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `cap-mes-donnees-${today()}.json`; link.click(); URL.revokeObjectURL(url); setNotice('Vos données ont été exportées. Conservez ce fichier dans un endroit privé.');
  }
  function resetData() {
    if (window.confirm(authRequired ? 'Effacer le profil, le budget, les objectifs, le journal et les conversations de votre espace ? La suppression sera enregistrée sur le serveur.' : 'Effacer le profil, le budget, les objectifs, le journal et les conversations enregistrés dans ce navigateur ?')) { requestGeneration.current += 1; chatAbortRef.current?.abort(); chatAbortRef.current = null; setBusy(false); setChatError(''); setShareContext(false); setData(emptyData()); setIsDemo(false); setMessages([welcome]); setDraft(''); setNotice('Votre espace est prêt à accueillir vos propres données.'); }
  }

  async function logout() {
    if (!onLogout || loggingOut) return;
    setLoggingOut(true);
    try {
      if (!sessionExpired && !await sync.flush()) { setNotice('La dernière sauvegarde n’a pas abouti. Exportez vos modifications ou réessayez avant de vous déconnecter.'); return; }
      if (sessionExpired && !window.confirm('Votre session a expiré. Les modifications non sauvegardées seront perdues. Exportez-les d’abord si nécessaire. Revenir à la connexion ?')) return;
      requestGeneration.current += 1; chatAbortRef.current?.abort();
      await onLogout();
    } catch { setNotice('La déconnexion n’a pas abouti. Réessayez après avoir vérifié votre connexion.'); }
    finally { if (isMounted.current) setLoggingOut(false); }
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Aller au contenu</a>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Fermer le menu" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`} aria-label="Navigation principale">
      <button className="brand" onClick={() => navigate('dashboard')} aria-label="CAP, accueil"><span className="brand-icon"><Sparkles size={25} /></span><span>cap<span className="brand-dot">.</span></span></button>
      <p className="brand-tagline">Votre vie. Votre direction.</p>
      <span className="nav-label">MON ESPACE</span>
      <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={section === id ? 'page' : undefined}><Icon size={19} strokeWidth={1.7} /><span>{label}</span>{id === 'chat' && <span className="nav-new">IA</span>}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><Leaf size={21} /><p>Les grandes vies se construisent<br /><strong>un petit pas à la fois.</strong></p></div>
        <button className={`nav-item ${section === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18} /><span>Mes préférences</span></button>
        <button className="user-card" onClick={() => navigate('settings')}><span className="avatar">{data.profile.firstName.slice(0, 1).toUpperCase() || 'V'}</span><span><strong>{data.profile.firstName || 'Votre espace'}</strong><small>{isDemo ? 'Profil d’exemple' : 'Un nouveau chapitre'}</small></span><ChevronRight size={17} /></button>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button mobile-toggle" aria-label="Ouvrir le menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><Menu size={22} /></button><span className="breadcrumb">Mon espace <ChevronRight size={13} /> <strong>{nav.find(n => n.id === section)?.label || 'Mes préférences'}</strong></span></div>
        <div className="topbar-right"><span className={`status-pill ${serverMode === 'connected' ? 'connected' : ''}`}><span />{modeLabel}</span><button className="icon-button help-button" onClick={() => setHelp(true)} aria-label="À propos de CAP"><HelpCircle size={19} /></button></div>
      </header>
      <main id="main-content" tabIndex={-1} ref={headingRef}>
        {authRequired && <div className={`sync-banner sync-${sync.status}`} role="status"><span><ShieldCheck size={15} />{sessionExpired ? 'Votre session a expiré. Exportez vos dernières modifications puis reconnectez-vous.' : sync.status === 'saved' ? 'Votre espace est sauvegardé sur le serveur.' : sync.status === 'saving' ? 'Sauvegarde en cours…' : sync.status === 'conflict' ? 'Cet espace a été modifié sur un autre appareil. Exportez vos changements avant de recharger.' : sync.status === 'offline' ? 'Connexion interrompue : vos dernières modifications restent en mémoire. Exportez-les avant de fermer l’application.' : sync.status === 'error' ? sync.error || 'La sauvegarde a échoué.' : 'Votre espace privé est ouvert.'}</span><div>{['offline', 'error'].includes(sync.status) && !sessionExpired && <button onClick={sync.retry}>Réessayer</button>}{sync.status === 'conflict' && <><button onClick={exportData}>Exporter</button><button onClick={() => { if (window.confirm('Recharger les données du serveur ? Les changements locaux non sauvegardés seront perdus.')) sync.reload(); }}>Recharger</button></>}{sessionExpired && <><button onClick={exportData}>Exporter</button><button onClick={logout}>Se reconnecter</button></>}</div></div>}
        {standalone && <div className="standalone-banner" role="status"><ShieldCheck size={18} /><span><strong>Fichier autonome.</strong> Budget, objectifs et journal fonctionnent sur cet appareil. La conversation IA nécessite l’application avec son serveur ; aucune connexion à un service IA n’est faite depuis ce fichier.</span></div>}
        {storageError && <div className="error-banner" role="alert">Le stockage de votre navigateur est indisponible. Vos changements seront perdus à la fermeture de cette page. Vous pouvez les exporter dans les préférences.</div>}
        {isDemo && <div className="demo-banner"><span><span className="demo-tag">EXEMPLE</span>Découvrez CAP avec des données fictives.</span><button onClick={() => navigate('settings')}>Personnaliser mon espace <ArrowRight size={14} /></button></div>}
        {section === 'dashboard' && <>
          <div className="page-intro"><div><p className="eyebrow"><span className="tiny-sun">✳</span> UN NOUVEAU JOUR, DES POSSIBILITÉS</p><h1>Bonjour{data.profile.firstName ? ` ${data.profile.firstName}` : ''}<span className="hello-dot">.</span></h1><p>Pas besoin de tout changer aujourd’hui. Commençons par un pas.</p></div><span className="today-date">{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span></div>
          <section className="hero-card" aria-labelledby="hero-heading"><div className="hero-copy"><span className="hero-kicker"><span /> VOTRE ALLIÉ AU QUOTIDIEN</span><h2 id="hero-heading">De l’ambition.<br />Un cap. <em>Vos prochains pas.</em></h2><p>De la clarté dans vos finances, du sens dans votre carrière,<br className="desktop-break" /> de la place pour vous. Avançons ensemble.</p><button className="button button-lime" onClick={() => ask('Aide-moi à choisir une petite action utile pour aujourd’hui.')}><Sparkles size={17} /> Faire le point avec mon assistant <ArrowUpRight size={17} /></button></div><div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-sun" /><svg className="landscape" viewBox="0 0 480 300"><path d="M0 225Q75 145 155 188T305 146T480 105V300H0Z" fill="#36624b"/><path d="M0 270Q90 190 185 226T350 188T480 185V300H0Z" fill="#78916b"/><path d="M0 310Q160 255 256 275T480 220V300H0Z" fill="#b9c69b"/><path d="M220 300Q310 262 288 234T343 194Q370 175 373 160" fill="none" stroke="#eee9bf" strokeWidth="10" opacity=".85"/></svg><span className="art-spark spark-one">✦</span><span className="art-spark spark-two">✧</span><div className="art-caption"><span className="compass-small"><Compass size={18} /></span>Le meilleur point de départ, c’est ici.</div></div></section>
          <div className="section-heading"><h2>Votre vie, en un regard</h2><span>Quatre espaces pour avancer</span></div>
          <div className="overview-grid">
            <button className="metric-card" onClick={() => navigate('finance')}><div className="metric-top"><span className="metric-icon mint"><Wallet size={19} /></span><ArrowUpRight size={18} /></div><h3>Mes finances</h3><strong className={remaining < 0 ? 'negative' : ''}>{euro(remaining)}</strong><span className="metric-caption">Reste à vivre mensuel prévu</span><span className="metric-bottom"><span className="small-dot green" />{data.finance.expenses.length ? `${data.finance.expenses.length} dépenses renseignées` : 'Construisez votre budget'}</span></button>
            <button className="metric-card" onClick={() => navigate('career')}><div className="metric-top"><span className="metric-icon peach"><BriefcaseBusiness size={19} /></span><ArrowUpRight size={18} /></div><h3>Ma carrière</h3><strong className="metric-text">{data.profile.profession || 'Votre prochain défi'}</strong><span className="metric-caption">{data.profile.country || 'Définissez votre projet'}</span><span className="metric-bottom">Explorer mes possibilités <ArrowRight size={13} /></span></button>
            <button className="metric-card" onClick={() => navigate('wellbeing')}><div className="metric-top"><span className="metric-icon lavender"><Heart size={19} /></span><ArrowUpRight size={18} /></div><h3>Mon bien-être</h3><strong className="metric-text">{data.checkins.length ? ['','Une journée difficile','Besoin de douceur','Ça peut aller','Plutôt bien','Très bien'][data.checkins[0].mood] : 'Comment allez-vous ?'}</strong><span className="metric-caption">{data.checkins.length ? 'Votre dernier ressenti' : 'Un moment rien que pour vous'}</span><span className="metric-bottom"><span className="small-dot purple" />Faire mon point du jour</span></button>
            <button className="metric-card" onClick={() => navigate('goals')}><div className="metric-top"><span className="metric-icon sand"><Target size={19} /></span><ArrowUpRight size={18} /></div><h3>Mes objectifs</h3><strong>{complete}<span className="metric-fraction"> / {data.goals.length}</span></strong><span className="metric-caption">Objectif{complete > 1 ? 's' : ''} accompli{complete > 1 ? 's' : ''}</span><span className="mini-progress" role="progressbar" aria-label="Objectifs accomplis" aria-valuenow={ratio} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${ratio}%` }} /></span></button>
          </div>
          <div className="dashboard-bottom"><section className="card daily-card"><div className="section-heading compact"><div><p className="eyebrow">CHAQUE PETIT PAS COMPTE</p><h2>Votre élan du jour</h2></div><span className="count-pill">{data.habits.filter(h => h.done).length}/{data.habits.length}</span></div><div className="habit-list">{data.habits.map((h, i) => <label key={h.id} className={`habit-row ${h.done ? 'done' : ''}`}><input type="checkbox" checked={h.done} onChange={() => setData({ ...data, habits: data.habits.map(x => x.id === h.id ? { ...x, done: !x.done } : x) })} /><span className="custom-check">{h.done && <Check size={14} />}</span><span>{h.label}</span><span className="habit-index">0{i + 1}</span></label>)}</div><div className="daily-footer"><Leaf size={14} /> La régularité compte plus que la perfection.</div></section><section className="card thought-card"><div className="thought-icon"><MessageCircle size={23} strokeWidth={1.5} /><span>✦</span></div><p className="eyebrow">UN ESPACE POUR Y VOIR PLUS CLAIR</p><h2>Et si on en parlait ?</h2><p>Une idée qui tourne en boucle ? Un projet qui vous anime ? Posons les choses, à votre rythme.</p><button className="text-link" onClick={() => ask('J’aimerais faire le point sur ce qui compte pour moi en ce moment.')} >Ouvrir la conversation <ArrowRight size={16} /></button><svg className="thought-decoration" aria-hidden="true" width="200" height="200" viewBox="0 0 100 100"><g stroke="currentColor" strokeWidth="5" strokeLinecap="round"><path d="M50 8v84M8 50h84M20 20l60 60M20 80l60-60" /></g></svg></section></div>
          <div className="page-footer"><span><ShieldCheck size={14} />{authRequired ? "Espace privé · sauvegarde chiffrée sur le serveur · partage IA au choix." : "Données enregistrées localement · partage IA au choix."}</span><span>Vous gardez le cap. Vous gardez le contrôle.</span></div>
        </>}
        {section === 'finance' && <FinanceView {...viewProps} />}
        {section === 'career' && <CareerView {...viewProps} />}
        {section === 'wellbeing' && <WellbeingView {...viewProps} />}
        {section === 'goals' && <GoalsView {...viewProps} />}
        {section === 'chat' && <div className="chat-page"><div className="page-intro"><div><p className="eyebrow">UN PEU DE RECUL, UN NOUVEL ÉLAN</p><h1>On en parle ?</h1><p>Votre espace pour réfléchir, apprendre et préparer la suite.</p></div><button className="button button-secondary" disabled={busy} onClick={() => { if (messages.length < 2 || window.confirm('Effacer cette conversation de ce navigateur ?')) { setMessages([welcome]); setChatError(''); } }}><Plus size={16} /> Nouvelle conversation</button></div><div className="chat-layout"><section className="chat-card card" aria-label="Conversation"><div className="chat-header"><span className="assistant-avatar"><Sparkles size={20} /></span><div><strong>CAP, votre assistant</strong><span>{standalone ? 'Fichier autonome · conversation non disponible sans serveur' : serverMode === 'connected' ? (providerVerified ? 'Réponses générées par une IA · peuvent contenir des erreurs' : 'Connexion configurée · réponse non encore vérifiée') : freePlan ? 'Service IA gratuit à configurer' : 'Exercices guidés locaux · IA non connectée'}</span></div></div><div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions">{messages.map(m => <div key={m.id} className={`message ${m.role}`}><span className="message-avatar">{m.role === 'assistant' ? <Sparkles size={16} /> : data.profile.firstName.slice(0, 1).toUpperCase() || 'V'}</span><div><span className="message-author">{m.role === 'assistant' ? 'CAP' : 'Vous'}{m.mode === 'discovery' && m.id !== 'welcome' && <small> · exercice guidé</small>}</span><div className="message-body">{m.content}</div></div></div>)}{busy && <div className="chat-thinking" role="status"><span /><span /><span /> Un moment pour réfléchir…</div>}<div ref={scrollRef} /></div>{chatError && <p className="chat-error" role="alert">{chatError}</p>}<form className="chat-compose" onSubmit={sendMessage}><label className="sr-only" htmlFor="chat-input">Votre message</label><textarea id="chat-input" disabled={standalone} value={draft} onChange={e => setDraft(e.target.value)} maxLength={4000} placeholder={standalone ? "Ouvrez l’application avec son serveur pour converser avec CAP." : "Qu’aimeriez-vous éclaircir aujourd’hui ?"} rows={2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /><button aria-label="Envoyer le message" className="send-button" disabled={standalone || busy || !draft.trim()}><Send size={19} /></button></form><div className="chat-privacy"><label><input type="checkbox" disabled={standalone} checked={shareContext} onChange={e => setShareContext(e.target.checked)} /> Inclure mon profil, les totaux de mon budget et mes objectifs</label><span>En mode IA, les messages sont transmis à {providerLabel}. En mode découverte, les exercices sont traités localement. Le journal de bien-être n’est jamais ajouté automatiquement.</span></div></section><aside className="chat-side"><div className="card"><span className="metric-icon sand"><Compass size={20} /></span><h3>Un point de départ</h3><p>Pas besoin d’avoir les mots parfaits.</p>{['Comment mieux organiser mon budget ?', 'Aide-moi à préparer ma prochaine candidature.', 'Je me sens seul et j’aimerais en parler.', 'Transformons mon objectif en un premier petit pas.'].map(p => <button key={p} className="prompt-button" onClick={() => setDraft(p)}>{p}<ArrowUpRight size={16} /></button>)}</div><div className="assistant-boundary"><ShieldCheck size={18} /><p>CAP accompagne votre réflexion. Il ne remplace pas un professionnel de santé ou un conseil financier personnalisé. Pour une urgence, contactez les services de votre pays.</p></div></aside></div></div>}
        {section === 'settings' && <div className="settings-page"><div className="page-intro"><div><p className="eyebrow">VOTRE ESPACE VOUS RESSEMBLE</p><h1>Mes préférences</h1><p>Quelques repères pour vous accompagner à votre rythme.</p></div></div><div className="settings-grid"><section className="card settings-card"><h2>Faisons connaissance</h2><p>{authRequired ? "Ces informations sont enregistrées dans votre espace privé. Leur partage avec l’assistant est optionnel." : "Ces informations restent dans ce navigateur. Leur partage avec l’assistant est optionnel."}</p>{isDemo && <div className="settings-demo"><strong>Vous utilisez des données fictives.</strong><p>Commencez avec un espace vide pour saisir vos propres informations.</p><button className="button button-primary" onClick={resetData}>Créer mon espace personnel <ArrowRight size={16} /></button></div>}<label className="field-label" htmlFor="first-name">Votre prénom</label><input id="first-name" value={data.profile.firstName} maxLength={80} onChange={e => setData({ ...data, profile: { ...data.profile, firstName: e.target.value } })} placeholder="Comment vous appeler ?" /><label className="field-label" htmlFor="profession">Votre métier ou projet professionnel</label><input id="profession" value={data.profile.profession} maxLength={120} onChange={e => setData({ ...data, profile: { ...data.profile, profession: e.target.value } })} placeholder="Ex. infirmier, développeuse, reconversion…" /><label className="field-label" htmlFor="country">Votre pays de recherche</label><input id="country" value={data.profile.country} maxLength={80} onChange={e => setData({ ...data, profile: { ...data.profile, country: e.target.value } })} placeholder="Ex. France" /><span className="save-note"><CheckCheck size={15} /> {authRequired ? "Sauvegarde automatique sur le serveur" : "Enregistrement automatique sur cet appareil"}</span></section><div className="settings-side"><InstallPanel />{authRequired && <section className="card settings-card"><h2>Mon compte privé</h2><p>Connecté en tant que <strong>{account?.username}</strong>. Votre mot de passe n’est jamais envoyé au fournisseur IA.</p><button className="button button-secondary" onClick={logout} disabled={loggingOut || busy}>{loggingOut ? "Déconnexion…" : "Se déconnecter"}</button></section>}{authRequired && <PasswordSettings onSessionExpired={handleAuthExpired} />}<section className="card settings-card"><h2>Une IA, quand vous le décidez</h2><p><strong>{modeLabel}.</strong> {standalone ? 'Ce fichier permet d’utiliser le tableau de bord sans installation. La conversation nécessite de démarrer l’application serveur et de configurer sa clé IA.' : freePlan ? `Cette version utilise Cloudflare Workers AI dans ses quotas gratuits, sans clé OpenAI. CAP autorise au maximum ${dailyLimit} tentatives de réponse par jour UTC ; le quota du fournisseur peut être atteint avant. Aucun basculement vers une API payante n’est effectué.` : serverMode === 'connected' ? 'Une clé est configurée sur le serveur. La réussite des réponses dépend de l’accès au service.' : 'Les réponses actuelles sont des exercices guidés. Pour une conversation libre, configurez AGENT_API_KEY côté serveur puis redémarrez-le.'}</p><p>{modelInfo && <>Modèle sélectionné : <strong>{modelInfo.model}</strong>{modelInfo.reasoningEffort && <> · raisonnement {modelInfo.reasoningEffort === 'high' ? 'approfondi' : modelInfo.reasoningEffort}</>}. Ce réglage n’est pas une mesure de QI.<br /></>}La clé ne doit jamais être saisie dans une conversation. Les SMS, WhatsApp et iMessage ne sont pas connectés dans cette version.</p></section><section className="card settings-card"><h2>Vos données vous appartiennent</h2><p>{authRequired ? "Votre espace est sauvegardé chiffré sur le serveur. L’hébergeur conserve les clés : cette protection ne remplace pas la sécurité du serveur. Le contenu est chargé sur l’appareil après connexion. Pensez à vous déconnecter sur un appareil partagé." : "Budget, journal et messages sont stockés localement, sans chiffrement applicatif. Sur un appareil partagé, pensez à exporter puis effacer votre espace."}</p><button className="button button-secondary" onClick={exportData}><Download size={16} /> Exporter mes données</button><button className="button button-danger" onClick={resetData}><Trash2 size={16} /> {authRequired ? "Effacer mon espace" : "Effacer mes données locales"}</button></section></div></div></div>}
      </main>
    </div>
    {notice && <div className="toast" role="status"><Check size={17} />{notice}<button aria-label="Fermer la notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {help && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setHelp(false); }}><section className="card help-dialog" ref={helpDialogRef} role="dialog" aria-modal="true" aria-labelledby="help-title"><button className="icon-button modal-close" aria-label="Fermer" onClick={() => setHelp(false)}><X size={20} /></button><span className="metric-icon mint"><Sparkles size={23} /></span><h2 id="help-title">Un cap, pas une promesse magique.</h2><p>CAP vous aide à organiser votre budget, préparer vos recherches d’emploi, suivre vos objectifs et réfléchir à votre bien-être.</p><p>La visualisation peut aider à clarifier une envie. La « loi de l’attraction » n’est pas une loi scientifique démontrée et ne garantit ni richesse ni santé.</p><p>CAP ne gère pas votre compte bancaire, ne pose pas de diagnostic et ne remplace pas un psychiatre. Les recherches d’emploi ouvrent des sites externes ; les offres ne sont pas vérifiées par CAP.</p><button className="button button-primary" onClick={() => setHelp(false)}>C’est compris <Check size={16} /></button></section></div>}
  </div>;
}
