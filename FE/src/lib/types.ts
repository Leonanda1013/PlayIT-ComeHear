export type User = {
  id: number
  username: string
  email: string
  name: string
  role: string
  practitioner_id: number | null
}

export type Patient = {
  id: number
  name: string
  rm_number: string
  gender_label: string
  birth_date: string | null
  usia: string
}

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
  location: { id: number; name: string; label: string }
  has_note: boolean
  is_approved: boolean
}

export type QueueResponse = {
  status: string
  tab: string
  counts: Record<string, number>
  location: { id: number; name: string; label: string }
  doctor: { id: number; name: string } | null
  rows: Visit[]
}

export type TranscriptSegment = { start: number | null; end: number | null; speaker?: string | null; text: string }
export type ExtractionField = { nilai: string | null; kutipan?: string | null; status: string; source_ids?: number[] }
export type IcdSuggestion = { code: string; display: string; keyakinan?: number; deskripsi_id?: string; alasan?: string }
export type ClinicalNote = {
  id: number | null
  subjective: Record<string, string>
  subjective_summary: string
  vitals: Record<string, number>
  exam_text: string
  diagnoses: { code: string; display: string; rank: number }[]
  assessment: string
  plan_text: string
  extra: Record<string, string>
  approved: boolean
  approved_snapshot: Record<string, unknown> | null
}
export type Consultation = {
  status: string
  locked: boolean
  consent_version: string
  visit: {
    id: number; code: string; queue_no: number | null; status: string
    patient: Patient; location: { id: number; name: string; label: string }
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
export type Resume = {
  mode: 'mock' | 'sandbox' | string
  visit: { id: number; code: string; status: string; patient: Patient; location: { name: string; label: string }; satusehat_encounter_id: string | null }
  note: ClinicalNote
  submission: { id: number; status: string; attempts: number; last_error_text: string | null; last_error_code: string | null; resources: { resource_type: string; resource_id: string }[] } | null
}
