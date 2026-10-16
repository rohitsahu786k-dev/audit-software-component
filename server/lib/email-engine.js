'use strict';

// Automatic CAPA reminder engine.
//
// Runs on the server (see the cron wiring in server.js) rather than in an admin's browser, so a
// reminder goes out whether or not anyone has the portal open. Every automatic email CCs the
// department's Manager and HOD/BUH from the Email Master, plus the global CC list.
//
// Escalation policy mirrors the matrix the CAPA page already advertises to users:
//   due/overdue 0-6d Delayed NC -> SPOC              on delay days 0, 3 and 6
//   overdue 7-14d  Escalation   -> HOD (SPOC in CC)  every 2 days
//   overdue 15d+   Escalation   -> HOD + Management  every 30 days
//   due within 0-2d Upcoming    -> SPOC              once per target date
//
// The engine never mutates findings; it only sends and logs.

const { getCollection } = require('./mongo');
const { getMailer, SMTP_FROM } = require('./mailer');
const { mergeEmailLogs } = require('./sync-helpers');
const { claimEmailLock, commitEmailLock } = require('./email-locks');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TZ = process.env.EMAIL_CRON_TZ || 'Asia/Kolkata';
const DEFAULT_WINDOW_DAYS = Number(process.env.EMAIL_REMINDER_WINDOW_DAYS || 2);

// Defaults for ap_email_rules — the config the Email Center writes. Mirrored in
// client/src/utils/emailRules.js; keep the two in step.
const EMAIL_RULES_DEFAULTS = {
  enabled: true,
  windowDays: DEFAULT_WINDOW_DAYS,
  ccManager: true,
  ccHod: true,
  ccGlobal: true,
  types: { upcoming_reminder: true, delayed: true, escalation: true },
  frequencies: { upcoming_reminder: 365, delayed: 1, escalation_2: 2, escalation_3: 30 },
  suppressed: [],
  depts: {},
};

const READ_KEYS = ['ap_finds', 'ap_depts', 'ap_users', 'ap_auds', 'ap_completed_audits', 'ap_email_master', 'ap_email_templates', 'ap_required_cc_emails', 'ap_system_settings', 'ap_email_rules'];

function mergeRules(stored) {
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

// Both escalation levels are governed by the single "escalation" switch in the UI.
function typeSwitchKey(bucket) {
  return bucket.startsWith('escalation') ? 'escalation' : bucket;
}

// ── DATES ────────────────────────────────────────────
// Findings store `due` as a plain YYYY-MM-DD with no timezone. The server may well run in UTC
// while the business day is IST, so anchor "today" to an explicit zone: comparing against a UTC
// clock would flip a due date a day early or late for anyone near midnight.
function todayYmd(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function ymdToMs(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}

// ── FINDINGS ─────────────────────────────────────────
// Mirrors findingWorkflowStatus() in client/src/utils/helpers.js — keep the two in step.
function workflowStatus(f) {
  if (!f) return '';
  const status = String(f.status || '').toLowerCase();
  const capa = String(f.capaStatus || '').toLowerCase();
  if (status === 'closed' || capa === 'closed') return 'closed';
  if (status === 'pending-closure') return 'pending-closure';
  if (capa === 'submitted' && (!status || status === 'open')) return 'pending-closure';
  return status || capa || 'open';
}

function isActionable(f) {
  if (!f || f.deletedAt) return false;
  if (String(f.status || '').toLowerCase() === 'draft') return false;
  const ws = workflowStatus(f);
  // 'pending-closure' sits with the reviewer, not the SPOC — nagging the SPOC there is noise.
  return ws !== 'closed' && ws !== 'pending-closure';
}

function classifyAll(f, todayMs, windowDays) {
  const dueMs = ymdToMs(f.due);
  if (!Number.isFinite(dueMs)) return [];
  const overdue = Math.round((todayMs - dueMs) / DAY_MS);
  if (overdue >= 15) return [{ type: 'escalation', level: 3, overdue }];
  if (overdue >= 7) return [{ type: 'escalation', level: 2, overdue }];
  const hits = [];
  if ([0, 3, 6].includes(overdue)) hits.push({ type: 'delayed', level: 1, overdue });
  const until = -overdue;
  if (until >= 0 && until <= Math.min(2, windowDays)) hits.push({ type: 'upcoming_reminder', level: 0, overdue: 0, until });
  return hits;
}

function classify(f, todayMs, windowDays) {
  return classifyAll(f, todayMs, windowDays)[0] || null;
}

function bucketOf(hit) {
  return hit.type === 'escalation' ? `escalation_${hit.level}` : hit.type;
}

// ── RECIPIENTS ───────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function splitEmails(value) {
  return String(value || '')
    .split(/\|\||[;,]/)
    .map(s => s.trim())
    .filter(s => EMAIL_RE.test(s));
}
function dedupe(list) {
  const seen = new Set();
  return list.filter(e => {
    const k = e.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function withoutAll(list, exclude) {
  const block = new Set(exclude.map(e => e.toLowerCase()));
  return list.filter(e => !block.has(e.toLowerCase()));
}

function deptToken(value) {
  return String(value || '').trim().replace(/\([^)]*\)/g, ' ').replace(/&/g, ' ').replace(/\band\b/ig, ' ').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}
function deptMatches(depts, a, b) {
  const find = value => {
    const raw = String(value || '').trim();
    const token = deptToken(raw);
    return (depts || []).find(d => String(d.code || d.id || '').toUpperCase() === raw.toUpperCase() || deptToken(d.name) === token || deptToken(d.code) === token);
  };
  const da = find(a), db = find(b);
  if (da && db) return String(da.code) === String(db.code) || deptToken(da.name) === deptToken(db.name);
  return Boolean(deptToken(a) && deptToken(a) === deptToken(b));
}

// By default the department Manager and HOD/BUH ride along on every automatic email. The Email
// Center can turn each of those off globally, add per-department CCs, or override the To line.
function recipientsFor(bucket, master, globalCc, rules = EMAIL_RULES_DEFAULTS, deptRule = {}, requiredCc = []) {
  const spoc = splitEmails(master && master.email);
  const manager = splitEmails(master && master.reportingEmail);
  const hod = splitEmails(master && master.hodEmail);
  const management = splitEmails(master && master.managementEmail);
  const overrideTo = splitEmails((Array.isArray(deptRule.overrideTo) ? deptRule.overrideTo : []).join(','));

  let to;
  if (overrideTo.length) to = overrideTo;
  else if (bucket === 'escalation_3') to = dedupe([...management]);
  else if (bucket === 'escalation_2') to = dedupe([...hod]);
  else to = dedupe([...spoc]);

  // Never drop an email on the floor because one field is blank: fall back down the chain.
  if (!to.length) to = dedupe([...spoc, ...manager, ...hod, ...management]);
  if (!to.length) return { to: [], cc: [] };

  const cc = dedupe([
    ...(rules.ccManager !== false ? manager : []),
    ...(rules.ccHod !== false ? hod : []),
    ...(bucket.startsWith('escalation') ? spoc : []),
    ...splitEmails((Array.isArray(deptRule.extraCc) ? deptRule.extraCc : []).join(',')),
    ...requiredCc,
    ...(rules.ccGlobal !== false ? globalCc : []),
  ]);
  return { to, cc: withoutAll(cc, to) };
}

// ── TEMPLATES ────────────────────────────────────────
// Both escalation levels share the one "escalation" template; level is exposed as {{escalation_level}}.
// Stored rows carry a `type` ("delayed") and a prefixed `id` ("tpl_delayed") — accept either.
function templateFor(templates, bucket) {
  const wanted = bucket.startsWith('escalation') ? 'escalation' : bucket;
  const row = (Array.isArray(templates) ? templates : []).find(t => {
    if (!t) return false;
    return String(t.type || '').trim() === wanted || String(t.id || '').trim().replace(/^tpl_/, '') === wanted;
  });
  if (!row || row.active === false) return null;
  return row;
}
function replaceTemplate(str, vars) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function buildNcTable(rows) {
  const head = ['NC No.', 'Clause', 'Severity', 'Target Date', 'Status', 'Overdue'];
  const th = head.map(h => `<th style="padding:6px 10px;border:1px solid #d1d5db;background:#f3f4f6;text-align:left;font-size:12px;">${h}</th>`).join('');
  const body = rows.map(({ f, hit }) => {
    const cells = [
      f.ref || '',
      f.clause || '',
      f.sev || '',
      f.due || '',
      workflowStatus(f),
      hit.overdue > 0 ? `${hit.overdue} day(s)` : '—',
    ];
    return `<tr>${cells.map(c => `<td style="padding:6px 10px;border:1px solid #d1d5db;font-size:12px;">${escapeHtml(c)}</td>`).join('')}</tr>`;
  }).join('');
  return `<table style="border-collapse:collapse;width:100%;margin:8px 0;">
<thead><tr>${th}</tr></thead>
<tbody>${body}</tbody>
</table>`;
}

// ── STORE ────────────────────────────────────────────
async function readKeys(collection) {
  const docs = await collection.find({ key: { $in: READ_KEYS } }).toArray();
  const out = {};
  docs.forEach(d => { out[d.key] = d.value; });
  return out;
}

async function appendEmailLogs(collection, logs, by) {
  if (!logs.length) return;
  const current = await collection.findOne({ key: 'ap_email_logs' });
  const value = mergeEmailLogs(current && current.value, logs, current && current.clearedAt);
  await collection.updateOne(
    { key: 'ap_email_logs' },
    { $set: { key: 'ap_email_logs', value, updatedAt: new Date(), updatedBy: by, clearedAt: (current && current.clearedAt) || null } },
    { upsert: true }
  );
}

// ── ENGINE ───────────────────────────────────────────
async function runEmailAutomation(options = {}) {
  const by = String(options.by || 'cron');
  const dryRun = Boolean(options.dryRun);
  const tz = options.tz || DEFAULT_TZ;

  const collection = await getCollection();
  const data = await readKeys(collection);

  const settings = data.ap_system_settings && typeof data.ap_system_settings === 'object' ? data.ap_system_settings : {};
  const rules = mergeRules(data.ap_email_rules);

  // Two independent kill switches: the long-standing system setting, and the Email Center's own.
  if (settings.emailNotifications === false) {
    return { ok: true, skipped: 'emailNotifications is off in System Settings', sent: 0, failed: 0, skippedCount: 0, groups: 0, results: [] };
  }
  if (rules.enabled === false) {
    return { ok: true, skipped: 'Automatic emails are paused in the Email Center', sent: 0, failed: 0, skippedCount: 0, groups: 0, results: [] };
  }

  let findings = Array.isArray(data.ap_finds) ? data.ap_finds : [];
  const emailMaster = Array.isArray(data.ap_email_master) ? data.ap_email_master : [];
  const templates = Array.isArray(data.ap_email_templates) ? data.ap_email_templates : [];
  const depts = Array.isArray(data.ap_depts) ? data.ap_depts : [];
  const users = Array.isArray(data.ap_users) ? data.ap_users.filter(user => user && user.active !== false && user.email) : [];
  const auditors = Array.isArray(data.ap_auds) ? data.ap_auds : [];
  const completedAudits = (Array.isArray(data.ap_completed_audits) ? data.ap_completed_audits : []).filter(audit => audit && !audit.deletedAt);
  const globalCc = dedupe(splitEmails((Array.isArray(data.ap_required_cc_emails) ? data.ap_required_cc_emails : []).join(',')));
  const windowDays = Math.max(0, Number(rules.windowDays != null ? rules.windowDays : settings.reminderWindowDays || DEFAULT_WINDOW_DAYS));
  const autoEscalation = settings.autoEscalation !== false;
  const suppressed = new Set(splitEmails((rules.suppressed || []).join(',')).map(e => e.toLowerCase()));
  const stripSuppressed = list => list.filter(e => !suppressed.has(e.toLowerCase()));

  const todayMs = ymdToMs(todayYmd(tz));

  // Keep workflow status aligned with the source portal: the due date itself remains
  // actionable without being marked delayed; status flips only after the date is missed.
  if (!dryRun) {
    const nowIso = new Date().toISOString();
    let changed = false;
    const nextFindings = findings.map(f => {
      const dueMs = ymdToMs(f && f.due);
      if (!isActionable(f) || !Number.isFinite(dueMs) || dueMs >= todayMs || String(f.status || '').toLowerCase() === 'delayed') return f;
      changed = true;
      const activityLog = Array.isArray(f.activityLog) ? f.activityLog.slice() : [];
      if (!activityLog.some(log => /auto status changed to delayed/i.test(String(log && log.action)))) {
        activityLog.push({ user: 'System', action: 'Auto status changed to Delayed (due date missed)', ts: new Date().toLocaleString('en-IN', { timeZone: tz }) });
      }
      return { ...f, previousStatusBeforeDelay: f.status || 'open', status: 'delayed', capaStatus: 'delayed', delayedAt: f.delayedAt || nowIso, updatedAt: nowIso, activityLog };
    });
    if (changed) {
      const update = await collection.updateOne(
        { key: 'ap_finds', value: findings },
        { $set: { value: nextFindings, updatedAt: new Date(), updatedBy: `email-engine:${by}` } }
      );
      if (update.modifiedCount) findings = nextFindings;
    }
  }

  // Group actionable findings by department + bucket: one email per dept per bucket, not per NC.
  const groups = new Map();
  const muted = [];
  findings.filter(isActionable).forEach(f => {
    classifyAll(f, todayMs, windowDays).forEach(hit => {
    const bucket = bucketOf(hit);
    if (!autoEscalation && bucket.startsWith('escalation')) return;
    const findingDept = f.dept || f.deptName || '';
    const deptRecord = depts.find(d => deptMatches(depts, d.code, findingDept) || deptMatches(depts, d.name, findingDept));
    const deptCode = String((deptRecord && deptRecord.code) || findingDept).trim();
    if (!deptCode) return;

    // "kisko send karna hai, kisko nahi" — the Email Center's per-type and per-department switches.
    const deptRule = rules.depts[deptCode] || {};
    const typeKey = typeSwitchKey(bucket);
    if (rules.types[typeKey] === false) { muted.push({ bucket, deptCode, reason: `${typeKey} emails are switched off for everyone` }); return; }
    if (deptRule.enabled === false) { muted.push({ bucket, deptCode, reason: `${deptCode} is switched off in the Email Center` }); return; }
    if (deptRule.types && deptRule.types[typeKey] === false) { muted.push({ bucket, deptCode, reason: `${typeKey} is switched off for ${deptCode}` }); return; }

    const gk = `${bucket}|${deptCode}`;
    if (!groups.has(gk)) groups.set(gk, { bucket, deptCode, rows: [] });
    groups.get(gk).rows.push({ f, hit });
    });
  });

  const results = [];
  const logs = [];
  let sent = 0, failed = 0, skipped = 0;

  for (const group of groups.values()) {
    const { bucket, deptCode, rows } = group;
    const matchingMasterRecords = emailMaster.filter(m => deptMatches(depts, m.deptCode, deptCode) || deptMatches(depts, m.department, deptCode));
    const master = matchingMasterRecords.find(m => String(m.status || 'active').toLowerCase() !== 'inactive') || null;
    const masterRecord = master || matchingMasterRecords[0] || null;
    const dept = depts.find(d => deptMatches(depts, d.code, deptCode));
    const deptName = (masterRecord && masterRecord.department) || (dept && dept.name) || deptCode;
    let sendRows = rows;
    let refs = sendRows.map(r => r.f.ref).filter(Boolean).sort();

    if (matchingMasterRecords.length && !master) {
      skipped++;
      results.push({ bucket, dept: deptCode, deptName, ncCount: rows.length, status: 'skipped', reason: `email record for ${deptCode} is deactivated` });
      continue;
    }

    const tpl = templateFor(templates, bucket);
    if (!tpl) {
      skipped++;
      results.push({ bucket, dept: deptCode, ncCount: rows.length, status: 'skipped', reason: `no active template for "${bucket}"` });
      continue;
    }

    const deptRule = rules.depts[deptCode] || {};
    const deptUsers = users.filter(user => deptMatches(depts, user.dept, deptCode));
    const deptAudits = completedAudits.filter(audit => deptMatches(depts, audit.dept || audit.deptName || audit.department, deptCode));
    const latestAudit = deptAudits.slice().sort((a, b) => Date.parse(a.submittedAt || a.date || 0) - Date.parse(b.submittedAt || b.date || 0)).pop() || {};
    const auditorEmails = dedupe([
      ...auditors.filter(auditor => auditor && auditor.email && latestAudit.auditor && auditor.name === latestAudit.auditor).flatMap(auditor => splitEmails(auditor.email)),
      ...users.filter(user => user.role === 'auditor' && (!latestAudit.auditor || user.name === latestAudit.auditor || user.loginId === latestAudit.auditor)).flatMap(user => splitEmails(user.email)),
    ]);
    const requiredCc = dedupe([...auditorEmails, ...users.filter(user => user.role === 'admin').flatMap(user => splitEmails(user.email))]);
    const resolvedMaster = {
      ...(master || {}),
      email: dedupe([...splitEmails(master && master.email), ...deptUsers.filter(user => user.role === 'spoc').flatMap(user => splitEmails(user.email))]).join(', '),
      reportingEmail: dedupe([...splitEmails(master && master.reportingEmail), ...deptUsers.filter(user => user.role === 'manager').flatMap(user => splitEmails(user.email))]).join(', '),
      managementEmail: dedupe([...splitEmails(master && master.managementEmail), ...users.filter(user => user.role === 'admin' || user.role === 'viewer').flatMap(user => splitEmails(user.email))]).join(', '),
    };
    const resolved = recipientsFor(bucket, resolvedMaster, globalCc, rules, deptRule, requiredCc);
    const to = stripSuppressed(resolved.to);
    // Findings imported from an external audit carry their own responsible owner; keep that
    // person in the loop (CC) alongside the department chain.
    const ownerCc = dedupe(rows.flatMap(r => splitEmails(r.f.ownerEmail)));
    const cc = stripSuppressed(withoutAll(dedupe([...resolved.cc, ...ownerCc]), resolved.to));
    if (!to.length) {
      // Surface the gap instead of dropping silently — a missing SPOC address in the Email
      // Master is exactly how a department stops receiving reminders without anyone noticing.
      skipped++;
      const reason = !master
        ? `dept ${deptCode} is not in the Email Master`
        : resolved.to.length
          ? `every recipient for dept ${deptCode} is on the suppression list`
          : `no usable email addresses for dept ${deptCode}`;
      results.push({ bucket, dept: deptCode, deptName, ncCount: rows.length, status: 'skipped', reason });
      logs.push({ id: `${bucket}_${deptCode}_${Date.now()}`, type: bucket, to: '', cc: '', subject: `[not sent] ${deptName} — ${rows.length} NC(s)`, status: 'skipped', error: reason, dept: deptCode, ncCount: rows.length, sentAt: new Date().toISOString() });
      continue;
    }

    const frequencyDays = bucket === 'upcoming_reminder' ? 365 : (Number(rules.frequencies[bucket]) || 1);
    const lockRows = [];
    if (!dryRun) {
      for (const row of rows) {
        const findingKey = String(row.f.id || row.f.ref || '').trim();
        const dueKey = bucket === 'upcoming_reminder' ? `:${row.f.due || ''}` : '';
        const lockKey = `auto:${bucket}:${deptCode}:${findingKey}${dueKey}`;
        const granted = await claimEmailLock(collection, lockKey, frequencyDays, { bucket, deptCode, refs: [row.f.ref].filter(Boolean) }, by);
        if (granted) lockRows.push({ row, lockKey });
      }
      if (!lockRows.length) {
        skipped++;
        results.push({ bucket, dept: deptCode, deptName, ncCount: rows.length, status: 'throttled', reason: `all findings were already sent within the last ${frequencyDays} day(s)` });
        continue;
      }
      sendRows = lockRows.map(item => item.row);
      refs = sendRows.map(r => r.f.ref).filter(Boolean).sort();
    }

    const worst = sendRows.reduce((a, b) => (b.hit.overdue > a.hit.overdue ? b : a), sendRows[0]);
    const vars = {
      department_name: deptName,
      spoc_name: (master && master.spocName) || deptName,
      nc_count: sendRows.length,
      nc_table: buildNcTable(sendRows),
      nc_number: worst.f.ref || '',
      target_date: worst.f.due || '',
      delay_days: worst.hit.overdue || 0,
      clause_name: worst.f.clause || '',
      clause_description: worst.f.desc || '',
      window_days: windowDays,
      escalation_level: bucket.startsWith('escalation') ? String(bucket.split('_')[1]) : '',
      audit_name: worst.f.auditRef || '',
    };
    const subject = replaceTemplate(tpl.subject, vars);
    const html = replaceTemplate(tpl.body, vars);
    if (dryRun) {
      results.push({ bucket, dept: deptCode, deptName, ncCount: sendRows.length, status: 'dry-run', to, cc, subject, html, refs, frequencyDays });
      continue;
    }

    try {
      const transport = getMailer();
      await transport.sendMail({ from: SMTP_FROM, to, cc, subject, html, text: html.replace(/<[^>]+>/g, ' ') });
      await Promise.all(lockRows.map(item => commitEmailLock(collection, item.lockKey, frequencyDays, true, by)));
      sent++;
      results.push({ bucket, dept: deptCode, deptName, ncCount: sendRows.length, status: 'sent', to, cc, subject });
      logs.push({ id: `${bucket}_${deptCode}_${Date.now()}`, type: bucket, to: to.join(', '), cc: cc.join(', '), subject, status: 'sent', dept: deptCode, ncCount: sendRows.length, sentAt: new Date().toISOString() });
    } catch (err) {
      await Promise.all(lockRows.map(item => commitEmailLock(collection, item.lockKey, frequencyDays, false, by)));
      failed++;
      results.push({ bucket, dept: deptCode, deptName, ncCount: sendRows.length, status: 'failed', to, cc, error: err.message });
      logs.push({ id: `${bucket}_${deptCode}_${Date.now()}`, type: bucket, to: to.join(', '), cc: cc.join(', '), subject, status: 'failed', error: err.message, dept: deptCode, ncCount: sendRows.length, sentAt: new Date().toISOString() });
    }
  }

  if (!dryRun) await appendEmailLogs(collection, logs, `email-engine:${by}`);

  // `muted` is the deliberately-silenced set. It is reported rather than hidden so an admin can
  // see at a glance that a department is quiet because they switched it off, not because it broke.
  const mutedGroups = Array.from(new Map(muted.map(m => [`${m.bucket}|${m.deptCode}`, m])).values());
  const summary = {
    ok: true, ranAt: new Date().toISOString(), tz, today: todayYmd(tz), dryRun,
    groups: results.length, sent, failed, skipped, muted: mutedGroups, results,
  };
  if (!dryRun) console.log(`[AuditPro] Email automation: ${sent} sent, ${failed} failed, ${skipped} skipped, ${mutedGroups.length} muted`);
  return summary;
}

module.exports = { runEmailAutomation, workflowStatus, classify, classifyAll, recipientsFor, splitEmails, todayYmd, ymdToMs, mergeRules, EMAIL_RULES_DEFAULTS };
