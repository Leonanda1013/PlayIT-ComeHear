import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { AudioLines, Check, CheckCheck, CircleCheck, ClipboardCheck, FileText, LoaderCircle, MessageSquareText, Pause, Play, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GroundedPreview } from './GroundedPreview'
import { Badge } from '@/components/ui/kit'

export function Waveform({ playing = false }: { playing?: boolean }) {
  return <div className={`lp-waveform ${playing ? 'is-playing' : ''}`} aria-hidden="true">
    {Array.from({ length: 43 }, (_, i) => <span key={i} style={{ height: `${8 + ((i * 17 + 11) % 33)}px`, animationDelay: `${i * -73}ms` }} />)}
  </div>
}

export function HeroPreview() {
  return <div className="lp-hero-visual">
    <div className="lp-visual-kicker"><span><span className="lp-live-dot" /> Dari mendengar, menjadi catatan.</span><span>Ilustrasi alur</span></div>
    <div className="lp-product-window">
      <div className="lp-window-header"><div className="lp-window-title"><AudioLines size={21} /><h2>Ruang konsultasi</h2></div><Badge>Data contoh</Badge></div>
      <div className="lp-mini-steps"><span className="active">Subjektif</span><span>Objektif</span><span>Asesmen & Plan</span><span>Validasi</span></div>
      <div className="lp-recording-static"><span className="lp-mic-icon"><AudioLines size={19} /></span><div><strong>Rekaman konsultasi</strong><span>Simulasi · tanpa akses mikrofon</span></div><Waveform /><span className="lp-timer">00:42</span></div>
      <GroundedPreview compact />
      <div className="lp-window-footer"><ShieldCheck size={15} /><span>Draf AI membantu. Dokter tetap memegang kendali.</span></div>
    </div>
    <div className="lp-visual-caption"><span className="lp-caption-icon"><CheckCheck size={20} /></span><div><strong>Terstruktur sejak percakapan</strong><span>Siap untuk ditinjau, dilengkapi, dan divalidasi.</span></div></div>
  </div>
}

const tabs = [
  { label: 'Transkrip & Subjektif', icon: MessageSquareText, description: 'Draf dilengkapi sitasi transkrip (grounding) dan peringatan informasi ambigu. Pilih sitasi untuk melihat sumber, lalu dokter memeriksa draf.' },
  { label: 'Tinjauan SOAP', icon: ClipboardCheck, description: 'SOAP adalah Subjektif, Objektif, Asesmen, dan Plan. Dokter melengkapi O, A, P serta memvalidasi seluruh dokumentasi.' },
  { label: 'Pemantauan Pengiriman', icon: Send, description: 'Status kunjungan dan status pengiriman dipantau terpisah. Pengiriman mengikuti persetujuan dokter dan konfigurasi integrasi.' },
]

export function ProductDemo() {
  const [tab, setTab] = useState(0)
  const [playState, setPlayState] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle')
  const [seconds, setSeconds] = useState(0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (playState !== 'loading') return
    const timeout = window.setTimeout(() => setPlayState('playing'), 650)
    return () => window.clearTimeout(timeout)
  }, [playState])

  useEffect(() => {
    if (playState !== 'playing') return
    if (seconds >= 42) { setPlayState('paused'); return }
    const interval = window.setInterval(() => setSeconds(value => Math.min(value + 1, 42)), 1000)
    return () => window.clearInterval(interval)
  }, [playState, seconds])

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault(); setTab(next); setPlayState('paused'); tabRefs.current[next]?.focus()
  }

  function togglePlayback() {
    if (playState === 'playing') { setPlayState('paused'); return }
    if (seconds === 42) setSeconds(0)
    setPlayState('loading')
  }

  return <div className="lp-demo">
    <div className="lp-demo-tabs" role="tablist" aria-label="Preview alur ComeHear">
      {tabs.map(({ label, icon: Icon }, index) => <button key={label} type="button" role="tab" id={`demo-tab-${index}`} aria-selected={tab === index} aria-controls={`demo-panel-${index}`} tabIndex={tab === index ? 0 : -1} ref={node => { tabRefs.current[index] = node }} onKeyDown={event => onTabKey(event, index)} onClick={() => { setTab(index); setPlayState('paused') }}><Icon size={18} />{label}</button>)}
    </div>
    {tabs.map(({ description }, index) => <div key={index} id={`demo-panel-${index}`} role="tabpanel" aria-labelledby={`demo-tab-${index}`} aria-hidden={tab !== index} inert={tab !== index} data-active={tab === index} tabIndex={tab === index ? 0 : -1} className="lp-demo-panel">
      <div className="lp-demo-context"><span><FileText size={17} /> Kunjungan DEMO-001 · Poli Umum</span><div><Badge>Data sintetis</Badge><Badge tone="info">{index === 2 ? 'Sandbox · simulasi' : 'Ilustrasi alur'}</Badge></div></div>
      <div className="lp-demo-body" tabIndex={tab === index ? 0 : -1} role="region" aria-label={`Isi preview ${tabs[index].label}`}>
      {index === 0 && <>
        <div className="lp-demo-player"><Button type="button" className="lp-button lp-play-button" onClick={togglePlayback} disabled={playState === 'loading'} aria-pressed={playState === 'playing'}>
          {playState === 'loading' ? <LoaderCircle className="lp-spinner" /> : playState === 'playing' ? <Pause /> : <Play />}
          {playState === 'loading' ? 'Menyiapkan…' : playState === 'playing' ? 'Jeda simulasi' : seconds === 42 ? 'Ulangi simulasi' : 'Putar simulasi'}
        </Button><Waveform playing={playState === 'playing'} /><span className="lp-timer">00:{String(seconds).padStart(2, '0')} / 00:42</span></div>
        <p className="lp-simulation-note" role="status">{playState === 'playing' ? 'Simulasi visual berjalan. Tanpa audio atau akses mikrofon.' : 'Preview memakai contoh yang telah disiapkan. Tanpa audio atau akses mikrofon.'}</p>
        <GroundedPreview />
      </>}
      {index === 1 && <div className="lp-soap-demo">
        <div className="lp-soap-summary"><h3>Tinjauan dokumentasi</h3><Badge tone="warn">Menunggu validasi dokter</Badge></div>
        <div className="lp-soap-row"><span>S</span><div><h4>Subjektif <Badge tone="info">Draf AI · Grounded</Badge></h4><p>Batuk disertai tenggorokan tidak nyaman. Demam dan sesak disangkal. Belum minum obat.</p><p className="lp-soap-warning">Perlu dicek: durasi “tiga hari” dan “seminggu” pada sitasi [1], [3] belum konsisten. Dokter perlu mengonfirmasi sebelum finalisasi.</p></div></div>
        <div className="lp-soap-row"><span>O</span><div><h4>Objektif <small>Contoh isian dokter</small></h4><p>Keadaan umum baik. Suhu 36,7 °C. Frekuensi napas 18 kali/menit.</p></div></div>
        <div className="lp-soap-row"><span>A</span><div><h4>Asesmen <small>Keputusan dokter</small></h4><p>Usulan ICD-10: <strong>R05 — Batuk</strong>. Kode dari klasifikasi penyakit internasional ini perlu ditinjau dokter.</p></div></div>
        <div className="lp-soap-row"><span>P</span><div><h4>Plan <small>Contoh isian dokter</small></h4><p>Rencana tindak lanjut dan edukasi diisi dokter sesuai hasil pemeriksaan.</p></div></div>
        <div className="lp-review-hint"><ShieldCheck size={18} />Contoh ini belum difinalisasi dan belum dikirim.</div>
      </div>}
      {index === 2 && <div className="lp-shipping-demo">
        <div className="lp-shipping-heading"><span className="lp-feature-icon"><Send /></span><div><h3>Pemantauan SATUSEHAT</h3><p>Lingkungan uji integrasi · bukan layanan produksi</p></div></div>
        <div className="lp-status-grid"><div><span>Status kunjungan</span><Badge tone="ok">Selesai</Badge></div><div><span>Dokumentasi SOAP</span><Badge tone="ok">Divalidasi dokter</Badge></div><div><span>Pengiriman SATUSEHAT</span><Badge tone="warn">Dalam proses</Badge></div></div>
        <ol className="lp-shipping-timeline"><li><CircleCheck /><div><strong>Dokter memvalidasi dokumentasi</strong><span>SOAP difinalisasi setelah pemeriksaan.</span></div></li><li><CircleCheck /><div><strong>Masuk antrean pengiriman</strong><span>Mengikuti persetujuan dan konfigurasi integrasi.</span></div></li><li><LoaderCircle /><div><strong>Menunggu hasil pengiriman</strong><span>Kunjungan selesai belum berarti data berhasil terkirim.</span></div></li></ol>
        <p className="lp-sandbox-note"><ShieldCheck size={18} />Seluruh status adalah simulasi prototipe. Tidak ada data yang dikirim dari demo ini.</p>
      </div>}
      </div>
      <p className="lp-demo-scroll-hint">Gulir di dalam preview untuk melihat seluruh isi.</p>
      <p className="lp-demo-explanation"><Check size={17} />{description}</p>
    </div>)}
  </div>
}
