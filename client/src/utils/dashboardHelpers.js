// client/src/utils/dashboardHelpers.js

export function parseAuditDate(value, yr) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value)) return value;
  if (typeof value === 'number') {
    const n = new Date(value);
    return isNaN(n) ? null : n;
  }
  const s = String(value).trim();
  if (!s) return null;
  const dm = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dm) {
    let y = +dm[3];
    if (y < 100) y += 2000;
    const dd = new Date(y, +dm[2] - 1, +dm[1]);
    return isNaN(dd) ? null : dd;
  }
  if (!/\d{4}/.test(s) && /[A-Za-z]/.test(s)) {
    const named = new Date(s + ' ' + (yr || new Date().getFullYear()));
    if (!isNaN(named)) return named;
  }
  let d = new Date(s);
  if (!isNaN(d)) return d;
  d = new Date(s + ' ' + (yr || new Date().getFullYear()));
  return isNaN(d) ? null : d;
}

export function normalizeAuditSeverity(sev) {
  const s = String(sev || 'obs').toLowerCase().trim();
  if (s.indexOf('critical') > -1) return 'critical';
  if (s.indexOf('major') > -1) return 'major';
  if (s.indexOf('minor') > -1) return 'minor';
  if (s === 'ob' || s === 'obs' || s.indexOf('observation') > -1) return 'obs';
  return 'obs';
}

export function scoreFromFindingCounts(counts) {
  counts = counts || {};
  const score = 100 - (Number(counts.critical || 0) * 15) - (Number(counts.major || 0) * 10) - (Number(counts.minor || 0) * 5) - (Number(counts.obs || 0) * 2);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function auditFindingCounts(findings) {
  let c = 0, ma = 0, mi = 0, ob = 0;
  (findings || []).forEach(f => {
    const sev = normalizeAuditSeverity(f && (f.sev !== undefined ? f.sev : f.severity));
    if (sev === 'critical') c++;
    else if (sev === 'major') ma++;
    else if (sev === 'minor') mi++;
    else ob++;
  });
  return { critical: c, major: ma, minor: mi, obs: ob, total: c + ma + mi + ob };
}

export function auditScore(findings) {
  return scoreFromFindingCounts(auditFindingCounts(findings));
}

export function closureRate(findings) {
  if (!findings || !findings.length) return 0;
  return Math.round(findings.filter(f => f.status === 'closed').length / findings.length * 100);
}

export function completedAuditKey(audit) {
  if (!audit) return '';
  const primary = audit.ref || audit.auditRef || audit.id || audit.auditId || '';
  if (primary) return [audit.dept || '', primary].join('|').toLowerCase();
  return [audit.dept || '', audit.submittedAt || audit.date || ''].join('|').toLowerCase();
}

let _derivedAuditsCache = { findings: null, depts: null, completed: null, result: null };

export function derivedCompletedAuditsFromFindings(findings, depts, completed) {
  if (_derivedAuditsCache.findings === findings && _derivedAuditsCache.depts === depts && _derivedAuditsCache.completed === completed) {
    return _derivedAuditsCache.result;
  }
  const existingKeys = new Set((completed || []).map(completedAuditKey).filter(Boolean));
  const existingRefs = new Set((completed || []).map(a => String(a && (a.ref || a.auditRef || a.id) || '').trim().toLowerCase()).filter(Boolean));
  const deptIndex = getDeptIndex(depts);
  const groups = {};
  (findings || []).forEach(f => {
    if (!f || !f.dept) return;
    const auditRef = String(f.auditRef || f.auditId || '').trim();
    if (auditRef && existingRefs.has(auditRef.toLowerCase())) return;
    const date = f.auditSubmittedAt || f.submittedAt || f.createdAt || f.date || '';
    const d = parseAuditDate(date);
    const day = d ? d.toISOString().slice(0, 10) : String(date || '').slice(0, 10);
    const stableDay = day || 'nodate';
    const key = f.dept + '|' + (auditRef || ('findings-' + stableDay));
    if (!groups[key]) {
      const dept = deptIndex.byCode.get(String(f.dept).toUpperCase()) || { code: f.dept, name: f.dept };
      const autoRef = auditRef || ('AUTO-' + f.dept + '-' + stableDay);
      groups[key] = { dept: f.dept, deptName: f.deptName || dept.name, ref: autoRef, submittedAt: date || '', date: date || '', rows: [] };
    }
    groups[key].rows.push(f);
  });
  const result = Object.keys(groups).map(key => {
    const g = groups[key];
    if (!g.submittedAt) return null;
    const counts = auditFindingCounts(g.rows);
    const audit = {
      id: 'derived_' + key.replace(/[^a-z0-9]+/gi, '_').toLowerCase(),
      ref: g.ref,
      dept: g.dept,
      deptName: g.deptName,
      status: 'submitted',
      submittedAt: g.submittedAt,
      date: g.date,
      findingRefs: g.rows.map(f => f.ref).filter(Boolean),
      auditScoreFrozen: scoreFromFindingCounts(counts),
      auditFindingCountsFrozen: counts,
      derivedFromFindings: true
    };
    return existingKeys.has(completedAuditKey(audit)) ? null : audit;
  }).filter(Boolean);
  _derivedAuditsCache = { findings, depts, completed, result };
  return result;
}

export function completedAuditsSorted(completed, findings, depts, deptCode) {
  const normalized = completed || [];
  const derived = derivedCompletedAuditsFromFindings(findings, depts, normalized);
  return normalized.concat(derived).filter(a => (!deptCode || a.dept === deptCode) && (!a.status || a.status === 'submitted')).slice().sort((a, b) => {
    return new Date(a.submittedAt || a.date || 0) - new Date(b.submittedAt || b.date || 0);
  });
}

export function frozenAuditScore(audit) {
  if (!audit) return null;
  const frozen = Number(audit.auditScoreFrozen);
  if (Number.isFinite(frozen)) return Math.max(0, Math.min(100, Math.round(frozen)));
  if (audit.auditFindingCountsFrozen) return scoreFromFindingCounts(audit.auditFindingCountsFrozen);
  if (audit.session && audit.session.findings) return auditScore(Object.values(audit.session.findings));
  return null;
}

export function latestDeptAudit(completed, findings, depts, deptCode) {
  const audits = completedAuditsSorted(completed, findings, depts, deptCode);
  return audits.length ? audits[audits.length - 1] : null;
}

export function latestDeptAuditScore(completed, findings, depts, deptCode) {
  const audits = completedAuditsSorted(completed, findings, depts, deptCode);
  if (!audits.length) return null;
  const latest = audits[audits.length - 1];
  const prev = audits.length > 1 ? audits[audits.length - 2] : null;
  const score = frozenAuditScore(latest);
  const prevScore = frozenAuditScore(prev);
  return {
    score,
    prevScore,
    audit: latest,
    prev,
    delta: (typeof score === 'number' && typeof prevScore === 'number') ? score - prevScore : null
  };
}

export function orgLatestAuditScore(completed, findings, depts) {
  const scores = (depts || []).map(d => {
    const s = latestDeptAuditScore(completed, findings, depts, d.code);
    return s && typeof s.score === 'number' ? s.score : null;
  }).filter(v => v !== null);
  if (!scores.length) return null;
  return Math.round(scores.reduce((sum, v) => sum + v, 0) / scores.length);
}

export function findingRaisedDate(f, yr) {
  if (!f) return null;
  return parseAuditDate(f.createdAt || f.submittedAt || f.auditSubmittedAt || f.date, yr) || parseAuditDate(f.due, yr);
}

export function findingClosedDate(f, yr) {
  if (!f) return null;
  return parseAuditDate(f.auditClosureDate || f.closedAt || f.decisionDate || f.closureDate, yr);
}

export function cumulativeClosureRateAt(findings, deptCode, monthEnd, yr) {
  const target = findings.filter(f => {
    if (deptCode && f.dept !== deptCode) return false;
    const raised = findingRaisedDate(f, yr);
    return raised && raised <= monthEnd;
  });
  if (!target.length) return null;
  const closed = target.filter(f => {
    if (f.status !== 'closed') return false;
    const closedAt = findingClosedDate(f, yr);
    return !closedAt || closedAt <= monthEnd;
  }).length;
  return Math.round((closed / target.length) * 100);
}

export function latestDeptAuditInMonth(completed, findings, depts, deptCode, yr, monthIndex) {
  const start = new Date(yr, monthIndex, 1);
  const end = new Date(yr, monthIndex + 1, 0, 23, 59, 59, 999);
  const audits = completedAuditsSorted(completed, findings, depts, deptCode).filter(a => {
    const d = parseAuditDate(a.submittedAt || a.date, yr);
    return d && d >= start && d <= end;
  });
  return audits.length ? audits[audits.length - 1] : null;
}

export function deptHasAuditInYear(completed, findings, depts, deptCode, yr) {
  return completedAuditsSorted(completed, findings, depts, deptCode).some(a => {
    const d = parseAuditDate(a.submittedAt || a.date, yr);
    return d && d.getFullYear() === yr;
  });
}

export function closureTrendDeptHasData(findings, deptCode, yr) {
  return findings.some(f => {
    if (f.dept !== deptCode) return false;
    const raised = findingRaisedDate(f, yr);
    return raised && raised.getFullYear() === yr;
  });
}

export function deptToken(value) {
  return String(value || '').trim()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

const _deptIndexCache = new WeakMap();

export function getDeptIndex(depts) {
  if (!depts) return { byCode: new Map(), byToken: new Map() };
  let idx = _deptIndexCache.get(depts);
  if (idx) return idx;
  const byCode = new Map();
  const byToken = new Map();
  depts.forEach(d => {
    if (!d) return;
    if (d.code) byCode.set(String(d.code).toUpperCase(), d);
    if (d.id) byCode.set(String(d.id).toUpperCase(), d);
    const t1 = deptToken(d.name); if (t1 && !byToken.has(t1)) byToken.set(t1, d);
    const t2 = deptToken(d.code); if (t2 && !byToken.has(t2)) byToken.set(t2, d);
    const t3 = deptToken((d.name || '') + ' ' + (d.code || '')); if (t3 && !byToken.has(t3)) byToken.set(t3, d);
  });
  idx = { byCode, byToken };
  _deptIndexCache.set(depts, idx);
  return idx;
}

export function deptRecordForValue(depts, value) {
  const raw = String(value || '').trim();
  if (!raw || !depts) return null;
  const idx = getDeptIndex(depts);
  const rawUp = raw.toUpperCase();
  if (idx.byCode.has(rawUp)) return idx.byCode.get(rawUp);
  const token = deptToken(raw);
  if (idx.byToken.has(token)) return idx.byToken.get(token);
  return null;
}

export function deptValuesMatch(depts, a, b) {
  const da = deptRecordForValue(depts, a), db = deptRecordForValue(depts, b);
  if (da && db) return da.code === db.code;
  if (da) return String(da.code || '').toUpperCase() === String(b || '').trim().toUpperCase() || deptToken(da.name) === deptToken(b);
  if (db) return String(db.code || '').toUpperCase() === String(a || '').trim().toUpperCase() || deptToken(db.name) === deptToken(a);
  return deptToken(a) && deptToken(a) === deptToken(b);
}

export function deptRecordForFinding(depts, f) {
  return deptRecordForValue(depts, f && f.dept) || deptRecordForValue(depts, f && f.deptName) || null;
}

export function deptCodeForFinding(depts, f) {
  const d = deptRecordForFinding(depts, f);
  return d ? d.code : String((f && f.dept) || (f && f.deptName) || 'Other').trim();
}

export function deptNameForFinding(depts, f) {
  const d = deptRecordForFinding(depts, f);
  return d ? d.name : String((f && f.deptName) || (f && f.dept) || 'Other').trim();
}

export function findingMatchesDept(depts, f, d) {
  if (!f || !d) return false;
  return deptValuesMatch(depts, f.dept, d.code) || deptValuesMatch(depts, f.deptName, d.code) || deptValuesMatch(depts, f.dept, d.name) || deptValuesMatch(depts, f.deptName, d.name);
}

export function rootCauseKey(name) {
  return String(name || '').trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

export const ROOT_CAUSE_ALIASES = {
  man: 'Man (Training)',
  manmonitoring: 'Man (Training)',
  mantraining: 'Man (Training)',
  monitoring: 'Man (Training)',
  training: 'Man (Training)',
  machineresources: 'Machine/System',
  machineresource: 'Machine/System',
  machinesystem: 'Machine/System',
  machine: 'Machine/System',
  resources: 'Machine/System',
  methodsystem: 'Method (SOP)',
  methodsop: 'Method (SOP)',
  method: 'Method (SOP)',
  sop: 'Method (SOP)',
  material: 'Material',
  measurement: 'Measurement',
  environment: 'Environment',
  unclassified: 'Unclassified'
};

export function canonicalRootCauseName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Unclassified';
  const key = rootCauseKey(raw);
  return ROOT_CAUSE_ALIASES[key] || raw;
}

export function dashboardRootCauseCategories(findings) {
  const cats = ['Man (Training)', 'Machine/System', 'Method (SOP)', 'Material', 'Measurement', 'Environment'];
  const add = (name) => {
    if (!name) return;
    const clean = canonicalRootCauseName(name);
    if (clean && !cats.includes(clean)) cats.push(clean);
  };
  (findings || []).forEach(f => {
    add(f.rc || f.rootCause || 'Unclassified');
  });
  if (!cats.includes('Unclassified')) cats.push('Unclassified');
  return cats;
}

// ── TASK / DATE HELPERS (ported from original portal) ──
export function capaKey(f) {
  return encodeURIComponent(String((f && (f.ref || f.id)) || ''));
}

export function localDateOnly(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function todayLocalDate() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function delayDays(f) {
  const d = localDateOnly(f && f.due);
  if (!d) return 0;
  return Math.max(0, Math.floor((todayLocalDate() - d) / 86400000));
}

export function daysUntilDue(f) {
  const d = localDateOnly(f && f.due);
  if (!d) return null;
  return Math.ceil((d - todayLocalDate()) / 86400000);
}

// Departments a user can manage: admin/auditor see all; manager sees own dept + reportingEmail matches; spoc sees own dept.
export function managerDeptCodes(user, depts, emailMaster) {
  if (!user) return [];
  const role = user.role;
  if (role === 'admin' || role === 'auditor') return (depts || []).map(d => d.code);
  const codes = new Set();
  if (user.dept) codes.add(user.dept);
  (emailMaster || []).forEach(r => {
    if (r.reportingEmail && user.email && String(r.reportingEmail).toLowerCase() === String(user.email).toLowerCase()) {
      codes.add(r.deptCode);
    }
  });
  return [...codes];
}

// ── CLAUSE MAP (ported from original portal) ──
export const CLAUSE_DESCRIPTIONS = {
  '4': 'Context of the organization',
  '4.3': 'Determining the scope of the quality management system',
  '4.4': 'Quality management system and its processes',
  '5': 'Leadership',
  '5.1': 'Leadership and commitment',
  '5.2': 'Quality policy',
  '5.3': 'Organizational roles, responsibilities and authorities',
  '6': 'Planning',
  '6.1': 'Actions to address risks and opportunities',
  '6.2': 'Quality objectives and planning to achieve them',
  '7': 'Support',
  '7.1': 'Resources',
  '7.1.3': 'Infrastructure',
  '7.1.4': 'Environment for operation of processes',
  '7.1.5': 'Monitoring and measuring resources',
  '7.2': 'Competence',
  '7.3': 'Awareness',
  '7.5': 'Documented information',
  '7.5.2': 'Creating and updating documented information',
  '7.5.3': 'Control of documented information',
  '8': 'Operation',
  '8.2': 'Requirements for products and services',
  '8.3': 'Design and development of products and services',
  '8.3.6': 'Design and development changes',
  '8.4': 'Control of externally provided processes, products and services',
  '8.4.1': 'General requirements for externally provided processes',
  '8.5': 'Production and service provision',
  '8.5.1': 'Control of production and service provision',
  '8.5.2': 'Identification and traceability',
  '8.5.3': 'Property belonging to customers or external providers',
  '8.5.4': 'Preservation',
  '8.5.5': 'Post-delivery activities',
  '8.5.6': 'Control of changes',
  '8.6': 'Release of products and services',
  '8.7': 'Control of nonconforming outputs',
  '8.7.1': 'Control of nonconforming product or service outputs',
  '9': 'Performance evaluation',
  '9.1': 'Monitoring, measurement, analysis and evaluation',
  '9.1.2': 'Customer satisfaction',
  '9.2': 'Internal audit',
  '9.3': 'Management review',
  '9.3.3': 'Management review outputs',
  '10': 'Improvement',
  '10.2': 'Nonconformity and corrective action',
};

export function clauseName(clause) {
  return String(clause || '—').trim() || '—';
}

export function clauseKey(clause) {
  const m = clauseName(clause).replace(/AS9100D|ISO\s*9001|ISO\s*14001|ISO\s*45001/ig, '').match(/(\d+(?:\.\d+)*)/);
  return m ? m[1] : '';
}

export function clauseDescription(clause) {
  let key = clauseKey(clause);
  while (key) {
    if (CLAUSE_DESCRIPTIONS[key]) return CLAUSE_DESCRIPTIONS[key];
    const parts = key.split('.');
    parts.pop();
    key = parts.join('.');
  }
  return 'Clause description not mapped';
}

export function auditScoreColorVar(score) {
  return score >= 80 ? 'green' : score >= 60 ? 'amber' : 'red';
}

// Date-range filter matching the original filterByDateRange (keeps items with no matching date field).
export function filterFindingsByDateRange(findings, dateFrom, dateTo, fields) {
  if (!dateFrom && !dateTo) return findings || [];
  const flds = fields || ['due', 'date', 'createdAt', 'submittedAt', 'auditSubmittedAt', 'closureDate', 'closureSubmittedAt', 'decisionDate', 'decisionAt', 'auditClosureDate', 'closedAt', 'updatedAt'];
  const from = dateFrom ? new Date(dateFrom) : null;
  const to = dateTo ? new Date(dateTo + 'T23:59:59') : null;
  return (findings || []).filter(item => {
    let sawDate = false;
    for (let i = 0; i < flds.length; i++) {
      const raw = item && item[flds[i]];
      if (!raw) continue;
      const d = new Date(raw);
      if (isNaN(d.getTime())) continue;
      sawDate = true;
      if (from && d < from) continue;
      if (to && d > to) continue;
      return true;
    }
    return !sawDate;
  });
}
