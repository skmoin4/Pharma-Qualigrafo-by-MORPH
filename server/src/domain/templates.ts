// Project templates (Phase 5 / step 2): what a project is given when it is created, resolved from its
// classification — industry group + facility type + service type — instead of from pharma defaults.
//
// Two things are generated today: the **disciplines** of the project and its **deliverable documents**, which are
// registered as "Missing" so the register states what is expected before anything has been produced. Requirements
// still come from the approved requirement library (services/libraryProjects.ts), now filtered by industry as well.
//
// Every deliverable belongs to a **track**: 'design' deliverables are only generated when the service includes
// design, 'bim' ones only when it includes BIM, and 'any' is generated either way. That is the client's rule —
// "for BIM-only projects, design-calculation registers stay hidden; for design-only projects, BIM fields stay
// hidden" — expressed as data rather than as conditions spread through the code.
//
// None of this is regulatory content: it is a starting register that the project team edits. Requirement *content*
// stays in the customer-approved library, where it is marked unverified until their own quality unit approves it.
import type { IndustryGroup, ServiceType } from './industries.ts'
import { includesBim, includesDesign } from './industries.ts'

export type Track = 'design' | 'bim' | 'any'

export interface DeliverableTemplate {
  /** Document title as it is registered; the project renames it freely afterwards. */
  title: string
  discipline: string
  /** The stage the deliverable is expected at, from PROJECT_STAGES. */
  stage: string
  track: Track
  /** Critical deliverables are the ones the handover gates and reminders treat as blocking. */
  critical?: boolean
}

export interface ProjectTemplate {
  /** What the template is called on screen, e.g. "Hospital / Healthcare · design + BIM". */
  label: string
  disciplines: string[]
  deliverables: DeliverableTemplate[]
  /** The specialised controls this industry expects, listed for the user. Informational in this step. */
  addOns: string[]
}

/* ------------------------------------------------------------ disciplines */

const PHARMA_DISCIPLINES = ['Civil & Cleanroom', 'Process Equipment', 'Piping & Utilities', 'HVAC', 'Electrical', 'Instrumentation', 'Fire & Life Safety', 'CQV']
const HOSPITAL_DISCIPLINES = ['Architecture', 'Structure', 'HVAC', 'Electrical', 'Plumbing & Drainage', 'Medical Gas', 'Medical Equipment', 'ICT & Nurse Call', 'Fire & Life Safety', 'Commissioning']
const SOLAR_DISCIPLINES = ['Civil & Structural', 'Solar PV & Array', 'Electrical (LV / HV)', 'Grid Interface & Substation', 'SCADA & Monitoring', 'Energy Storage (BESS)', 'Fire & Life Safety', 'Commissioning']
const SEMICON_DISCIPLINES = ['Civil & Structural', 'Cleanroom', 'Process Utilities', 'High-Purity Piping', 'Specialty Gases', 'Exhaust & Scrubbers', 'Electrical', 'Tool Hook-up', 'Facility Monitoring', 'Commissioning']
const COMMON_DISCIPLINES = ['Architecture', 'Structure', 'HVAC', 'Electrical', 'Plumbing & Drainage', 'Fire & Life Safety', 'Façade', 'Site Coordination', 'Commissioning']

/** Energy & High-Tech covers two very different worlds; the facility type says which one. */
export const isSemiconductor = (facilityType: string) => /^Semiconductor/i.test(facilityType)

/* ------------------------------------------------------------ deliverables */

const d = (discipline: string, title: string, stage: string, track: Track, critical = false): DeliverableTemplate => ({ discipline, title, stage, track, critical })

/**
 * Deliverables every engineering project has, whatever the industry. The discipline is filled in per project.
 *
 * **Critical** is deliberately rare: it drives the handover gates and the reminders, so it marks the formally
 * issued artefacts (construction issue and as-built) rather than every working document. Marking most of a register
 * critical would make the word mean nothing, which is worse than not using it.
 */
const perDiscipline = (discipline: string): DeliverableTemplate[] => [
  d(discipline, `${discipline} — design basis and criteria`, 'Concept', 'design'),
  d(discipline, `${discipline} — calculations`, 'Detailed design', 'design'),
  d(discipline, `${discipline} — layout and general arrangement drawings`, 'Detailed design', 'any'),
  d(discipline, `${discipline} — technical specification`, 'Detailed design', 'design'),
  d(discipline, `${discipline} — discipline model`, 'Detailed design', 'bim'),
  d(discipline, `${discipline} — clash resolution record`, 'Detailed design', 'bim'),
  d(discipline, `${discipline} — GFC / IFC drawings`, 'GFC / IFC', 'any', true),
  d(discipline, `${discipline} — shop drawings`, 'Shop drawing', 'any'),
  d(discipline, `${discipline} — as-built drawings`, 'As-built', 'any', true),
  d(discipline, `${discipline} — as-built model and asset data`, 'As-built', 'bim'),
]

/** Deliverables that belong to the project as a whole rather than to one discipline. */
const projectWide = (lead: string): DeliverableTemplate[] => [
  d(lead, 'Project execution plan', 'Concept', 'any'),
  d(lead, 'BIM execution plan (BEP)', 'Concept', 'bim'),
  d(lead, 'Master information delivery plan (MIDP)', 'Schematic', 'bim'),
  d(lead, 'Federated model and coordination report', 'Detailed design', 'bim'),
  d(lead, 'Commissioning and testing plan', 'Construction', 'any', true),
  d(lead, 'Handover dossier index', 'Handover / FM', 'any', true),
]

/* ------------------------------------------------------------ the templates */

const TEMPLATES: Record<IndustryGroup, { label: string; disciplines: string[]; addOns: string[]; lead: string }> = {
  'Pharma': {
    label: 'Pharma',
    disciplines: PHARMA_DISCIPLINES,
    lead: 'CQV',
    addOns: ['URS / DQ / IQ / OQ / PQ qualification records', 'Validation master plan', 'Cleanroom classification evidence', 'Deviations and CAPA', 'Electronic signatures on controlled records'],
  },
  'Hospital / Healthcare': {
    label: 'Hospital / Healthcare',
    disciplines: HOSPITAL_DISCIPLINES,
    lead: 'Commissioning',
    addOns: ['Medical gas verification', 'OT / ICU and infection-control requirements', 'Room and department data sheets', 'Healthcare equipment schedules', 'Authority approvals, testing and commissioning'],
  },
  'Energy & High-Tech': {
    label: 'Energy & High-Tech',
    disciplines: SOLAR_DISCIPLINES,
    lead: 'Commissioning',
    addOns: ['PV layout and stringing', 'Inverter and transformer packages', 'SCADA and grid interface', 'BESS', 'Yield and performance documentation', 'Asset register'],
  },
  'Common buildings': {
    label: 'Common buildings',
    disciplines: COMMON_DISCIPLINES,
    lead: 'Site Coordination',
    addOns: ['Authority approvals', 'Shop drawings and site coordination', 'Testing and balancing', 'As-built and O&M handover'],
  },
}

const SEMICON = {
  label: 'Energy & High-Tech · semiconductor',
  disciplines: SEMICON_DISCIPLINES,
  lead: 'Commissioning',
  addOns: ['Cleanroom classification', 'Tool hook-up packages', 'Specialty gases and high-purity piping', 'Process utilities and exhaust', 'Equipment move-in and sub-fab', 'Facility monitoring and commissioning'],
}

const base = (industryGroup: IndustryGroup, facilityType: string) =>
  industryGroup === 'Energy & High-Tech' && isSemiconductor(facilityType) ? SEMICON : TEMPLATES[industryGroup]

/** The disciplines a project of this classification starts with. */
export const disciplinesFor = (industryGroup: IndustryGroup, facilityType: string) => [...base(industryGroup, facilityType).disciplines]

/**
 * The template for one classification: the deliverables are the project-wide ones plus one set per chosen
 * discipline, keeping only the tracks the service type covers.
 */
export function templateFor(industryGroup: IndustryGroup, facilityType: string, serviceType: ServiceType, disciplines: string[]): ProjectTemplate {
  const b = base(industryGroup, facilityType)
  const keep = (t: DeliverableTemplate) => (t.track === 'any' ? true : t.track === 'bim' ? includesBim(serviceType) : includesDesign(serviceType))
  const lead = disciplines.includes(b.lead) ? b.lead : (disciplines[0] ?? b.lead)
  const deliverables = [...projectWide(lead), ...disciplines.flatMap((x) => perDiscipline(x))].filter(keep)
  return {
    label: `${b.label} · ${serviceType.toLowerCase()}`,
    disciplines: [...b.disciplines],
    deliverables,
    addOns: [...b.addOns],
  }
}

/** How many deliverables each track contributes, so the wizard can say what it is about to create. */
export function templateSummary(t: ProjectTemplate) {
  const byStage = new Map<string, number>()
  for (const x of t.deliverables) byStage.set(x.stage, (byStage.get(x.stage) ?? 0) + 1)
  return {
    total: t.deliverables.length,
    critical: t.deliverables.filter((x) => x.critical).length,
    byStage: [...byStage].map(([stage, n]) => ({ stage, n })),
  }
}
