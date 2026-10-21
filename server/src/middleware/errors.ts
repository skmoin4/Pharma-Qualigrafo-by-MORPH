import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import multer from 'multer'
import { ZodError } from 'zod'
import { config } from '../config.ts'
import { HttpError } from '../lib/http.ts'

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = randomUUID()
  res.setHeader('X-Request-Id', req.requestId)
  next()
}

export function notFoundRoute(req: Request, res: Response) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` })
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
  if (err instanceof ZodError) {
    const i = err.issues[0]
    return res.status(400).json({ error: `${i.path.join('.') || 'body'}: ${i.message}`, issues: err.issues })
  }
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Malformed JSON body.' })
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File is larger than the ${config.MAX_UPLOAD_MB} MB limit.` })
    return res.status(400).json({ error: `Upload rejected: ${err.message}.` })
  }
  const code = (err as { code?: string }).code
  if (code === 'P2002') return res.status(409).json({ error: 'Conflicting update, please retry.' })
  console.error(`[${req.requestId}]`, err)
  res.status(500).json({ error: 'Internal server error.', requestId: req.requestId })
}
