// Unverified starter template for the requirement library: topic-level entries only (no clauses).
// Loaded on request as DRAFT pack versions; the customer's reviewers verify, complete and approve them.
//
// Phase 5 / step 2b: the template covers all four industry groups. Every item carries the industry group it belongs
// to, so a pack can hold more than one industry and a project only ever receives the items of its own.
//
// **What these entries are and are not.** They are a list of *topics* an engineering project in that industry
// normally has to evidence — not regulation, not clauses, not an assurance that the list is complete. The exact
// instrument, clause, edition and effective date differ per country and per project and are left blank on purpose:
// the customer's own qualified reviewer fills them in and approves the version, under the four-eyes rule. The topic
// line of every item says so, and the version is marked `starter` until they approve it.
//
// The topics are deliberately the same in every market, because the *topics* (medical gas, earthing, cleanroom
// classification, fire compartmentation) are what they are wherever the project is; what changes per country is the
// instrument that governs them, which is exactly the part a reviewer has to supply. Writing different topic sets per
// country would be inventing regulatory judgement we are not entitled to make.
import { INDUSTRY_GROUP_INFO } from './industries.ts'
import type { IndustryGroup } from './industries.ts'
import type { MarketKey } from './types.ts'

export interface StarterItem {
  key: string
  title: string
  topic: string
  discipline: string
  critical: boolean
  /** Facility types the item is limited to; empty = every facility of the industry group. */
  facilities?: string[]
}

const VERIFY = 'Topic mapping — exact clause, version and effective date require expert verification'
const LOCAL = 'Local authority / project-specific review'

/* ------------------------------------------------------------ pharma (unchanged content) */

const PHARMA: Record<string, StarterItem> = Object.fromEntries(([
  ['TOPIC-01', 'Premises layout, flow and cleanroom finishes', 'Civil & Cleanroom', true, VERIFY],
  ['TOPIC-02', 'Equipment design and vendor evidence', 'Process Equipment', false, VERIFY],
  ['TOPIC-03', 'Purified water system documentation', 'Piping & Utilities', true, VERIFY],
  ['TOPIC-04', 'Material traceability for utility piping', 'Piping & Utilities', true, VERIFY],
  ['TOPIC-05', 'HVAC design and verification evidence', 'HVAC', true, VERIFY],
  ['TOPIC-06', 'Electrical installation evidence', 'Electrical', false, VERIFY],
  ['TOPIC-07', 'Instrument calibration evidence', 'Instrumentation', true, VERIFY],
  ['TOPIC-08', 'Fire-system project approvals', 'Fire & Life Safety', false, 'Local authority / project-specific review (not GMP)'],
  ['TOPIC-09', 'Qualification planning and traceability', 'CQV', true, VERIFY],
  ['TOPIC-10', 'Electronic records and signatures scope check', 'CQV', false, VERIFY],
  ['TOPIC-11', 'Personnel and material flow, gowning interface', 'Civil & Cleanroom', false, VERIFY],
  ['TOPIC-12', 'Pressure cascade and environmental control design', 'HVAC', true, VERIFY],
  ['TOPIC-13', 'Cleanroom classification and room-integrity verification', 'HVAC', true, VERIFY],
  ['TOPIC-14', 'Water system sanitisation and monitoring provisions', 'Piping & Utilities', false, VERIFY],
  ['TOPIC-15', 'Equipment installation qualification documentation', 'Process Equipment', true, VERIFY],
  ['TOPIC-16', 'Building monitoring system documentation', 'Instrumentation', false, VERIFY],
  ['TOPIC-17', 'Emergency power and utility continuity for critical systems', 'Electrical', false, VERIFY],
  ['TOPIC-18', 'Fire compartmentation and evacuation approvals', 'Fire & Life Safety', false, 'Local authority / project-specific review (not GMP)'],
  ['TOPIC-19', 'Computerised system documentation (monitoring and control)', 'Instrumentation', false, VERIFY],
  ['TOPIC-20', 'Equipment and facility design documentation', 'Process Equipment', false, VERIFY],
  ['TOPIC-21', 'Electronic signature controls for engineering records (scope check)', 'CQV', false, VERIFY],
] as [string, string, string, boolean, string][]).map(([key, title, discipline, critical, topic]) => [key, { key, title, topic, discipline, critical }]))

/** Which pharma topics each market's starter draft holds, and where a market treats one as critical. */
const PHARMA_BY_MARKET: Partial<Record<MarketKey, { key: string; critical?: boolean }[]>> = {
  SA: [{ key: 'TOPIC-01' }, { key: 'TOPIC-02' }, { key: 'TOPIC-03' }, { key: 'TOPIC-04' }, { key: 'TOPIC-05' }, { key: 'TOPIC-06' }, { key: 'TOPIC-07' }, { key: 'TOPIC-08' }, { key: 'TOPIC-09' }, { key: 'TOPIC-11' }, { key: 'TOPIC-12' }, { key: 'TOPIC-13' }, { key: 'TOPIC-14' }, { key: 'TOPIC-15' }, { key: 'TOPIC-16' }, { key: 'TOPIC-17' }, { key: 'TOPIC-18' }],
  EU: [{ key: 'TOPIC-01' }, { key: 'TOPIC-03' }, { key: 'TOPIC-05', critical: false }, { key: 'TOPIC-07' }, { key: 'TOPIC-09' }, { key: 'TOPIC-19' }, { key: 'TOPIC-15' }],
  IN: [{ key: 'TOPIC-01', critical: false }, { key: 'TOPIC-02' }, { key: 'TOPIC-04' }, { key: 'TOPIC-06' }, { key: 'TOPIC-09', critical: false }, { key: 'TOPIC-05' }, { key: 'TOPIC-03' }, { key: 'TOPIC-07' }, { key: 'TOPIC-15', critical: false }],
  US: [{ key: 'TOPIC-10' }, { key: 'TOPIC-20' }, { key: 'TOPIC-21' }],
}

/* ------------------------------------------------------------ the three new industry groups */

// Energy & High-Tech holds two worlds in one group, so its items say which of the two they belong to: a solar farm
// must not be given cleanroom requirements, and a wafer fab must not be given array stringing.
const ENERGY_FACILITIES = INDUSTRY_GROUP_INFO.find((g) => g.key === 'Energy & High-Tech')?.facilities ?? []
const SEMICONDUCTOR = ENERGY_FACILITIES.filter((f) => /^Semiconductor/i.test(f))
const RENEWABLE = ENERGY_FACILITIES.filter((f) => !/^Semiconductor/i.test(f) && f !== 'Other / custom facility')

const HOSPITAL: StarterItem[] = [
  { key: 'HOS-01', title: 'Departmental layout, clinical adjacency and flow separation', topic: VERIFY, discipline: 'Architecture', critical: true },
  { key: 'HOS-02', title: 'Infection-control requirements for finishes, joints and surfaces', topic: VERIFY, discipline: 'Architecture', critical: true },
  { key: 'HOS-03', title: 'Operating theatre and critical-care ventilation performance', topic: VERIFY, discipline: 'HVAC', critical: true },
  { key: 'HOS-04', title: 'Isolation room pressure regime and verification', topic: VERIFY, discipline: 'HVAC', critical: true },
  { key: 'HOS-05', title: 'Medical gas pipeline design, purity and verification', topic: VERIFY, discipline: 'Medical Gas', critical: true },
  { key: 'HOS-06', title: 'Medical gas alarm, zone valve and emergency supply arrangements', topic: VERIFY, discipline: 'Medical Gas', critical: true },
  { key: 'HOS-07', title: 'Essential electrical supply, grading and changeover evidence', topic: VERIFY, discipline: 'Electrical', critical: true },
  { key: 'HOS-08', title: 'Medical IT / isolated power systems for clinical areas', topic: VERIFY, discipline: 'Electrical', critical: false },
  { key: 'HOS-09', title: 'Radiation shielding design and verification', topic: VERIFY, discipline: 'Architecture', critical: true, facilities: ['Diagnostic / imaging centre', 'Cancer / oncology hospital', 'General hospital', 'Multi-speciality hospital', 'Super-speciality hospital', 'Teaching hospital / medical college'] },
  { key: 'HOS-10', title: 'Water systems, legionella control and dialysis water quality', topic: VERIFY, discipline: 'Plumbing & Drainage', critical: true },
  { key: 'HOS-11', title: 'Clinical and hazardous waste handling routes and storage', topic: VERIFY, discipline: 'Plumbing & Drainage', critical: false },
  { key: 'HOS-12', title: 'Medical equipment schedules, room data sheets and interfaces', topic: VERIFY, discipline: 'Medical Equipment', critical: true },
  { key: 'HOS-13', title: 'Nurse call, clinical communications and ICT infrastructure', topic: VERIFY, discipline: 'ICT & Nurse Call', critical: false },
  { key: 'HOS-14', title: 'Fire compartmentation, progressive horizontal evacuation and approvals', topic: `${LOCAL} — healthcare occupancies are treated separately`, discipline: 'Fire & Life Safety', critical: true },
  { key: 'HOS-15', title: 'Testing, commissioning and clinical handover evidence', topic: VERIFY, discipline: 'Commissioning', critical: true },
]

const ENERGY: StarterItem[] = [
  { key: 'SOL-01', title: 'Site survey, topography and geotechnical basis', topic: VERIFY, discipline: 'Civil & Structural', critical: false, facilities: RENEWABLE },
  { key: 'SOL-02', title: 'Structural design for wind, snow and seismic actions', topic: VERIFY, discipline: 'Civil & Structural', critical: true, facilities: RENEWABLE },
  { key: 'SOL-03', title: 'Module and mounting system qualification evidence', topic: VERIFY, discipline: 'Solar PV & Array', critical: true, facilities: RENEWABLE },
  { key: 'SOL-04', title: 'Array layout, stringing and shading analysis', topic: VERIFY, discipline: 'Solar PV & Array', critical: false, facilities: RENEWABLE },
  { key: 'SOL-05', title: 'Inverter and transformer package documentation', topic: VERIFY, discipline: 'Electrical (LV / HV)', critical: true, facilities: RENEWABLE },
  { key: 'SOL-06', title: 'Earthing, bonding and lightning protection design', topic: VERIFY, discipline: 'Electrical (LV / HV)', critical: true, facilities: RENEWABLE },
  { key: 'SOL-07', title: 'DC and AC cable sizing, protection and selectivity', topic: VERIFY, discipline: 'Electrical (LV / HV)', critical: true, facilities: RENEWABLE },
  { key: 'SOL-08', title: 'Grid connection, protection settings and compliance evidence', topic: `${VERIFY}; the applicable grid code is set by the network operator`, discipline: 'Grid Interface & Substation', critical: true, facilities: RENEWABLE },
  { key: 'SOL-09', title: 'SCADA, metering and performance monitoring', topic: VERIFY, discipline: 'SCADA & Monitoring', critical: false, facilities: RENEWABLE },
  { key: 'SOL-10', title: 'Energy storage safety, fire protection and siting', topic: VERIFY, discipline: 'Energy Storage (BESS)', critical: true, facilities: ['Battery energy storage system (BESS)', 'Hybrid renewable plant – solar + wind + BESS', 'Microgrid / distributed energy'] },
  { key: 'SOL-11', title: 'Fire safety, access and emergency response for the plant', topic: LOCAL, discipline: 'Fire & Life Safety', critical: false, facilities: RENEWABLE },
  { key: 'SOL-12', title: 'Commissioning tests, yield verification and performance ratio', topic: VERIFY, discipline: 'Commissioning', critical: true, facilities: RENEWABLE },
  { key: 'SEM-01', title: 'Cleanroom classification, recovery and monitoring regime', topic: VERIFY, discipline: 'Cleanroom', critical: true, facilities: SEMICONDUCTOR },
  { key: 'SEM-02', title: 'Vibration, noise and EMI criteria for tool areas', topic: VERIFY, discipline: 'Cleanroom', critical: true, facilities: SEMICONDUCTOR },
  { key: 'SEM-03', title: 'Specialty gas storage, distribution and detection', topic: VERIFY, discipline: 'Specialty Gases', critical: true, facilities: SEMICONDUCTOR },
  { key: 'SEM-04', title: 'High-purity piping materials, welding and passivation evidence', topic: VERIFY, discipline: 'High-Purity Piping', critical: true, facilities: SEMICONDUCTOR },
  { key: 'SEM-05', title: 'Process exhaust segregation, scrubbing and abatement', topic: VERIFY, discipline: 'Exhaust & Scrubbers', critical: true, facilities: SEMICONDUCTOR },
  { key: 'SEM-06', title: 'Process utilities: UPW, process cooling and compressed gases', topic: VERIFY, discipline: 'Process Utilities', critical: true, facilities: SEMICONDUCTOR },
  { key: 'SEM-07', title: 'Tool hook-up packages and equipment move-in sequence', topic: VERIFY, discipline: 'Tool Hook-up', critical: false, facilities: SEMICONDUCTOR },
  { key: 'SEM-08', title: 'Equipment safety and interlock review for process tools', topic: VERIFY, discipline: 'Tool Hook-up', critical: true, facilities: SEMICONDUCTOR },
  { key: 'SEM-09', title: 'Facility monitoring and alarm management', topic: VERIFY, discipline: 'Facility Monitoring', critical: false, facilities: SEMICONDUCTOR },
]

const COMMON: StarterItem[] = [
  { key: 'COM-01', title: 'Planning permission, zoning and authority approvals', topic: LOCAL, discipline: 'Architecture', critical: true },
  { key: 'COM-02', title: 'Accessibility and inclusive design compliance', topic: VERIFY, discipline: 'Architecture', critical: true },
  { key: 'COM-03', title: 'Structural design basis, loads and durability', topic: VERIFY, discipline: 'Structure', critical: true },
  { key: 'COM-04', title: 'Fire strategy, compartmentation and means of escape approvals', topic: `${LOCAL} — fire authority sign-off`, discipline: 'Fire & Life Safety', critical: true },
  { key: 'COM-05', title: 'Fire detection, suppression and smoke control evidence', topic: VERIFY, discipline: 'Fire & Life Safety', critical: true },
  { key: 'COM-06', title: 'Thermal performance and energy code compliance', topic: VERIFY, discipline: 'HVAC', critical: false },
  { key: 'COM-07', title: 'Ventilation rates and indoor air quality', topic: VERIFY, discipline: 'HVAC', critical: false },
  { key: 'COM-08', title: 'Electrical installation, earthing and protection evidence', topic: VERIFY, discipline: 'Electrical', critical: true },
  { key: 'COM-09', title: 'Water supply, drainage and sanitary provision', topic: VERIFY, discipline: 'Plumbing & Drainage', critical: false },
  { key: 'COM-10', title: 'Façade performance: weather-tightness, safety and fire behaviour', topic: VERIFY, discipline: 'Façade', critical: true },
  { key: 'COM-11', title: 'Vertical transportation design and statutory inspection', topic: VERIFY, discipline: 'Site Coordination', critical: false },
  { key: 'COM-12', title: 'Acoustic performance between and within occupancies', topic: VERIFY, discipline: 'Architecture', critical: false },
  { key: 'COM-13', title: 'Testing, balancing, commissioning and O&M handover', topic: VERIFY, discipline: 'Commissioning', critical: true },
]

/* ------------------------------------------------------------ assembled per industry and market */

export const STARTER_INDUSTRIES: IndustryGroup[] = ['Pharma', 'Hospital / Healthcare', 'Energy & High-Tech', 'Common buildings']

const pharmaFor = (m: MarketKey): StarterItem[] =>
  (PHARMA_BY_MARKET[m] ?? []).map(({ key, critical }) => ({ ...PHARMA[key], ...(critical === undefined ? {} : { critical }) }))

/**
 * The starter content for one industry group in one market. Pharma keeps the per-market sets it shipped with, so a
 * pharma installation sees exactly the drafts it saw before. The other three groups use one topic set everywhere.
 */
export function starterFor(industry: IndustryGroup, market: MarketKey): StarterItem[] {
  if (industry === 'Pharma') return pharmaFor(market)
  if (industry === 'Hospital / Healthcare') return HOSPITAL
  if (industry === 'Energy & High-Tech') return ENERGY
  return COMMON
}

/** Markets that have starter content for at least one of the chosen industry groups. */
export const starterMarkets = (industries: IndustryGroup[], markets: readonly MarketKey[]) =>
  markets.filter((m) => industries.some((i) => starterFor(i, m).length))

/** Kept for the pharma-only callers that ask whether a market has anything to offer at all. */
export const STARTER_LIBRARY: Partial<Record<MarketKey, StarterItem[]>> = Object.fromEntries(
  (['SA', 'EU', 'IN', 'US', 'UK'] as MarketKey[]).map((m) => [m, STARTER_INDUSTRIES.flatMap((i) => starterFor(i, m))]).filter(([, items]) => (items as StarterItem[]).length),
) as Partial<Record<MarketKey, StarterItem[]>>
