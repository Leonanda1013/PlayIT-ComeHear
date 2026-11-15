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

  const body = await response.json().catch(() => null) as { detail?: string } | null
  if (!response.ok) {
    throw new ApiError(body?.detail || `Permintaan gagal (HTTP ${response.status}).`, response.status)
  }
  return body as T
}
