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

export function TranscriptBubble({ segment, patientName, doctorName }: { segment: TranscriptSegment; patientName: string; doctorName?: string }) {
  const isDoctor = segment.speaker === 'doctor' || segment.speaker === 'dokter'
  const label = isDoctor ? `Dokter${doctorName ? ` (${doctorName})` : ''}` : segment.speaker === 'guardian' ? 'Pendamping pasien' : `Pasien (${patientName})`
  return <div className={`flex items-start gap-2 ${isDoctor ? 'flex-row-reverse' : ''}`}>
    <span className={`mt-1 grid size-[22px] shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${isDoctor ? 'bg-[#102a43]' : 'bg-ch-brand'}`}>{isDoctor ? 'D' : 'P'}</span>
    <div className={`max-w-[82%] rounded-[10px] border px-3 py-2 ${isDoctor ? 'border-[#d3e1e7] bg-[#f0f4f6]' : 'border-[#b9e6ec] bg-[#e5f7f9]'}`}>
      <p className={`text-[11px] font-semibold ${isDoctor ? 'text-[#34495d]' : 'text-[#0a97aa]'}`}>{label}</p>
      <p className="mt-0.5 text-[13px] leading-5 text-ch-ink">{segment.text}</p>
    </div>
  </div>
}
