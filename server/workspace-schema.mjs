const MAX_WORKSPACE_BYTES = 1024 * 1024;
const validString = (value, max = 2000) => typeof value === 'string' && value.length <= max;
const validId = value => validString(value, 128) && value.length > 0;
const validMoney = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
const validDate = value => validString(value, 80) && Number.isFinite(Date.parse(value));

/** Only the public, versioned workspace schema can be persisted, never credentials. */
export function validateWorkspace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || typeof value.isDemo !== 'boolean') return false;
  const { data, messages, habitDate } = value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(habitDate) || !validDate(habitDate)) return false;
  if (!data || typeof data !== 'object' || !data.profile || !data.finance) return false;
  if (!validString(data.profile.firstName, 80) || !validString(data.profile.profession, 120) || !validString(data.profile.country, 80)) return false;
  if (!validMoney(data.finance.monthlyIncome) || !validMoney(data.finance.savings)) return false;
  if (!Array.isArray(data.finance.expenses) || data.finance.expenses.length > 1000 || !data.finance.expenses.every(e => e && validId(e.id) && validString(e.label, 80) && validMoney(e.amount) && ['Essentiel', 'Loisir', 'Projet'].includes(e.category))) return false;
  if (!Array.isArray(data.goals) || data.goals.length > 1000 || !data.goals.every(g => g && validId(g.id) && validString(g.title, 200) && ['Finances', 'Carrière', 'Bien-être', 'Personnel'].includes(g.category) && typeof g.done === 'boolean')) return false;
  if (!Array.isArray(data.habits) || data.habits.length > 100 || !data.habits.every(h => h && validId(h.id) && validString(h.label, 200) && typeof h.done === 'boolean')) return false;
  if (!Array.isArray(data.checkins) || data.checkins.length > 2000 || !data.checkins.every(c => c && validId(c.id) && validDate(c.date) && Number.isInteger(c.mood) && c.mood >= 1 && c.mood <= 5 && validString(c.note, 2000))) return false;
  if (!Array.isArray(messages) || messages.length > 60 || !messages.every(m => m && validId(m.id) && ['user', 'assistant'].includes(m.role) && validString(m.content, m.role === 'user' ? 4000 : 12000) && (m.mode === undefined || ['discovery', 'connected'].includes(m.mode)))) return false;
  try { return Buffer.byteLength(JSON.stringify(value)) <= MAX_WORKSPACE_BYTES; } catch { return false; }
}

export function canonicalWorkspace(value) {
  const { data } = value;
  return {
    version: 1,
    isDemo: value.isDemo,
    habitDate: value.habitDate,
    data: {
      profile: { firstName: data.profile.firstName, profession: data.profile.profession, country: data.profile.country },
      finance: { monthlyIncome: data.finance.monthlyIncome, savings: data.finance.savings, expenses: data.finance.expenses.map(({ id, label, amount, category }) => ({ id, label, amount, category })) },
      goals: data.goals.map(({ id, title, category, done }) => ({ id, title, category, done })),
      habits: data.habits.map(({ id, label, done }) => ({ id, label, done })),
      checkins: data.checkins.map(({ id, date, mood, note }) => ({ id, date, mood, note })),
    },
    messages: value.messages.map(({ id, role, content, mode }) => ({ id, role, content, ...(mode ? { mode } : {}) })),
  };
}
