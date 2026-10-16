// Config for the automatic reminder engine, edited in the Email Center and stored under the
// `ap_email_rules` sync key. Mirrors EMAIL_RULES_DEFAULTS in server/lib/email-engine.js —
// the server is the authority at send time, so keep the two in step.

export const EMAIL_RULES_DEFAULTS = {
  enabled: true,
  windowDays: 2,
  ccManager: true,
  ccHod: true,
  ccGlobal: true,
  types: { upcoming_reminder: true, delayed: true, escalation: true },
  frequencies: { upcoming_reminder: 365, delayed: 1, escalation_2: 2, escalation_3: 30 },
  suppressed: [],
  depts: {},
};

// The three switchable email types. `escalation` covers both escalation levels.
export const EMAIL_TYPES = [
  { key: 'upcoming_reminder', label: 'Upcoming Reminder', desc: 'Sent once when the target date is 0-2 days away', to: 'SPOC' },
  { key: 'delayed', label: 'Delayed NC', desc: 'Sent on delay days 0, 3 and 6', to: 'SPOC' },
  { key: 'escalation', label: 'Escalation', desc: 'Overdue 7d+ goes to the HOD; 15d+ adds Management', to: 'HOD' },
];

export function mergeEmailRules(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    ...EMAIL_RULES_DEFAULTS,
    ...s,
    types: { ...EMAIL_RULES_DEFAULTS.types, ...(s.types || {}) },
    frequencies: { ...EMAIL_RULES_DEFAULTS.frequencies, ...(s.frequencies || {}) },
    suppressed: Array.isArray(s.suppressed) ? s.suppressed : [],
    depts: s.depts && typeof s.depts === 'object' ? s.depts : {},
  };
}

export function deptRuleOf(rules, code) {
  return (rules.depts && rules.depts[code]) || {};
}

// A department is silent for a type if the type is off globally, the dept is off, or the
// dept has that specific type off.
export function isDeptTypeEnabled(rules, code, typeKey) {
  if (rules.types[typeKey] === false) return false;
  const dr = deptRuleOf(rules, code);
  if (dr.enabled === false) return false;
  return !(dr.types && dr.types[typeKey] === false);
}

export function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}
