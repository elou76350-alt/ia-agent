import { useState, type FormEvent } from 'react';
import { ArrowUpRight, CircleHelp, Plus, Trash2, Wallet } from 'lucide-react';
import type { AppData, Expense } from '../types';
import './workspace-views.css';

type Props = { data: AppData; onChange: (next: AppData) => void; onAsk: (message: string) => void };
const euros = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
const validAmount = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100_000_000;

export default function FinanceView({ data, onChange, onAsk }: Props) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Expense['category']>('Essentiel');
  const [notice, setNotice] = useState('');
  const expenses = data.finance.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const remaining = data.finance.monthlyIncome - expenses;
  const ratio = data.finance.monthlyIncome > 0 ? Math.min(100, expenses / data.finance.monthlyIncome * 100) : 0;

  function addExpense(event: FormEvent) {
    event.preventDefault();
    if (!label.trim() || !validAmount(amount) || Number(amount) === 0) {
      setNotice('Ajoute un nom et un montant supérieur à 0.');
      return;
    }
    onChange({ ...data, finance: { ...data.finance, expenses: [...data.finance.expenses, { id: crypto.randomUUID(), label: label.trim().slice(0, 80), amount: Number(amount), category }] } });
    setLabel('');
    setAmount('');
    setNotice('Dépense ajoutée à ton budget mensuel.');
  }

  return <section className="workspace-view">
    <div className="wv-heading"><div><span className="wv-eyebrow">PRENDRE LES COMMANDES</span><h1>Mon argent, en clair.</h1><p>Comprendre ton budget, c’est déjà faire un premier pas.</p></div><span className="wv-tag"><Wallet size={15} /> Budget mensuel · EUR</span></div>
    <div className="wv-stats">
      <article className="wv-stat"><span>Revenus mensuels</span><strong>{euros(data.finance.monthlyIncome)}</strong><small>Ce qui entre chaque mois</small></article>
      <article className="wv-stat"><span>Dépenses prévues</span><strong>{euros(expenses)}</strong><small>{data.finance.expenses.length} poste{data.finance.expenses.length > 1 ? 's' : ''} dans ton budget</small></article>
      <article className={`wv-stat wv-stat-accent ${remaining < 0 ? 'wv-stat-warning' : ''}`}><span>Reste après dépenses</span><strong>{euros(remaining)}</strong><small>{remaining >= 0 ? 'Avant épargne et dépenses imprévues' : 'Ton budget dépasse tes revenus'}</small></article>
    </div>
    <div className="wv-columns">
      <article className="wv-card"><div className="wv-card-heading"><h2>Les bases de ton budget</h2><span className="wv-dot-label">Modifiable</span></div><p className="wv-muted">Renseigne des montants mensuels pour comparer la même période.</p><div className="wv-field-pair"><label className="wv-field">Revenus nets mensuels (€)<input type="number" inputMode="decimal" min="0" max="100000000" step="0.01" placeholder="0" value={data.finance.monthlyIncome || ''} onChange={event => { if (event.target.value === '' || validAmount(event.target.value)) onChange({ ...data, finance: { ...data.finance, monthlyIncome: Number(event.target.value) } }); }} /></label><label className="wv-field">Épargne déjà disponible (€)<input type="number" inputMode="decimal" min="0" max="100000000" step="0.01" placeholder="0" value={data.finance.savings || ''} onChange={event => { if (event.target.value === '' || validAmount(event.target.value)) onChange({ ...data, finance: { ...data.finance, savings: Number(event.target.value) } }); }} /></label></div><div className="wv-budget-bar"><div className="wv-bar-label"><span>Part des revenus engagée</span><strong>{data.finance.monthlyIncome > 0 ? `${Math.round(expenses / data.finance.monthlyIncome * 100)} %` : 'Revenus à renseigner'}</strong></div><div className="wv-progress"><span style={{ width: `${ratio}%`, background: remaining < 0 ? '#c87542' : undefined }} /></div></div><div className="wv-info"><CircleHelp size={17} /><span>Un outil pour apprendre et planifier. Aucun compte bancaire connecté et aucun transfert d’argent.</span></div></article>
      <article className="wv-card wv-advice-card"><span className="wv-icon-box"><ArrowUpRight size={23} /></span><h2>Un petit pas pour demain</h2><p>{remaining < 0 ? 'Repère une dépense ajustable et vérifie si certains frais reviennent plusieurs fois.' : 'Décide de la part de ton reste mensuel à garder pour les imprévus, avant de penser à investir.'}</p><button className="wv-button wv-button-light" onClick={() => onAsk('Aide-moi à comprendre mon budget et à choisir une première action réaliste, sans promesse de rendement.')}>Comprendre mon budget <ArrowUpRight size={16} /></button></article>
    </div>
    <article className="wv-card"><div className="wv-card-heading"><div><h2>Mes dépenses prévues</h2><p className="wv-muted">Ajoute aussi les abonnements et les dépenses récurrentes.</p></div></div><form className="wv-expense-form" onSubmit={addExpense}><label className="wv-field">Nom de la dépense<input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} placeholder="Ex. Loyer" required /></label><label className="wv-field">Montant mensuel (€)<input type="number" inputMode="decimal" min="0.01" max="100000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" required /></label><label className="wv-field">Catégorie<select value={category} onChange={event => setCategory(event.target.value as Expense['category'])}><option>Essentiel</option><option>Loisir</option><option>Projet</option></select></label><button className="wv-button" type="submit"><Plus size={16} /> Ajouter</button></form><p className="wv-notice" role="status">{notice}</p><div className="wv-expense-list">{data.finance.expenses.length ? data.finance.expenses.map(expense => <div className="wv-list-row" key={expense.id}><div className="wv-row-main"><span className="wv-category-icon"><Wallet size={17} /></span><div><strong>{expense.label}</strong><small>{expense.category}</small></div></div><div className="wv-row-end"><strong>{euros(expense.amount)}</strong><button className="wv-icon-button" aria-label={`Supprimer la dépense ${expense.label}`} onClick={() => onChange({ ...data, finance: { ...data.finance, expenses: data.finance.expenses.filter(item => item.id !== expense.id) } })}><Trash2 size={16} /></button></div></div>) : <p className="wv-empty">Ton budget commence ici. Ajoute ta première dépense.</p>}</div></article>
  </section>;
}
