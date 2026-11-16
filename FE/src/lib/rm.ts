import { apiRequest } from '@/lib/api'
import type { HistoryVisit, LocationRef, NotificationsResponse, Patient, RmVisit, RmVisitsResponse, SatusehatRow } from '@/lib/types'

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const getRmVisits = (params: { scope?: string; q?: string; status?: string; tanggal?: string }) =>
  apiRequest<RmVisitsResponse>(`/api/rm/kunjungan?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])}`)

export const confirmArrival = (id: number) =>
  apiRequest<{ message: string; visit: RmVisit }>(`/api/backend/visits/${id}/konfirmasi`, { method: 'POST' })

export const getHistory = (q = '') =>
  apiRequest<{ count: number; visits: HistoryVisit[] }>(`/api/backend/riwayat?${new URLSearchParams({ q })}`)

export const getRegistration = (params?: { q?: string; page?: number; limit?: number }) => {
  const query = params && Object.keys(params).length
    ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
    : ''
  return apiRequest<{ patients: Patient[]; queued_patient_ids: number[]; total?: number }>(`/api/backend/pendaftaran${query}`)
}

export const getPractitioners = () => apiRequest<{ id: number; name: string }[]>('/api/practitioners')
export const getLocations = () => apiRequest<LocationRef[]>('/api/lokasi')
export const setLocation = (locationId: number) => apiRequest<{ location: LocationRef }>('/api/backend/lokasi', json({ location_id: locationId }))

export type NewPatient = { name: string; nik: string; birth_date: string; gender: string; phone: string; address: string }
export const createPatient = (data: NewPatient) =>
  apiRequest<{ message: string; patient: Patient }>('/api/backend/pendaftaran/pasien', json(data))

export type UpdatePatientData = {
  name: string
  nik: string
  birth_date: string
  gender: string
  phone?: string
  address?: string
}
export const updatePatient = (id: number, data: UpdatePatientData) =>
  apiRequest<{ message: string; patient: Patient }>(`/api/backend/pendaftaran/pasien/${id}`, json(data))

export type NewVisit = { patient_id: number; visit_date: string; practitioner_id?: number; visit_type: string; admin_note: string }
export const createVisit = (data: NewVisit) =>
  apiRequest<{ message: string; visit: { id: number; queue_no: number } }>('/api/backend/pendaftaran/kunjungan', json(data))

export const getSatusehat = () =>
  apiRequest<{ mode: string; rows: SatusehatRow[]; updated_at: string }>('/api/satusehat/pengiriman')

export const requeueSubmission = (id: number) =>
  apiRequest<{ message: string }>(`/api/backend/submissions/${id}/requeue`, { method: 'POST' })

export const getNotifications = () =>
  apiRequest<NotificationsResponse>('/api/notifikasi')
