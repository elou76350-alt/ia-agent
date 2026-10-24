import { useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, Heart, Leaf, NotebookPen } from 'lucide-react';
import type { AppData } from '../types';
import './workspace-views.css';

type Props = { data: AppData; onChange: (next: AppData) => void; onAsk: (message: string) => void };
const moods = ['Difficile', 'Un peu bas', 'Moyen', 'Bien', 'Très bien'];
const moodFaces = ['☁', '◔', '◑', '◕', '☀'];

export default function WellbeingView({ data, onChange, onAsk }: Props) {
  const [mood, setMood] = useState(3);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const doneHabits = data.habits.filter(habit => habit.done).length;

  function saveCheckin(event: FormEvent) {
    event.preventDefault();
    onChange({ ...data, checkins: [{ id: crypto.randomUUID(), date: new Date().toISOString(), mood, note: note.trim().slice(0, 2000) }, ...data.checkins].slice(0, 100) });
    setNote('');
    setNotice('Ton point du jour a été enregistré dans ce navigateur.');
  }

  return <section className="workspace-view">
    <div className="wv-heading"><div><span className="wv-eyebrow">REVENIR À L’ESSENTIEL</span><h1>Un peu de place pour toi.</h1><p>Pas besoin d’être au maximum pour prendre soin de toi.</p></div><span className="wv-tag"><Heart size={15} /> Mon bien-être</span></div>
    <div className="wv-columns"><article className="wv-card"><div className="wv-card-heading"><h2>Comment te sens-tu ?</h2><Leaf size={20} /></div><p className="wv-muted">Il n’y a pas de bonne réponse. Juste un moment pour t’écouter.</p><form onSubmit={saveCheckin}><fieldset className="wv-mood-fieldset"><legend className="wv-sr-only">Choisis ton humeur de 1 à 5</legend><div className="wv-mood-options">{moods.map((label, index) => <label className={`wv-mood-option ${mood === index + 1 ? 'is-selected' : ''}`} key={label}><input type="radio" name="mood" value={index + 1} checked={mood === index + 1} onChange={() => setMood(index + 1)} /><span className="wv-mood-face" aria-hidden="true">{moodFaces[index]}</span><span>{label}</span></label>)}</div></fieldset><label className="wv-field">Ce que tu as sur le cœur <span className="wv-optional">(facultatif)</span><textarea value={note} onChange={event => setNote(event.target.value)} rows={4} maxLength={2000} placeholder="Ce qui t’a fait du bien, ce qui a été difficile…" /></label><button className="wv-button" type="submit"><NotebookPen size={16} /> Enregistrer mon point</button><p className="wv-notice" role="status">{notice}</p></form></article><article className="wv-card wv-advice-card"><span className="wv-icon-box"><Heart size={23} /></span><h2>Tu peux en parler</h2><p>Mettre des mots sur ce que tu traverses peut aider à y voir plus clair. Le coach peut t’écouter et t’aider à préparer une conversation avec un proche ou un professionnel.</p><button className="wv-button wv-button-light" onClick={() => onAsk('J’aimerais parler de ce que je ressens. Écoute-moi sans jugement et pose-moi une question simple pour commencer.')}>Prendre un temps pour parler <ArrowUpRight size={16} /></button><small>Ce compagnon ne remplace ni un médecin ni un psychiatre et ne pose pas de diagnostic.</small></article></div>
    <div className="wv-columns"><article className="wv-card"><div className="wv-card-heading"><div><h2>Mes petites habitudes</h2><p className="wv-muted">Des gestes simples, à ton rythme.</p></div><span className="wv-count-badge">{doneHabits}/{data.habits.length}</span></div><div className="wv-habit-list">{data.habits.map(habit => <label className={`wv-habit ${habit.done ? 'is-done' : ''}`} key={habit.id}><input type="checkbox" checked={habit.done} onChange={() => onChange({ ...data, habits: data.habits.map(item => item.id === habit.id ? { ...item, done: !item.done } : item) })} /><span className="wv-check-visual" aria-hidden="true">{habit.done && <Check size={14} />}</span><span>{habit.label}</span></label>)}</div><button className="wv-text-button" onClick={() => onChange({ ...data, habits: data.habits.map(habit => ({ ...habit, done: false })) })}>Recommencer une journée</button></article><article className="wv-card"><div className="wv-card-heading"><h2>Mon journal récent</h2><NotebookPen size={19} /></div>{data.checkins.length ? <div className="wv-journal-list">{data.checkins.slice(0, 5).map(checkin => <article className="wv-journal-item" key={checkin.id}><div><strong>{moods[Math.max(0, Math.min(4, checkin.mood - 1))]}</strong><time dateTime={checkin.date}>{new Date(checkin.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div>{checkin.note && <p>{checkin.note}</p>}<button className="wv-text-button" onClick={() => onChange({ ...data, checkins: data.checkins.filter(item => item.id !== checkin.id) })}>Supprimer cette note</button></article>)}</div> : <div className="wv-empty"><Leaf size={28} /><p>Ton journal commence quand tu le souhaites.</p><small>Les notes sont conservées dans ce navigateur.</small></div>}</article></div>
  </section>;
}
