import { apiRequest } from '@/lib/api'
import type { Consultation, KfaDrug, Resume, ScribeState } from '@/lib/types'

export const subjectiveFields = [
  ['keluhan_utama', 'Keluhan utama'],
  ['riwayat_penyakit_sekarang', 'Riwayat penyakit sekarang'],
  ['riwayat_penyakit_dahulu', 'Riwayat penyakit dahulu'],
  ['riwayat_alergi', 'Riwayat alergi'],
  ['riwayat_pengobatan', 'Obat atau tindakan sebelum datang'],
] as const

export const vitalLabels: Record<string, string> = {
  body_temperature: 'Suhu (°C)', oxygen_saturation: 'SpO₂ (%)', body_weight: 'Berat badan (kg)',
  body_height: 'Tinggi badan (cm)', respiratory_rate: 'Laju napas (x/menit)',
  heart_rate: 'Nadi (x/menit)', systolic: 'Sistolik (mmHg)', diastolic: 'Diastolik (mmHg)',
}

export const visitPath = (id: number, segment = '') => `/api/backend/visits/${id}${segment}`
export const getConsultation = (id: number) => apiRequest<Consultation>(visitPath(id))
export const getScribe = (id: number) => apiRequest<ScribeState>(visitPath(id, '/scribe'))
export const getResume = (id: number) => apiRequest<Resume>(visitPath(id, '/resume'))
export const saveSoap = (id: number, data: Record<string, string>) => apiRequest<{ status: string; detail?: string; submission_id?: number }>(visitPath(id, '/soap'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const triggerSuggestIcd = (id: number, data?: { subjective?: Record<string, string>; objective?: unknown }) =>
  apiRequest<{ status: string; message: string }>(visitPath(id, '/suggest-icd'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {})
  })

export async function finishAudioSession(id: number, sessionId: number) {
  const body = new FormData()
  body.set('session_id', String(sessionId))
  return apiRequest<{ session_id: number; status: string }>(visitPath(id, '/audio-finish'), { method: 'POST', body })
}

export async function closeAudioSession(id: number, sessionId: number) {
  const body = new FormData()
  body.set('session_id', String(sessionId))
  try {
    return await apiRequest(visitPath(id, '/recording/close'), { method: 'POST', body })
  } catch {
    return await apiRequest(visitPath(id, '/audio-finish'), { method: 'POST', body })
  }
}

export function formatWib(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '—'
}

export function isManualSubjective(consultation: Consultation): boolean {
  const c = consultation.visit.consent as { decision?: string } | null
  if (consultation.visit.status === 'manual' || c?.decision === 'tolak') {
    return true
  }
  if (!consultation.session && !consultation.failed_session) {
    return true
  }
  return false
}

export function subjectiveStagePath(consultation: Consultation): 'subjektif' | 'draf-s' {
  return isManualSubjective(consultation) ? 'subjektif' : 'draf-s'
}

export const searchKfaDrugs = (q = '') =>
  apiRequest<KfaDrug[]>(`/api/kfa?q=${encodeURIComponent(q)}`)
