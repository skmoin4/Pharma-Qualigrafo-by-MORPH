// Thin client for the Qualigrafo API (server/). Requests go to /api, proxied to the backend by Vite in development.
const BASE = import.meta.env.VITE_API_URL ?? '/api'
const TOKEN_KEY = 'qualigrafo-token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const tokenStore = {
  get: (): string | null => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch { /* storage blocked */ } },
}

let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (f: () => void) => { onUnauthorized = f }

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get()
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that the API is running.')
  }
  const data = await res.json().catch(() => null)
  if (res.status === 401 && token) onUnauthorized()
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`)
  return data as T
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error.')

/** Multipart upload with progress (fetch cannot report upload progress, XHR can). */
export function uploadForm<T>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = tokenStore.get()
    const xhr = new XMLHttpRequest()
    xhr.open('POST', BASE + path)
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed: cannot reach the server.'))
    xhr.onload = () => {
      const data = xhr.response
      if (xhr.status === 401 && token) onUnauthorized()
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T)
      else reject(new ApiError(xhr.status, data?.error ?? `Upload failed (${xhr.status}).`))
    }
    xhr.send(form)
  })
}

/** Fetches a protected file into memory (for the drawing viewer). */
export async function fetchBlob(path: string): Promise<Blob> {
  const token = tokenStore.get()
  let res: Response
  try {
    res = await fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  } catch {
    throw new ApiError(0, 'Cannot reach the server.')
  }
  if (res.status === 401 && token) onUnauthorized()
  if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Could not load the file (${res.status}).`)
  return res.blob()
}

/** Downloads a protected file (the bearer token cannot ride on a plain link) and hands it to the browser. */
export async function downloadAs(path: string, name: string) {
  const token = tokenStore.get()
  let res: Response
  try {
    res = await fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that the API is running.')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    if (res.status === 401 && token) onUnauthorized()
    throw new ApiError(res.status, data?.error ?? `Download failed (${res.status}).`)
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
