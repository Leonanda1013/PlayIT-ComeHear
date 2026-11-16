export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init })
  } catch {
    throw new ApiError('Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.', 0)
  }

  const body = await response.json().catch(() => null) as { detail?: unknown } | null
  if (!response.ok) {
    let message = `Permintaan gagal (HTTP ${response.status}).`
    if (typeof body?.detail === 'string') {
      message = body.detail
    } else if (Array.isArray(body?.detail)) {
      message = body.detail
        .map((item: { msg?: string; loc?: string[] } | unknown) => {
          if (item && typeof item === 'object') {
            const err = item as { msg?: string; loc?: string[] }
            const field = err.loc ? err.loc.slice(1).join('.') : ''
            return field ? `${field}: ${err.msg || 'tidak valid'}` : err.msg || JSON.stringify(err)
          }
          return String(item)
        })
        .join('; ')
    }
    throw new ApiError(message, response.status)
  }
  return body as T
}
