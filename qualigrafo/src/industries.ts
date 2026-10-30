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
