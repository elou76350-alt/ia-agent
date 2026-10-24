import { useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, Flag, Plus, Sparkles, Target, Trash2 } from 'lucide-react';
import type { AppData, Goal } from '../types';
import './workspace-views.css';

type Props = { data: AppData; onChange: (next: AppData) => void; onAsk: (message: string) => void };

export default function GoalsView({ data, onChange, onAsk }: Props) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Goal['category']>('Personnel');
  const [vision, setVision] = useState('');
  const [step, setStep] = useState('');
  const [notice, setNotice] = useState('');
  const completed = data.goals.filter(goal => goal.done).length;
  const percent = data.goals.length ? Math.round(completed / data.goals.length * 100) : 0;
  const patientExperience = /patient/i.test(data.profile.profession);

  function addGoal(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onChange({ ...data, goals: [...data.goals, { id: crypto.randomUUID(), title: title.trim().slice(0, 180), category, done: false }] });
    setTitle('');
    setNotice('Ton prochain pas a été ajouté.');
  }

  function addStep(event: FormEvent) {
    event.preventDefault();
    if (!step.trim()) return;
    onChange({ ...data, goals: [...data.goals, { id: crypto.randomUUID(), title: step.trim().slice(0, 180), category: 'Personnel', done: false }] });
    setStep('');
    setNotice('Ton intention est devenue une action dans ta liste.');
  }

  return <section className="workspace-view">
    <div className="wv-heading"><div><span className="wv-eyebrow">DE L’IDÉE AU PREMIER PAS</span><h1>Les projets qui comptent.</h1><p>Voir grand. Choisir une action. Recommencer demain.</p></div><span className="wv-tag"><Target size={15} /> Mes objectifs</span></div>
    <div className="wv-stats"><article className="wv-stat"><span>Objectifs définis</span><strong>{data.goals.length}</strong><small>Des intentions devenues concrètes</small></article><article className="wv-stat"><span>Pas accomplis</span><strong>{completed}</strong><small>Chaque petite avancée compte</small></article><article className="wv-stat wv-stat-accent"><span>Ta progression</span><strong>{percent} %</strong><div className="wv-progress"><span style={{ width: `${percent}%` }} /></div></article></div>
    <article className="wv-card"><div className="wv-card-heading"><div><h2>Ma prochaine petite victoire</h2><p className="wv-muted">Formule une action assez précise pour savoir quand elle est terminée.</p></div><Flag size={20} /></div><form className="wv-goal-form" onSubmit={addGoal}><label className="wv-field">Une action concrète<input value={title} onChange={event => setTitle(event.target.value)} maxLength={180} required placeholder={patientExperience ? 'Ex. Préparer un exemple d’amélioration du parcours patient' : 'Ex. Envoyer une candidature vendredi'} /></label><label className="wv-field">Domaine<select value={category} onChange={event => setCategory(event.target.value as Goal['category'])}><option>Personnel</option><option>Finances</option><option>Carrière</option><option>Bien-être</option></select></label><button className="wv-button" type="submit"><Plus size={16} /> Ajouter</button></form><p className="wv-notice" role="status">{notice}</p><div className="wv-goal-list">{data.goals.length ? data.goals.map(goal => <div className={`wv-list-row wv-goal-row ${goal.done ? 'is-done' : ''}`} key={goal.id}><label className="wv-goal-label"><input type="checkbox" checked={goal.done} onChange={() => onChange({ ...data, goals: data.goals.map(item => item.id === goal.id ? { ...item, done: !item.done } : item) })} /><span className="wv-check-visual" aria-hidden="true">{goal.done && <Check size={14} />}</span><span><strong>{goal.title}</strong><small>{goal.category}</small></span></label><button className="wv-icon-button" aria-label={`Supprimer l’objectif ${goal.title}`} onClick={() => onChange({ ...data, goals: data.goals.filter(item => item.id !== goal.id) })}><Trash2 size={16} /></button></div>) : <p className="wv-empty">Tout commence par un premier pas. Quel sera le tien ?</p>}</div></article>
    <div className="wv-columns"><article className="wv-card"><div className="wv-card-heading"><h2>Visualiser, puis agir</h2><Sparkles size={20} /></div><p className="wv-muted">La visualisation peut servir de motivation. Elle ne garantit pas qu’un souhait se réalise : relie ton intention à une action à ta portée.</p><form onSubmit={addStep}><label className="wv-field">Ce que j’aimerais construire<textarea rows={2} maxLength={1000} value={vision} onChange={event => setVision(event.target.value)} placeholder="Ex. Une vie plus sereine et un travail qui me plaît" /></label><label className="wv-field">Une action que je peux faire cette semaine<input value={step} onChange={event => setStep(event.target.value)} maxLength={180} required placeholder="Ex. Préparer mon CV pendant 20 minutes" /></label><button className="wv-button" type="submit"><Plus size={16} /> Ajouter cette action</button></form></article><article className="wv-card wv-advice-card"><span className="wv-icon-box"><Target size={23} /></span><h2>Les grandes ambitions aiment les petits pas.</h2><p>Tu n’as pas à tout transformer aujourd’hui. Choisis ce qui compte le plus, puis trouve une action faisable en vingt minutes.</p><button className="wv-button wv-button-light" onClick={() => onAsk(`Aide-moi à transformer ${vision.trim() ? `ce souhait : « ${vision.trim()} »` : 'mes ambitions'} en un plan réaliste. Choisissons une seule action à faire cette semaine, sans promesse de richesse.`)}>Construire mon premier pas <ArrowUpRight size={16} /></button></article></div>
  </section>;
}
