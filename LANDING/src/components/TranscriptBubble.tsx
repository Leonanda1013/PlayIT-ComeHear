import type { TranscriptSegment } from '@/lib/types'

function mmss(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function shortName(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts.length <= 2 ? name : `${parts[0]} ${parts.slice(1, -1).map((p) => `${p[0]}.`).join(' ')} ${parts.at(-1)}`
}

function highlightTextSpan(text: string, quote?: string | null) {
  if (!quote || !quote.trim()) return text
  const q = quote.trim()
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return text
  const before = text.slice(0, idx)
  const match = text.slice(idx, idx + q.length)
  const after = text.slice(idx + q.length)
  return (
    <>
      {before}
      <mark className="rounded-[4px] bg-[#fff3bf] px-1 py-0.5 font-medium text-[#5a4300] underline decoration-[#e0a800] decoration-2 underline-offset-2">
        {match}
      </mark>
      {after}
    </>
  )
}

export function TranscriptBubble({
  segment,
  patientName,
  doctorName,
  highlighted = false,
  highlightQuote = null,
  citedFields = [],
  onClick,
  idPrefix = 'transcript-seg',
}: {
  segment: TranscriptSegment
  patientName: string
  doctorName?: string | null
  highlighted?: boolean
  highlightQuote?: string | null
  citedFields?: string[]
  onClick?: () => void
  idPrefix?: string
}) {
  const isDoctor = segment.speaker === 'doctor' || segment.speaker === 'dokter'
  const label = isDoctor ? `Dokter${doctorName ? ` (${doctorName})` : ''}` : segment.speaker === 'guardian' ? 'Pendamping pasien' : `Pasien (${shortName(patientName)})`
  const avatar = (letter: string, color: string) => <span className={`mt-[11px] grid size-[22px] place-items-center rounded-full text-[11px] font-bold text-white ${color}`}>{letter}</span>
  const segIndex = segment.i

  return <div
    id={segIndex !== undefined ? `${idPrefix}-${segIndex}` : undefined}
    onClick={onClick}
    className={`grid grid-cols-[22px_minmax(0,1fr)_22px] items-start gap-x-[13px] transition-all duration-200 ${onClick ? 'cursor-pointer' : ''}`}
  >
    {isDoctor ? <span /> : avatar('P', 'bg-ch-brand')}
    <div
      className={`rounded-[8px] border px-3 py-[9px] transition-all duration-200 ${
        highlighted
          ? 'mr-[8px] border-[#0b8597] bg-[#d9f3f6] ring-2 ring-[#0b8597]/40 shadow-sm'
          : isDoctor
            ? 'mr-[10px] border-[#dce4e9] bg-[#f1f4f6]'
            : 'mr-[8px] border-[#c8eaf0] bg-[#e6f6f9]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {segIndex !== undefined && (
            <span
              className={`inline-flex h-[18px] items-center rounded-[4px] px-1.5 font-inter text-[10px] font-bold tabular-nums ${
                highlighted
                  ? 'bg-[#0b6e7d] text-white'
                  : isDoctor
                    ? 'bg-[#dce4e9] text-[#3d5266]'
                    : 'bg-[#c5e8ef] text-[#086775]'
              }`}
              title={`Segmen transkrip [${segIndex}]`}
            >
              [{segIndex}]
            </span>
          )}
          <p className={`text-[12px] font-semibold leading-4 ${isDoctor ? 'text-[#1f3346]' : 'text-[#0a97aa]'}`}>{label}</p>
          {segment.start !== null && segment.start !== undefined && (
            <span className="font-inter text-[10px] tabular-nums text-[#728596]">{mmss(Math.floor(segment.start))}</span>
          )}
        </div>
        {citedFields.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {citedFields.map((fieldLabel) => (
              <span
                key={fieldLabel}
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
                  highlighted
                    ? 'border-[#0b6e7d] bg-[#0b6e7d] text-white'
                    : 'border-[#9adbe5] bg-white/80 text-[#0b6e7d]'
                }`}
              >
                Sitasi: {fieldLabel}
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 text-[14px] leading-[18px] text-ch-ink">
        {highlighted && highlightQuote ? highlightTextSpan(segment.text, highlightQuote) : segment.text}
      </p>
    </div>
    {isDoctor ? avatar('D', 'bg-[#0d2a40]') : <span />}
  </div>
}
