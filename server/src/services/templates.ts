// Turning a project template into real records (Phase 5 / step 2). Runs inside the project-creation transaction.
//
// The deliverables are registered as documents with status "Missing": the register then states what the project is
// expected to produce before anything has been produced, which is what the client asked for and the opposite of the
// empty project they were handed. Nothing here is evidence or regulatory content — every row is a plan the project
// team edits, reassigns or deletes.
import { PROJECT_STAGES } from '../domain/industries.ts'
import { today } from '../domain/rules.ts'
import type { DeliverableTemplate, ProjectTemplate } from '../domain/templates.ts'
import { nextCode } from './ctx.ts'
import type { Tx } from '../db.ts'

/**
 * Due dates are a **starting plan**, not a commitment: the wizard does not ask for a programme, so a deliverable is
 * dated by how far its stage is ahead of the stage the project is in — roughly a month per stage, and two weeks for
 * anything at or behind the current stage. The register is where the team puts the real dates.
 */
export function dueFor(stage: string, projectStage: string, from = today()) {
  const i = PROJECT_STAGES.indexOf(stage)
  const now = PROJECT_STAGES.indexOf(projectStage)
  const ahead = i < 0 || now < 0 ? 1 : Math.max(1, i - now + 1)
  const dt = new Date(`${from}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + (i >= 0 && now >= 0 && i <= now ? 14 : 30 * ahead))
  return dt
}

export interface GeneratedWorkspace {
  documents: number
  critical: number
}

/**
 * Registers the template's deliverables on a freshly created project. `owner` has to be one of the project's
 * companies — the client is used, because it is registered as Owner for every project — and the team reassigns
 * each row afterwards.
 */
export async function generateDeliverables(
  tx: Tx,
  project: { id: string; projectStage: string },
  template: ProjectTemplate,
  owner: string,
  by: { role: string; userId: string },
): Promise<GeneratedWorkspace> {
  const rows: { t: DeliverableTemplate; code: string }[] = []
  const codes: { code: string }[] = []
  for (const t of template.deliverables) {
    const code = nextCode('DOC', codes)
    codes.push({ code })
    rows.push({ t, code })
  }
  for (const { t, code } of rows) {
    await tx.document.create({
      data: {
        projectId: project.id, code, number: '', title: t.title, discipline: t.discipline, system: '',
        rev: 0, status: 'Missing', owner, due: dueFor(t.stage, project.projectStage), critical: !!t.critical, signStage: 0,
        history: { create: { rev: 0, status: 'Missing', byRole: by.role, byUserId: by.userId, note: `Registered from the ${template.label} template` } },
      },
    })
  }
  return { documents: rows.length, critical: rows.filter((r) => r.t.critical).length }
}
