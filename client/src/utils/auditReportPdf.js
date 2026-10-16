import { SEV_LABEL, STAT_LABEL, findingWorkflowStatus } from './helpers';

const RED = [192, 57, 43];
const BLUE = [37, 99, 235];
const GREEN = [22, 163, 74];
const INK = [30, 30, 50];
const MUTED = [110, 110, 125];

const TILES = [
  { key: 'score', label: 'AUDIT SCORE', bg: [254, 236, 238], fg: [220, 38, 38] },
  { key: 'critical', label: 'CRITICAL', bg: [254, 236, 238], fg: [220, 38, 38] },
  { key: 'major', label: 'MAJOR', bg: [255, 247, 230], fg: [217, 119, 6] },
  { key: 'minor', label: 'MINOR', bg: [230, 250, 245], fg: [13, 148, 136] },
  { key: 'obs', label: 'OBS', bg: [243, 240, 255], fg: [124, 58, 237] },
];

const RESULT_LABEL = { yes: 'Compliant', no: 'Non-Compliant', na: 'N/A', skip: 'N/A' };

function clean(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

// One row per checkpoint of the audit, in section order — same numbering the auditor saw.
export function checklistRows(audit) {
  const session = (audit && audit.session) || {};
  const answers = session.answers || {};
  const notes = session.notes || {};
  const findings = session.findings || {};
  const rows = [];
  ((audit && audit.sections) || []).forEach(sec => {
    (sec._checkpoints || []).forEach(q => {
      const ans = answers[q.id];
      const f = findings[q.id];
      const obs = ans === 'no' ? clean(f && (f.desc || f.description)) || clean(notes[q.id]) : clean(notes[q.id]);
      rows.push({ clause: clean(q.clause), question: clean(q.text), result: RESULT_LABEL[ans] || 'N/A', observation: obs });
    });
  });
  return rows;
}

function closureText(f) {
  const parts = [];
  if (clean(f.closureEvidence)) parts.push(clean(f.closureEvidence));
  if (f.decision === 'accept' && clean(f.decisionComments)) parts.push('Auditor: ' + clean(f.decisionComments));
  return parts.join('\n');
}

export function buildAuditReportPdf(jsPDF, { dept, audit, score, counts, findings, standardsLabel, hasExternal }) {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const mx = 14;
  const cw = pw - mx * 2;

  // Banner
  doc.setFillColor(...RED); doc.rect(0, 0, pw, 30, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('OnePWS Pvt. Ltd.', pw / 2, 12, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text((hasExternal ? 'Quality Audit Report (On-portal + External) — ' : 'Internal Quality Audit Report — ') + dept.name, pw / 2, 19, { align: 'center' });
  doc.setFontSize(7.5);
  doc.text('SPOC: ' + (dept.spoc || 'TBD') + ' | Date: ' + new Date().toLocaleDateString() + ' | Standards: ' + standardsLabel, pw / 2, 25, { align: 'center' });

  // Score tiles
  const values = { score: score === null || score === undefined ? 'N/A' : score + '%', critical: counts.critical, major: counts.major, minor: counts.minor, obs: counts.obs };
  const gap = 3;
  const tw = (cw - gap * (TILES.length - 1)) / TILES.length;
  const ty = 37;
  TILES.forEach((t, i) => {
    const x = mx + i * (tw + gap);
    doc.setFillColor(...t.bg); doc.roundedRect(x, ty, tw, 22, 3, 3, 'F');
    doc.setTextColor(...t.fg); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(String(values[t.key]), x + tw / 2, ty + 11, { align: 'center' });
    doc.setFontSize(6.5);
    doc.text(t.label, x + tw / 2, ty + 17, { align: 'center' });
  });

  // Checklist
  const rows = checklistRows(audit);
  let y = ty + 22 + 10;
  if (rows.length) {
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text(`Audit Checklist Results (${rows.length} questions)`, mx, y);
    doc.autoTable({
      startY: y + 3,
      head: [['#', 'Clause', 'Question', 'Result', 'Observation']],
      body: rows.map((r, i) => [i + 1, r.clause, r.question, r.result, r.observation]),
      styles: { fontSize: 7.5, cellPadding: 2.5, textColor: [70, 70, 80], valign: 'top', overflow: 'linebreak' },
      headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 247, 249] },
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 22 }, 2: { cellWidth: 52 }, 3: { cellWidth: 24 }, 4: { cellWidth: 'auto' } },
      margin: { left: mx, right: mx, bottom: 18 },
      didParseCell: (d) => {
        if (d.section !== 'body' || d.column.index !== 3) return;
        const v = d.cell.raw;
        if (v === 'Non-Compliant') { d.cell.styles.textColor = [220, 38, 38]; d.cell.styles.fontStyle = 'bold'; }
        else if (v === 'Compliant') d.cell.styles.textColor = GREEN;
        else d.cell.styles.textColor = [150, 150, 160];
      },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  // Non-conformances & evidence
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  const ensure = (need) => { if (y + need > ph - 20) { doc.addPage(); y = 18; } };
  ensure(14);
  doc.setTextColor(...RED);
  doc.text(`Non-Conformances & Evidence (${findings.length} findings)`, mx, y);
  y += 6;
  if (!findings.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    doc.text('No non-conformances recorded.', mx, y + 2);
  }
  findings.forEach(f => {
    const statusText = STAT_LABEL[findingWorkflowStatus(f)] || STAT_LABEL[f.status] || f.status || '';
    const title = [f.ref, SEV_LABEL[f.sev] || f.sev, clean(f.clause) || '—', statusText].join(' | ');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    const descLines = doc.splitTextToSize(clean(f.desc), cw - 6);
    const ca = closureText(f);
    const caLines = doc.splitTextToSize(ca || 'No corrective action recorded yet.', cw - 6);
    const need = 8 + descLines.length * 3.8 + 8 + caLines.length * 3.6 + 8;
    ensure(Math.min(need, ph - 40));
    doc.setFillColor(254, 242, 242); doc.roundedRect(mx, y, cw, 7, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...RED);
    doc.text(title, mx + 3, y + 4.7);
    y += 11;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK);
    descLines.forEach(line => { ensure(5); doc.text(line, mx + 3, y); y += 3.8; });
    y += 3;
    ensure(10);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...GREEN);
    doc.text('Corrective Action:', mx + 3, y); y += 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...(ca ? [70, 70, 80] : MUTED));
    caLines.forEach(line => { ensure(5); doc.text(line, mx + 3, y); y += 3.6; });
    y += 3;
    doc.setDrawColor(225, 225, 230); doc.line(mx, y, pw - mx, y);
    y += 7;
  });

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150, 150, 160);
    doc.text(`OnePWS Pvt. Ltd. | ${dept.name} | Confidential | Page ${p} of ${pages}`, pw / 2, ph - 8, { align: 'center' });
  }
  return doc;
}
