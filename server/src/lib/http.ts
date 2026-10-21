export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Caller is authenticated but their role may not do this. */
export const forbidden = (msg: string) => new HttpError(403, msg)
/** Request is well-formed but breaks a workflow rule. */
export const rule = (msg: string) => new HttpError(422, msg)
export const notFound = (msg: string) => new HttpError(404, msg)
export const unauthorized = (msg = 'Sign in required.') => new HttpError(401, msg)
