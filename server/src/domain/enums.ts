import { z } from 'zod'
import { INDUSTRY_GROUP_INFO } from './industries.ts'

export const ROLES = ['Consultant', 'Contractor', 'Owner / QA'] as const
export const MARKETS = ['SA', 'IN', 'EU', 'US', 'UK'] as const
/**
 * The pharma facility types the product shipped with, kept because library items are authored against them. Every
 * facility type of every industry group is in ALL_FACILITIES; library applicability accepts any of them, so hospital
 * and energy packs can be authored (the per-industry applicability filter itself is Phase 5 step 2).
 */
export const FACILITIES = ['API', 'Non-sterile formulation', 'Sterile products', 'Biologics', 'Warehouse'] as const
export const ALL_FACILITIES = [...new Set(INDUSTRY_GROUP_INFO.flatMap((g) => g.facilities))]
export const SCOPES = ['New plant', 'Expansion', 'Renovation', 'Equipment installation', 'Fit-out'] as const
export const APPLICABILITY = ['Assessment pending', 'Required', 'Not applicable'] as const
export const RISK_STATUS = ['Open', 'Mitigating', 'Accepted', 'Closed'] as const
export const NCR_SEVERITY = ['Critical', 'Major', 'Minor'] as const
export const ACTION_STATUS = ['Open', 'Ready for verification', 'Closed'] as const
export const PRIORITY = ['High', 'Medium', 'Low'] as const
export const SOURCE_MODE = ['Standalone', 'Revit'] as const
export const AUTOMATION_KEYS = ['routing', 'reminders', 'autoIssue'] as const
export const COMPANY_KINDS = ['Owner', 'Engineering consultant', 'Main contractor', 'Subcontractor', 'Vendor / supplier', 'Other'] as const

export const zRole = z.enum(ROLES)
export const zMarket = z.enum(MARKETS)
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
export const zRating = z.number().int().min(1).max(5)
/** Free text: trimmed emptiness is checked by the business rules so the user gets a specific message. */
export const zText = z.string().max(5000)
