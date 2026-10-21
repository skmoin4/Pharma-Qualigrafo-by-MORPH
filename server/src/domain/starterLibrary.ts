// Unverified starter template for the requirement library: topic-level entries only (no clauses).
// Loaded on request as DRAFT pack versions; the customer's reviewers verify, complete and approve them.
import type { MarketKey } from './types.ts'

export interface StarterItem { key: string; title: string; topic: string; discipline: string; critical: boolean }

export const STARTER_LIBRARY: Partial<Record<MarketKey, StarterItem[]>> = {
  SA: [
    { key: 'TOPIC-01', title: 'Premises layout, flow and cleanroom finishes', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Civil & Cleanroom', critical: true },
    { key: 'TOPIC-02', title: 'Equipment design and vendor evidence', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Process Equipment', critical: false },
    { key: 'TOPIC-03', title: 'Purified water system documentation', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Piping & Utilities', critical: true },
    { key: 'TOPIC-04', title: 'Material traceability for utility piping', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Piping & Utilities', critical: true },
    { key: 'TOPIC-05', title: 'HVAC design and verification evidence', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'HVAC', critical: true },
    { key: 'TOPIC-06', title: 'Electrical installation evidence', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Electrical', critical: false },
    { key: 'TOPIC-07', title: 'Instrument calibration evidence', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Instrumentation', critical: true },
    { key: 'TOPIC-08', title: 'Fire-system project approvals', topic: 'Local authority / project-specific review (not GMP)', discipline: 'Fire & Life Safety', critical: false },
    { key: 'TOPIC-09', title: 'Qualification planning and traceability', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'CQV', critical: true },
    { key: 'TOPIC-11', title: 'Personnel and material flow, gowning interface', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Civil & Cleanroom', critical: false },
    { key: 'TOPIC-12', title: 'Pressure cascade and environmental control design', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'HVAC', critical: true },
    { key: 'TOPIC-13', title: 'Cleanroom classification and room-integrity verification', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'HVAC', critical: true },
    { key: 'TOPIC-14', title: 'Water system sanitisation and monitoring provisions', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Piping & Utilities', critical: false },
    { key: 'TOPIC-15', title: 'Equipment installation qualification documentation', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Process Equipment', critical: true },
    { key: 'TOPIC-16', title: 'Building monitoring system documentation', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Instrumentation', critical: false },
    { key: 'TOPIC-17', title: 'Emergency power and utility continuity for critical systems', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Electrical', critical: false },
    { key: 'TOPIC-18', title: 'Fire compartmentation and evacuation approvals', topic: 'Local authority / project-specific review (not GMP)', discipline: 'Fire & Life Safety', critical: false },
  ],
  EU: [
    { key: 'TOPIC-01', title: 'Premises layout, flow and cleanroom finishes', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Civil & Cleanroom', critical: true },
    { key: 'TOPIC-03', title: 'Purified water system documentation', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Piping & Utilities', critical: true },
    { key: 'TOPIC-05', title: 'HVAC design and verification evidence', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'HVAC', critical: false },
    { key: 'TOPIC-07', title: 'Instrument calibration evidence', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Instrumentation', critical: true },
    { key: 'TOPIC-09', title: 'Qualification planning and traceability', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'CQV', critical: true },
    { key: 'TOPIC-19', title: 'Computerised system documentation (monitoring and control)', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Instrumentation', critical: false },
    { key: 'TOPIC-15', title: 'Equipment installation qualification documentation', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Process Equipment', critical: true },
  ],
  IN: [
    { key: 'TOPIC-01', title: 'Premises layout, flow and cleanroom finishes', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Civil & Cleanroom', critical: false },
    { key: 'TOPIC-02', title: 'Equipment design and vendor evidence', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Process Equipment', critical: false },
    { key: 'TOPIC-04', title: 'Material traceability for utility piping', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Piping & Utilities', critical: true },
    { key: 'TOPIC-06', title: 'Electrical installation evidence', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Electrical', critical: false },
    { key: 'TOPIC-09', title: 'Qualification planning and traceability', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'CQV', critical: false },
    { key: 'TOPIC-05', title: 'HVAC design and verification evidence', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'HVAC', critical: true },
    { key: 'TOPIC-03', title: 'Purified water system documentation', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Piping & Utilities', critical: true },
    { key: 'TOPIC-07', title: 'Instrument calibration evidence', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Instrumentation', critical: true },
    { key: 'TOPIC-15', title: 'Equipment installation qualification documentation', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Process Equipment', critical: false },
  ],
  US: [
    { key: 'TOPIC-10', title: 'Electronic records and signatures scope check', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'CQV', critical: false },
    { key: 'TOPIC-20', title: 'Equipment and facility design documentation', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'Process Equipment', critical: false },
    { key: 'TOPIC-21', title: 'Electronic signature controls for engineering records (scope check)', topic: 'Topic mapping — exact clause, version and effective date require expert verification', discipline: 'CQV', critical: false },
  ],
}
