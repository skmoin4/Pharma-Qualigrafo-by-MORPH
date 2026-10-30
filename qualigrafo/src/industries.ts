// Classification reference data, read from the server (GET /reference/industries). The server owns these lists
// because it validates every project against them: a second copy in the client could offer a facility type the
// server then rejects, so the wizard and the set-up page both read them from here.
import { useEffect, useState } from 'react'
import { api, errorText } from './api'
import type { IndustryReference } from './types'

export const CUSTOM_FACILITY = 'Other / custom facility'

export function useIndustries() {
  const [ref, setRef] = useState<IndustryReference | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    api<IndustryReference>('GET', '/reference/industries')
      .then((r) => { if (live) setRef(r) })
      .catch((e) => { if (live) setError(errorText(e)) })
    return () => { live = false }
  }, [])
  return { ref, error }
}

/** The facility types of one industry group, or an empty list while the reference data is still loading. */
export const facilitiesOf = (ref: IndustryReference | null, group: string) =>
  ref?.groups.find((g) => g.key === group)?.facilities ?? []

export const includesBim = (s: string) => s === 'BIM only' || s === 'Design + BIM'

/** How a classification reads in one line, for review screens and project headers. */
export const classificationText = (c: {
  industryGroup: string
  facilityType: string
  customFacilityType?: string
  secondaryFacilityType?: string
  serviceType: string
  projectStage?: string
}) => [c.industryGroup, c.customFacilityType || c.facilityType, c.secondaryFacilityType, c.serviceType, c.projectStage].filter(Boolean).join(' · ')

/** What GET /reference/template returns for one classification. */
export interface ProjectTemplate {
  label: string
  disciplines: string[]
  addOns: string[]
  summary: { total: number; critical: number; byStage: { stage: string; n: number }[] }
  deliverables: { title: string; discipline: string; stage: string; track: 'design' | 'bim' | 'any'; critical?: boolean }[]
}

/**
 * The project template for a classification (Phase 5 / step 2). The wizard reads it from the server so that what it
 * shows is exactly what creation will do — both come from the same `templateFor`. It returns null until the
 * classification is complete enough to resolve one.
 */
export function useTemplate(c: { industryGroup: string; facilityType: string; serviceType: string }, disciplines: string[]) {
  const [template, setTemplate] = useState<ProjectTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = `${c.industryGroup}|${c.facilityType}|${c.serviceType}|${disciplines.join(',')}`
  useEffect(() => {
    if (!c.industryGroup || !c.serviceType) { setTemplate(null); return }
    let live = true
    const q = new URLSearchParams({ industryGroup: c.industryGroup, facilityType: c.facilityType, serviceType: c.serviceType, disciplines: disciplines.join(',') })
    api<ProjectTemplate>('GET', `/reference/template?${q}`)
      .then((r) => { if (live) { setTemplate(r); setError(null) } })
      .catch((e) => { if (live) setError(errorText(e)) })
    return () => { live = false }
    // The classification and the chosen disciplines are the whole input; `key` folds them into one dependency.
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return { template, error }
}
