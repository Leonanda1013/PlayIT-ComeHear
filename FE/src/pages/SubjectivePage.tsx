import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, MicOff, Pause, Play, Square } from 'lucide-react'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { RecorderBar, SubjectiveEmpty, TranscriptPanel } from '@/components/Scribe'
import { btn, Notice, Panel, PanelTitle, Badge, TextArea, FieldCaps } from '@/components/ui/kit'
import { apiRequest } from '@/lib/api'
import { getScribe, saveSoap, subjectiveFields, visitPath } from '@/lib/clinical'
import type { Consultation } from '@/lib/types'

const CHUNK_MS = 5000

export function SubjectivePage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [consent, setConsent] = useState<'setuju' | 'tolak' | ''>(data.visit.consent ? 'setuju' : data.visit.status === 'manual' ? 'tolak' : '')
  const [showConsentInfo, setShowConsentInfo] = useState(false)
  const [manual, setManual] = useState(data.visit.status === 'manual')
  const [fields, setFields] = useState<Record<string, string>>(data.note.subjective || {})
  const [summary, setSummary] = useState(data.note.subjective_summary || '')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const sessionId = useRef<number | null>(null)
  const seq = useRef(0)
  const uploads = useRef<Promise<unknown>>(Promise.resolve())

  const live = useQuery({ queryKey: ['scribe', id, 'live'], queryFn: () => getScribe(id), enabled: recording, refetchInterval: recording ? 3000 : false })

  useEffect(() => { if (!recording || paused) return; const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer) }, [recording, paused])
  useEffect(() => () => { if (recorder.current && recorder.current.state !== 'inactive') { recorder.current.ondataavailable = null; recorder.current.onstop = null; recorder.current.stop() }; stream.current?.getTracks().forEach((track) => track.stop()) }, [])

  async function decide(decision: 'setuju' | 'tolak') {
    setBusy(true); setError(''); setNotice('')
    try {
      const body = new FormData(); body.set('decision', decision)
      await apiRequest(visitPath(id, '/consent'), { method: 'POST', body })
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      setConsent(decision)
      if (decision === 'tolak') setManual(true)
      setNotice(decision === 'setuju' ? 'Persetujuan rekam tersimpan. Mikrofon siap digunakan.' : 'Pasien menolak perekaman. Isi Subjektif secara manual.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Persetujuan gagal disimpan.') }
    finally { setBusy(false) }
  }

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
    setError(''); setNotice('')
    if (consent !== 'setuju') { setError('Pilih persetujuan pasien terlebih dahulu sebelum memulai rekaman.'); return }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Browser tidak mendukung perekaman. Lanjutkan dengan Isi Manual.'); return }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      stream.current = media; seq.current = 0; sessionId.current = null; uploads.current = Promise.resolve()
      const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined
      const next = new MediaRecorder(media, type ? { mimeType: type } : undefined); recorder.current = next
      next.ondataavailable = (event) => { if (event.data.size) sendChunk(event.data) }
      next.onerror = () => { setError('Rekaman terhenti. Coba lagi atau gunakan Isi Manual.'); setRecording(false) }
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
    } catch { setError('Mikrofon tidak tersedia atau izin ditolak. Periksa perangkat lalu coba lagi.') }
  }

  async function saveManual() {
    if (!summary.trim() && !Object.values(fields).some((value) => value?.trim())) { setError('Isi minimal satu bagian Subjektif sebelum melanjutkan.'); return }
    setBusy(true); setError('')
    try {
      await saveSoap(id, { step: 's', action: 'to_oap', summary, ...Object.fromEntries(subjectiveFields.map(([key]) => [`s_${key}`, fields[key] || ''])) })
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      navigate(`/kunjungan/${id}/objektif`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Draf belum tersimpan.') }
    finally { setBusy(false) }
  }

  const consentBlock = <div className="mt-3 border-t border-[#d7e4e9] pt-3">
    <div className="grid gap-3 lg:grid-cols-[250px_1fr]">
      <div><h3 className="text-[13px] font-bold text-ch-ink">Persetujuan Rekaman Percakapan Klinis</h3><p className="mt-1 text-[10px] text-[#718399]">Sesuai UU PDP No. 27/2022 &amp; Permenkes RI No. 24/2022.</p></div>
      <div>
        <div role="radiogroup" aria-label="Persetujuan perekaman" className="grid gap-2 md:grid-cols-2">
          <ConsentPill active={consent === 'setuju'} disabled={busy || recording} onClick={() => decide('setuju')}>Pasien Menyetujui Perekaman (AI Scribe Aktif)</ConsentPill>
          <ConsentPill active={consent === 'tolak'} disabled={busy || recording} onClick={() => decide('tolak')}>Pasien Menolak Perekaman (Pencatatan Manual)</ConsentPill>
        </div>
        <p className="mt-1.5 text-[10px] text-[#94a5b8]">Diverifikasi verbal oleh perawat/dokter saat pasien masuk.</p>
      </div>
    </div>
    {showConsentInfo && <ul className="mt-3 space-y-1 rounded-[10px] bg-[#f2f8fa] p-3 text-[11px] leading-5 text-[#5d7083]">
      <li>• Tujuan: otomatisasi draf anamnesis (SOAP Subjektif) dan arsip riwayat konsultasi pasien.</li>
      <li>• Penyimpanan: audio diproses di server klinik dan dihapus otomatis setelah dokter memvalidasi SOAP.</li>
      <li>• Hanya teks transkrip yang dikirim ke layanan AI untuk menyusun draf; dokter tetap memeriksa dan menyetujui.</li>
    </ul>}
    <div className="flex justify-end"><button type="button" onClick={() => setShowConsentInfo(!showConsentInfo)} aria-expanded={showConsentInfo} aria-label={showConsentInfo ? 'Sembunyikan ketentuan' : 'Lihat ketentuan privasi'} className="grid size-7 place-items-center rounded-md text-ch-brand hover:bg-[#e6f6f8]">{showConsentInfo ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}</button></div>
  </div>

  const ready = consent === 'setuju'
  const recorderStatus = recording ? (paused ? 'Rekaman Dijeda' : 'Sedang Merekam') : busy ? 'Mengirim Rekaman…' : ready ? 'Mikrofon Siap' : 'Menunggu Persetujuan'

  return <div className="space-y-5">
    <ClinicalHeader consultation={data} stage="subjektif" patientExtra={consentBlock} />
    {notice && <Notice>{notice}</Notice>}
    {error && <Notice tone="bad">{error}</Notice>}

    {!manual && <RecorderBar status={recorderStatus} tone={recording ? 'live' : ready ? 'ready' : 'idle'} seconds={seconds}
      actions={!recording ? <>
        <button type="button" className={`${btn.soft} h-9 text-xs`} disabled><ChevronDown className="size-3.5" /> Mikrofon Bilik 3</button>
        <button type="button" disabled={busy || !ready} onClick={startRecording} className={`${btn.soft} h-9 text-xs`}><Play className="size-3 fill-current" /> Mulai Rekam</button>
      </> : <>
        <button type="button" className={`${btn.soft} h-9 text-xs`} onClick={() => { if (paused) recorder.current?.resume(); else recorder.current?.pause(); setPaused(!paused) }}>{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{paused ? 'Lanjutkan' : 'Jeda'}</button>
        <button type="button" className={`${btn.primary} h-9 text-xs`} onClick={() => recorder.current?.stop()}><Square className="size-3.5 fill-current" /> Selesai Rekam</button>
      </>} />}

    <div className="grid items-start gap-5 xl:grid-cols-[285px_minmax(0,1fr)]">
      <Panel className="flex min-h-[300px] flex-col">
        <PanelTitle action={<Badge tone={manual ? 'info' : 'muted'} className="py-1">{manual ? 'Isi Manual' : recording ? 'Merekam' : 'Menunggu Rekaman'}</Badge>}>Subjektif</PanelTitle>
        {manual ? <div className="mt-4 space-y-3">
          {subjectiveFields.map(([key, label]) => <div key={key}><FieldCaps>{label}</FieldCaps><TextArea rows={2} value={fields[key] || ''} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} className="text-xs" /></div>)}
          <div><FieldCaps>Rangkuman Subjektif</FieldCaps><TextArea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} className="text-xs" /></div>
        </div> : <SubjectiveEmpty recording={recording} />}
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <button type="button" className={`${btn.soft} h-9 text-xs`} disabled={recording} onClick={() => setManual(!manual)}>{manual ? 'Batal Manual' : 'Isi Manual'}</button>
          <button type="button" className={`${btn.primary} h-9 text-xs`} disabled={busy || recording} onClick={() => manual ? saveManual() : navigate(`/kunjungan/${id}/objektif`)}>Lanjut ke OAP</button>
        </div>
      </Panel>
      <TranscriptPanel transcript={live.data?.transcript || []} patientName={data.visit.patient.name} empty={<div className="text-center"><span className="mx-auto grid size-11 place-items-center rounded-full bg-[#eef3f7] text-[#9aacc0]"><MicOff className="size-5" /></span><p className="mt-3 text-xs font-bold text-[#2f4053]">{recording ? 'Mendengarkan percakapan…' : 'Belum ada rekaman berlangsung'}</p><p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-5 text-[#96a7ba]">{recording ? 'Transkrip muncul bertahap selama rekaman berjalan.' : <>Klik tombol <b className="text-ch-brand">"Mulai Rekam"</b> untuk menyimpan dan mentranskripsi dialog percakapan dokter–pasien secara otomatis.</>}</p></div>} />
    </div>
  </div>
}

function ConsentPill({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="radio" aria-checked={active} disabled={disabled} onClick={onClick} className={`flex min-h-[30px] w-full items-center gap-2 rounded-full border px-3 text-left text-[11px] transition-colors disabled:cursor-not-allowed ${active ? 'border-[#79d8e4] bg-[#d8f5f8] font-semibold text-[#08798a]' : 'border-[#d0dfe6] bg-ch-field text-[#52677b] hover:bg-[#eaf5f7]'}`}>
    <span className={`grid size-3 shrink-0 place-items-center rounded-full border ${active ? 'border-[#148fa0]' : 'border-[#8296a7] bg-white'}`}>{active && <span className="size-1.5 rounded-full bg-[#148fa0]" />}</span>{children}
  </button>
}
