import { useState } from 'react'
import { ArrowLeft, ArrowRight, AudioLines, Check, CheckCheck, ClipboardCheck, FileText, Mic, Play, ShieldCheck, Users } from 'lucide-react'
import { Waveform } from './ProductPreview'

const moments = [
  { quote: '“Batuk sejak tiga hari yang lalu, Dok. Tenggorokan juga terasa tidak nyaman.”', label: 'Keluhan utama', note: 'Batuk sejak tiga hari, disertai rasa tidak nyaman di tenggorokan.', source: '00:12 · Pasien', tag: 'Draf Subjektif' },
  { quote: '“Tidak ada demam atau sesak, Dok.”', label: 'Gejala penyerta', note: 'Pasien menyangkal demam dan sesak napas.', source: '00:31 · Pasien', tag: 'Bukti percakapan' },
  { quote: '“Belum minum obat untuk keluhan ini.”', label: 'Riwayat pengobatan', note: 'Belum mengonsumsi obat untuk keluhan saat ini.', source: '00:40 · Pasien', tag: 'Siap ditinjau' },
]

export function ListeningPreview() {
  const [selected, setSelected] = useState(0)
  const moment = moments[selected]
  return <div className="listen-preview">
    <div className="listen-top"><span><AudioLines size={19} /> COMEHEAR / RUANG KONSULTASI</span><span className="listen-status">Data contoh</span></div>
    <div className="listen-session"><div><span className="listen-avatar"><Mic size={22} /></span><div><strong>Ruang untuk mendengar.</strong><small>Poli umum · Kunjungan DEMO-001</small></div></div><span className="listen-time">00:42</span></div>
    <div className="listen-wave"><Waveform playing /><span>PERCAKAPAN → CATATAN</span></div>
    <div className="listen-excerpt" aria-live="polite"><span className="listen-label">{moment.source}</span><blockquote>{moment.quote}</blockquote></div>
    <div className="listen-result" aria-live="polite"><div><span><FileText size={15} />{moment.tag}</span><CheckCheck size={17} /></div><span className="listen-label">{moment.label}</span><p>{moment.note}</p><small><ShieldCheck size={13} /> Dokter meninjau sebelum finalisasi.</small></div>
    <div className="listen-bottom"><span>Coba pilih potongan percakapan</span><div>{moments.map((_, i) => <button type="button" key={i} aria-label={`Lihat contoh percakapan ${i + 1}`} aria-pressed={selected === i} onClick={() => setSelected(i)}>0{i + 1}</button>)}</div></div>
  </div>
}

const journey = [
  { icon: Users, actor: 'PETUGAS REKAM MEDIS', title: 'Mulai dari satu kunjungan.', text: 'Siapkan data pasien dan antrean. Dokter mendapat konteks kunjungan sebelum konsultasi dimulai.', status: 'Menunggu pemeriksaan', rows: [['Nomor antrean', 'A-001'], ['Pasien', 'Pasien Contoh'], ['Poliklinik', 'Poli Umum'], ['Status kunjungan', 'Terdaftar']], action: 'Kunjungan siap untuk dokter', name: 'Daftarkan' },
  { icon: Mic, actor: 'DOKTER & PASIEN', title: 'Beri percakapan ruang.', text: 'Dengan persetujuan pasien, rekaman membantu menyusun transkrip dan draf Subjektif. Pengisian manual tetap tersedia.', status: 'Contoh konsultasi', rows: [['Persetujuan pasien', 'Dikonfirmasi'], ['Sumber catatan', 'Transkrip percakapan'], ['Keluaran AI', 'Draf Subjektif'], ['Alternatif', 'Pengisian manual']], action: 'Draf siap diperiksa', name: 'Dengarkan' },
  { icon: ClipboardCheck, actor: 'DOKTER', title: 'Tinjau dengan konteks.', text: 'Telusuri sitasi ke percakapan asal. Perbaiki draf, tinjau usulan ICD-10, lalu lengkapi Objektif, Asesmen, dan Plan.', status: 'Menunggu tinjauan', rows: [['Subjektif', 'Draf AI + sitasi'], ['Objektif', 'Diisi dokter'], ['Asesmen & Plan', 'Keputusan dokter'], ['Usulan ICD-10', 'Perlu ditinjau']], action: 'Dokter melengkapi dokumentasi', name: 'Tinjau' },
  { icon: ShieldCheck, actor: 'DOKTER & PETUGAS', title: 'Tutup dengan kepastian.', text: 'Dokter memvalidasi dokumentasi. Pantau pengiriman secara terpisah agar kunjungan selesai tidak disamakan dengan data terkirim.', status: 'Simulasi sandbox', rows: [['Dokumentasi SOAP', 'Divalidasi dokter'], ['Status kunjungan', 'Selesai'], ['Pengiriman SATUSEHAT', 'Dalam proses'], ['Lingkungan integrasi', 'Sandbox']], action: 'Status pengiriman dapat dipantau', name: 'Validasi' },
]

export function CareJourney() {
  const [step, setStep] = useState(0)
  const current = journey[step]
  return <div className="care-journey">
    <div className="journey-selector" role="group" aria-label="Pilih tahap pelayanan">{journey.map(({ name, icon: Icon }, i) => <button type="button" key={name} aria-pressed={step === i} onClick={() => setStep(i)}><span>0{i + 1}</span><Icon size={19} /><strong>{name}</strong><ArrowRight size={15} /></button>)}</div>
    <div className="journey-stage" aria-live="polite">
      <div className="journey-story" key={`story-${step}`}><span className="journey-count">0{step + 1}<small> / 04</small></span><p className="lp-section-label">{current.actor}</p><h3>{current.title}</h3><p>{current.text}</p><div className="journey-controls"><button type="button" disabled={step === 0} aria-label="Tahap sebelumnya" onClick={() => setStep(step - 1)}><ArrowLeft size={19} /></button><button type="button" disabled={step === 3} aria-label="Tahap berikutnya" onClick={() => setStep(step + 1)}><ArrowRight size={19} /></button><span>Pilih tahap untuk menjelajahi alurnya</span></div></div>
      <div className="journey-record" key={`record-${step}`}><div className="journey-record-top"><span><current.icon size={21} /> Kunjungan DEMO-001</span><span>DATA SINTETIS</span></div><div className="journey-record-status"><span className="lp-live-dot" />{current.status}</div><dl>{current.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="journey-record-foot"><Check size={16} />{current.action}</div></div>
    </div>
  </div>
}

export function FilmSection() {
  const [started, setStarted] = useState(false)
  return <section className="film-section" aria-labelledby="film-title"><div className="lp-container"><div className="film-heading"><div><p className="lp-section-label">DI BALIK SETIAP CATATAN, ADA MANUSIA.</p><h2 id="film-title">Hadir sepenuhnya.<br /><span>Mulai dengan mendengar.</span></h2></div><p>Kenali cerita ComeHear dan cara kami membantu dokumentasi konsultasi.</p></div><div className={`film-player ${started ? 'is-started' : ''}`}><video controls={started} preload="none" playsInline aria-label="Video pengenalan ComeHear" onPlay={() => setStarted(true)} src={`${import.meta.env.BASE_URL}ComeHear-promo-landscape-v4.mp4`} />{!started && <button type="button" className="film-cover" onClick={event => { const video = event.currentTarget.parentElement?.querySelector('video'); if (video) { setStarted(true); void video.play().catch(() => setStarted(false)) } }}><span className="film-cover-label">COMEHEAR ORIGINAL</span><AudioLines className="film-symbol" size={70} /><strong>Setiap cerita<br />layak didengar.</strong><span className="film-play"><Play size={19} fill="currentColor" /> Putar cerita ComeHear</span><span className="film-cover-foot">AI MEDICAL SCRIBE<span>OLEH PENGUASALIMIT ↗</span></span></button>}</div></div></section>
}
