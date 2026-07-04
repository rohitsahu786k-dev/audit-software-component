'use strict';

const crypto = require('crypto');

// All sync keys
const SYNC_KEYS = [
  'ap_users','ap_depts','ap_auds','ap_cps','ap_finds','ap_learns',
  'ap_completed_audits','ap_planned_audits','ap_import_logs','ap_capa_due',
  'ap_secs','ap_notifs','ap_stds','ap_permissions','ap_email_master',
  'ap_email_templates','ap_email_logs','ap_required_cc_emails','ap_root_causes',
  'ap_media_library','ap_escalation_matrix','ap_audit_drafts','ap_local_storage_backup'
];

function assertSyncKey(key) {
  if (!SYNC_KEYS.includes(key)) {
    const err = new Error(`Unsupported sync key: ${key}`);
    err.statusCode = 400;
    throw err;
  }
}

function stableSyncStringify(value) {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSyncStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableSyncStringify(value[k])}`).join(',')}}`;
}

function canonicalSyncValue(key, value) {
  if (key === 'ap_local_storage_backup' && value && typeof value === 'object') {
    return { keys: Array.isArray(value.keys) ? value.keys.slice().sort() : [], data: value.data && typeof value.data === 'object' ? value.data : {} };
  }
  if (key === 'ap_audit_drafts' && Array.isArray(value)) {
    return value.map(row => {
      if (!row || typeof row !== 'object') return row;
      const draft = { ...row }; delete draft.updatedAt;
      if (draft.session && typeof draft.session === 'object') { draft.session = { ...draft.session }; delete draft.session.at; }
      return draft;
    });
  }
  return value;
}

function syncValuesEqual(key, a, b) {
  return stableSyncStringify(canonicalSyncValue(key, a)) === stableSyncStringify(canonicalSyncValue(key, b));
}

// ── EMAIL LOG MERGE ──
function emailLogKey(log) {
  if (!log || typeof log !== 'object') return '';
  return log.id || [log.type||'',log.to||'',log.cc||'',log.subject||'',log.status||'',log.sentAt||''].join('|');
}

function mergeEmailLogs(existing, incoming, clearedAt) {
  const clearTime = clearedAt ? new Date(clearedAt).getTime() : 0;
  const seen = new Set();
  return [].concat(Array.isArray(incoming) ? incoming : [], Array.isArray(existing) ? existing : [])
    .filter(log => {
      if (!log || typeof log !== 'object') return false;
      const sentTime = log.sentAt ? new Date(log.sentAt).getTime() : Date.now();
      if (clearTime && sentTime <= clearTime) return false;
      const k = emailLogKey(log);
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    })
    .sort((a,b) => new Date(b.sentAt||0) - new Date(a.sentAt||0))
    .slice(0,500);
}

// ── USER MERGE ──
function userMergeKey(user) {
  return String(user && (user.loginId || user.email || user.id) || '').trim().toLowerCase();
}

function normalizeUserForStorage(user, existing) {
  if (!user || typeof user !== 'object') return user;
  const next = { ...(existing || {}), ...user };
  const password = Object.prototype.hasOwnProperty.call(user, 'password') ? String(user.password || '') : '';
  if (password) {
    const salt = crypto.randomBytes(16).toString('base64url');
    const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('base64url');
    next.passwordHash = `pbkdf2$120000$${salt}$${hash}`;
    delete next.legacyPasswordHashes; delete next.legacyPasswords;
  } else if (existing && existing.passwordHash) {
    next.passwordHash = existing.passwordHash;
  } else if (existing && existing.password) {
    const salt = crypto.randomBytes(16).toString('base64url');
    const hash = crypto.pbkdf2Sync(existing.password, salt, 120000, 32, 'sha256').toString('base64url');
    next.passwordHash = `pbkdf2$120000$${salt}$${hash}`;
  }
  delete next.password;
  return next;
}

function mergeUsersForSync(existing, incoming) {
  if (!Array.isArray(incoming)) return incoming;
  if (!Array.isArray(existing) || !existing.length) return incoming;
  const byKey = new Map();
  const existingKeys = new Set();
  existing.forEach(u => { const k = userMergeKey(u); if (k) { existingKeys.add(k); byKey.set(k, u); } });
  const incomingKeys = new Set(incoming.map(userMergeKey).filter(Boolean));
  const isShrinking = incomingKeys.size < existingKeys.size && Array.from(existingKeys).some(k => !incomingKeys.has(k));
  incoming.forEach(u => {
    const k = userMergeKey(u);
    if (!k) return;
    if (isShrinking && byKey.has(k)) return;
    byKey.set(k, normalizeUserForStorage(u, byKey.get(k)));
  });
  return Array.from(byKey.values());
}

// ── FINDINGS MERGE ──
function findingKey(f) { return String((f && (f.id || f.ref)) || '').trim(); }
function findingUpdatedTime(f) { const t = Date.parse((f && (f.updatedAt || f.findingUpdatedAt)) || ''); return Number.isFinite(t) ? t : 0; }
function findingDeletedTime(f) { const t = Date.parse((f && f.deletedAt) || ''); return Number.isFinite(t) ? t : 0; }
function isDraftFindingLeak(f) { return !!(f && String(f.status||'').toLowerCase()==='draft' && f.audit && f.session); }
function isDeletedFinding(f) { return !!(f && f.deletedAt) || isDraftFindingLeak(f); }
function hasReviewDecision(f) { const d = String((f && f.decision)||'').toLowerCase(); return d==='accept'||d==='reject'; }
function isReviewedOrClosedFinding(f) { return hasReviewDecision(f) || String((f&&f.status)||'').toLowerCase()==='closed' || String((f&&f.capaStatus)||'').toLowerCase()==='closed'; }

function parseAuditTimestamp(value) {
  const raw = String(value||'').trim(); if (!raw) return 0;
  const direct = Date.parse(raw); if (Number.isFinite(direct)) return direct;
  const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M|am|pm)?)?/);
  if (!m) return 0;
  let h = Number(m[4]||0); const mi=Number(m[5]||0), s=Number(m[6]||0), ap=String(m[7]||'').toLowerCase();
  if (ap==='pm' && h<12) h+=12; if (ap==='am' && h===12) h=0;
  const t = new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),h,mi,s).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isClosureSubmissionAction(a) { return /(closure submitted|submitted for review|submitted closure)/i.test(String(a||'')); }
function isReviewDecisionAction(a) { return /closure (accepted|rejected)/i.test(String(a||'')); }
function isManualStatusAction(a) { return /status\s*(?:→|->|â†')/i.test(String(a||'')); }

function latestWorkflowSignal(f, fields, matchFn) {
  const signal = {exists:false,time:0,index:-1};
  if (!f||typeof f!=='object') return signal;
  fields.forEach(field => {
    const t = parseAuditTimestamp(f[field]);
    if (t&&t>=signal.time){signal.exists=true;signal.time=t;signal.index=-1;}
    else if(String(f[field]||'').trim())signal.exists=true;
  });
  const logs = Array.isArray(f.activityLog)?f.activityLog:[];
  logs.forEach((log,idx) => {
    if(!matchFn(String((log&&log.action)||'')))return;
    const t=parseAuditTimestamp(log&&log.ts); signal.exists=true;
    if((t&&t>=signal.time)||(!signal.time&&idx>=signal.index)){signal.time=t||signal.time;signal.index=idx;}
  });
  return signal;
}

function closureSubmissionSignal(f) {
  const s=latestWorkflowSignal(f,['closureSubmittedAt','closureSubmitAt','closureDate'],isClosureSubmissionAction);
  if(!s.exists&&f&&typeof f==='object') s.exists=!!(String(f.closureEvidence||'').trim()||String(f.closureSubmittedBy||'').trim());
  return s;
}
function reviewDecisionSignal(f) { return latestWorkflowSignal(f,['decisionAt','reviewedAt','decisionDate','auditClosureDate','closedAt'],isReviewDecisionAction); }
function statusChangeSignal(f) { return latestWorkflowSignal(f,['statusChangedAt'],isManualStatusAction); }

function hasClosureSubmission(f) {
  if(!f||typeof f!=='object')return false;
  if(String(f.closureEvidence||'').trim())return true;
  if(String(f.closureSubmittedBy||'').trim()||String(f.closureDate||'').trim())return true;
  return Array.isArray(f.activityLog)&&f.activityLog.some(l=>isClosureSubmissionAction((l&&l.action)||''));
}
function hasUnreviewedClosureSubmission(f) {
  if(!hasClosureSubmission(f))return false; if(!hasReviewDecision(f))return true;
  const submitted=closureSubmissionSignal(f),reviewed=reviewDecisionSignal(f);
  if(!submitted.exists||!reviewed.exists)return false;
  if(submitted.time&&reviewed.time)return submitted.time>reviewed.time;
  if(submitted.index>-1&&reviewed.index>-1)return submitted.index>reviewed.index;
  return false;
}
function isPendingReviewFinding(f) {
  const status=String((f&&f.status)||'').toLowerCase(), capaStatus=String((f&&f.capaStatus)||'').toLowerCase();
  return status==='pending-closure'||capaStatus==='submitted'||(status==='delayed'&&hasUnreviewedClosureSubmission(f));
}

function normalizeFindingSyncState(f) {
  if(!f||typeof f!=='object')return f;
  if(isDraftFindingLeak(f))return null;
  const item={...f};
  let status=String(item.status||'').toLowerCase(), capaStatus=String(item.capaStatus||'').toLowerCase(), decision=String(item.decision||'').toLowerCase();
  const pendingSignal=status==='pending-closure'||capaStatus==='submitted', unreviewed=hasUnreviewedClosureSubmission(item);
  if(pendingSignal&&(decision==='accept'||decision==='reject')){
    if(unreviewed){item.decision=null;item.decisionComments='';item.decisionDate=null;item.auditClosureDate=null;item.closedAt=null;}
    else{item.status=decision==='accept'?'closed':'open';item.capaStatus=decision==='accept'?'closed':'open';}
    status=String(item.status||'').toLowerCase();capaStatus=String(item.capaStatus||'').toLowerCase();
  }
  if((status==='delayed'||capaStatus==='delayed')&&unreviewed){
    item.status='pending-closure';item.capaStatus='submitted';
    if(decision==='accept'||decision==='reject'){item.decision=null;item.decisionComments='';item.decisionDate=null;item.auditClosureDate=null;item.closedAt=null;}
  }
  return item;
}

function workflowMeaningfulTime(f) { return Math.max(findingUpdatedTime(f),closureSubmissionSignal(f).time||0,reviewDecisionSignal(f).time||0); }

function mergeActivityLogs(a,b) {
  const rows=[].concat(Array.isArray(a&&a.activityLog)?a.activityLog:[],Array.isArray(b&&b.activityLog)?b.activityLog:[]);
  const seen=new Set();
  return rows.map((log,idx)=>({log,idx,time:parseAuditTimestamp((log&&(log.ts||log.at||log.updatedAt))||'')}))
    .filter(row=>{const l=row.log;if(!l||typeof l!=='object')return false;const k=[l.user||'',l.action||'',l.ts||''].join('|');if(seen.has(k))return false;seen.add(k);return true;})
    .sort((a,b)=>(a.time-b.time)||(a.idx-b.idx)).slice(-200).map(r=>r.log);
}

function mergeFindingWorkflowData(selected,other) {
  if(!selected||!other)return selected;
  const logs=mergeActivityLogs(selected,other);
  let out=logs.length===(Array.isArray(selected.activityLog)?selected.activityLog.length:0)?selected:Object.assign({},selected,{activityLog:logs});
  let changed=out!==selected;
  const hasValue=v=>Array.isArray(v)?v.length>0:String(v==null?'':v).trim()!=='';
  const copyMissing=field=>{if(!hasValue(out[field])&&hasValue(other[field])){if(!changed){out={...out};changed=true;}out[field]=Array.isArray(other[field])?other[field].slice():other[field];}};
  ['closureEvidence','closureSubmittedBy','closureDate','closureSubmittedAt','closureSubmitAt'].forEach(copyMissing);
  if(isReviewedOrClosedFinding(out)&&isReviewedOrClosedFinding(other)&&!isPendingReviewFinding(out)){
    ['decision','decisionComments','decisionDate','decisionAt','auditClosureDate','closedAt'].forEach(copyMissing);
  }
  return out;
}

function chooseFindingForSync(current,incoming) {
  current=normalizeFindingSyncState(current); incoming=normalizeFindingSyncState(incoming);
  if(!current)return incoming; if(!incoming)return current;
  if(isDeletedFinding(current)||isDeletedFinding(incoming)){const cd=findingDeletedTime(current),id=findingDeletedTime(incoming);if(cd||id)return id>=cd?incoming:current;return isDeletedFinding(incoming)?incoming:current;}
  const cp=isPendingReviewFinding(current),ip=isPendingReviewFinding(incoming),cr=isReviewedOrClosedFinding(current),ir=isReviewedOrClosedFinding(incoming);
  const submittedNewerThanReview=(sub,rev)=>{const s=closureSubmissionSignal(sub),r=reviewDecisionSignal(rev);return !!(s.time&&r.time&&s.time>r.time);};
  const statusNewerThanReview=(ch,rev)=>{const s=statusChangeSignal(ch),r=reviewDecisionSignal(rev);return !!(s.time&&r.time&&s.time>r.time);};
  if(cp||ip){
    if(cp&&ir)return submittedNewerThanReview(current,incoming)?mergeFindingWorkflowData(current,incoming):mergeFindingWorkflowData(incoming,current);
    if(ip&&cr)return submittedNewerThanReview(incoming,current)?mergeFindingWorkflowData(incoming,current):mergeFindingWorkflowData(current,incoming);
    if(cp&&!ip&&!ir)return mergeFindingWorkflowData(current,incoming);
    if(ip&&!cp&&!cr)return mergeFindingWorkflowData(incoming,current);
    if(cp&&ip){const ct=workflowMeaningfulTime(current),it=workflowMeaningfulTime(incoming);return mergeFindingWorkflowData(it>ct?incoming:current,it>ct?current:incoming);}
  }
  if(cr&&!ir)return statusNewerThanReview(incoming,current)?mergeFindingWorkflowData(incoming,current):mergeFindingWorkflowData(current,incoming);
  if(ir&&!cr)return statusNewerThanReview(current,incoming)?mergeFindingWorkflowData(current,incoming):mergeFindingWorkflowData(incoming,current);
  const ct=findingUpdatedTime(current),it=findingUpdatedTime(incoming);
  if(ct||it)return mergeFindingWorkflowData(it>=ct?incoming:current,it>=ct?current:incoming);
  return mergeFindingWorkflowData(incoming,current);
}

function mergeFindingsForSync(currentValue,incomingValue) {
  if(!Array.isArray(incomingValue))return incomingValue;
  incomingValue=incomingValue.map(normalizeFindingSyncState).filter(Boolean);
  if(!Array.isArray(currentValue)||!currentValue.length)return incomingValue;
  currentValue=currentValue.map(normalizeFindingSyncState).filter(Boolean);
  const currentByKey=new Map(); currentValue.forEach(f=>{const k=findingKey(f);if(k)currentByKey.set(k,f);});
  const seen=new Set();
  const merged=incomingValue.map(f=>{const k=findingKey(f);if(!k)return f;seen.add(k);return chooseFindingForSync(currentByKey.get(k),f);});
  currentValue.forEach(f=>{const k=findingKey(f);if(k&&!seen.has(k))merged.push(f);});
  return merged;
}

// ── NOTIFICATIONS MERGE ──
function notificationKey(r) { return String((r&&r.id)||[r&&r.type||'',r&&r.title||'',r&&r.body||'',r&&r.ts||''].join('|')).trim(); }
function notificationTime(r) {
  const raw=String((r&&(r.ts||r.at||r.updatedAt))||'').trim();
  const d=Date.parse(raw); if(Number.isFinite(d))return d;
  const m=raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if(!m)return 0;
  const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  let h=Number(m[4]); const ap=m[6].toLowerCase(); if(ap==='pm'&&h<12)h+=12; if(ap==='am'&&h===12)h=0;
  const t=new Date(Number(m[3]),months[m[2].toLowerCase()],Number(m[1]),h,Number(m[5])).getTime();
  return Number.isFinite(t)?t:0;
}
function mergeNotificationsForSync(currentValue,incomingValue) {
  if(!Array.isArray(incomingValue))return Array.isArray(currentValue)?currentValue:[];
  const byKey=new Map();
  [].concat(Array.isArray(currentValue)?currentValue:[],incomingValue).forEach(r=>{const k=notificationKey(r);if(k)byKey.set(k,Object.assign({},byKey.get(k)||{},r));});
  return Array.from(byKey.values()).sort((a,b)=>notificationTime(b)-notificationTime(a)).slice(0,600);
}

// ── AUDIT DRAFTS MERGE ──
function auditDraftKey(r) { return String((r&&(r.userKey||r.loginId||r.id))||'').trim(); }
function auditDraftTime(r) { const t=Date.parse((r&&(r.updatedAt||r.at))||''); return Number.isFinite(t)?t:0; }
function auditDraftCompleteness(r) {
  if(!r||typeof r!=='object')return 0;
  let s=r.audit?1:0; const sess=r.session&&typeof r.session==='object'?r.session:null;
  if(sess){s+=1;s+=Object.keys(sess.answers||{}).length;s+=Object.keys(sess.findings||{}).length*2;s+=Object.keys(sess.notes||{}).length;if(String(sess.genNotes||'').trim())s+=1;}
  return s;
}
function chooseAuditDraft(current,incoming) {
  if(!current)return incoming;
  const ct=auditDraftTime(current),it=auditDraftTime(incoming);
  if(it>ct)return incoming; if(it<ct)return current;
  return auditDraftCompleteness(incoming)>=auditDraftCompleteness(current)?incoming:current;
}
function mergeAuditDraftsForSync(currentValue,incomingValue) {
  if(!Array.isArray(incomingValue))return Array.isArray(currentValue)?currentValue:[];
  const byKey=new Map();
  [].concat(Array.isArray(currentValue)?currentValue:[],incomingValue).forEach(r=>{const k=auditDraftKey(r);if(!k)return;byKey.set(k,chooseAuditDraft(byKey.get(k),r));});
  return Array.from(byKey.values()).sort((a,b)=>auditDraftTime(b)-auditDraftTime(a)).slice(0,100);
}

// ── COMPLETED AUDITS MERGE ──
function normalizeAuditSeverity(sev) {
  const t=String(sev||'obs').toLowerCase().trim();
  if(t.includes('critical'))return 'critical'; if(t.includes('major'))return 'major'; if(t.includes('minor'))return 'minor'; return 'obs';
}
function auditFindingCounts(findings) {
  const c={critical:0,major:0,minor:0,obs:0,total:0};
  (Array.isArray(findings)?findings:[]).forEach(f=>{const k=normalizeAuditSeverity(f&&(f.sev??f.severity));c[k]++;c.total++;});
  return c;
}
function auditScoreFromCounts(c) { return Math.min(100,Math.max(0,Math.round(100-(c.critical||0)*15-(c.major||0)*10-(c.minor||0)*5-(c.obs||0)*2))); }
function completedAuditKey(a) { return String((a&&(a.ref||a.auditRef||a.id))||'').trim().toLowerCase(); }
function completedAuditTime(a) { const t=Date.parse((a&&(a.updatedAt||a.submittedAt||a.date))||''); return Number.isFinite(t)?t:0; }
function completedAuditCompleteness(a) {
  if(!a||typeof a!=='object')return 0;
  let s=a.auditScoreFrozen!==undefined?1:0;
  s+=Array.isArray(a.findingRefs)?a.findingRefs.length:0;
  if(a.auditFindingCountsFrozen&&typeof a.auditFindingCountsFrozen==='object')s+=Number(a.auditFindingCountsFrozen.total||0);
  if(a.session&&a.session.findings)s+=Object.keys(a.session.findings).length;
  return s;
}
function isBadDerivedCompletedAudit(a) {
  if(!a||typeof a!=='object'||!a.derivedFromFindings)return false;
  const ref=String((a.ref||a.auditRef||a.id)||'').trim(), id=String(a.id||'');
  return /^AUTO-[A-Z0-9]+-\d{10,}$/.test(ref)||/^derived_[a-z0-9]+_findings_?$/i.test(id);
}
function repairCompletedAuditScores(audits,findings) {
  const active=(Array.isArray(findings)?findings:[]).map(normalizeFindingSyncState).filter(f=>f&&!f.deletedAt&&!isDraftFindingLeak(f));
  return audits.map(audit=>{
    const ref=String((audit.ref||audit.auditRef||audit.id)||'').trim();
    const explicitRefs=new Set((audit.findingRefs||[]).map(String));
    const rows=active.filter(f=>(f.dept===audit.dept&&(String(f.auditRef||f.auditId||'')===ref||explicitRefs.has(String(f.ref||'')))));
    if(!rows.length)return audit;
    const counts=auditFindingCounts(rows);
    return{...audit,findingRefs:rows.map(f=>f.ref).filter(Boolean),auditScoreFrozen:auditScoreFromCounts(counts),auditFindingCountsFrozen:counts,status:audit.status||'submitted'};
  });
}
function mergeCompletedAuditsForSync(currentValue,incomingValue,findingsValue) {
  if(!Array.isArray(incomingValue))return Array.isArray(currentValue)?currentValue:[];
  const current=(Array.isArray(currentValue)?currentValue:[]).filter(a=>!isBadDerivedCompletedAudit(a));
  const incoming=incomingValue.filter(a=>!isBadDerivedCompletedAudit(a));
  if(!incoming.length&&current.length)return repairCompletedAuditScores(current,findingsValue);
  const byKey=new Map();
  current.concat(incoming).forEach(a=>{const k=completedAuditKey(a);if(!k)return;const prev=byKey.get(k);const it=completedAuditTime(a),pt=prev?completedAuditTime(prev):0;byKey.set(k,(!prev||it>pt||(it===pt&&completedAuditCompleteness(a)>completedAuditCompleteness(prev)))?a:prev);});
  return repairCompletedAuditScores(Array.from(byKey.values()),findingsValue).sort((a,b)=>completedAuditTime(a)-completedAuditTime(b));
}

// ── CLIENTS ──
function sanitizeUsersForClient(users) {
  return Array.isArray(users) ? users.map(u => {if(!u)return u;const c={...u};delete c.password;delete c.passwordHash;delete c.legacyPasswords;delete c.legacyPasswordHashes;return c;}) : users;
}
function sanitizeSyncValueForClient(key,value) {
  if(key==='ap_users')return sanitizeUsersForClient(value);
  if(key==='ap_local_storage_backup'&&value&&typeof value==='object'){const c={...value};if(c.data){c.data={...c.data};if(c.data.ap_users)c.data.ap_users=sanitizeUsersForClient(c.data.ap_users);delete c.data.ap_rem_p;}return c;}
  return value;
}

module.exports = {
  SYNC_KEYS, assertSyncKey, syncValuesEqual, sanitizeSyncValueForClient,
  mergeEmailLogs, mergeUsersForSync, normalizeUserForStorage,
  mergeFindingsForSync, mergeNotificationsForSync, mergeAuditDraftsForSync,
  mergeCompletedAuditsForSync
};
