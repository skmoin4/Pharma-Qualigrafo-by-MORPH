// Request logging (Phase 3 / P6). One structured line per request with the request id that the response carries in
// X-Request-Id and that every audit entry of that request stores, so a record can be traced back to its call.
// Only metadata is logged: method, path, status, duration, response size, user and client address — never bodies,
// tokens or passwords.
import type { NextFunction, Request, Response } from 'express'
import { log } from '../lib/logger.ts'
import { recordRequest } from '../services/monitoring.ts'

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const t0 = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6)
    recordRequest(res.statusCode, ms, `${req.method} ${req.route?.path ? req.baseUrl + req.route.path : req.path}`)
    log[res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info']('request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms,
      bytes: Number(res.getHeader('content-length')) || undefined,
      user: req.user?.email,
      ip: req.ip,
    })
  })
  next()
}
