import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, MicOff, Pause, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { apiRequest } from '@/lib/api'
import { saveSoap, subjectiveFields, visitPath } from '@/lib/clinical'
import type { Consultation } from '@/lib/types'

export function SubjectivePage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const initialConsent: 'setuju' | 'tolak' | null =
    data.visit.consent || data.visit.status === 'consented'
      ? 'setuju'
      : data.visit.status === 'manual'
        ? 'tolak'
        : null
  const [consent, setConsent] = useState<'setuju' | 'tolak' | null>(initialConsent)
  const manual = consent === 'tolak'
  const [fields, setFields] = useState<Record<string, string>>(data.note.subjective)
  const [summary, setSummary] = useState(data.note.subjective_summary)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])

  useEffect(() => { if (!recording || paused) return; const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer) }, [recording, paused])
  useEffect(() => () => { if (recorder.current && recorder.current.state !== 'inactive') { recorder.current.onstop = null; recorder.current.stop() }; stream.current?.getTracks().forEach((track) => track.stop()) }, [])

  async function decide(decision: 'setuju' | 'tolak') {
    setBusy(true); setError(''); setNotice('')
    try {
      const body = new FormData(); body.set('decision', decision)
      await apiRequest(visitPath(id, '/consent'), { method: 'POST', body })
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      setConsent(decision)
      setNotice(decision === 'setuju' ? 'Persetujuan rekam tersimpan. Mikrofon siap digunakan.' : 'Pencatatan manual dipilih.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Persetujuan gagal disimpan.') }
    finally { setBusy(false) }
  }

  async function startRecording() {
    setError('')
    if (consent !== 'setuju') { setError('Pilih persetujuan pasien terlebih dahulu sebelum memulai rekaman.'); return }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Browser tidak mendukung perekaman. Lanjutkan dengan isian manual.'); return }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = media; chunks.current = []
      const type = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined
      const next = new MediaRecorder(media, type ? { mimeType: type } : undefined); recorder.current = next
      next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      next.onerror = () => { setError('Rekaman terhenti. Coba lagi atau lanjut manual.'); setRecording(false) }
      next.onstop = async () => {
        media.getTracks().forEach((track) => track.stop()); setRecording(false); setPaused(false); setBusy(true)
        try {
          const mime = next.mimeType || 'audio/webm'; const extension = mime.includes('mp4') ? 'mp4' : 'webm'; const body = new FormData()
          body.set('audio', new Blob(chunks.current, { type: mime }), `konsultasi.${extension}`)
          await apiRequest(visitPath(id, '/audio'), { method: 'POST', body }); await queryClient.invalidateQueries({ queryKey: ['consultation', id] }); navigate(`/kunjungan/${id}/draf-s`)
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Audio belum berhasil dikirim.') }
        finally { setBusy(false) }
      }
      next.start(); setSeconds(0); setPaused(false); setRecording(true)
    } catch { setError('Mikrofon tidak tersedia atau izin ditolak. Periksa perangkat lalu coba lagi.') }
  }

  async function saveManual() {
    if (!summary.trim() && !Object.values(fields).some((value) => value.trim())) { setError('Isi minimal satu bagian Subjektif sebelum melanjutkan.'); return }
    setBusy(true); setError('')
    try { await saveSoap(id, { step: 's', action: 'to_oap', summary, ...Object.fromEntries(subjectiveFields.map(([key]) => [`s_${key}`, fields[key] || ''])) }); await queryClient.invalidateQueries({ queryKey: ['consultation', id] }); navigate(`/kunjungan/${id}/oap`) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Draf belum tersimpan.') }
    finally { setBusy(false) }
  }

  const isSetuju = consent === 'setuju'
  const isTolak = consent === 'tolak'

  const consentExtra = <div className="mt-3 grid gap-4 border-t border-[#d7e4e9] pt-3 lg:grid-cols-[1.35fr_1fr]">
    <div className="pr-4 lg:border-r lg:border-[#d4e2e8]"><h3 className="text-sm font-bold text-[#1a2b43]">Persetujuan Rekaman Percakapan Klinis</h3><p className="mt-1 text-[11px] text-[#718399]">Sesuai UU PDP No. 27/2022 &amp; Permenkes RI No. 24/2022.</p><ul className="mt-1.5 space-y-1 text-[11px] leading-4 text-[#718399]"><li>• Tujuan: Otomatisasi draf anamnesis (SOAP Subjektif) &amp; arsip riwayat konsultasi pasien.</li><li>• Penyimpanan: Audio &amp; transkrip disimpan terenkripsi di server lokal klinik.</li><li>• Pengembangan Model: Data rekaman digunakan khusus untuk peningkatan performa internal.</li></ul><a href="#ketentuan" className="mt-1.5 inline-block text-[11px] font-semibold text-[#00a1b5]">[Pelajari Ketentuan Kerahasiaan Data &amp; AI ↗]</a></div>
    <div className="space-y-2">
      <button type="button" disabled={busy || recording} onClick={() => decide('setuju')} className={`flex min-h-9 w-full items-center gap-2 rounded-full border px-3 text-left text-[11px] transition-colors ${isSetuju ? 'border-[#79d8e4] bg-[#d8f5f8] text-[#08798a]' : 'border-[#d0dfe6] bg-[#f8fbfc] text-[#52677b] hover:bg-[#eaf5f7]'}`}>
        <span className={`size-3 rounded-full border ${isSetuju ? 'border-[#148fa0] bg-[#148fa0]' : 'border-[#8296a7] bg-white'}`} /> Pasien Menyetujui Perekaman (AI Scribe Aktif)
      </button>
      <button type="button" disabled={busy || recording} onClick={() => decide('tolak')} className={`flex min-h-9 w-full items-center gap-2 rounded-full border px-3 text-left text-[11px] transition-colors ${isTolak ? 'border-[#79d8e4] bg-[#d8f5f8] text-[#08798a]' : 'border-[#d0dfe6] bg-[#f8fbfc] text-[#52677b] hover:bg-[#eaf5f7]'}`}>
        <span className={`size-3 rounded-full border ${isTolak ? 'border-[#148fa0] bg-[#148fa0]' : 'border-[#8296a7] bg-white'}`} /> Pasien Menolak Perekaman (Pencatatan Manual)
      </button>
      <p className="px-1 text-[10px] text-[#94a5b8]">Diverifikasi verbal oleh perawat/dokter saat pasien masuk.</p>
    </div>
  </div>

  const timer = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
  return <div className="space-y-6"><ClinicalHeader consultation={data} stage="subjektif" patientExtra={consentExtra} />
    {notice && <p role="status" className="rounded-xl border border-[#a8dfc8] bg-[#eaf8f2] p-3 text-sm text-[#176e4e]">{notice}</p>}{error && <p role="alert" className="rounded-xl border border-[#f2b8b8] bg-[#fff0f0] p-3 text-sm text-[#9d2525]">{error}</p>}
    {!manual && <section className="flex min-h-[116px] flex-wrap items-center gap-5 rounded-2xl border border-[#d2e1e7] bg-[#fbfdfe] px-5 py-5">
      <div className="flex items-center gap-5">
        <span className={`inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-bold ${recording ? 'border-[#f2a7a7] bg-[#fff1f1] text-[#b42727]' : isSetuju ? 'border-[#79d8e4] bg-[#ddf6f9] text-[#08798a]' : 'border-[#d0dfe6] bg-[#f0f4f7] text-[#627788]'}`}>
          <span className={`size-2 rounded-full ${recording ? 'animate-pulse bg-[#e03131]' : isSetuju ? 'bg-[#128da0]' : 'bg-[#8c9ea9]'}`} /> {recording ? paused ? 'Rekaman Dijeda' : 'Sedang Merekam' : isSetuju ? 'Mikrofon Siap' : 'Menunggu Persetujuan'}
        </span>
        <strong className="text-[20px] tabular-nums text-[#3f4c55]">{timer} <small className="text-xs font-semibold text-[#687982]">menit</small></strong>
      </div>
      <div className="hidden h-px flex-1 border-t border-dashed border-[#18abc0] lg:block" />
      <div className="ml-auto flex flex-wrap gap-3">{!recording ? <><button type="button" className="inline-flex h-10 items-center gap-1 rounded-xl border border-[#d2e1e7] bg-[#f1f6f8] px-3 text-xs font-semibold text-[#4f667a]"><ChevronDown className="size-3" /> Mikrofon Bilik 3</button><Button disabled={busy || !isSetuju} onClick={startRecording} className="h-10 rounded-xl bg-[#14a2b5] px-5 text-xs text-white hover:bg-[#0c8fa1] disabled:opacity-50"><Play className="size-3.5 fill-current" /> Mulai Rekam</Button></> : <><Button variant="outline" onClick={() => { if (paused) recorder.current?.resume(); else recorder.current?.pause(); setPaused(!paused) }}>{paused ? <Play className="size-4" /> : <Pause className="size-4" />}{paused ? 'Lanjutkan' : 'Jeda'}</Button><Button onClick={() => recorder.current?.stop()}><Square className="size-4" /> Selesai</Button></>}</div>
    </section>}

    {!manual && <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><EmptyPanel title="Transkrip Percakapan" badge="Transkrip Sesi" message="Belum ada rekaman berlangsung" detail='Klik tombol "Mulai Rekam" untuk menyimpan dan mentranskripsi dialog percakapan dokter–pasien secara otomatis.' /><EmptyPanel title="Subjektif" badge="Menunggu Rekaman" message="Belum ada rekaman berlangsung" detail='Klik tombol "Mulai Rekam" untuk mencatat Subjektif secara otomatis.' /></div>}

    {manual && <section className="rounded-2xl border border-[#d2e1e7] bg-[#fbfdfe] p-5"><div className="flex items-center gap-2"><MicOff className="size-5 text-[#0ea5b7]" /><h2 className="text-lg font-bold text-[#102a43]">Pencatatan Subjektif Manual</h2></div><div className="mt-5 grid gap-4 md:grid-cols-2">{subjectiveFields.map(([key, label]) => <label key={key} className="text-xs font-semibold text-[#53687b]">{label}<textarea value={fields[key] || ''} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-[#d2e1e7] bg-white p-3 text-sm font-normal outline-none focus:border-[#0ea5b7]" /></label>)}</div><label className="mt-4 block text-xs font-semibold text-[#53687b]">Rangkuman Subjektif<textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-[#d2e1e7] bg-white p-3 text-sm font-normal outline-none focus:border-[#0ea5b7]" /></label><div className="mt-5 flex justify-end"><Button disabled={busy} onClick={saveManual} className="bg-[#14a2b5] text-white hover:bg-[#0c8fa1]">Simpan dan lanjut Objektif</Button></div></section>}
  </div>
}

function EmptyPanel({ title, badge, message, detail }: { title: string; badge: string; message: string; detail: string }) {
  return <section className="min-h-[300px] rounded-2xl border border-[#d2e1e7] bg-[#fbfdfe] p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-[20px] font-bold text-[#101f35]">{title}</h2><span className="rounded-full border border-[#cad9e3] bg-[#edf2f6] px-3 py-1.5 text-[11px] font-semibold text-[#52677b]">{badge}</span></div><div className="mt-4 grid min-h-[220px] place-items-center rounded-xl border border-dashed border-[#d4e2e9] bg-[#fcfdfe] p-6 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-full bg-[#f1f5f8] text-[#9aacc0]"><MicOff className="size-6" /></span><p className="mt-3 text-xs font-bold text-[#2f4053]">{message}</p><p className="mx-auto mt-2 max-w-md text-[11px] leading-5 text-[#96a7ba]">{detail}</p></div></div></section>
}
