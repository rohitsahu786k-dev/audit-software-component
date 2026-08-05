// Audit engine ported from the original OnePWS AuditPro portal.
// Multi-standard checkpoint library (STDLIB), standard metadata, and the dynamic checklist builder.

export const AUDIT_KEY = 'ap_active_audit';
export const SESSION_KEY = 'ap_audit_session';
export const CAPA_DUE_DEFAULTS = { critical: 7, major: 15, minor: 30, obs: 45 };
export const EMPTY_SESSION = { answers: {}, findings: {}, notes: {}, genNotes: '' };

export const STD_META = {
  as9100d: { id: 'as9100d', label: 'AS9100 Rev D', short: 'AS9100D', color: '#c0392b', bg: '#fef2f2', border: '#fca5a5', badge: 'b-red' },
  iso9001: { id: 'iso9001', label: 'ISO 9001:2015', short: 'ISO 9001', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', badge: 'b-blue' },
  iso14001: { id: 'iso14001', label: 'ISO 14001:2015', short: 'ISO 14001', color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4', badge: 'b-teal' },
  iso45001: { id: 'iso45001', label: 'ISO 45001:2018', short: 'ISO 45001', color: '#d97706', bg: '#fffbeb', border: '#fde68a', badge: 'b-amber' },
  internal: { id: 'internal', label: 'OnePWS Internal', short: 'Internal', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', badge: 'b-purple' },
};


export const STDLIB = {
  as9100d:{
    '':[ // Generic (all depts)
      {t:'Is the QMS scope defined, documented and communicated?',c:'AS9100D §4.3',w:4,tp:'Review QMS manual and scope statement'},
      {t:'Are quality objectives established, measurable and reviewed?',c:'AS9100D §6.2',w:4,tp:'Check objective register with targets and actuals'},
      {t:'Are documented work instructions available at point of use?',c:'AS9100D §7.5',w:5,tp:'Verify current revision on shopfloor / workstation'},
      {t:'Are all personnel aware of the quality policy and their QMS contribution?',c:'AS9100D §7.3',w:3,tp:'Ask 2-3 operators about quality policy'},
      {t:'Are nonconforming outputs controlled (identified, segregated, dispositioned)?',c:'AS9100D §8.7',w:5,tp:'Check NC tags, segregation area and MRB records',ai:'Non-conformance control is a top AS9100 audit focus.'},
      {t:'Are CARs raised, root-caused and tracked to verified closure?',c:'AS9100D §10.2',w:5,tp:'Review open CAR register and closure evidence'},
      {t:'Are risks and opportunities identified and actioned?',c:'AS9100D §6.1',w:4,tp:'Risk and opportunity register with controls and status'},
    ],
    PRE:[
      {t:'Are customer requirements (technical, quality, delivery) captured before bidding?',c:'AS9100D §8.2.2',w:4,tp:'Review last 3 bid review records'},
      {t:'Is feasibility (technical, quality, schedule) assessed before commitment?',c:'AS9100D §8.2.4',w:5,tp:'Feasibility sign-off required in bid files',ai:'Pre-sales failing to assess risk leads to downstream quality failures.'},
      {t:'Are customer-specific requirements (CSR) identified at pre-sales stage?',c:'AS9100D §8.2.2',w:4,tp:'IPCA/Thales specific flow-down must be captured early'},
    ],
    SAL:[
      {t:'Is a formal order/contract review conducted and documented before acceptance?',c:'AS9100D §8.2.3',w:5,tp:'Review signed order review checklist for last 3 orders'},
      {t:'Are changes to customer requirements communicated to all relevant functions?',c:'AS9100D §8.2.4',w:4,tp:'Check change notification records in project files'},
      {t:'Are all customer-specific requirements (CSR) flowed down to operations?',c:'AS9100D §8.2.2',w:5,tp:'CSR register must be referenced in work orders',ai:'CSR flow-down failure is a top finding in aerospace customer audits.'},
      {t:'Are delivery performance (OTD) metrics tracked and reported?',c:'AS9100D §9.1.1',w:4,tp:'Review OTD data for last quarter'},
    ],
    PEX:[
      {t:'Is a project plan maintained with milestones, resources and quality gates?',c:'AS9100D §8.1',w:5,tp:'Review project plan document with sign-offs'},
      {t:'Are project risks identified, assessed and mitigation tracked?',c:'AS9100D §6.1',w:5,tp:'Risk register must show owner and status',ai:'Lack of risk register is frequently cited in AS9100 surveillance audits.'},
      {t:'Are configuration management records maintained throughout lifecycle?',c:'AS9100D §8.1.3',w:5,tp:'Check drawing/BOM revision control records'},
      {t:'Are lessons learned captured and shared with relevant teams?',c:'AS9100D §10.1',w:3,tp:'Check lessons-learned register'},
    ],
    DES:[
      {t:'Is design & development planning documented with roles and review gates?',c:'AS9100D §8.3.2',w:5,tp:'Review D&D plan for current project'},
      {t:'Are design inputs (customer requirements, standards) fully captured?',c:'AS9100D §8.3.3',w:5,tp:'Trace requirements from customer spec to design input register'},
      {t:'Are design reviews, verification and validation activities conducted and recorded?',c:'AS9100D §8.3.4',w:5,tp:'Check DR/DV/DVP records with sign-offs'},
      {t:'Are design outputs (drawings, BOM) traceable to inputs?',c:'AS9100D §8.3.5',w:5,tp:'Pick 2 drawings and trace to design input register'},
      {t:'Are design changes (ECNs) controlled, reviewed and approved before release?',c:'AS9100D §8.3.6',w:5,tp:'Review last 3 ECNs for approval signatures',ai:'ENG-2025-025: unapproved design change — repeat risk.'},
      {t:'Is DFMEA maintained for critical and safety-related designs?',c:'AS9100D §8.3.3',w:4,tp:'DFMEA must be current and reviewed after changes'},
      {t:'Are Key Characteristics (KCs) identified and controlled in design outputs?',c:'AS9100D §8.3.5',w:5,tp:'KCs must be annotated on drawings and flowed to manufacturing'},
    ],
    PUR:[
      {t:'Is an Approved Vendor List (AVL) maintained, reviewed and controlled?',c:'AS9100D §8.4.1',w:5,tp:'Check AVL revision date and approval authority',ai:'PUR-2025-036: supplier qualification overdue for 3 vendors.'},
      {t:'Are supplier assessments/qualifications conducted and documented?',c:'AS9100D §8.4.1',w:5,tp:'Review qualification records for 3 critical suppliers'},
      {t:'Are customer-specific supplier requirements flowed down in POs?',c:'AS9100D §8.4.2',w:4,tp:'Check POs for customer QA requirements'},
      {t:'Are POs reviewed for technical completeness before release?',c:'AS9100D §8.4.3',w:4,tp:'Verify PO review checklist for last 5 POs'},
      {t:'Is supplier performance monitored (quality, delivery, rejection rate)?',c:'AS9100D §8.4.1',w:4,tp:'Check supplier scorecard/dashboard'},
    ],
    STR:[
      {t:'Are all items uniquely identified with traceable lot/batch/serial numbers?',c:'AS9100D §8.5.2',w:5,tp:'Sample 3 lots and verify ERP linkage',ai:'STR-2025-041: lot traceability failure — repeat risk.'},
      {t:'Is FIFO/FEFO implemented and verified for all materials?',c:'AS9100D §8.5.4',w:4,tp:'Check date labels and rack organisation on 5 locations'},
      {t:'Are storage conditions (temp/humidity) monitored and logged?',c:'AS9100D §8.5.3',w:4,tp:'Review 30-day logger data',ai:'STR-2025-033: temperature logs missing for 5 days.'},
      {t:'Are expired/shelf-life materials segregated and dispositioned?',c:'AS9100D §8.5.4',w:5,tp:'Physically check for expired items in stores'},
      {t:'Are Certificates of Conformance (CoC) received and filed for all critical items?',c:'AS9100D §8.4.3',w:5,tp:'Sample 3 recent GRNs and verify CoC on file'},
      {t:'Are goods receipt inspections performed and records maintained?',c:'AS9100D §8.4.3',w:4,tp:'Check IQC inspection reports for last 10 GRNs'},
    ],
    PRD:[
      {t:'Are production processes controlled using current, approved work instructions?',c:'AS9100D §8.5.1',w:5,tp:'WIs must show current revision at workstation'},
      {t:'Are First Article Inspections (FAI) performed per AS9102 for new/revised parts?',c:'AS9100D §8.5.1',w:5,tp:'FAI report must be on file before production release',ai:'FAI non-compliance is a major AS9100 audit finding.'},
      {t:'Is product traceability maintained throughout the entire production flow?',c:'AS9100D §8.5.2',w:5,tp:'Follow a router from raw material to finished goods'},
      {t:'Are special processes (welding, heat treat, painting) controlled and operators certified?',c:'AS9100D §8.5.1',w:5,tp:'Verify operator certifications and process qualification records'},
      {t:'Is process FMEA maintained and reviewed after changes or quality escapes?',c:'AS9100D §8.5.1',w:4,tp:'PFMEA revision date should be within 12 months'},
      {t:'Are production operators qualified for safety-critical operations?',c:'AS9100D §7.2',w:5,tp:'Check operator qualification matrix vs job assignments'},
      {t:'Are production records (routers/travelers) completed accurately and retained?',c:'AS9100D §8.5.1',w:5,tp:'Sample 5 travelers for completeness and legibility'},
    ],
    MNT:[
      {t:'Is a documented PM schedule maintained with all equipment listed?',c:'AS9100D §7.1.3',w:5,tp:'PM schedule must list all equipment with frequency and due dates'},
      {t:'Are PM activities completed on schedule with records of work done?',c:'AS9100D §7.1.3',w:5,tp:'Check last 3 months PM completion rate (target ≥95%)'},
      {t:'Are ALL measuring instruments calibrated with valid, traceable certificates?',c:'AS9100D §7.1.5',w:5,tp:'Pull 5 random instruments — verify calibration sticker and certificate',ai:'Calibration record gaps found in 5 previous audits — top recurring NC.'},
      {t:'Are calibration certificates traceable to national/international standards?',c:'AS9100D §7.1.5',w:5,tp:'Certificate must reference NABL/NIST/NPL traceability'},
      {t:'Are out-of-tolerance findings investigated for impact on past measurements?',c:'AS9100D §7.1.5',w:4,tp:'Out-of-cal event must trigger retrospective impact analysis'},
      {t:'Are equipment breakdown records maintained with root cause analysis?',c:'AS9100D §7.1.3',w:4,tp:'Check breakdown log for last 3 months with RCA entries'},
    ],
    ASM:[
      {t:'Are assembly work instructions current, approved and available at workstation?',c:'AS9100D §7.5',w:5,tp:'Check WI revision vs master document register'},
      {t:'Is traceability maintained for all sub-assemblies and key components?',c:'AS9100D §8.5.2',w:5,tp:'Trace serial numbers on sub-assemblies to batch records'},
      {t:'Are in-process inspections performed at defined checkpoints with sign-offs?',c:'AS9100D §8.6',w:5,tp:'Check traveler for inspection gate sign-offs'},
      {t:'Are torque and critical assembly parameters recorded with tool traceability?',c:'AS9100D §8.5.1',w:5,tp:'Torque records must reference the calibrated tool ID used'},
      {t:'Is a Foreign Object Damage (FOD) prevention programme in place?',c:'AS9100D §8.5.1',w:5,tp:'FOD prevention is mandatory for aerospace — check log and training records'},
    ],
    QAL:[
      {t:'Is an Inspection and Test Plan (ITP) documented and followed?',c:'AS9100D §8.6',w:5,tp:'ITP must reference drawing/spec and acceptance criteria'},
      {t:'Are all inspection records maintained with inspector sign-off and date?',c:'AS9100D §8.6',w:5,tp:'Sample 5 inspection reports — verify completeness',ai:'QAL-2025-029: inspection records not signed off.'},
      {t:'Is the nonconformance process followed end-to-end with full traceability?',c:'AS9100D §8.7',w:5,tp:'NC tag → MRB → disposition → closeout — verify all steps'},
      {t:'Is CAPA effectiveness verification documented?',c:'AS9100D §10.2',w:5,tp:'Verification must be done by Quality — not by the originating dept'},
      {t:'Are customer returns/complaints analysed with CARs raised?',c:'AS9100D §9.1.2',w:5,tp:'Check customer complaint log and associated CARs'},
      {t:'Are quality objectives tracked with trend data at management level?',c:'AS9100D §9.3',w:4,tp:'Review QO dashboard — each objective must have target and actual'},
    ],
    PCK:[
      {t:'Are packing specifications defined, approved and available at workstation?',c:'AS9100D §8.5.4',w:4,tp:'Packing spec must reference customer packaging requirements'},
      {t:'Is product ID/labelling (part no, rev, qty, lot) verified before packing?',c:'AS9100D §8.5.2',w:5,tp:'Verify label accuracy check is part of packing sign-off'},
      {t:'Is a final packing inspection checklist completed for each order?',c:'AS9100D §8.6',w:4,tp:'Packing checklist must be on file with each dispatch record'},
    ],
    DIS:[
      {t:'Is a dispatch checklist completed and verified for every shipment?',c:'AS9100D §8.5.5',w:4,tp:'Check last 5 dispatch records for completed checklists'},
      {t:'Are shipping documents (invoice, packing list, CoC) verified before release?',c:'AS9100D §8.5.5',w:5,tp:'Document set must be complete before goods leave premises'},
      {t:'Are customer delivery timelines tracked and deviations formally reported?',c:'AS9100D §8.5.5',w:4,tp:'Check OTD log — late deliveries must have customer notification'},
    ],
    SPS:[
      {t:'Are paint/coating specifications documented with process parameters?',c:'AS9100D §8.5.1',w:5,tp:'Process spec must be available at the process station'},
      {t:'Is surface preparation process validated with records maintained?',c:'AS9100D §8.5.1',w:5,tp:'Validation records must show acceptance criteria met'},
      {t:'Are film thickness checks performed per specification and recorded?',c:'AS9100D §8.6',w:5,tp:'Check last 10 film thickness inspection records'},
      {t:'Are environmental conditions (temp, humidity) monitored during painting?',c:'AS9100D §7.1.4',w:4,tp:'Environmental log must be maintained per batch'},
      {t:'Are chemical batch numbers and shelf-life recorded for each job?',c:'AS9100D §8.5.2',w:4,tp:'Traceability from material batch to job traveler'},
    ],
    MR:[
      {t:'Are Management Review meetings conducted with inputs and outputs documented?',c:'AS9100D §9.3',w:5,tp:'Minutes must show KPI inputs and resource/improvement outputs'},
      {t:'Are quality objectives reviewed and updated at management review?',c:'AS9100D §9.3.2',w:4,tp:'Check QO review in last MRM minutes'},
      {t:'Are customer feedback and complaint trends reviewed at management level?',c:'AS9100D §9.3.2',w:4,tp:'Customer satisfaction data must be presented in MRM'},
    ],
    HSE:[
      {t:'Is a Hazard Identification and Risk Assessment (HIRA) maintained and reviewed?',c:'AS9100D §6.1',w:5,tp:'HIRA must be reviewed after incidents or process changes'},
      {t:'Are emergency preparedness procedures documented with drills conducted?',c:'AS9100D §8.2',w:5,tp:'Check drill records — minimum 2 per year'},
      {t:'Are workplace incidents/near-misses reported, investigated and actioned?',c:'AS9100D §10.2',w:5,tp:'Every incident must have RCA and corrective action'},
    ],
    HR:[
      {t:'Are training needs identified and training plans documented for all roles?',c:'AS9100D §7.2',w:4,tp:'Training plan must be role-specific'},
      {t:'Are training effectiveness evaluations conducted and recorded?',c:'AS9100D §7.2',w:4,tp:'Post-training tests or supervisor observation records required'},
      {t:'Are competency records (skills matrix) current for all personnel?',c:'AS9100D §7.2',w:5,tp:'Skills matrix must show current status vs required competencies',ai:'Training records incomplete — top recurring NC across departments.'},
    ],
    IT:[
      {t:'Are data backup procedures defined and backups tested periodically?',c:'AS9100D §7.5',w:5,tp:'Backup test record must show successful restore verified'},
      {t:'Is role-based access control implemented for all QMS-related systems?',c:'AS9100D §7.5',w:5,tp:'Access control matrix must be reviewed and approved by management'},
    ],
    IAP:[
      {t:'Is an annual internal audit programme documented and approved?',c:'AS9100D §9.2',w:5,tp:'Programme must cover all processes within the audit cycle'},
      {t:'Are internal auditors trained, competent and independent from audited area?',c:'AS9100D §9.2.2',w:5,tp:'Auditor qualification records and independence declaration required'},
      {t:'Are all audit findings tracked to closure in a formal register?',c:'AS9100D §9.2.2',w:5,tp:'Register must show finding, owner, target date, closure status'},
      {t:'Are repeat findings tracked to identify systemic issues?',c:'AS9100D §10.2',w:5,tp:'Repeat findings must trigger systemic root cause analysis',ai:'Repeat findings indicate systemic issues — major AS9100 focus.'},
    ],
  },

  iso9001:{
    '':[ // Generic
      {t:'Are internal/external issues relevant to the organisation analysed?',c:'ISO 9001 §4.1',w:3,tp:'SWOT or PESTLE analysis reviewed annually'},
      {t:'Are interested parties and their relevant requirements understood?',c:'ISO 9001 §4.2',w:3,tp:'Stakeholder register with requirements and monitoring'},
      {t:'Is top management demonstrating leadership and commitment to QMS?',c:'ISO 9001 §5.1',w:4,tp:'Evidence: policy signing, MRM attendance, resource allocation'},
      {t:'Is continual improvement evidenced through systematic actions?',c:'ISO 9001 §10.3',w:4,tp:'Improvement initiatives register — show trend over time'},
      {t:'Is there a process for managing internal and external communication?',c:'ISO 9001 §7.4',w:3,tp:'Communication plan with records of key communications'},
    ],
    PEX:[
      {t:'Are project-specific quality plans developed and maintained?',c:'ISO 9001 §8.1',w:4,tp:'Project quality plan referencing applicable standards'},
      {t:'Are changes to project scope/requirements reviewed and approved?',c:'ISO 9001 §8.5.6',w:4,tp:'Change control log with approval authority'},
    ],
    DES:[
      {t:'Are design inputs documented and reviewed for adequacy and completeness?',c:'ISO 9001 §8.3.3',w:5,tp:'Input review must include completeness and conflict checks'},
      {t:'Are design review outcomes documented with actions and responsibilities?',c:'ISO 9001 §8.3.4',w:4,tp:'Design review minutes filed with action tracker'},
    ],
    PUR:[
      {t:'Is supplier control proportional to risk and impact on product quality?',c:'ISO 9001 §8.4.1',w:4,tp:'High-risk suppliers should have more rigorous controls'},
      {t:'Is supplier performance information communicated back to suppliers?',c:'ISO 9001 §8.4.1',w:3,tp:'Supplier performance review meetings or scorecards shared'},
    ],
    PRD:[
      {t:'Are production outputs validated to confirm requirements before release?',c:'ISO 9001 §8.6',w:5,tp:'Final inspection/test certificate required before dispatch'},
      {t:'Are changes to production processes controlled and reviewed for impact?',c:'ISO 9001 §8.5.6',w:4,tp:'Process change control — check last 3 change records'},
    ],
    MNT:[
      {t:'Is infrastructure adequacy reviewed and maintained for product conformity?',c:'ISO 9001 §7.1.3',w:4,tp:'Infrastructure review records in MRM or separate register'},
      {t:'Are monitoring resources identified, calibrated and fit for purpose?',c:'ISO 9001 §7.1.5',w:5,tp:'Calibration status must be visible on each instrument'},
    ],
    QAL:[
      {t:'Are customer satisfaction levels monitored and results analysed?',c:'ISO 9001 §9.1.2',w:4,tp:'Customer satisfaction surveys, complaint trends, OTD data'},
      {t:'Is data analysis used to evaluate QMS suitability and effectiveness?',c:'ISO 9001 §9.1.3',w:4,tp:'Regular analysis reports feeding management review'},
    ],
    STR:[
      {t:'Are products/materials protected from contamination and damage in storage?',c:'ISO 9001 §8.5.4',w:4,tp:'Physical check — racking, moisture/heat/contamination protection'},
      {t:'Is customer-owned property (free issue) identified and protected?',c:'ISO 9001 §8.5.3',w:4,tp:'Customer property log with condition records'},
    ],
    HR:[
      {t:'Is the work environment (physical, social, psychological) managed effectively?',c:'ISO 9001 §7.1.4',w:3,tp:'Employee welfare programs, ergonomics, work culture initiatives'},
    ],
    MR:[
      {t:'Does management review include process KPI and quality objective performance?',c:'ISO 9001 §9.3.2',w:4,tp:'MRM agenda/minutes must show KPI review'},
      {t:'Are improvement actions from management review tracked to completion?',c:'ISO 9001 §9.3.3',w:4,tp:'MRM action log with due dates and owners'},
    ],
    IAP:[
      {t:'Does the audit programme consider risk and importance of processes?',c:'ISO 9001 §9.2.2',w:4,tp:'High-risk processes should be audited more frequently'},
    ],
  },

  iso14001:{
    '':[ // Generic
      {t:'Are environmental aspects and impacts identified, evaluated and controlled?',c:'ISO 14001 §6.1.2',w:5,tp:'Aspect/impact register covering all operations, products and services'},
      {t:'Are environmental legal and compliance obligations identified and met?',c:'ISO 14001 §6.1.3',w:5,tp:'Legal register must be current — check last review date'},
      {t:'Are environmental objectives set with programmes and targets?',c:'ISO 14001 §6.2',w:4,tp:'Objectives must have targets, timelines and responsible persons'},
      {t:'Are operational controls in place for significant environmental aspects?',c:'ISO 14001 §8.1',w:5,tp:'Controls documented where absence could lead to environmental impact'},
      {t:'Is environmental performance monitored, measured and evaluated?',c:'ISO 14001 §9.1',w:4,tp:'KPIs: energy consumption, water usage, waste generated, emissions'},
      {t:'Are stakeholders (neighbours, authorities) informed of significant environmental risks?',c:'ISO 14001 §4.2',w:3,tp:'Community communication plan or records of notifications'},
    ],
    PRD:[
      {t:'Are environmental controls in place at production processes (waste, emissions, noise)?',c:'ISO 14001 §8.1',w:5,tp:'Check waste segregation, emission controls, noise measurements'},
      {t:'Is waste generated during production classified, segregated and legally disposed?',c:'ISO 14001 §6.1.2',w:5,tp:'Waste manifest/disposal records with licensed contractor CoC'},
      {t:'Is energy consumption monitored with efficiency measures in place?',c:'ISO 14001 §6.2',w:4,tp:'Energy metering at machine/area level with consumption trends'},
    ],
    SPS:[
      {t:'Are paint/solvent waste and VOC emissions controlled and within regulatory limits?',c:'ISO 14001 §6.1.2',w:5,tp:'Check VOC monitoring records and disposal contracts',ai:'Paint shops carry highest environmental risk — emission data frequently missing.'},
      {t:'Are hazardous chemical storage areas designed to prevent environmental release?',c:'ISO 14001 §8.1',w:5,tp:'Bunded storage, proper ventilation, spill kits accessible'},
      {t:'Is effluent from surface treatment disposed per consent/permit conditions?',c:'ISO 14001 §6.1.3',w:5,tp:'Effluent test reports vs consent conditions — must be within limits'},
      {t:'Are SDS (Safety Data Sheets) current and available at point of use?',c:'ISO 14001 §8.1',w:4,tp:'Current SDS must be at point of use for all hazardous chemicals'},
    ],
    MNT:[
      {t:'Is waste oil/hydraulic fluid disposal compliant with regulations?',c:'ISO 14001 §6.1.3',w:4,tp:'Waste oil disposal records — licensed contractor mandatory'},
      {t:'Are oil leaks managed to prevent soil/water contamination?',c:'ISO 14001 §8.1',w:4,tp:'Spill response kit present and drip trays under leaking equipment'},
    ],
    STR:[
      {t:'Are hazardous materials stored to prevent environmental release (bunding)?',c:'ISO 14001 §8.1',w:5,tp:'Bunded pallets or areas for all hazardous materials'},
      {t:'Is packaging waste (cardboard, plastic) segregated and recycled?',c:'ISO 14001 §6.1.2',w:3,tp:'Recycling bins present and used — check waste disposal records'},
    ],
    HSE:[
      {t:'Is the emergency response plan updated to include environmental scenarios?',c:'ISO 14001 §8.2',w:5,tp:'Spill response, chemical release and fire scenarios must be covered'},
      {t:'Are environmental emergency drills conducted and records maintained?',c:'ISO 14001 §8.2',w:4,tp:'Minimum one environmental drill per year — check records'},
      {t:'Is the environmental legal register reviewed when new regulations are issued?',c:'ISO 14001 §6.1.3',w:5,tp:'Legal register must show last review date and next scheduled review'},
    ],
    MR:[
      {t:'Are environmental KPIs and objectives reviewed at management review?',c:'ISO 14001 §9.3',w:4,tp:'Energy, water, waste trends must be on MRM agenda'},
    ],
    IAP:[
      {t:'Does the audit programme cover all significant environmental aspects?',c:'ISO 14001 §9.2',w:5,tp:'High-impact areas (paint shop, effluent) audited at least annually'},
    ],
    DIS:[
      {t:'Are transport-related environmental impacts considered and minimised?',c:'ISO 14001 §6.1.2',w:3,tp:'Evidence of route optimisation, packaging reduction initiatives'},
    ],
  },

  iso45001:{
    '':[ // Generic
      {t:'Are OH&S hazards identified, assessed and controlled using hierarchy of controls?',c:'ISO 45001 §6.1.2',w:5,tp:'HIRA must cover physical, chemical, ergonomic, psychological hazards'},
      {t:'Are OH&S legal requirements identified and complied with?',c:'ISO 45001 §6.1.3',w:5,tp:'Legal register verified against applicable legislation'},
      {t:'Are workers consulted and involved in OH&S management decisions?',c:'ISO 45001 §5.4',w:4,tp:'Safety committee minutes, worker reps — evidence of participation'},
      {t:'Are OH&S objectives set with measurable targets?',c:'ISO 45001 §6.2',w:4,tp:'Objectives: TRIFR, near-miss frequency, training completion'},
      {t:'Is there a process for reporting and investigating incidents and near misses?',c:'ISO 45001 §9.1.1',w:5,tp:'Near-miss reporting must be encouraged — check frequency vs benchmarks'},
      {t:'Are risk assessments reviewed after incidents or changes to operations?',c:'ISO 45001 §6.1.2',w:5,tp:'Post-incident risk review must be documented'},
    ],
    PRD:[
      {t:'Are production workers trained on OH&S hazards specific to their tasks?',c:'ISO 45001 §7.2',w:5,tp:'Task-specific safety induction records must be on file'},
      {t:'Are machine guarding and safety interlocks in place and functional?',c:'ISO 45001 §6.1.2',w:5,tp:'Physically check guarding on rotating machinery — must not be bypassed'},
      {t:'Are hot work, confined space and LOTO procedures followed?',c:'ISO 45001 §8.1.3',w:5,tp:'Permit-to-work system — check recent permit records'},
      {t:'Is PPE appropriate, available and used correctly in production?',c:'ISO 45001 §8.1.2',w:5,tp:'Physically observe PPE compliance in the production area'},
      {t:'Are noise/dust/chemical exposures monitored and within safe limits?',c:'ISO 45001 §8.1.1',w:4,tp:'Health surveillance and exposure monitoring records'},
    ],
    MNT:[
      {t:'Are LOTO (Lockout/Tagout) procedures followed during all maintenance activities?',c:'ISO 45001 §8.1.3',w:5,tp:'LOTO must be equipment-specific — audited for compliance',ai:'LOTO non-compliance is a life-critical safety violation.'},
      {t:'Are confined space entry procedures in place for applicable equipment?',c:'ISO 45001 §8.1.3',w:5,tp:'Confined space register and permit-to-enter records required'},
      {t:'Are contractors inducted on site OH&S requirements before work?',c:'ISO 45001 §8.1.4',w:4,tp:'Contractor induction register with sign-off records'},
    ],
    SPS:[
      {t:'Are respiratory protection programmes in place for chemical exposure?',c:'ISO 45001 §8.1.2',w:5,tp:'Respirator selection, fit-testing records, maintenance log required'},
      {t:'Are chemical exposure levels monitored and within Occupational Exposure Limits?',c:'ISO 45001 §8.1.1',w:5,tp:'Air monitoring reports vs OEL for solvents/isocyanates used'},
    ],
    ASM:[
      {t:'Are manual handling risks assessed with controls to prevent MSDs?',c:'ISO 45001 §6.1.2',w:4,tp:'Manual handling risk assessment — lifting aids, ergonomic workstations'},
      {t:'Are slip/trip/fall hazards identified and controlled in assembly areas?',c:'ISO 45001 §6.1.2',w:4,tp:'Housekeeping standards, anti-slip flooring, good lighting — check area'},
    ],
    HSE:[
      {t:'Is the OH&S policy defined, signed by top management and communicated?',c:'ISO 45001 §5.2',w:4,tp:'Policy must be displayed and communicated to all workers'},
      {t:'Are emergency evacuation procedures documented, practiced and recorded?',c:'ISO 45001 §8.2',w:5,tp:'Fire drill records — minimum 2 per year per location'},
      {t:'Are first aid facilities adequate and first aiders trained and certified?',c:'ISO 45001 §8.1.1',w:4,tp:'First aid box inspection records — current first aider certifications'},
      {t:'Is health surveillance in place for workers exposed to occupational risks?',c:'ISO 45001 §8.1.1',w:5,tp:'Medical records, periodic health checks for noise/chemical/dust exposed workers'},
      {t:'Are all incidents (including near misses) investigated with corrective actions?',c:'ISO 45001 §10.2',w:5,tp:'Every incident must have completed investigation with RCA'},
      {t:'Is OH&S performance reviewed at management review with trend analysis?',c:'ISO 45001 §9.3',w:4,tp:'Incident frequency, near-miss rate, training completion in MRM data'},
    ],
    HR:[
      {t:'Is OH&S induction provided to all new employees before they start work?',c:'ISO 45001 §7.2',w:5,tp:'Induction record must be signed before first day on shopfloor'},
      {t:'Are employees trained on emergency procedures, evacuation and first aid locations?',c:'ISO 45001 §7.3',w:5,tp:'Ask 2 employees to point out emergency exits and first aid kit'},
      {t:'Is mental health and worker wellbeing addressed in OH&S programmes?',c:'ISO 45001 §5.4',w:3,tp:'EAP, stress management, workload review processes'},
    ],
    MR:[
      {t:'Are OH&S objectives and KPIs reviewed at management review?',c:'ISO 45001 §9.3',w:4,tp:'TRIFR, near-miss trends, training completion in MRM data'},
    ],
    IAP:[
      {t:'Does the internal audit programme cover OH&S management system requirements?',c:'ISO 45001 §9.2',w:4,tp:'OH&S audits must provide specific coverage of safety management'},
    ],
  },
};

export function buildChecklist(deptCode, standards, depts, checkpoints) {
  const sections = [];
  const seen = new Set();
  standards.forEach(sid => {
    const lib = STDLIB[sid]; if (!lib) return;
    const sm = STD_META[sid];
    const all = [...(lib[deptCode] || []), ...(lib[''] || [])];
    const cps = [];
    all.forEach(cp => {
      const key = (cp.t + cp.c).toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        cps.push({ id: 'dyn_' + sid + '_' + deptCode + '_' + cps.length + '_' + Date.now(), text: cp.t, clause: cp.c, weight: cp.w || 3, type: cp.tp2 || 'Yes/No', tip: cp.tp || '', aiSuggestion: cp.ai || '', dept: deptCode, standard: sid });
      }
    });
    if (cps.length > 0) {
      sections.push({ id: 'sec_' + sid + '_' + deptCode, title: sm.label + ' — Audit Checkpoints', clause: sm.short, risk: (sid === 'as9100d' || sid === 'iso45001') ? 'High' : 'Medium', stdId: sid, _checkpoints: cps, cpIds: cps.map(c => c.id) });
    }
  });
  if (standards.includes('internal')) {
    const deptObj = (depts || []).find(d => d.code === deptCode);
    const deptNameLower = deptObj ? deptObj.name.toLowerCase() : '';
    const masterCps = (checkpoints || []).filter(cp => {
      if (!cp.dept || cp.dept === 'All' || cp.dept === 'all') return true;
      if (cp.dept === deptCode) return true;
      const cpLow = (cp.dept || '').toLowerCase().trim();
      if (deptNameLower && cpLow === deptNameLower) return true;
      if (cpLow === deptCode.toLowerCase()) return true;
      return false;
    });
    if (masterCps.length > 0) {
      const intCps = [];
      masterCps.forEach(cp => {
        const key = (cp.text + (cp.clause || '')).toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          intCps.push({ id: 'int_' + deptCode + '_' + intCps.length + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), text: cp.text, clause: cp.clause || 'Internal', weight: cp.weight || 3, type: cp.type || 'Yes/No', tip: cp.tip || '', aiSuggestion: cp.aiSuggestion || '', dept: deptCode, standard: 'internal', sourceId: cp.id });
        }
      });
      if (intCps.length > 0) {
        sections.push({ id: 'sec_internal_' + deptCode, title: 'OnePWS Internal Checkpoints', clause: 'Internal', risk: 'Medium', stdId: 'internal', _checkpoints: intCps, cpIds: intCps.map(c => c.id) });
      }
    }
  }
  return sections;
}
