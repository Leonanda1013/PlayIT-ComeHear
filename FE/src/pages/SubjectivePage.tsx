import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronDown, MicOff, Pause, Play, Square, X } from 'lucide-react'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { ConsentBlock, useConsent } from '@/components/Consent'
import { TranscriptBubble, Waveform } from '@/components/Scribe'
import { Dialog, Notice, TextArea } from '@/components/ui/kit'
import { apiRequest } from '@/lib/api'
import { closeAudioSession, finishAudioSession, getScribe, saveSoap, subjectiveFields, visitPath } from '@/lib/clinical'
import { mmss } from '@/lib/format'
import type { Consultation } from '@/lib/types'

const CHUNK_MS = 5000

export function SubjectivePage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [fields, setFields] = useState<Record<string, string>>(data.note.subjective || {})
  const [summary, setSummary] = useState(data.note.subjective_summary || '')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null)
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [micMenuOpen, setMicMenuOpen] = useState(false)
  const [micButtonHovered, setMicButtonHovered] = useState(false)
  const [pendingNavigationUrl, setPendingNavigationUrl] = useState<string | null>(null)
  const [showNavBlockModal, setShowNavBlockModal] = useState(false)
  const micMenuRef = useRef<HTMLDivElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const sessionId = useRef<number | null>(null)
  const seq = useRef(0)
  const uploads = useRef<Promise<unknown>>(Promise.resolve())
  const {
    consent,
    decide: saveDecision,
    givenByName,
    setGivenByName,
    relation,
    setRelation,
    saved,
  } = useConsent(data, setError)

  // Tutup menu dropdown mikrofon saat klik di luar
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (micMenuRef.current && !micMenuRef.current.contains(event.target as Node)) {
        setMicMenuOpen(false)
      }
    }
    if (micMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [micMenuOpen])

  // Deteksi perangkat input audio (mikrofon) yang terhubung ke komputer pengguna
  useEffect(() => {
    let mounted = true

    async function updateAudioDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) return
      try {
        let deviceList = await navigator.mediaDevices.enumerateDevices()
        let audioInputs = deviceList.filter((d) => d.kind === 'audioinput')

        // Jika label masih kosong karena belum ada izin audio di browser, buka stream sementara untuk memicu izin
        const hasLabels = audioInputs.some((d) => Boolean(d.label))
        if (!hasLabels && navigator.mediaDevices.getUserMedia) {
          try {
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true })
            tempStream.getTracks().forEach((track) => track.stop())
            deviceList = await navigator.mediaDevices.enumerateDevices()
            audioInputs = deviceList.filter((d) => d.kind === 'audioinput')
          } catch {
            // Izin belum diberikan di level peramban
          }
        }

        if (!mounted) return
        setAudioDevices(audioInputs)
        if (audioInputs.length > 0) {
          setSelectedDeviceId((prev) => {
            if (prev && audioInputs.some((d) => d.deviceId === prev)) return prev
            const defaultDevice = audioInputs.find((d) => d.deviceId === 'default') || audioInputs[0]
            return defaultDevice?.deviceId || ''
          })
        }
      } catch {
        // Abaikan error enumerasi
      }
    }

    void updateAudioDevices()

    if (navigator.mediaDevices?.addEventListener) {
      const handleDeviceChange = () => { void updateAudioDevices() }
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
      return () => {
        mounted = false
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
      }
    }

    return () => { mounted = false }
  }, [])

  // Cek apakah ada sesi rekaman sebelumnya yang terputus (status masih 'recording' di server)
  const interruptedSession = data.session && (data.session.status === 'recording' || (data.session as { status: string }).status === 'interrupted')
    ? data.session
    : null

  // Alasan pengalihan draf S sesuai kondisi
  const redirectReason = (location.state as { redirectReason?: string } | null)?.redirectReason ||
    new URLSearchParams(location.search).get('alasan')

  const live = useQuery({ queryKey: ['scribe', id, 'live'], queryFn: () => getScribe(id), enabled: recording, refetchInterval: recording ? 3000 : false })

  useEffect(() => { if (!recording || paused) return; const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer) }, [recording, paused])
  useEffect(() => () => { if (recorder.current && recorder.current.state !== 'inactive') { recorder.current.ondataavailable = null; recorder.current.onstop = null; recorder.current.stop() }; stream.current?.getTracks().forEach((track) => track.stop()) }, [])

  // Peringatan saat pengguna me-refresh atau menutup tab saat perekaman berlangsung
  useEffect(() => {
    if (!recording) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = 'Perekaman audio sedang berlangsung. Meninggalkan halaman dapat memutus sesi rekaman.'
      return event.returnValue
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [recording])

  // Pencegahan navigasi internal web aplikasi (klik sidebar menu, tab antrean, dll) saat sedang merekam
  useEffect(() => {
    if (!recording) return

    function handleLinkClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest('a')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href || href === '#' || href.startsWith('javascript:')) return

      // Tahan navigasi halaman dan buka modal konfirmasi internal ComeHear
      event.preventDefault()
      event.stopPropagation()
      setPendingNavigationUrl(href)
      setShowNavBlockModal(true)
    }

    function handlePopState(event: PopStateEvent) {
      event.preventDefault()
      window.history.pushState(null, '', window.location.href)
      setPendingNavigationUrl('/kunjungan')
      setShowNavBlockModal(true)
    }

    window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', handlePopState)
    document.addEventListener('click', handleLinkClick, true)

    return () => {
      window.removeEventListener('popstate', handlePopState)
      document.removeEventListener('click', handleLinkClick, true)
    }
  }, [recording])

  function handleCancelLeave() {
    setShowNavBlockModal(false)
    setPendingNavigationUrl(null)
  }

  function handleFinishAndLeave() {
    setShowNavBlockModal(false)
    setPendingNavigationUrl(null)
    // Selesaikan perekaman secara normal: panggil stop() agar potongan audio diproses,
    // dikirim ke backend /audio-finish, dan diarahkan langsung ke halaman /draf-s
    if (recorder.current && recorder.current.state !== 'inactive') {
      recorder.current.stop()
    }
  }

  function handleDiscardAndLeave() {
    setShowNavBlockModal(false)
    const dest = pendingNavigationUrl || '/kunjungan'
    setPendingNavigationUrl(null)

    // Bersihkan recorder & audio tracks seketika tanpa diproses
    if (recorder.current && recorder.current.state !== 'inactive') {
      recorder.current.ondataavailable = null
      recorder.current.onstop = null
      recorder.current.stop()
    }
    stream.current?.getTracks().forEach((track) => track.stop())
    setActiveStream(null)
    setRecording(false)
    navigate(dest)
  }

  function decide(decision: 'setuju' | 'tolak', customGiver?: string, customRel?: string) {
    if (recording) return
    setError('')
    saveDecision(decision, customGiver, customRel)
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

  async function startRecording(continueExisting = false) {
    setError('')
    if (consent !== 'setuju') { setError('Pilih "Pasien Menyetujui Perekaman" terlebih dahulu sebelum memulai rekaman.'); return }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Browser tidak mendukung perekaman. Gunakan pencatatan manual.'); return }
    try {
      await saved()
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
      }
      let media: MediaStream
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      } catch (firstErr) {
        if (selectedDeviceId) {
          media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        } else {
          throw firstErr
        }
      }
      stream.current = media
      setActiveStream(media)
      seq.current = 0
      sessionId.current = continueExisting && interruptedSession ? interruptedSession.id : null
      uploads.current = Promise.resolve()
      const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined
      const next = new MediaRecorder(media, type ? { mimeType: type } : undefined); recorder.current = next
      next.ondataavailable = (event) => { if (event.data.size) sendChunk(event.data) }
      next.onerror = () => { setError('Rekaman terhenti. Coba lagi atau gunakan pencatatan manual.'); setActiveStream(null); setRecording(false) }
      next.onstop = async () => {
        media.getTracks().forEach((track) => track.stop()); setActiveStream(null); setRecording(false); setPaused(false); setBusy(true)
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

  async function handleFinishInterruptedSession() {
    if (!interruptedSession) return
    setBusy(true)
    setError('')
    try {
      await finishAudioSession(id, interruptedSession.id)
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      navigate(`/kunjungan/${id}/draf-s`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal menyelesaikan sesi rekaman terputus.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCloseInterruptedSession() {
    if (!interruptedSession) return
    setBusy(true)
    setError('')
    try {
      await closeAudioSession(id, interruptedSession.id)
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal menutup sesi rekaman.')
    } finally {
      setBusy(false)
    }
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

  const consentBlock = (
    <ConsentBlock
      consent={consent}
      onDecide={decide}
      disabled={recording}
      patientName={data.visit.patient.name}
      givenByName={givenByName}
      relation={relation}
      onUpdateGiver={(name, rel) => {
        setGivenByName(name)
        setRelation(rel)
      }}
    />
  )

  const transcript = live.data?.transcript || []
  const manual = consent === 'tolak'
  const currentDeviceLabel = audioDevices.find((d) => d.deviceId === selectedDeviceId)?.label ||
    (audioDevices.length > 0 ? (audioDevices[0].label || 'Mikrofon Bawaan') : 'Mikrofon Bilik 3')

  return <div className="space-y-[27px]">
    <ClinicalHeader consultation={data} stage="subjektif" patientExtra={consentBlock} />
    {redirectReason && consent !== 'setuju' && <Notice tone="info">{redirectReason}</Notice>}
    {error && <Notice tone="bad">{error}</Notice>}

    {/* Banner Pemulihan Sesi Rekaman Terputus */}
    {interruptedSession && !recording && (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-[#f0c27b] bg-[#fffaf0] p-4 text-[#7c4d0b] shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#d97706]" />
          <div>
            <p className="text-[14px] font-bold text-[#92400e]">Sesi Rekaman Sebelumnya Terputus</p>
            <p className="mt-0.5 text-[12px] text-[#78350f]">
              Terdeteksi sesi rekaman percakapan yang belum selesai diproses. Anda dapat melanjutkan perekaman, menyusun draf SOAP dari audio yang tersimpan, atau menutup sesi ini untuk mulai baru.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => startRecording(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#d97706] px-3 text-[12px] font-semibold text-white hover:bg-[#b45309] disabled:opacity-50"
          >
            <Play className="size-3 fill-current" /> Lanjutkan Rekaman
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleFinishInterruptedSession}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#d97706] bg-white px-3 text-[12px] font-semibold text-[#b45309] hover:bg-[#fff6e5] disabled:opacity-50"
          >
            <Check className="size-3" /> Selesaikan &amp; Susun Draf
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleCloseInterruptedSession}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfdbe2] bg-[#f0f4f7] px-3 text-[12px] font-semibold text-[#4b5f70] hover:bg-[#e4ecf0] disabled:opacity-50"
          >
            <X className="size-3" /> Tutup Sesi
          </button>
        </div>
      </div>
    )}

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
        {recording && !paused && <Waveform stream={activeStream} />}
        <div className="ml-auto flex flex-wrap gap-4">
          {!recording ? <>
            <div className="relative" ref={micMenuRef}>
              <button
                type="button"
                onClick={() => setMicMenuOpen((v) => !v)}
                onMouseEnter={() => setMicButtonHovered(true)}
                onMouseLeave={() => setMicButtonHovered(false)}
                title={currentDeviceLabel}
                className="inline-flex h-9 max-w-[240px] items-center gap-1.5 rounded-[8px] border border-[#dce6eb] bg-[#eef4f7] px-3 text-[14px] font-medium text-[#3d5266] hover:bg-[#e4ecf0] hover:text-ch-ink"
              >
                <ChevronDown className={`size-3.5 shrink-0 transition-transform ${micMenuOpen ? 'rotate-180' : ''}`} />
                <MarqueeText text={currentDeviceLabel} isHovered={micButtonHovered} />
              </button>

              {micMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[240px] max-w-[320px] rounded-[10px] border border-[#dce6eb] bg-white py-1.5 shadow-lg">
                  <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a9bad]">
                    Pilih Mikrofon Perangkat
                  </div>
                  {audioDevices.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[#5f7284]">Tidak ada mikrofon terdeteksi</div>
                  ) : (
                    <div className="max-h-52 overflow-y-auto">
                      {audioDevices.map((device, index) => {
                        const isSelected = selectedDeviceId === device.deviceId || (!selectedDeviceId && index === 0)
                        const label = device.label || `Mikrofon Perangkat ${index + 1}`
                        return (
                          <button
                            key={device.deviceId || index}
                            type="button"
                            onClick={() => {
                              setSelectedDeviceId(device.deviceId)
                              setMicMenuOpen(false)
                            }}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-[#f0f7f9] ${
                              isSelected ? 'bg-[#eaf6f8] font-semibold text-ch-teal' : 'text-[#3d5266]'
                            }`}
                          >
                            <MarqueeText text={label} className="pr-2" />
                            {isSelected && <Check className="size-3.5 shrink-0 text-ch-teal" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => startRecording(false)}
              className={`inline-flex h-9 items-center gap-2 rounded-[8px] px-4 text-[14px] font-semibold shadow-sm transition-all disabled:opacity-50 ${
                consent === 'setuju'
                  ? 'bg-ch-brand text-white hover:bg-ch-brand-hover ring-2 ring-ch-brand/20'
                  : 'border border-[#dce6eb] bg-[#eef4f7] text-[#3d5266] hover:border-ch-brand hover:text-ch-teal'
              }`}
            >
              <Play className="size-3 fill-current" /> Mulai Rekam
            </button>
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

    {/* Modal Peringatan Navigasi saat Perekaman Sedang Berjalan */}
    <Dialog
      open={showNavBlockModal}
      onClose={handleCancelLeave}
      title="Perekaman Sedang Berlangsung"
      width={520}
    >
      <div className="space-y-4 text-[13px] text-[#33475b]">
        <div className="flex items-start gap-3 rounded-[12px] border border-[#f5c2c7] bg-[#fdf2f2] p-3.5 text-xs text-[#9f1c24]">
          <AlertTriangle className="size-5 shrink-0 text-[#dc3545] mt-0.5" />
          <div>
            <strong className="block text-[13px] font-bold">Perekaman audio percakapan belum selesai!</strong>
            <p className="mt-1 leading-relaxed">
              Meninggalkan halaman ini saat merekam akan memutus percakapan dokter-pasien. Pilih tindakan yang ingin Anda lakukan:
            </p>
          </div>
        </div>

        <ul className="space-y-1.5 text-xs text-ch-muted">
          <li>• <b className="text-ch-ink">Tetap di Sini</b>: Melanjutkan percakapan dan perekaman dokter-pasien.</li>
          <li>• <b className="text-ch-ink">Selesaikan &amp; Susun Draf</b>: Menghentikan rekaman saat ini dan memproses audio menjadi draf Subjektif AI.</li>
          <li>• <b className="text-ch-ink">Hentikan &amp; Tinggalkan</b>: Membuang rekaman saat ini dan berpindah ke halaman tujuan.</li>
        </ul>

        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-[#e2ecf0] pt-3">
          <button
            type="button"
            onClick={handleCancelLeave}
            className="inline-flex h-9 items-center rounded-[8px] bg-ch-brand px-4 text-[13px] font-semibold text-white hover:bg-ch-brand-hover shadow-sm"
          >
            Tetap di Halaman Ini
          </button>
          <button
            type="button"
            onClick={handleFinishAndLeave}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#0b8597] bg-[#e2f6f9] px-3.5 text-[13px] font-semibold text-[#0b8597] hover:bg-[#d0f0f5]"
          >
            <Check className="size-3.5" /> Selesaikan &amp; Susun Draf
          </button>
          <button
            type="button"
            onClick={handleDiscardAndLeave}
            className="inline-flex h-9 items-center rounded-[8px] border border-[#cfdbe2] bg-[#f0f4f7] px-3.5 text-[13px] font-semibold text-[#4b5f70] hover:bg-[#e4ecf0]"
          >
            Hentikan &amp; Tinggalkan
          </button>
        </div>
      </div>
    </Dialog>
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

function MarqueeText({
  text,
  isHovered: externalHovered,
  className = '',
}: {
  text: string
  isHovered?: boolean
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [internalHovered, setInternalHovered] = useState(false)
  const [overflowDistance, setOverflowDistance] = useState(0)

  const isHovered = externalHovered ?? internalHovered

  const checkOverflow = useCallback(() => {
    if (containerRef.current && measureRef.current) {
      const containerW = containerRef.current.clientWidth
      const textW = measureRef.current.offsetWidth
      setOverflowDistance(textW > containerW ? textW - containerW : 0)
    }
  }, [])

  useEffect(() => {
    checkOverflow()
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      const ro = new ResizeObserver(() => checkOverflow())
      ro.observe(containerRef.current)
      return () => ro.disconnect()
    }
  }, [text, checkOverflow])

  const shouldAnimate = Boolean(isHovered && overflowDistance > 0)
  const duration = Math.max(2.5, Math.min(8, overflowDistance / 28))

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => {
        checkOverflow()
        setInternalHovered(true)
      }}
      onMouseLeave={() => setInternalHovered(false)}
      className={`relative flex items-center self-stretch min-w-0 flex-1 overflow-hidden whitespace-nowrap ${className}`}
    >
      <span
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 invisible whitespace-nowrap opacity-0"
      >
        {text}
      </span>
      <span
        style={
          shouldAnimate
            ? ({
                '--marquee-distance': `-${overflowDistance + 6}px`,
                '--marquee-duration': `${duration}s`,
              } as React.CSSProperties)
            : undefined
        }
        className={`block whitespace-nowrap leading-normal transition-transform ${
          shouldAnimate ? 'animate-marquee-hover' : 'max-w-full truncate'
        }`}
      >
        {text}
      </span>
    </div>
  )
}
