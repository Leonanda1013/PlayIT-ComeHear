import { MicOff } from 'lucide-react'
import { Badge, Panel, PanelTitle } from '@/components/ui/kit'
import { mmss } from '@/lib/format'
import type { TranscriptSegment } from '@/lib/types'

export function RecorderBar({ status, tone, seconds, actions }: { status: string; tone: 'idle' | 'ready' | 'live' | 'saved'; seconds: number; actions: React.ReactNode }) {
  const pill = tone === 'live' ? 'border-[#f2a7a7] bg-[#fff1f1] text-[#b42727]' : tone === 'idle' ? 'border-[#d0dfe6] bg-[#f0f4f7] text-[#627788]' : 'border-[#79d8e4] bg-[#ddf6f9] text-[#08798a]'
  const dot = tone === 'live' ? 'animate-pulse bg-[#e03131]' : tone === 'idle' ? 'bg-[#8c9ea9]' : 'bg-[#128da0]'
  return <section className="flex min-h-[92px] flex-wrap items-center gap-5 rounded-[16px] border border-[#d3e2e8] bg-ch-panel px-4 py-4" aria-live="polite">
    <span className={`inline-flex h-[30px] items-center gap-2 rounded-[8px] border px-3.5 text-xs font-bold ${pill}`}><span className={`size-1.5 rounded-full ${dot}`} /> {status}</span>
    <strong className="font-inter text-[20px] tabular-nums text-[#3f4c55]">{mmss(seconds)} <small className="text-xs font-semibold text-[#687982]">menit</small></strong>
    {tone === 'live' && <Waveform />}
    <div className="ml-auto flex flex-wrap gap-2.5">{actions}</div>
  </section>
}

function Waveform() {
  return <div className="hidden h-8 flex-1 items-center gap-[3px] overflow-hidden lg:flex" aria-hidden>
    {Array.from({ length: 48 }).map((_, i) => <span key={i} className="w-[3px] animate-pulse rounded-full bg-ch-brand/70" style={{ height: `${8 + ((i * 37) % 22)}px`, animationDelay: `${(i % 8) * 90}ms` }} />)}
  </div>
}

export function SubjectiveEmpty({ recording }: { recording?: boolean }) {
  return <div className="mt-4 grid min-h-[175px] flex-1 place-items-center rounded-[12px] border border-dashed border-[#d4e2e9] bg-[#fcfdfe] p-5 text-center">
    <div><span className="mx-auto grid size-10 place-items-center rounded-full bg-[#eef3f7] text-[#9aacc0]"><MicOff className="size-5" /></span><p className="mt-3 text-[11px] font-bold text-[#2f4053]">{recording ? 'Rekaman sedang berjalan' : 'Belum ada rekaman berlangsung'}</p><p className="mx-auto mt-1.5 max-w-[210px] text-[10px] leading-4 text-[#96a7ba]">{recording ? 'Draf Subjektif disusun AI setelah rekaman selesai.' : <>Klik tombol <b className="text-ch-brand">"Mulai Rekam"</b> untuk mencatat Subjektif secara otomatis.</>}</p></div>
  </div>
}

export function TranscriptPanel({ transcript, patientName, doctorName, empty, badge = 'Transkrip Sesi', processing }: { transcript: TranscriptSegment[]; patientName: string; doctorName?: string; empty: React.ReactNode; badge?: string; processing?: React.ReactNode }) {
  return <Panel className="min-h-[300px]">
    <PanelTitle action={<Badge tone="muted" className="py-1">{badge}</Badge>}>Transkrip Percakapan</PanelTitle>
    {processing}
    {transcript.length ? <div className="mt-4 max-h-[640px] space-y-3 overflow-auto pr-1">
      {transcript.map((segment, index) => <TranscriptBubble key={segment.i ?? index} segment={segment} patientName={patientName} doctorName={doctorName} />)}
    </div> : <div className="mt-4 grid min-h-[230px] place-items-center rounded-[12px] border border-dashed border-[#d4e2e9] bg-[#fcfdfe] p-6">{empty}</div>}
  </Panel>
}

/** "Vincentius Leonanda Prabowo" -> "Vincentius L. Prabowo" (seperti label di desain). */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts.length <= 2 ? name : `${parts[0]} ${parts.slice(1, -1).map((p) => `${p[0]}.`).join(' ')} ${parts.at(-1)}`
}

export function TranscriptBubble({ segment, patientName, doctorName }: { segment: TranscriptSegment; patientName: string; doctorName?: string | null }) {
  const isDoctor = segment.speaker === 'doctor' || segment.speaker === 'dokter'
  const label = isDoctor ? `Dokter${doctorName ? ` (${doctorName})` : ''}` : segment.speaker === 'guardian' ? 'Pendamping pasien' : `Pasien (${shortName(patientName)})`
  const avatar = (letter: string, color: string) => <span className={`mt-[11px] grid size-[22px] place-items-center rounded-full text-[11px] font-bold text-white ${color}`}>{letter}</span>
  return <div className="grid grid-cols-[22px_minmax(0,1fr)_22px] items-start gap-x-[13px]">
    {isDoctor ? <span /> : avatar('P', 'bg-ch-brand')}
    <div className={`rounded-[8px] border px-3 py-[9px] ${isDoctor ? 'mr-[10px] border-[#dce4e9] bg-[#f1f4f6]' : 'mr-[8px] border-[#c8eaf0] bg-[#e6f6f9]'}`}>
      <p className={`text-[12px] font-semibold leading-4 ${isDoctor ? 'text-[#1f3346]' : 'text-[#0a97aa]'}`}>{label}</p>
      <p className="mt-1 text-[14px] leading-[18px] text-ch-ink">{segment.text}</p>
    </div>
    {isDoctor ? avatar('D', 'bg-[#0d2a40]') : <span />}
  </div>
}
