// Product reference data shared by every installation.
import type { MarketKey } from './types.ts'

export const disciplines = ['Civil & Cleanroom', 'Process Equipment', 'Piping & Utilities', 'HVAC', 'Electrical', 'Instrumentation', 'Fire & Life Safety', 'CQV']

export const markets: Record<MarketKey, { name: string; short: string; authority: string; base: string; url: string }> = {
  SA: { name: 'Saudi Arabia', short: 'KSA', authority: 'SFDA', base: 'SFDA GMP guide and applicable local supplementary provisions', url: 'https://www.sfda.gov.sa/en/guide/69378' },
  IN: { name: 'India', short: 'IN', authority: 'CDSCO / State licensing', base: 'Applicable Drugs Rules and Schedule M, as amended', url: 'https://www.cdsco.gov.in/opencms/opencms/en/Notifications/Gazette-Notifications/' },
  EU: { name: 'European Union', short: 'EU', authority: 'EMA / national authorities', base: 'EudraLex Volume 4, parts and annexes by activity', url: 'https://health.ec.europa.eu/medicinal-products/eudralex/eudralex-volume-4_en' },
  US: { name: 'United States', short: 'US', authority: 'FDA', base: 'Applicable drug cGMP (21 CFR 210/211); Part 11 where relevant', url: 'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-C/part-211' },
  UK: { name: 'United Kingdom', short: 'UK', authority: 'MHRA', base: 'Applicable MHRA GMP framework', url: 'https://www.gov.uk/guidance/good-manufacturing-practice-and-good-distribution-practice' },
}
