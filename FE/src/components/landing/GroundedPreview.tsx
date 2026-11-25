import { useId, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Quote } from 'lucide-react'
import { TranscriptBubble } from '@/components/Scribe'
import { Badge } from '@/components/ui/kit'
import type { ExtractionField, TranscriptSegment } from '@/lib/types'

// Synthetic examples use the application's extraction/segment shapes. No API or patient data.
const transcript: TranscriptSegment[] = [
  { i: 0, start: 8, end: 11, speaker: 'doctor', text: 'Apa keluhan yang dirasakan hari ini?' },
  { i: 1, start: 12, end: 22, speaker: 'patient', text: 'Batuk sejak tiga hari yang lalu, Dok. Tenggorokan juga terasa tidak nyaman.' },
  { i: 2, start: 24, end: 29, speaker: 'doctor', text: 'Sejak kapan mulai batuk? Ada demam atau sesak?' },
  { i: 3, start: 31, end: 36, speaker: 'patient', text: 'Sejak seminggu lalu, Dok. Tidak ada demam atau sesak.' },
  { i: 4, start: 37, end: 39, speaker: 'doctor', text: 'Apakah sudah minum obat untuk keluhan ini?' },
  { i: 5, start: 40, end: 42, speaker: 'patient', text: 'Belum minum obat, Dok.' },
]

type PreviewField = { key: string; label: string; meta: ExtractionField }
const fields: PreviewField[] = [
  { key: 'keluhan_utama', label: 'Keluhan utama', meta: {
    nilai: 'Batuk; durasi belum jelas. Pasien menyebut “tiga hari” dan “seminggu”.',
    status: 'ambigu', source_ids: [1, 3], grounding: 1,
    kutipan: 'Batuk sejak tiga hari yang lalu, Dok.',
    alasan_ambigu: 'Durasi bertentangan: “tiga hari” pada segmen [1] dan “seminggu” pada segmen [3]. Konfirmasikan kepada pasien.',
  } },
  { key: 'riwayat_penyakit_sekarang', label: 'Riwayat penyakit sekarang', meta: {
    nilai: 'Batuk disertai rasa tidak nyaman di tenggorokan. Demam dan sesak disangkal. Waktu mulai keluhan perlu dikonfirmasi.',
    status: 'ambigu', source_ids: [1, 3], grounding: 1,
    kutipan: 'Sejak seminggu lalu, Dok. Tidak ada demam atau sesak.',
    alasan_ambigu: 'Onset belum konsisten dalam percakapan; jangan menetapkan durasi sebelum klarifikasi.',
  } },
  { key: 'riwayat_pengobatan', label: 'Riwayat penggunaan obat', meta: {
    nilai: 'Belum mengonsumsi obat untuk keluhan ini.', status: 'jelas', source_ids: [5], grounding: 1,
    kutipan: 'Belum minum obat, Dok.',
  } },
  { key: 'riwayat_alergi', label: 'Riwayat alergi', meta: {
    nilai: null, status: 'tidak_dibahas', source_ids: [],
  } },
]

export function GroundedPreview({ compact = false }: { compact?: boolean }) {
  const prefix = `preview-${useId().replace(/:/g, '')}`
  const [activeField, setActiveField] = useState<string | null>(null)
  const segmentRefs = useRef(new Map<number, HTMLDivElement>())
  const active = fields.find(field => field.key === activeField)
  const visibleFields = compact ? [fields[0], fields[2]] : fields
  const visibleTranscript = compact ? transcript.filter(segment => [0, 1, 3, 5].includes(segment.i!)) : transcript

  function focusSource(field: PreviewField, segmentId?: number) {
    setActiveField(field.key)
    const targetId = segmentId ?? field.meta.source_ids?.[0]
    if (targetId !== undefined) segmentRefs.current.get(targetId)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest',
    })
  }

  return <div className={`lp-clinical-columns lp-grounded-preview ${compact ? 'is-compact' : ''}`}>
    <div className="lp-transcript lp-grounded-transcript">
      <div className="lp-preview-label"><h3>Transkrip Percakapan</h3><Badge>Transkrip sesi</Badge></div>
      <div className="lp-transcript-segments">
        {visibleTranscript.map(segment => {
          const id = segment.i!
          const citedFields = visibleFields.filter(field => field.meta.source_ids?.includes(id)).map(field => field.label)
          const highlighted = Boolean(active?.meta.source_ids?.includes(id))
          return <div key={id} ref={node => { if (node) segmentRefs.current.set(id, node); else segmentRefs.current.delete(id) }} className="lp-source-segment" data-segment={id} data-highlighted={highlighted}>
            <TranscriptBubble segment={segment} patientName="Contoh" idPrefix={prefix} highlighted={highlighted} highlightQuote={highlighted ? segment.text : null} citedFields={compact ? [] : citedFields} />
          </div>
        })}
      </div>
      {!compact && <div className="lp-citation-controls"><p role="status">{active ? `Menyorot sitasi: ${active.label} (${active.meta.source_ids?.map(id => `[${id}]`).join(', ')}).` : 'Pilih sitasi pada draf untuk menyorot sumber percakapan.'}</p><button type="button" disabled={!active} onClick={() => setActiveField(null)}>Hapus sorotan</button></div>}
    </div>
    <div className="lp-subjective lp-grounded-subjective">
      <div className="lp-preview-label"><h3>Subjektif</h3><Badge tone="info">Draf AI · Grounded</Badge></div>
      {visibleFields.map(field => {
        const { meta } = field
        const ambiguous = meta.status === 'ambigu'
        const sourceIds = meta.source_ids || []
        const isActive = activeField === field.key
        const sourceLabel = `Sitasi Segmen ${sourceIds.map(id => `[${id}]`).join(', ')}`
        return <div key={field.key} className={`lp-grounded-field ${ambiguous ? 'has-warning' : ''}`} data-field={field.key} data-active={isActive}>
          <div className="lp-grounded-field-heading"><h4>{field.label}</h4><div className="lp-grounding-meta">
            {typeof meta.grounding === 'number' && <span className="lp-grounding-score" title="Skor contoh kecocokan bukti kutipan dengan transkrip, bukan akurasi diagnosis."><CheckCircle2 size={12} />{Math.round(meta.grounding * 100)}%</span>}
            {sourceIds.map(id => compact ? <span key={id} className="lp-source-chip"><Quote size={11} />[{id}]</span> : <button key={id} type="button" className="lp-source-control" aria-label={`Sorot segmen ${id} untuk ${field.label}`} aria-pressed={isActive} onClick={() => focusSource(field, id)}><span className="lp-source-chip"><Quote size={12} />[{id}]</span></button>)}
          </div></div>
          <p className={`lp-grounded-value ${!meta.nilai ? 'is-empty' : ''}`}>{meta.nilai || 'Tidak dibahas dalam percakapan.'}</p>
          {meta.kutipan && (compact ? <div className="lp-source-quote"><Quote size={12} /><span><strong>{sourceLabel}:</strong> <em>“{meta.kutipan}”</em></span></div> : <button type="button" className="lp-source-quote" aria-label={`Lihat ${sourceLabel} untuk ${field.label}`} onClick={() => focusSource(field)}><Quote size={14} /><span><strong>{sourceLabel}:</strong> <em>“{meta.kutipan}”</em></span></button>)}
          {ambiguous && <p className="lp-grounding-warning"><AlertTriangle size={13} /><span><strong>Perlu dicek:</strong> {compact ? 'Durasi 3 hari dan 1 minggu berbeda. Konfirmasi dokter diperlukan.' : meta.alasan_ambigu}</span></p>}
        </div>
      })}
      <p className="lp-grounding-legend">Grounding menghubungkan draf dengan bukti transkrip. Skor di atas adalah contoh kecocokan kutipan, bukan jaminan akurasi klinis.</p>
      <div className="lp-review-hint"><ClipboardCheck size={16} /><span>Draf dan peringatan perlu ditinjau dokter sebelum finalisasi.</span></div>
    </div>
  </div>
}
