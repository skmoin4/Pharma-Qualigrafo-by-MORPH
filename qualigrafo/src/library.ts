// Requirement library: client types and a small hook (the library is installation-wide, not part of a project payload).
import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from './api'
import type { MarketKey } from './types'

export interface LibVersionSummary {
  id: string; version: number; status: 'Draft' | 'Approved' | 'Superseded'; note: string; starter: boolean; items: number
  createdByName: string; createdAt: string; updatedAt: string; approvedByName: string | null; approvedAt: string | null; approvalReason: string | null
}
export interface LibPack { market: MarketKey; name: string; hasStarter: boolean; versions: LibVersionSummary[] }
export interface LibItem {
  id: string; key: string; title: string; topic: string; discipline: string; facilities: string[]; critical: boolean
  clause: string; sourceVersion: string; effective: string; guidance: string; change: string
}
export interface LibVersion {
  id: string; market: MarketKey; packName: string; version: number; status: LibVersionSummary['status']; note: string; starter: boolean
  createdByName: string; createdByUserId: string | null; updatedByUserId: string | null
  approvedByName: string | null; approvedAt: string | null; approvalReason: string | null
  comparedWith: number | null; removed: { key: string; title: string }[]; items: LibItem[]
}

export const approvedOf = (p?: LibPack) => p?.versions.find((v) => v.status === 'Approved')
export const draftOf = (p?: LibPack) => p?.versions.find((v) => v.status === 'Draft')

/** All packs (one per market) with their version summaries. */
export function useLibraryPacks() {
  const [packs, setPacks] = useState<LibPack[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try { setPacks((await api<{ packs: LibPack[] }>('GET', '/library')).packs); setError(null) } catch (e) { setError(errorText(e)) }
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { packs, setPacks, error, reload }
}
