export type Role = 'dokter' | 'perawat' | 'admin' | string

export type User = {
  id: number
  username: string
  email: string
  name: string
  role: Role
  practitioner_id: number | null
}

export type Patient = {
  id: number
  name: string
  rm_number: string
  nik?: string | null
  ihs_number?: string | null
  gender?: string | null
  gender_label: string
  birth_date: string | null
  usia: string
  phone?: string | null
  address?: string | null
}

export type LocationRef = { id: number; name: string; label: string; poli?: string | null }

export type Visit = {
  id: number
  code: string
  queue_no: number | null
  status: string
  state: 'saat_ini' | 'selanjutnya' | 'menunggu' | 'selesai'
  draft_status: string
  arrived_at: string | null
  called_at: string | null
  started_at: string | null
  patient: Patient
  location: LocationRef
  has_note: boolean
  is_approved: boolean
}

export type QueueResponse = {
  status: string
  tab: string
  counts: Record<string, number>
  location: LocationRef
  doctor: { id: number; name: string } | null
  rows: Visit[]
}

export type TranscriptSegment = { i?: number; start: number | null; end: number | null; speaker?: string | null; text: string }
export type ExtractionField = { nilai: string | null; kutipan?: string | null; status: string; source_ids?: number[]; alasan_ambigu?: string | null; grounding?: number | null }
export type IcdSuggestion = { code: string; display: string; keyakinan?: number; deskripsi_id?: string; alasan?: string }
export type Diagnosis = { code: string; display: string; rank: number; source?: string }

export type ClinicalNote = {
  id: number | null
  subjective: Record<string, string>
  subjective_summary: string
  vitals: Record<string, number>
  exam_text: string
  diagnoses: Diagnosis[]
  assessment: string
  plan_text: string
  prescriptions?: Record<string, unknown>[]
  extra: Record<string, unknown>
  approved: boolean
  approved_snapshot: Record<string, unknown> | null
}

export type Consultation = {
  status: string
  locked: boolean
  consent_version: string
  visit: {
    id: number; code: string; queue_no: number | null; status: string
    arrived_at?: string | null; called_at?: string | null; started_at?: string | null; ended_at?: string | null
    patient: Patient; location: LocationRef
    consent: { given_by_name: string; version: string; given_at: string } | null
  }
  note: ClinicalNote
  session: {
    id: number; status: string; transcript: TranscriptSegment[]
    extraction: Record<string, ExtractionField | string> | null
    icd_suggestions: IcdSuggestion[] | null; error: string | null; has_audio: boolean
  } | null
  failed_session: { id: number; error: string } | null
}

export type ScribeState = {
  status: string | null; error: string | null; transcript: TranscriptSegment[]
  summary: string | null; fields: Record<string, string> | null
  icd: IcdSuggestion[] | null; duration_s: number | null
}

export type Submission = {
  id: number; status: string; attempts: number; last_error_text: string | null; last_error_code: string | null
  resources: { resource_type: string; resource_id: string }[]
}

export type Resume = {
  mode: 'mock' | 'sandbox' | string
  visit: { id: number; code: string; status: string; arrived_at?: string | null; patient: Patient; location: LocationRef; satusehat_encounter_id: string | null }
  note: ClinicalNote
  submission: Submission | null
}

export type HistoryVisit = {
  id: number
  code: string
  status: string
  arrived_at: string | null
  patient: Patient
  location: LocationRef
  doctor: string | null
  diagnosis: string | null
  diagnosis_code: string | null
  is_approved: boolean
  submission_status: string | null
}

export type RmStatus = 'terjadwal' | 'menunggu_pemeriksaan' | 'dalam_pemeriksaan' | 'selesai'

export type RmVisit = {
  id: number
  code: string
  queue_no: number | null
  visit_date: string | null
  arrived_at: string | null
  confirmed_at: string | null
  visit_type: string
  admin_note: string | null
  rm_status: RmStatus
  patient: Patient
  location: LocationRef
  doctor: string | null
  submission_status: string | null
}

export type RmVisitsResponse = {
  scope: string
  counts: Record<RmStatus | 'total', number>
  rows: RmVisit[]
  updated_at: string
}

export type SatusehatRow = {
  id: number; status: string; attempts: number; last_error_code: string | null; last_error_text: string | null
  visit_id: number; visit_code: string | null; visit_date: string | null
  patient: Patient | null; doctor: string | null; poli: string | null
}
