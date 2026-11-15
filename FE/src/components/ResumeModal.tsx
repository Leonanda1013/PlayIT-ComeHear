import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CircleCheck, ClipboardList, Clock3, FileCheck2, LoaderCircle, X } from 'lucide-react'
import { getConsultation, getResume } from '@/lib/clinical'
import { dateId, genderShort, timeWib } from '@/lib/format'
import type { ClinicalNote } from '@/lib/types'

const S_FIELDS: [string, string][] = [
  ['keluhan_utama', 'KELUHAN UTAMA'],
  ['riwayat_penyakit_sekarang', 'RIWAYAT PENYAKIT SEKARANG'],
  ['riwayat_penyakit_dahulu', 'RIWAYAT PENYAKIT DAHULU'],
  ['riwayat_penyakit_keluarga', 'RIWAYAT PENYAKIT KELUARGA'],
  ['riwayat_alergi', 'RIWAYAT ALERGI'],
  ['riwayat_pengobatan', 'RIWAYAT PENGGUNAAN OBAT'],
]
const PROCESS = ['QUEUED', 'SENDING', 'RETRY_WAIT', 'RECONCILING']

const longDate = (value?: string | null) => value ? new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '—'
const num = (v?: number) => v === undefined || v === null ? '—' : String(v)

function vitalsLine(note: ClinicalNote) {
  const v = note.vitals || {}
  return [
    `Tekanan Darah: ${v.systolic ? `${v.systolic}/${v.diastolic} mmHg` : '—'}`,
    `Nadi: ${v.heart_rate ? `${v.heart_rate} x/menit` : '—'}`,
    `Suhu Tubuh: ${v.body_temperature ? `${v.body_temperature} °C` : '—'}`,
    `SpO2: ${v.oxygen_saturation ? `${v.oxygen_saturation}%` : '—'}`,
  ].join(' • ')
}

function physicalLine(note: ClinicalNote) {
  const v = note.vitals || {}
  const parts: string[] = []
  if (v.respiratory_rate) parts.push(`RR ${num(v.respiratory_rate)} x/menit`)
  if (v.body_weight) parts.push(`BB ${num(v.body_weight)} kg`)
  if (v.body_height) parts.push(`TB ${num(v.body_height)} cm`)
  if (v.body_weight && v.body_height) parts.push(`(IMT: ${(v.body_weight / (v.body_height / 100) ** 2).toFixed(1)} kg/m²)`)
  return [parts.join(' • ').replace(' • (IMT', ' (IMT'), note.exam_text?.replace(/\n+/g, ' ')].filter(Boolean).join(' • ')
}

function Section({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return <div className={`py-4 ${last ? '' : 'border-b border-[#e3ebef]'}`}>
    <p className="mb-2 text-[13px] text-[#6a7d8f]">{title}</p>
    <div className="space-y-1.5 text-[14px] leading-[21px] text-ch-ink">{children}</div>
  </div>
}

/** Modal "Resume Medis" untuk satu kunjungan (dibuka dari tombol Lihat Resume di antrean). */
export function ResumeModal({ visitId, onClose }: { visitId: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const consultation = useQuery({ queryKey: ['consultation', visitId], queryFn: () => getConsultation(visitId) })
  const resume = useQuery({ queryKey: ['resume', visitId], queryFn: () => getResume(visitId) })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus() }
  }, [onClose])

  const data = consultation.data
  const note = data?.note
  const approved = !!note?.approved_snapshot
  const snapshot = note?.approved_snapshot as { approved_at?: string; practitioner?: { name?: string } } | null | undefined
  const sub = resume.data?.submission
  const savedAt = snapshot?.approved_at || note?.updated_at
  const doctor = snapshot?.practitioner?.name || data?.visit.doctor || '—'
  const visitDate = data?.visit.arrived_at || data?.visit.started_at || data?.visit.called_at
  const ap = (note?.extra?.asesmen_plan || {}) as { tindakan?: string; dx?: { text: string; onset?: string }[] }

  const banner = !approved ? { icon: Clock3, text: 'Draf SOAP tersimpan, belum divalidasi dokter', tone: 'bg-[#fff6e5] text-[#7a5300]' }
    : sub?.status === 'SENT' ? { icon: CheckCircle2, text: 'Resume medis lengkap & terkirim ke SATUSEHAT', tone: 'bg-[#e4f4f6] text-ch-ink' }
    : sub?.status === 'NEEDS_ATTENTION' ? { icon: AlertTriangle, text: 'Resume medis lengkap, pengiriman ke SATUSEHAT gagal dan perlu ditindaklanjuti', tone: 'bg-ch-bad-soft text-[#8b2020]' }
    : sub && PROCESS.includes(sub.status) ? { icon: LoaderCircle, text: 'Resume medis lengkap, sedang dikirim ke SATUSEHAT', tone: 'bg-[#e4f4f6] text-ch-ink' }
    : { icon: CheckCircle2, text: 'Resume medis lengkap, menunggu pengiriman ke SATUSEHAT', tone: 'bg-[#e4f4f6] text-ch-ink' }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#081d2d]/35 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="resume-title" className="flex max-h-[92vh] w-full max-w-[868px] flex-col overflow-hidden rounded-[14px] border border-[#dce6eb] bg-white shadow-[0_24px_60px_rgba(8,29,45,0.22)]">
      <div className="flex shrink-0 items-start gap-4 border-b border-[#dce6eb] px-7 py-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-[#e1f3f6] text-ch-brand"><ClipboardList className="size-6" /></span>
        <div className="min-w-0 flex-1"><h2 id="resume-title" className="text-[24px] font-bold leading-7 tracking-[-0.02em] text-ch-ink">Resume Medis</h2><p className="mt-1 text-[14px] text-[#6a7d8f]">Ringkasan kunjungan pasien berdasarkan draf SOAP</p></div>
        <button type="button" aria-label="Tutup resume" onClick={onClose} className="grid size-9 place-items-center rounded-lg text-[#4a5f72] hover:bg-[#eef4f7]"><X className="size-5" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {consultation.isPending ? <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-ch-muted"><LoaderCircle className="size-5 animate-spin" /> Memuat resume…</div>
          : consultation.isError ? <p className="m-7 rounded-[10px] bg-ch-bad-soft p-4 text-sm text-[#8b2020]">{consultation.error.message}</p>
          : data && note && <>
            <div className="bg-[#f1f8fa] px-7 pb-5 pt-7">
              <section className="rounded-[12px] border border-[#dce6eb] bg-white/70 px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-[22px] font-bold leading-7 text-ch-ink">{data.visit.patient.name}</p><p className="mt-1 text-[14px] text-[#6a7d8f]">No. RM {data.visit.patient.rm_number} · {genderShort(data.visit.patient.gender_label)} · {dateId(data.visit.patient.birth_date)}</p></div>
                  <div className="flex gap-3">
                    <span className={`inline-flex h-[26px] items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${approved ? 'border-[#a8dcc2] bg-[#e7f6ee] text-[#137049]' : 'border-[#f0d08a] bg-[#fff6e5] text-[#7a5300]'}`}><CircleCheck className="size-4" />{approved ? 'Selesai' : 'Draf'}</span>
                    <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-[#a8dcc2] bg-[#e7f6ee] px-3 text-[13px] font-medium text-[#137049]"><FileCheck2 className="size-4" />Tersimpan</span>
                  </div>
                </div>
                <div className="my-4 border-t border-[#e3ebef]" />
                <dl className="grid gap-4 sm:grid-cols-3">
                  {[['Tanggal kunjungan', longDate(visitDate)], ['Dokter pemeriksa', doctor], ['Waktu penyimpanan', timeWib(savedAt)]].map(([k, v]) => <div key={k}><dt className="text-[13px] text-[#6a7d8f]">{k}</dt><dd className="mt-1 text-[14px] font-semibold text-ch-ink">{v}</dd></div>)}
                </dl>
              </section>
              <p className={`mt-5 flex items-center gap-3 rounded-[10px] px-4 py-3 text-[13px] font-semibold ${banner.tone}`}><banner.icon className="size-5 shrink-0 text-ch-teal" />{banner.text}</p>
            </div>

            <div className="px-7 pb-7">
              <section className="-mt-px rounded-[12px] border border-[#dce6eb] bg-white px-5 pt-5">
                <h3 className="flex items-center gap-2.5 text-[15px] font-bold text-ch-ink"><ClipboardList className="size-5 text-ch-brand" /> SOAP dari draf SOAP</h3>
                <Section title="S — Subjektif — Hasil Ekstraksi AI Medical Scribe">
                  {S_FIELDS.filter(([key]) => key !== 'riwayat_penyakit_keluarga' || note.subjective?.[key]).map(([key, label]) => <p key={key}>{label}: {note.subjective?.[key] || <span className="text-ch-faint">tidak dibahas</span>}</p>)}
                  {!Object.values(note.subjective || {}).some(Boolean) && note.subjective_summary && <p>{note.subjective_summary}</p>}
                </Section>
                <Section title="O — Objektif — Pemeriksaan Fisik & TTV">
                  <p>{vitalsLine(note)}</p>
                  <p>STATUS FISIK &amp; PEMERIKSAAN PENUNJANG</p>
                  <p>{physicalLine(note) || <span className="text-ch-faint">Belum dicatat.</span>}</p>
                </Section>
                <Section title="A — Asesmen — Diagnosis & Validasi ICD-10 SATUSEHAT">
                  {note.diagnoses?.length ? note.diagnoses.map((d, i) => <p key={d.code}>{i === 0 ? 'DIAGNOSIS UTAMA' : `DIAGNOSIS SEKUNDER ${i}`}: {ap.dx?.[i]?.text || d.display} — <b>{d.code}</b> {d.display}{i === 0 && ap.dx?.[0]?.onset ? ` (${ap.dx[0].onset})` : ''}</p>) : <p className="text-ch-faint">Belum ada diagnosis.</p>}
                </Section>
                <Section title="P — Plan — Tatalaksana & Edukasi" last>
                  {(note.plan_text || '').split('\n').filter((line) => line.trim()).map((line, i) => <p key={i}>{line}</p>)}
                  {!note.plan_text && <p className="text-ch-faint">Belum ada rencana tatalaksana.</p>}
                </Section>
              </section>
            </div>
          </>}
      </div>
    </div>
  </div>
}
