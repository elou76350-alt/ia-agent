export interface Expense { id: string; label: string; amount: number; category: 'Essentiel' | 'Loisir' | 'Projet' }
export interface Goal { id: string; title: string; category: 'Finances' | 'Carrière' | 'Bien-être' | 'Personnel'; done: boolean }
export interface Habit { id: string; label: string; done: boolean }
export interface Checkin { id: string; date: string; mood: number; note: string }
export interface AppData {
  profile: { firstName: string; profession: string; country: string };
  finance: { monthlyIncome: number; savings: number; expenses: Expense[] };
  goals: Goal[];
  habits: Habit[];
  checkins: Checkin[];
}
export interface ViewProps { data: AppData; onChange: (next: AppData) => void; onAsk: (message: string) => void }
export type Section = 'dashboard' | 'chat' | 'finance' | 'career' | 'wellbeing' | 'goals' | 'settings';
export interface Message { id: string; role: 'user' | 'assistant'; content: string; mode?: 'discovery' | 'connected' }
