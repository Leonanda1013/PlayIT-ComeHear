import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, MicOff, Pause, Play, Square } from 'lucide-react'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { ConsentBlock, useConsent } from '@/components/Consent'
import { TranscriptBubble } from '@/components/Scribe'
import { Notice, TextArea } from '@/components/ui/kit'
import { apiRequest } from '@/lib/api'
import { getScribe, saveSoap, subjectiveFields, visitPath } from '@/lib/clinical'
import { mmss } from '@/lib/format'
import type { Consultation } from '@/lib/types'

const CHUNK_MS = 5000

export function SubjectivePage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [fields, setFields] = useState<Record<string, string>>(data.note.subjective || {})
  const [summary, setSummary] = useState(data.note.subjective_summary || '')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const sessionId = useRef<number | null>(null)
  const seq = useRef(0)
  const uploads = useRef<Promise<unknown>>(Promise.resolve())
  const { consent, decide: saveDecision, saved } = useConsent(data, setError)

  const live = useQuery({ queryKey: ['scribe', id, 'live'], queryFn: () => getScribe(id), enabled: recording, refetchInterval: recording ? 3000 : false })

  useEffect(() => { if (!recording || paused) return; const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer) }, [recording, paused])
  useEffect(() => () => { if (recorder.current && recorder.current.state !== 'inactive') { recorder.current.ondataavailable = null; recorder.current.onstop = null; recorder.current.stop() }; stream.current?.getTracks().forEach((track) => track.stop()) }, [])

  function decide(decision: 'setuju' | 'tolak') { if (recording) return; setError(''); saveDecision(decision) }

  function sendChunk(blob: Blob) {
    const n = seq.current++
    uploads.current = uploads.current.then(async () => {
      const body = new FormData()
      body.set('seq', String(n))
      body.set('chunk', blob, `potongan-${n}.webm`)
      if (sessionId.current) body.set('session_id', String(sessionId.current))
      const result = await apiRequest<{ session_id: number }>(visitPath(id, '/audio-chunk'), { method: 'POST', body })
      sessionId.current = result.session_id
    })
    uploads.current.catch((caught) => setError(caught instanceof Error ? caught.message : 'Potongan audio gagal dikirim.'))
  }

  async function startRecording() {
    setError('')
    if (consent !== 'setuju') { setError('Pilih "Pasien Menyetujui Perekaman" terlebih dahulu sebelum memulai rekaman.'); return }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Browser tidak mendukung perekaman. Gunakan pencatatan manual.'); return }
    try {
      await saved()
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      stream.current = media; seq.current = 0; sessionId.current = null; uploads.current = Promise.resolve()
      const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined
      const next = new MediaRecorder(media, type ? { mimeType: type } : undefined); recorder.current = next
      next.ondataavailable = (event) => { if (event.data.size) sendChunk(event.data) }
      next.onerror = () => { setError('Rekaman terhenti. Coba lagi atau gunakan pencatatan manual.'); setRecording(false) }
      next.onstop = async () => {
        media.getTracks().forEach((track) => track.stop()); setRecording(false); setPaused(false); setBusy(true)
        try {
          await uploads.current
          if (!sessionId.current) throw new Error('Tidak ada audio yang terekam. Coba rekam ulang.')
          const body = new FormData(); body.set('session_id', String(sessionId.current))
          await apiRequest(visitPath(id, '/audio-finish'), { method: 'POST', body })
          await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
          navigate(`/kunjungan/${id}/draf-s`)
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Audio belum berhasil dikirim.') }
        finally { setBusy(false) }
      }
      next.start(CHUNK_MS); setSeconds(0); setPaused(false); setRecording(true)
    } catch (caught) { setError(caught instanceof Error && caught.message ? caught.message : 'Mikrofon tidak tersedia atau izin ditolak. Periksa perangkat lalu coba lagi.') }
  }

  async function toObjective() {
    if (!consent) { setError('Pilih persetujuan perekaman pasien terlebih dahulu.'); return }
    setBusy(true); setError('')
    try {
      await saved()
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      navigate(`/kunjungan/${id}/objektif`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Persetujuan belum tersimpan.') }
    finally { setBusy(false) }
  }

  async function saveManual() {
    if (!summary.trim() && !Object.values(fields).some((value) => value?.trim())) { setError('Isi minimal satu bagian Subjektif sebelum melanjutkan.'); return }
    setBusy(true); setError('')
    try {
      await saved()
      await saveSoap(id, { step: 's', action: 'to_oap', summary, ...Object.fromEntries(subjectiveFields.map(([key]) => [`s_${key}`, fields[key] || ''])) })
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      navigate(`/kunjungan/${id}/objektif`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Draf belum tersimpan.') }
    finally { setBusy(false) }
  }

  const consentBlock = <ConsentBlock consent={consent} onDecide={decide} disabled={recording} />

  const transcript = live.data?.transcript || []
  const manual = consent === 'tolak'

  return <div className="space-y-[27px]">
    <ClinicalHeader consultation={data} stage="subjektif" patientExtra={consentBlock} />
    {error && <Notice tone="bad">{error}</Notice>}

    {manual ? (
      /* Pasien menolak perekaman: Subjektif diisi manual oleh dokter. */
      <section className="rounded-[16px] border border-[#dce6eb] bg-[#fbfdfe] p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="text-[20px] font-bold text-ch-ink">Subjektif</h2><span className="inline-flex h-[30px] items-center rounded-full border border-[#cfdbe2] bg-[#edf2f5] px-3 text-[13px] font-semibold text-[#4b5f70]">Pencatatan Manual</span></div>
        <p className="mt-1 text-[12px] text-[#5f7284]">Pasien menolak perekaman. Isi anamnesis berdasarkan wawancara langsung.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {subjectiveFields.map(([key, label]) => <label key={key} className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#5f7284]">{label}</span><TextArea rows={3} value={fields[key] || ''} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} className="text-[13px]" /></label>)}
          <label className="block md:col-span-2"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#5f7284]">Rangkuman Subjektif</span><TextArea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} className="text-[13px]" /></label>
        </div>
        <div className="mt-5 flex justify-end"><button type="button" disabled={busy} onClick={saveManual} className="inline-flex h-[42px] items-center rounded-[10px] bg-ch-brand px-5 text-[14px] font-semibold text-white hover:bg-ch-brand-hover disabled:opacity-50">{busy ? 'Menyimpan…' : 'Lanjut ke OAP'}</button></div>
      </section>
    ) : <>
      {/* Kartu AI Scribe: perekam + transkrip + draf Subjektif. */}
      <section className="flex min-h-[115px] flex-wrap items-center gap-5 rounded-[16px] border border-[#dce6eb] bg-[#fbfdfe] px-[19px] py-4" aria-live="polite">
        <span className={`inline-flex h-[38px] items-center gap-2.5 rounded-[8px] border px-3.5 text-[14px] font-semibold ${recording ? 'border-[#f2a7a7] bg-[#fff1f1] text-[#b42727]' : 'border-[#9adbe5] bg-[#d9f3f6] text-[#0b6e7d]'}`}><span className={`size-2 rounded-full ${recording ? 'animate-pulse bg-[#e03131]' : 'bg-[#0b6e7d]'}`} />{recording ? (paused ? 'Rekaman Dijeda' : 'Sedang Merekam') : busy ? 'Mengirim Rekaman…' : 'Mikrofon Siap'}</span>
        <p className="font-inter text-[22px] font-bold tabular-nums text-[#3f4c55]">{mmss(seconds)} <span className="font-jakarta text-[15px] font-semibold text-[#5f7284]">menit</span></p>
        <div className="ml-auto flex flex-wrap gap-4">
          {!recording ? <>
            <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#dce6eb] bg-[#eef4f7] px-3 text-[14px] font-medium text-[#3d5266]"><ChevronDown className="size-3.5" /> Mikrofon Bilik 3</button>
            <button type="button" disabled={busy} onClick={startRecording} className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#dce6eb] bg-[#eef4f7] px-4 text-[14px] font-medium text-[#3d5266] hover:border-ch-brand hover:text-ch-teal disabled:opacity-50"><Play className="size-3 fill-current" /> Mulai Rekam</button>
          </> : <>
            <button type="button" className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#dce6eb] bg-[#eef4f7] px-4 text-[14px] font-medium text-[#3d5266]" onClick={() => { if (paused) recorder.current?.resume(); else recorder.current?.pause(); setPaused(!paused) }}>{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{paused ? 'Lanjutkan' : 'Jeda'}</button>
            <button type="button" className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-ch-brand px-4 text-[14px] font-semibold text-white hover:bg-ch-brand-hover" onClick={() => recorder.current?.stop()}><Square className="size-3.5 fill-current" /> Selesai Rekam</button>
          </>}
        </div>
      </section>

      <div className="grid items-stretch gap-[25px] xl:grid-cols-[592fr_486fr]">
        <Card title="Transkrip Percakapan" badge="Transkrip Sesi">
          {transcript.length ? <div className="mt-4 max-h-[560px] space-y-3 overflow-y-auto pr-1">{transcript.map((segment, index) => <TranscriptBubble key={segment.i ?? index} segment={segment} patientName={data.visit.patient.name} />)}</div>
            : <EmptyBox title={recording ? 'Mendengarkan percakapan…' : 'Belum ada rekaman berlangsung'}>{recording ? 'Transkrip muncul bertahap selama rekaman berjalan.' : <>Klik tombol <b className="font-semibold text-ch-brand">"Mulai Rekam"</b> untuk menyimpan dan mentranskripsi dialog<br />percakapan dokter-pasien secara otomatis.</>}</EmptyBox>}
        </Card>
        <Card title="Subjektif" badge={recording ? 'Merekam' : 'Menunggu Rekaman'} footer={<>
          <button type="button" disabled={recording} onClick={() => decide('tolak')} className="inline-flex h-10 min-w-[92px] items-center justify-center rounded-[10px] border border-[#dce6eb] bg-[#eef4f7] px-4 text-[14px] font-medium text-[#3d5266] hover:border-ch-brand disabled:opacity-50">Isi Manual</button>
          <button type="button" disabled={busy || recording} onClick={toObjective} className="inline-flex h-10 min-w-[178px] items-center justify-center rounded-[10px] bg-ch-brand px-5 text-[14px] font-semibold text-white hover:bg-ch-brand-hover disabled:opacity-50">Lanjut ke OAP</button>
        </>}>
          <EmptyBox title={recording ? 'Rekaman sedang berjalan' : 'Belum ada rekaman berlangsung'}>{recording ? 'Draf Subjektif disusun AI setelah rekaman selesai.' : <>Klik tombol <b className="font-semibold text-ch-brand">"Mulai Rekam"</b> untuk<br />mencatata Subjektif secara otomatis.</>}</EmptyBox>
        </Card>
      </div>
    </>}
  </div>
}

function Card({ title, badge, children, footer }: { title: string; badge: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return <section className="flex min-h-[420px] flex-col rounded-[16px] border border-[#dce6eb] bg-[#fbfdfe] px-[15px] pb-[15px] pt-[19px]">
    <div className="flex items-center justify-between gap-3 px-1"><h2 className="text-[20px] font-bold text-ch-ink">{title}</h2><span className="inline-flex h-[30px] items-center rounded-full border border-[#cfdbe2] bg-[#edf2f5] px-3 text-[13px] font-semibold text-[#4b5f70]">{badge}</span></div>
    <div className="flex flex-1 flex-col">{children}</div>
    {footer && <div className="mt-[35px] flex items-center justify-between gap-3">{footer}</div>}
  </section>
}

function EmptyBox({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mt-4 grid flex-1 place-items-center rounded-[12px] border border-dashed border-[#d6e1e7] bg-[#fcfdfe] px-6 py-10 text-center">
    <div><span className="mx-auto grid size-12 place-items-center rounded-full bg-[#eef3f7] text-[#9aacc0]"><MicOff className="size-5" /></span><p className="mt-3 text-[13px] font-semibold text-[#2f4053]">{title}</p><p className="mx-auto mt-2 text-[11px] leading-[18px] text-[#96a7ba]">{children}</p></div>
  </div>
}
