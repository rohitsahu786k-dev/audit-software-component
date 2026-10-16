import { genId } from './helpers';
import {
  auditFindingCounts, scoreFromFindingCounts, deptRecordForValue, deptValuesMatch,
} from './dashboardHelpers';

// Columns in the exported template. The first block is required by the import;
// the second block is optional and has safe fallbacks (see buildExternalAuditImport).
export const EXTERNAL_AUDIT_REQUIRED_HEADERS = [
  'Sr. No.', 'Date of Audit', 'Department', 'Topic/Question', 'NC Type',
  'Description of Finding', 'Target Closure Date', 'Status',
];
export const EXTERNAL_AUDIT_OPTIONAL_HEADERS = [
  'Responsible Owner', 'Responsible Owner Email', 'External Audit Name', 'External Audit Reference', 'Clause',
];
export const EXTERNAL_AUDIT_HEADERS = [...EXTERNAL_AUDIT_REQUIRED_HEADERS, ...EXTERNAL_AUDIT_OPTIONAL_HEADERS];

// Shown only on the Instructions sheet; the data sheet is exported blank.
export const EXTERNAL_AUDIT_SAMPLE = [{
  'Sr. No.': 1,
  'Date of Audit': '14/10/2026',
  Department: 'Quality',
  'Topic/Question': 'Document control',
  'NC Type': 'Major',
  'Description of Finding': 'Controlled copies of work instructions found obsolete at the point of use.',
  'Target Closure Date': '31/10/2026',
  Status: 'Open',
  'Responsible Owner': 'Owner Name',
  'Responsible Owner Email': 'owner@example.com',
  'External Audit Name': 'Customer Quality Audit',
  'External Audit Reference': 'EXT-2026-001',
  Clause: '7.5',
}];

const aliases = {
  serial: ['Sr. No.', 'Sr No', 'Sr. No', 'Serial No', 'S.No', 'S No', 'SNo'],
  auditName: ['External Audit Name', 'Audit Name', 'External Audit'],
  auditRef: ['External Audit Reference', 'Audit Reference', 'Audit Ref', 'Report No'],
  auditDate: ['Date of Audit', 'Audit Date'],
  department: ['Department', 'Dept'],
  topic: ['Topic/Question', 'Topic / Question', 'Topic', 'Question'],
  severity: ['NC Type', 'Type of NC', 'Severity', 'Finding Type'],
  description: ['Description of Finding', 'Finding Description', 'NC Description', 'Description', 'Finding'],
  owner: ['Responsible Owner', 'Owner', 'Responsible Person'],
  ownerEmail: ['Responsible Owner Email', 'Owner Email', 'Responsible Email'],
  due: ['Target Closure Date', 'Due Date', 'Target Date'],
  status: ['Status', 'Finding Status'],
  clause: ['Clause', 'Clause No', 'Clause Number'],
};

const REQUIRED_KEYS = ['serial', 'auditDate', 'department', 'topic', 'severity', 'description', 'due', 'status'];

function norm(value) { return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }

function cell(row, names) {
  const entries = Object.entries(row || {});
  for (const name of names) {
    const wanted = norm(name);
    const hit = entries.find(([key]) => norm(key) === wanted);
    if (hit && String(hit[1] ?? '').trim()) return hit[1];
  }
  return '';
}

function hasColumn(headers, names) {
  const set = new Set(headers.map(norm));
  return names.some(n => set.has(norm(n)));
}

function ymd(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Accepts an Excel serial number, DD/MM/YYYY (also - or .), YYYY-MM-DD, or "14 Oct 2026".
// Always returns a plain YYYY-MM-DD built from calendar parts (never via toISOString, which
// shifts the day in timezones ahead of UTC such as IST).
export function externalAuditDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return ymd(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 1 || value > 2958465) return '';
    const parts = window.XLSX?.SSF?.parse_date_code(value);
    if (parts) return ymd(parts.y, parts.m, parts.d);
    const ms = Math.round((value - 25569) * 86400000);
    const d = new Date(ms);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const raw = String(value).trim();
  let m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return ymd(m[3], m[2], m[1]);
  m = raw.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = raw.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ ,-]+(\d{4})$/);
  if (m) {
    const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].slice(0, 3).toLowerCase());
    return idx < 0 ? '' : ymd(m[3], idx + 1, m[1]);
  }
  return '';
}

function localToday() {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function statusOf(value, due) {
  const s = norm(value || 'open').replace(/[ _]+/g, '-');
  if (['closed', 'close', 'completed', 'complete', 'done'].includes(s)) return 'closed';
  if (['in-progress', 'inprogress', 'ongoing', 'wip', 'work-in-progress'].includes(s)) return 'in-progress';
  if (['pending-closure', 'submitted', 'submit-for-review', 'under-review', 'pending-review'].includes(s)) return 'pending-closure';
  if (['delayed', 'overdue'].includes(s)) return 'delayed';
  if (!['open', 'new', 'pending'].includes(s)) return '';
  return due && due < localToday() ? 'delayed' : 'open';
}

function severityOf(value) {
  const s = norm(value);
  if (!s) return '';
  if (s.includes('critical') || s === 'cr') return 'critical';
  if (s.includes('major') || s === 'ma') return 'major';
  if (s.includes('minor') || s === 'mi') return 'minor';
  if (s === 'ob' || s === 'obs' || s.includes('observation') || s === 'ofi' || s.includes('opportunity')) return 'obs';
  return '';
}

function emailValid(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function token(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Exact/token match via the shared dept index, then a single unambiguous partial match
// ("Quality" -> "Quality Assurance"). Several candidates = ambiguous = not matched.
function resolveDept(depts, raw) {
  const exact = deptRecordForValue(depts, raw);
  if (exact) return { dept: exact, partial: false };
  const needle = norm(raw);
  if (needle.length < 3) return { dept: null, partial: false };
  const hits = (depts || []).filter(d => {
    const name = norm(d.name);
    return name && (name.includes(needle) || needle.includes(name));
  });
  return hits.length === 1 ? { dept: hits[0], partial: true } : { dept: null, partial: false };
}

function defaultOwner(dept, users, emailMaster, depts) {
  const spoc = (users || []).find(u => u && u.active !== false && u.role === 'spoc' && u.email && deptValuesMatch(depts, u.dept, dept.code));
  if (spoc) return { name: spoc.name || spoc.loginId || 'Department SPOC', email: String(spoc.email).trim().toLowerCase() };
  const master = (emailMaster || []).find(m => m && String(m.status || 'active').toLowerCase() !== 'inactive'
    && (deptValuesMatch(depts, m.deptCode, dept.code) || deptValuesMatch(depts, m.department, dept.code)));
  if (master) {
    const email = String(master.email || '').split(/\|\||[;,]/)[0].trim().toLowerCase();
    return { name: master.spocName || `${dept.name} SPOC`, email: emailValid(email) ? email : '' };
  }
  return { name: `${dept.name} SPOC`, email: '' };
}

export function buildExternalAuditImport(rows, { depts, users, emailMaster, findings, completed, fileName, currentUser }) {
  const errors = [];
  const warnings = [];
  const normalized = [];
  const allRows = Array.isArray(rows) ? rows : [];
  const dataRows = allRows.filter(row => Object.values(row || {}).some(v => String(v ?? '').trim()));

  if (!dataRows.length) {
    return { ok: false, errors: [{ rn: 1, kind: 'error', msg: 'The file has no data rows. Fill the template below the heading row and upload again.' }], warnings, findings: [], audits: [] };
  }

  const headers = Array.from(new Set(allRows.flatMap(r => Object.keys(r || {}))));
  const missingColumns = REQUIRED_KEYS.filter(k => !hasColumn(headers, aliases[k])).map(k => aliases[k][0]);
  if (!hasColumn(headers, aliases.description) && !missingColumns.includes('Description of Finding')) missingColumns.push('Description of Finding');
  if (missingColumns.length) {
    return { ok: false, errors: [{ rn: 1, kind: 'error', msg: `Missing column heading(s): ${missingColumns.join(', ')}. Use the template exported from the portal without renaming headings.` }], warnings, findings: [], audits: [] };
  }

  const existingKeys = new Set((findings || []).map(f => String(f.externalImportKey || '').toLowerCase()).filter(Boolean));
  const usedRefs = new Set((findings || []).map(f => String(f.ref || '').toLowerCase()).filter(Boolean));
  const seenKeys = new Set();
  const validDeptNames = (depts || []).map(d => d.name).filter(Boolean).join(', ');

  allRows.forEach((row, index) => {
    const rowNo = index + 2;
    if (!Object.values(row || {}).some(v => String(v ?? '').trim())) return;

    const rawDept = String(cell(row, aliases.department)).trim();
    const resolved = rawDept ? resolveDept(depts, rawDept) : { dept: null, partial: false };
    const dept = resolved.dept;
    const auditDate = externalAuditDate(cell(row, aliases.auditDate));
    const due = externalAuditDate(cell(row, aliases.due));
    const description = String(cell(row, aliases.description)).trim();
    const topic = String(cell(row, aliases.topic)).trim();
    const severity = severityOf(cell(row, aliases.severity));
    const serial = String(cell(row, aliases.serial)).trim() || String(index + 1);
    const status = statusOf(cell(row, aliases.status), due);
    const problems = [];

    if (!auditDate) problems.push('valid Date of Audit (DD/MM/YYYY)');
    if (!rawDept) problems.push('Department');
    else if (!dept) problems.push(`Department "${rawDept}" not found in Department Master (available: ${validDeptNames || 'none'})`);
    if (!topic) problems.push('Topic/Question');
    if (!severity) problems.push('NC Type (Critical, Major, Minor or Observation)');
    if (!description) problems.push('Description of Finding');
    if (!due) problems.push('valid Target Closure Date (DD/MM/YYYY)');
    if (!status) problems.push('valid Status (Open, In Progress, Delayed, Pending Closure, Closed)');
    if (auditDate && due && due < auditDate) problems.push('Target Closure Date on/after Date of Audit');

    let owner = String(cell(row, aliases.owner)).trim();
    let ownerEmail = String(cell(row, aliases.ownerEmail)).trim().toLowerCase();
    if (ownerEmail && !emailValid(ownerEmail)) problems.push('valid Responsible Owner Email');

    if (problems.length) {
      errors.push({ rn: rowNo, kind: 'error', msg: `Invalid/missing: ${problems.join('; ')}` });
      return;
    }

    if (resolved.partial) warnings.push({ rn: rowNo, kind: 'warn', msg: `Department "${rawDept}" matched to "${dept.name}"` });
    if (!ownerEmail && owner) {
      const matched = (users || []).find(u => u && u.active !== false && norm(u.name) === norm(owner) && u.email && (!u.dept || deptValuesMatch(depts, u.dept, dept.code)));
      ownerEmail = String(matched?.email || '').trim().toLowerCase();
    }
    if (!owner || !ownerEmail) {
      const fallback = defaultOwner(dept, users, emailMaster, depts);
      if (!owner) { owner = fallback.name; warnings.push({ rn: rowNo, kind: 'warn', msg: `No Responsible Owner - assigned to ${fallback.name}` }); }
      if (!ownerEmail) ownerEmail = fallback.email;
    }
    if (!ownerEmail) warnings.push({ rn: rowNo, kind: 'warn', msg: 'No owner email found - reminders will go to the department email list only' });

    const auditName = String(cell(row, aliases.auditName)).trim() || 'External Audit';
    const auditRef = String(cell(row, aliases.auditRef)).trim() || `EXT-${auditDate.replace(/-/g, '')}`;
    const importKey = token([auditRef, auditDate, dept.code, serial, description].join('|'));
    if (existingKeys.has(importKey) || seenKeys.has(importKey)) {
      warnings.push({ rn: rowNo, kind: 'warn', msg: 'Duplicate external finding - skipped' });
      return;
    }
    seenKeys.add(importKey);
    normalized.push({
      rowNo, serial, dept, auditDate, due, description, topic, owner, ownerEmail, auditName, auditRef,
      status, severity, clause: String(cell(row, aliases.clause)).trim() || '-', importKey,
    });
  });

  if (errors.length) return { ok: false, errors, warnings, findings: [], audits: [] };
  if (!normalized.length) return { ok: true, errors, warnings, findings: [], audits: [] };

  const importedAt = new Date().toISOString();
  const importedText = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const todayStr = localToday();
  const newFindings = normalized.map(item => {
    let ref = `${item.auditRef}-${item.dept.code}-${String(item.serial).replace(/\s+/g, '')}`;
    let n = 2;
    while (usedRefs.has(ref.toLowerCase())) ref = `${item.auditRef}-${item.dept.code}-${String(item.serial).replace(/\s+/g, '')}-${n++}`;
    usedRefs.add(ref.toLowerCase());
    const closeDay = item.due < todayStr ? item.due : todayStr;
    return {
      id: genId('ext'), ref, dept: item.dept.code, deptName: item.dept.name,
      desc: item.description, topic: item.topic, sev: item.severity, clause: item.clause,
      due: item.due, status: item.status, capaStatus: item.status === 'pending-closure' ? 'submitted' : item.status,
      type: 'external-audit', source: 'external-audit', auditType: 'external', externalAudit: true,
      auditRef: item.auditRef, externalAuditName: item.auditName, auditDate: item.auditDate, importRow: item.rowNo,
      auditSubmittedAt: `${item.auditDate}T12:00:00.000Z`, responsibleOwner: item.owner, ownerEmail: item.ownerEmail,
      externalImportKey: item.importKey, importFile: fileName, createdAt: `${item.auditDate}T12:00:00.000Z`, updatedAt: importedAt,
      ...(item.status === 'closed' ? { auditClosureDate: closeDay, closedAt: `${closeDay}T12:00:00.000Z` } : {}),
      activityLog: [{ user: currentUser?.name || currentUser?.loginId || 'System', action: `External audit finding imported from ${fileName}`, ts: importedText }],
      closureEvidence: '', closureFiles: [], closureSubmittedBy: null, closureDate: null,
      decision: item.status === 'closed' ? 'accept' : null, decisionComments: item.status === 'closed' ? 'Closed in external audit report (imported)' : '',
      decisionDate: item.status === 'closed' ? closeDay : null,
    };
  });

  const groups = new Map();
  newFindings.forEach(f => {
    const key = `${f.auditRef}|${f.dept}`.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  });
  const existingAuditKeys = new Set((completed || []).map(a => `${String(a.ref || a.auditRef || '').toLowerCase()}|${String(a.dept || '').toLowerCase()}`));
  const audits = [];
  groups.forEach(group => {
    const first = group[0];
    const auditKey = `${first.auditRef.toLowerCase()}|${first.dept.toLowerCase()}`;
    // The same external audit imported again (new findings added later): keep the one
    // report entry; its score is recomputed server-side from the linked findings.
    if (existingAuditKeys.has(auditKey)) return;
    const earliest = group.map(f => f.auditDate).sort()[0];
    const counts = auditFindingCounts(group);
    audits.push({
      id: genId('extaudit'), ref: first.auditRef, auditRef: first.auditRef,
      title: first.externalAuditName, dept: first.dept, deptName: first.deptName,
      status: 'submitted', auditSource: 'external', auditType: 'external', source: 'external-audit', externalAudit: true,
      date: earliest, submittedAt: `${earliest}T12:00:00.000Z`, updatedAt: importedAt,
      importedAt, importFile: fileName, findingRefs: group.map(f => f.ref),
      auditScoreFrozen: scoreFromFindingCounts(counts), auditFindingCountsFrozen: counts,
      auditor: currentUser?.name || currentUser?.loginId || 'External Auditor',
    });
  });
  return { ok: true, errors, warnings, findings: newFindings, audits };
}
