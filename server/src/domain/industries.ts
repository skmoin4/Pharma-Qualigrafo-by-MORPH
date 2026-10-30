// Project classification reference data (Phase 5 / step 1): the four industry groups, their facility lists, the
// mandatory service type, the project stages and the BIM requirement options. The client's specification is
// clientnew/Qualigrafo_Comprehensive_Industry_Facility_UI.html (facility lists) and
// clientnew/Qualigrafo_Unified_Project_Creation_UI.html (service type, stage, BIM block).
//
// Every list is reference data rather than a TypeScript union, because a customer's facility is not something the
// software can enumerate for them: each group therefore ends with "Other / custom facility", which turns on a free
// text field. The five pharma values that shipped before this step stay at the head of the pharma list, so projects
// created by the old wizard keep a value that is still offered (decision §6.4.7).

export const INDUSTRY_GROUPS = ['Energy & High-Tech', 'Hospital / Healthcare', 'Pharma', 'Common buildings'] as const
export const SERVICE_TYPES = ['Design only', 'BIM only', 'Design + BIM'] as const

export type IndustryGroup = (typeof INDUSTRY_GROUPS)[number]
export type ServiceType = (typeof SERVICE_TYPES)[number]

/** The option every group ends with; selecting it requires `customFacilityType`. */
export const CUSTOM_FACILITY = 'Other / custom facility'

export interface IndustryGroupInfo {
  key: IndustryGroup
  /** One line under the group's name in the wizard. */
  summary: string
  /** Facility types offered for the group, ending with CUSTOM_FACILITY. */
  facilities: string[]
}

const PHARMA_FACILITIES = [
  // The five values the pharma wizard offered before this step; existing projects hold one of them.
  'API',
  'Non-sterile formulation',
  'Sterile products',
  'Biologics',
  'Warehouse',
  // The client's wider pharma list.
  'API intermediate manufacturing',
  'Oral solid dosage – tablet / capsule',
  'Oral liquid / syrup manufacturing',
  'Topical / ointment / cream manufacturing',
  'Sterile injectable facility',
  'SVP / LVP / parenteral facility',
  'Vaccine manufacturing facility',
  'Biosimilar facility',
  'Oncology / cytotoxic / HPAPI facility',
  'Beta-lactam / penicillin / cephalosporin facility',
  'Hormone / steroid facility',
  'Inhalation / DPI / MDI facility',
  'Nutraceutical / supplement facility',
  'R&D / formulation development centre',
  'Pilot plant / scale-up facility',
  'QC / analytical / microbiology laboratory',
  'Cleanroom facility',
  'Pharma packaging facility',
  'Cold storage / cold chain facility',
  'Central utility / process utility facility',
]

const ENERGY_FACILITIES = [
  'Solar PV – utility scale / ground mounted',
  'Solar PV – rooftop',
  'Solar PV – floating solar',
  'Solar PV – carport / canopy',
  'Solar thermal / CSP',
  'Wind energy – onshore',
  'Wind energy – offshore',
  'Battery energy storage system (BESS)',
  'Hybrid renewable plant – solar + wind + BESS',
  'Hydropower / small hydro',
  'Biomass / biogas / waste-to-energy',
  'Geothermal energy',
  'Green hydrogen / electrolyser facility',
  'Microgrid / distributed energy',
  'Renewable energy utility / substation / grid interface',
  'Semiconductor – front-end wafer fab / foundry',
  'Semiconductor – IDM facility',
  'Semiconductor – ATMP / OSAT',
  'Semiconductor – assembly, test & packaging',
  'Semiconductor – advanced packaging',
  'Semiconductor – R&D / pilot fab',
  'Semiconductor – photomask facility',
  'Semiconductor – wafer / materials facility',
  'Semiconductor equipment manufacturing',
  'Semiconductor cleanroom / sub-fab',
  'Semiconductor central utility plant / process utility facility',
]

const HOSPITAL_FACILITIES = [
  'General hospital',
  'Multi-speciality hospital',
  'Super-speciality hospital',
  'Teaching hospital / medical college',
  'Cancer / oncology hospital',
  'Cardiac hospital',
  'Maternity / women & child hospital',
  "Children's / paediatric hospital",
  'Orthopaedic hospital',
  'Eye hospital',
  'Dental hospital / dental college',
  'Mental health / psychiatric facility',
  'Rehabilitation centre',
  'Emergency / trauma centre',
  'Ambulatory / day-care / day-surgery centre',
  'Clinic / polyclinic',
  'Diagnostic / imaging centre',
  'Pathology / laboratory facility',
  'Dialysis centre',
  'IVF / ART centre',
  'Blood bank / transfusion centre',
  'Long-term care / assisted living / senior care',
  'Home-care / community healthcare facility',
]

const COMMON_FACILITIES = [
  'Residential – high-rise apartment',
  'Residential – low-rise / mid-rise',
  'Residential – villa / bungalow',
  'Residential – township / gated community',
  'Residential – staff housing / hostel / dormitory',
  'Commercial – office building / corporate HQ',
  'Commercial – business park',
  'Commercial – shopping mall / retail',
  'Commercial – mixed-use development',
  'Education – school',
  'Education – college',
  'Education – university / campus',
  'Education – research / laboratory building',
  'Hospitality – hotel',
  'Hospitality – resort',
  'Hospitality – serviced apartment',
  'Hospitality – convention / banquet facility',
  'Data center – enterprise',
  'Data center – colocation',
  'Data center – hyperscale',
  'Data center – edge',
  'Industrial / manufacturing – general factory',
  'Industrial – automotive / assembly',
  'Industrial – food & beverage',
  'Industrial – textile',
  'Industrial – heavy engineering',
  'Warehouse / logistics – general warehouse',
  'Warehouse / logistics – distribution centre',
  'Warehouse / logistics – cold storage',
  'Warehouse / logistics – fulfilment centre',
  'Airport / aviation – passenger terminal',
  'Airport / aviation – cargo terminal',
  'Airport / aviation – hangar / MRO',
  'Infrastructure – metro / railway',
  'Infrastructure – roads / transport',
  'Infrastructure – water / sewage / utilities',
  'Infrastructure – public / government building',
  'Religious / cultural / community facility',
  'Sports / stadium / arena',
]

export const INDUSTRY_GROUP_INFO: IndustryGroupInfo[] = [
  { key: 'Energy & High-Tech', summary: 'Solar, renewable energy, semiconductor', facilities: [...ENERGY_FACILITIES, CUSTOM_FACILITY] },
  { key: 'Hospital / Healthcare', summary: 'Hospitals, medical colleges, diagnostic facilities', facilities: [...HOSPITAL_FACILITIES, CUSTOM_FACILITY] },
  { key: 'Pharma', summary: 'API, sterile, non-sterile, biologics, cleanroom', facilities: [...PHARMA_FACILITIES, CUSTOM_FACILITY] },
  { key: 'Common buildings', summary: 'Residential, commercial, school, hotel, warehouse, other', facilities: [...COMMON_FACILITIES, CUSTOM_FACILITY] },
]

export const isIndustryGroup = (v: string): v is IndustryGroup => (INDUSTRY_GROUPS as readonly string[]).includes(v)
export const isServiceType = (v: string): v is ServiceType => (SERVICE_TYPES as readonly string[]).includes(v)
export const facilitiesFor = (group: IndustryGroup) => INDUSTRY_GROUP_INFO.find((g) => g.key === group)?.facilities ?? []

/** Does the service type include BIM? The BIM requirement block is only asked for, and only stored, when it does. */
export const includesBim = (s: ServiceType) => s === 'BIM only' || s === 'Design + BIM'
/** Does the service type include engineering design? Design-only registers stay hidden for a BIM-only project. */
export const includesDesign = (s: ServiceType) => s === 'Design only' || s === 'Design + BIM'

/** Project stages, earliest first. Free text is still accepted: projects created before this step hold their own. */
export const PROJECT_STAGES = [
  'Concept',
  'Schematic',
  'Detailed design',
  'Tender',
  'GFC / IFC',
  'Shop drawing',
  'Construction',
  'Commissioning',
  'As-built',
  'Handover / FM',
]

/** The scopes the pharma wizard offered, plus the client's two additions. Stored as free text, like the stage. */
export const PROJECT_SCOPES = ['New plant', 'Expansion', 'Renovation', 'Equipment installation', 'Fit-out']

export const LOD_LEVELS = ['LOD 300', 'LOD 350', 'LOD 400', 'LOD 500'] as const
export const ASSET_HANDOVER = ['None', 'COBie', 'As-built', 'COBie + as-built'] as const

/** Asked only when the service type includes BIM, and cleared when it does not. */
export interface BimRequirement {
  lod: string
  coordination: boolean
  assetHandover: string
}

export const DEFAULT_BIM_REQUIREMENT: BimRequirement = { lod: 'LOD 300', coordination: true, assetHandover: 'None' }
