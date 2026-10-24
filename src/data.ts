import type { AppData, Message } from './types';

export const emptyData = (): AppData => ({
  profile: { firstName: '', profession: 'Patient Experience Specialist', country: '' },
  finance: { monthlyIncome: 0, savings: 0, expenses: [] },
  goals: [],
  habits: [
    { id: 'walk', label: 'Prendre un moment pour bouger', done: false },
    { id: 'pause', label: 'Faire une vraie pause', done: false },
    { id: 'learn', label: 'Apprendre quelque chose', done: false },
  ],
  checkins: [],
});

export const demoData = (): AppData => ({
  ...emptyData(),
  finance: {
    monthlyIncome: 2800, savings: 4200,
    expenses: [
      { id: 'rent', label: 'Loyer et charges', amount: 850, category: 'Essentiel' },
      { id: 'food', label: 'Courses', amount: 320, category: 'Essentiel' },
      { id: 'travel', label: 'Transport', amount: 90, category: 'Essentiel' },
      { id: 'fun', label: 'Sorties et loisirs', amount: 240, category: 'Loisir' },
      { id: 'subscriptions', label: 'Abonnements', amount: 65, category: 'Loisir' },
    ],
  },
  goals: [
    { id: 'g1', title: 'Constituer mon épargne de précaution', category: 'Finances', done: false },
    { id: 'g2', title: 'Valoriser mon expérience patient dans mon CV', category: 'Carrière', done: false },
    { id: 'g3', title: 'Prendre du temps pour moi', category: 'Bien-être', done: true },
  ],
});

export const euro = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);

export function chatHistory(messages: Message[]): Pick<Message, 'role' | 'content'>[] {
  const history: Pick<Message, 'role' | 'content'>[] = [];
  let characters = 0;
  for (const message of messages.filter(item => item.id !== 'welcome').slice(-16).reverse()) {
    const content = message.content.trim().slice(0, message.role === 'user' ? 4000 : 12000);
    if (!content) continue;
    if (characters + content.length > 40000) break;
    history.push({ role: message.role, content });
    characters += content.length;
  }
  return history.reverse();
}

export function validData(value: unknown): value is AppData {
  if (!value || typeof value !== 'object') return false;
  const d = value as AppData;
  const amount = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e9;
  const str = (s: unknown) => typeof s === 'string' && s.length <= 2000;
  return !!d.profile && str(d.profile.firstName) && str(d.profile.profession) && str(d.profile.country)
    && !!d.finance && amount(d.finance.monthlyIncome) && amount(d.finance.savings)
    && Array.isArray(d.finance.expenses) && d.finance.expenses.length <= 1000 && d.finance.expenses.every(e => e && str(e.id) && str(e.label) && amount(e.amount) && ['Essentiel', 'Loisir', 'Projet'].includes(e.category))
    && Array.isArray(d.goals) && d.goals.length <= 1000 && d.goals.every(g => g && str(g.id) && str(g.title) && ['Finances', 'Carrière', 'Bien-être', 'Personnel'].includes(g.category) && typeof g.done === 'boolean')
    && Array.isArray(d.habits) && d.habits.length <= 100 && d.habits.every(h => h && str(h.id) && str(h.label) && typeof h.done === 'boolean')
    && Array.isArray(d.checkins) && d.checkins.length <= 2000 && d.checkins.every(c => c && str(c.id) && str(c.date) && Number.isFinite(Date.parse(c.date)) && Number.isInteger(c.mood) && c.mood >= 1 && c.mood <= 5 && str(c.note));
}
