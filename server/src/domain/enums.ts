import { z } from 'zod'

export const ROLES = ['Consultant', 'Contractor', 'Owner / QA'] as const
export const MARKETS = ['SA', 'IN', 'EU', 'US', 'UK'] as const
export const FACILITIES = ['API', 'Non-sterile formulation', 'Sterile products', 'Biologics', 'Warehouse'] as const
export const SCOPES = ['New plant', 'Expansion', 'Renovation', 'Equipment installation'] as const
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
