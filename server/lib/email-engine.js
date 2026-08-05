'use strict';

// Automatic CAPA reminder engine.
//
// Runs on the server (see the cron wiring in server.js) rather than in an admin's browser, so a
// reminder goes out whether or not anyone has the portal open. Every automatic email CCs the
// department's Manager and HOD/BUH from the Email Master, plus the global CC list.
//
// Escalation policy mirrors the matrix the CAPA page already advertises to users:
//   overdue 1-6d   Delayed NC   -> SPOC              every 3 days
//   overdue 7-14d  Escalation   -> HOD (SPOC in CC)  every 2 days
//   overdue 15d+   Escalation   -> HOD + Management  every 30 days
//   due within N   Upcoming     -> SPOC              daily inside the window
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
  frequencies: { upcoming_reminder: 1, delayed: 3, escalation_2: 2, escalation_3: 30 },
  suppressed: [],
  depts: {},
};

const READ_KEYS = ['ap_finds', 'ap_depts', 'ap_email_master', 'ap_email_templates', 'ap_required_cc_emails', 'ap_system_settings', 'ap_email_rules'];

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

function classify(f, todayMs, windowDays) {
  const dueMs = ymdToMs(f.due);
  if (!Number.isFinite(dueMs)) return null;
  const overdue = Math.round((todayMs - dueMs) / DAY_MS);
  if (overdue >= 15) return { type: 'escalation', level: 3, overdue };
  if (overdue >= 7) return { type: 'escalation', level: 2, overdue };
  if (overdue >= 1) return { type: 'delayed', level: 1, overdue };
  const until = -overdue;
  if (until >= 0 && until <= windowDays) return { type: 'upcoming_reminder', level: 0, overdue: 0, until };
  return null;
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

// By default the department Manager and HOD/BUH ride along on every automatic email. The Email
// Center can turn each of those off globally, add per-department CCs, or override the To line.
function recipientsFor(bucket, master, globalCc, rules = EMAIL_RULES_DEFAULTS, deptRule = {}) {
  const spoc = splitEmails(master && master.email);
  const manager = splitEmails(master && master.reportingEmail);
  const hod = splitEmails(master && master.hodEmail);
  const management = splitEmails(master && master.managementEmail);
  const overrideTo = splitEmails((Array.isArray(deptRule.overrideTo) ? deptRule.overrideTo : []).join(','));

  let to;
  if (overrideTo.length) to = overrideTo;
  else if (bucket === 'escalation_3') to = dedupe([...hod, ...management]);
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

  const findings = Array.isArray(data.ap_finds) ? data.ap_finds : [];
  const emailMaster = Array.isArray(data.ap_email_master) ? data.ap_email_master : [];
  const templates = Array.isArray(data.ap_email_templates) ? data.ap_email_templates : [];
  const depts = Array.isArray(data.ap_depts) ? data.ap_depts : [];
  const globalCc = dedupe(splitEmails((Array.isArray(data.ap_required_cc_emails) ? data.ap_required_cc_emails : []).join(',')));
  const windowDays = Math.max(0, Number(rules.windowDays != null ? rules.windowDays : settings.reminderWindowDays || DEFAULT_WINDOW_DAYS));
  const autoEscalation = settings.autoEscalation !== false;
  const suppressed = new Set(splitEmails((rules.suppressed || []).join(',')).map(e => e.toLowerCase()));
  const stripSuppressed = list => list.filter(e => !suppressed.has(e.toLowerCase()));

  const todayMs = ymdToMs(todayYmd(tz));

  // Group actionable findings by department + bucket: one email per dept per bucket, not per NC.
  const groups = new Map();
  const muted = [];
  findings.filter(isActionable).forEach(f => {
    const hit = classify(f, todayMs, windowDays);
    if (!hit) return;
    const bucket = bucketOf(hit);
    if (!autoEscalation && bucket.startsWith('escalation')) return;
    const deptCode = String(f.dept || '').trim();
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

  const results = [];
  const logs = [];
  let sent = 0, failed = 0, skipped = 0;

  for (const group of groups.values()) {
    const { bucket, deptCode, rows } = group;
    const master = emailMaster.find(m => String(m.deptCode) === deptCode && String(m.status || 'active').toLowerCase() !== 'inactive');
    const dept = depts.find(d => String(d.code) === deptCode);
    const deptName = (master && master.department) || (dept && dept.name) || deptCode;
    const refs = rows.map(r => r.f.ref).filter(Boolean).sort();

    const tpl = templateFor(templates, bucket);
    if (!tpl) {
      skipped++;
      results.push({ bucket, dept: deptCode, ncCount: rows.length, status: 'skipped', reason: `no active template for "${bucket}"` });
      continue;
    }

    const deptRule = rules.depts[deptCode] || {};
    const resolved = recipientsFor(bucket, master, globalCc, rules, deptRule);
    const to = stripSuppressed(resolved.to);
    const cc = stripSuppressed(resolved.cc);
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

    const worst = rows.reduce((a, b) => (b.hit.overdue > a.hit.overdue ? b : a), rows[0]);
    const vars = {
      department_name: deptName,
      spoc_name: (master && master.spocName) || deptName,
      nc_count: rows.length,
      nc_table: buildNcTable(rows),
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
    const frequencyDays = Number(rules.frequencies[bucket]) || 1;
    const lockKey = `auto:${bucket}:${deptCode}`;

    if (dryRun) {
      results.push({ bucket, dept: deptCode, deptName, ncCount: rows.length, status: 'dry-run', to, cc, subject, html, refs, frequencyDays });
      continue;
    }

    // Claim before sending: two cron ticks (or a restart mid-run) must not double-send.
    const granted = await claimEmailLock(collection, lockKey, frequencyDays, { bucket, deptCode, refs }, by);
    if (!granted) {
      skipped++;
      results.push({ bucket, dept: deptCode, deptName, ncCount: rows.length, status: 'throttled', reason: `already sent within the last ${frequencyDays} day(s)` });
      continue;
    }

    try {
      const transport = getMailer();
      await transport.sendMail({ from: SMTP_FROM, to, cc, subject, html, text: html.replace(/<[^>]+>/g, ' ') });
      await commitEmailLock(collection, lockKey, frequencyDays, true, by);
      sent++;
      results.push({ bucket, dept: deptCode, deptName, ncCount: rows.length, status: 'sent', to, cc, subject });
      logs.push({ id: `${bucket}_${deptCode}_${Date.now()}`, type: bucket, to: to.join(', '), cc: cc.join(', '), subject, status: 'sent', dept: deptCode, ncCount: rows.length, sentAt: new Date().toISOString() });
    } catch (err) {
      await commitEmailLock(collection, lockKey, frequencyDays, false, by);
      failed++;
      results.push({ bucket, dept: deptCode, deptName, ncCount: rows.length, status: 'failed', to, cc, error: err.message });
      logs.push({ id: `${bucket}_${deptCode}_${Date.now()}`, type: bucket, to: to.join(', '), cc: cc.join(', '), subject, status: 'failed', error: err.message, dept: deptCode, ncCount: rows.length, sentAt: new Date().toISOString() });
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

module.exports = { runEmailAutomation, workflowStatus, classify, recipientsFor, splitEmails, todayYmd, ymdToMs, mergeRules, EMAIL_RULES_DEFAULTS };
