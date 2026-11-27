// Preview-only data contracts. The public website does not import application or API code.
export type TranscriptSegment = { i?: number; start: number | null; end: number | null; speaker?: string | null; text: string }

export type ExtractionField = {
  nilai: string | null
  kutipan?: string | null
  status: string
  source_ids?: number[]
  alasan_ambigu?: string | null
  grounding?: number | null
}
