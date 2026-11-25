import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, AudioLines, Check, ChevronDown, ClipboardCheck, FileClock, FileText, HeartHandshake, ListChecks, Menu, MessageSquareText, Mic, Network, Play, Send, ShieldCheck, Sparkles, Stethoscope, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HeroPreview, ProductDemo, Waveform } from '@/components/landing/ProductPreview'
import './landing.css'

const navigation = [['Fitur', '#fitur'], ['Cara Kerja', '#cara-kerja'], ['Untuk Siapa', '#untuk-siapa'], ['FAQ', '#faq']] as const
const features = [
  { icon: FileText, title: 'Usulan kode ICD-10', text: 'Dukungan pencarian kode diagnosis dalam Klasifikasi Penyakit Internasional (ICD-10). Dokter meninjau usulan dan menetapkan pilihan akhir.', detail: 'Usulan AI · keputusan dokter' },
  { icon: ListChecks, title: 'Alur SOAP terstruktur', text: 'Subjektif, Objektif, Asesmen, dan Plan (SOAP) tersusun berurutan. Dokter melengkapi catatan dan memvalidasi hasilnya.', detail: 'S → O → A → P → Validasi' },
  { icon: Users, title: 'Pendaftaran & antrean', text: 'Dari menyiapkan kunjungan hingga memanggil pasien, petugas dan dokter dapat mengikuti alur pelayanan.', detail: 'Terdaftar · Menunggu · Diperiksa' },
  { icon: FileClock, title: 'Riwayat & resume kunjungan', text: 'Telusuri dokumentasi kunjungan sebelumnya dan baca kembali ringkasan yang sudah divalidasi dokter.', detail: 'Konteks kunjungan tetap terhubung' },
  { icon: Send, title: 'Pemantauan SATUSEHAT', text: 'Lihat status pengiriman dan kendala yang perlu ditindaklanjuti. Integrasi pada prototipe menggunakan lingkungan uji (sandbox).', detail: 'Status pengiriman terpisah dari kunjungan' },
]
const steps = [
  { icon: Users, title: 'Daftarkan kunjungan', text: 'Petugas menyiapkan data pasien dan antrean.' },
  { icon: Mic, title: 'Catat konsultasi', text: 'Rekam dengan persetujuan pasien, atau lanjutkan pengisian manual.' },
  { icon: ClipboardCheck, title: 'Tinjau & lengkapi SOAP', text: 'Dokter memeriksa draf Subjektif dan usulan ICD-10, lalu mengisi O, A, dan P.' },
  { icon: ShieldCheck, title: 'Validasi & pantau', text: 'Dokter memfinalisasi dokumentasi. Petugas memantau pengiriman sesuai konfigurasi integrasi.' },
]
const faqs = [
  ['Apa yang dibantu AI di ComeHear?', 'AI mengolah rekaman percakapan konsultasi menjadi transkrip dan draf Subjektif, serta memberikan usulan kode ICD-10 untuk ditinjau dokter.'],
  ['Apakah AI membuat seluruh SOAP secara otomatis?', 'Tidak. AI membantu menyusun draf Subjektif dan usulan kode ICD-10. Dokter mengisi Objektif, Asesmen, dan Plan, memeriksa draf, serta memvalidasi seluruh dokumentasi.'],
  ['Apakah pasien harus menyetujui perekaman?', 'Ya, perekaman dilakukan setelah persetujuan pasien. Jika pasien menolak perekaman, dokter dapat melanjutkan dengan pengisian manual.'],
  ['Siapa yang memvalidasi hasil dokumentasi?', 'Dokter memeriksa dan memperbaiki draf AI, melengkapi SOAP, lalu memfinalisasi dokumentasi. Keputusan klinis tetap berada pada dokter.'],
  ['Apa perbedaan kunjungan selesai dan data terkirim?', 'Kunjungan selesai menandakan alur pelayanan telah diselesaikan. Data terkirim menandakan pengiriman ke SATUSEHAT berhasil. Status ini terpisah; kunjungan yang selesai masih dapat menunggu pengiriman atau memerlukan tindak lanjut.'],
  ['Bagaimana status integrasi SATUSEHAT pada demo?', 'ComeHear masih berupa prototipe. Integrasi menggunakan lingkungan uji (sandbox), bukan integrasi produksi tersertifikasi. Preview di halaman ini hanya simulasi dengan data sintetis dan tidak mengirim data.'],
]

function DemoLink({ secondary = false, children = 'Lihat Demo' }: { secondary?: boolean; children?: React.ReactNode }) {
  return <Button asChild className={`lp-button ${secondary ? 'lp-button-secondary' : 'lp-button-primary'}`}><a href="#demo">{!secondary && <Play size={17} />}{children}{!secondary && <ArrowRight className="lp-button-arrow" size={17} />}</a></Button>
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const pageRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'ComeHear — AI Medical Scribe untuk alur kerja klinik'
    document.documentElement.classList.add('comehear-landing')
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true })
    // Add animation only on entry: content stays visible without JS or observer support.
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('lp-revealed'); observer?.unobserve(entry.target) }
      })
    }, { threshold: 0.08 })
    pageRef.current?.querySelectorAll('[data-reveal]').forEach(node => observer?.observe(node))
    return () => { document.title = previousTitle; document.documentElement.classList.remove('comehear-landing'); window.removeEventListener('scroll', onScroll); observer?.disconnect() }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuRef.current?.focus() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return <div className="lp" ref={pageRef}>
    <a className="lp-skip-link" href="#konten">Lewati ke konten utama</a>
    <header className={`lp-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="lp-container lp-nav">
        <a href="#beranda" className="lp-logo-link" aria-label="ComeHear, kembali ke beranda"><img src="/comehear-logo.png" alt="ComeHear — AI Medical Scribe" width="210" height="50" /></a>
        <button className="lp-menu-toggle" type="button" ref={menuRef} aria-label={menuOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi'} aria-expanded={menuOpen} aria-controls="landing-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        <nav id="landing-nav" className={`lp-nav-links ${menuOpen ? 'is-open' : ''}`} aria-label="Navigasi utama" onClick={event => { if ((event.target as HTMLElement).closest('a')) setMenuOpen(false) }}>
          {navigation.map(([label, href]) => <a key={href} href={href} className="lp-nav-link">{label}</a>)}
          <span className="lp-nav-divider" /><Link className="lp-nav-link lp-login-link" to="/login">Masuk</Link><DemoLink />
        </nav>
      </div>
    </header>

    <main id="konten">
      <section className="lp-hero" id="beranda" aria-labelledby="hero-title">
        <div className="lp-container lp-hero-grid">
          <div className="lp-hero-copy">
            <div className="lp-eyebrow"><AudioLines size={17} /> AI Medical Scribe untuk alur kerja klinik</div>
            <h1 id="hero-title">Lebih fokus<br className="lp-desktop-break" /> mendengar pasien.<span>Lebih terarah mencatat konsultasi.</span></h1>
            <p className="lp-hero-description">ComeHear membantu mengubah percakapan konsultasi menjadi draf Subjektif dan usulan kode ICD-10, untuk ditinjau dokter dalam alur dokumentasi SOAP.</p>
            <div className="lp-actions"><DemoLink /><Button asChild className="lp-button lp-button-secondary"><a href="#cara-kerja">Pelajari Cara Kerja <ArrowRight className="lp-button-arrow" size={17} /></a></Button></div>
            <p className="lp-hero-microcopy"><ShieldCheck size={17} />Draf AI ditinjau dokter sebelum rekam medis difinalisasi.</p>
          </div>
          <HeroPreview />
        </div>
        <div className="lp-container"><div className="lp-value-strip">
          {[{ icon: MessageSquareText, text: 'Percakapan menjadi draf Subjektif' }, { icon: ClipboardCheck, text: 'Dokumentasi ditinjau dokter' }, { icon: Network, text: 'Alur kunjungan dan pengiriman dapat dipantau' }].map(({ icon: Icon, text }) => <div key={text}><Icon size={23} /><span>{text}</span></div>)}
        </div></div>
      </section>

      <section className="lp-section lp-problem" aria-labelledby="problem-title">
        <div className="lp-container lp-problem-grid" data-reveal>
          <div><p className="lp-section-label">LEBIH HADIR DALAM KONSULTASI</p><h2 id="problem-title">Saat konsultasi berjalan, dokumentasi juga perlu tertata.</h2><p>Setiap percakapan membawa informasi penting. ComeHear membantu menatanya, agar dokter dapat memberi perhatian pada pasien.</p></div>
          <div className="lp-problem-list">
            {[{ icon: HeartHandshake, title: 'Mendengar sambil mencatat', text: 'Perhatian dapat terbagi antara percakapan dengan pasien dan kebutuhan dokumentasi.' }, { icon: FileText, title: 'Menyusun informasi yang beragam', text: 'Cerita pasien perlu dirangkai menjadi catatan yang terstruktur dan mudah ditinjau.' }, { icon: Network, title: 'Menjaga koordinasi antarperan', text: 'Status dokumentasi dan pengiriman perlu terlihat oleh petugas yang menanganinya.' }].map(({ icon: Icon, title, text }) => <div key={title}><span className="lp-line-icon"><Icon /></span><div><h3>{title}</h3><p>{text}</p></div></div>)}
          </div>
        </div>
      </section>

      <section id="fitur" className="lp-section lp-features" aria-labelledby="features-title">
        <div className="lp-container">
          <div className="lp-section-heading" data-reveal><p className="lp-section-label">TERHUBUNG DI SETIAP TAHAP</p><h2 id="features-title">Dukungan dari percakapan<br />hingga dokumentasi.</h2><p>Satu alur untuk mendengar, menyusun, meninjau, dan memantau.</p></div>
          <div className="lp-feature-grid" data-reveal>
            <article className="lp-feature-card lp-featured"><span className="lp-feature-icon"><AudioLines /></span><span className="lp-small-label">AI SCRIBE</span><h3>Transkrip dan<br />draf Subjektif</h3><p>Membantu menyusun informasi dari percakapan konsultasi menjadi draf yang dapat ditinjau dan diperbaiki dokter.</p><div className="lp-feature-mini"><div><MessageSquareText size={17} /><span>Percakapan konsultasi</span></div><div className="lp-mini-wave"><Waveform /></div><div><Sparkles size={17} /><strong>Draf Subjektif</strong><Check size={16} /></div></div><a href="#demo" className="lp-text-link">Lihat gambaran alurnya <ArrowRight size={17} /></a></article>
            {features.map(({ icon: Icon, title, text, detail }) => <article key={title} className="lp-feature-card"><span className="lp-feature-icon"><Icon /></span><h3>{title}</h3><p>{text}</p><div className="lp-feature-detail">{detail}</div></article>)}
          </div>
        </div>
      </section>

      <section id="cara-kerja" className="lp-section lp-workflow" aria-labelledby="workflow-title"><div className="lp-container">
        <div className="lp-section-heading" data-reveal><p className="lp-section-label">CARA KERJA</p><h2 id="workflow-title">Alur yang mengikuti<br />proses pelayanan.</h2><p>Dari kunjungan pertama dicatat hingga dokumentasi ditinjau.</p></div>
        <ol className="lp-steps" data-reveal>{steps.map(({ icon: Icon, title, text }, index) => <li key={title}><div className="lp-step-top"><span className="lp-step-icon"><Icon size={25} /></span><span className="lp-step-number">0{index + 1}</span></div><h3>{title}</h3><p>{text}</p></li>)}</ol>
      </div></section>

      <section id="demo" className="lp-section lp-preview-section" aria-labelledby="demo-title"><div className="lp-container">
        <div className="lp-section-heading" data-reveal><p className="lp-section-label">JELAJAHI PRODUK</p><h2 id="demo-title">Lihat bagaimana informasi tersusun.</h2><p>Pilih tampilan untuk mengenali alurnya. Seluruh isi menggunakan data sintetis.</p></div>
        <ProductDemo />
        <p className="lp-demo-footnote">Prototipe ComeHear · Ilustrasi antarmuka · Tanpa data pasien asli</p>
      </div></section>

      <section id="untuk-siapa" className="lp-section lp-roles" aria-labelledby="roles-title"><div className="lp-container">
        <div className="lp-section-heading" data-reveal><p className="lp-section-label">UNTUK TIM PELAYANAN ANDA</p><h2 id="roles-title">Terhubung dalam satu alur pelayanan.</h2><p>Setiap peran mendapat konteks untuk menjalankan bagiannya.</p></div>
        <div className="lp-role-grid" data-reveal>{[
          { icon: Stethoscope, label: 'Untuk dokter', title: 'Dengarkan. Tinjau. Putuskan.', text: 'Dukungan pencatatan konsultasi dengan kendali penuh atas peninjauan, keputusan klinis, dan finalisasi dokumentasi.', tags: ['Draf Subjektif', 'Tinjauan SOAP', 'Validasi'] },
          { icon: ClipboardCheck, label: 'Untuk petugas rekam medis', title: 'Alur administrasi yang terarah.', text: 'Kelola pendaftaran, telusuri riwayat kunjungan, dan pantau status pengiriman untuk menindaklanjuti kendala.', tags: ['Pendaftaran', 'Riwayat', 'Pengiriman'] },
          { icon: Network, label: 'Untuk pengelola klinik', title: 'Koordinasi dengan konteks.', text: 'Dapatkan gambaran alur kunjungan dan dukung koordinasi antarperan dalam proses pelayanan sehari-hari.', tags: ['Alur kunjungan', 'Koordinasi tim'] },
        ].map(({ icon: Icon, label, title, text, tags }) => <article className="lp-role-card" key={label}><Icon size={29} /><p className="lp-role-label">{label}</p><h3>{title}</h3><p>{text}</p><div className="lp-role-tags">{tags.map(tag => <span key={tag}>{tag}</span>)}</div></article>)}</div>
      </div></section>

      <section className="lp-section lp-control-section" aria-labelledby="control-title"><div className="lp-container"><div className="lp-control-panel" data-reveal>
        <div><span className="lp-control-icon"><ShieldCheck size={33} /></span><p className="lp-section-label">KENDALI TETAP PADA DOKTER</p><h2 id="control-title">Draf dari AI.<br />Validasi oleh dokter.</h2><p>Teknologi membantu menyusun catatan. Peninjauan dan keputusan klinis tetap menjadi bagian dokter.</p></div>
        <ul>{['Perekaman dilakukan setelah persetujuan pasien.', 'Pengisian manual tersedia jika perekaman ditolak.', 'Draf AI dapat diperiksa dan diperbaiki.', 'Finalisasi dokumentasi dilakukan oleh dokter.', 'Akses dan tindakan mengikuti peran pengguna.'].map(text => <li key={text}><span><Check size={17} /></span>{text}</li>)}</ul>
      </div></div></section>

      <section id="faq" className="lp-section lp-faq-section" aria-labelledby="faq-title"><div className="lp-container lp-faq-grid">
        <div data-reveal><p className="lp-section-label">PERTANYAAN UMUM</p><h2 id="faq-title">Kenali ComeHear<br />lebih dekat.</h2><p>Beberapa hal yang perlu diketahui sebelum menjelajahi demo.</p><span className="lp-prototype-label"><Sparkles size={16} /> Saat ini dalam tahap prototipe</span></div>
        <div className="lp-faq-list">{faqs.map(([question, answer], index) => <div className="lp-faq-item" key={question}><h3><button type="button" id={`faq-question-${index}`} aria-expanded={openFaq === index} aria-controls={`faq-answer-${index}`} onClick={() => setOpenFaq(openFaq === index ? null : index)}>{question}<ChevronDown size={19} /></button></h3><div id={`faq-answer-${index}`} role="region" aria-labelledby={`faq-question-${index}`} className={`lp-faq-answer ${openFaq === index ? 'is-open' : ''}`} inert={openFaq !== index}><div><p>{answer}</p></div></div></div>)}</div>
      </div></section>

      <section className="lp-final-section" aria-labelledby="final-title"><div className="lp-container"><div className="lp-final-panel" data-reveal>
        <div className="lp-final-wave" aria-hidden="true"><Waveform /><Waveform /></div><span className="lp-final-mark"><AudioLines size={32} /></span><p className="lp-section-label">MULAI DENGAN MENGENALI ALURNYA</p><h2 id="final-title">Kenali alur dokumentasi ComeHear.</h2><p>Jelajahi bagaimana percakapan, draf Subjektif, dan peninjauan dokter terhubung dalam satu alur.</p><div className="lp-actions"><DemoLink /><Button asChild className="lp-button lp-button-secondary"><Link to="/login">Masuk ke Aplikasi <ArrowRight className="lp-button-arrow" size={17} /></Link></Button></div>
      </div></div></section>
    </main>

    <footer className="lp-footer"><div className="lp-container"><div className="lp-footer-main"><div><a href="#beranda" className="lp-logo-link" aria-label="ComeHear, kembali ke beranda"><img src="/comehear-logo.png" alt="ComeHear — AI Medical Scribe" width="210" height="50" loading="lazy" /></a><p>AI Medical Scribe untuk mendukung<br />dokumentasi konsultasi.</p></div><nav aria-label="Navigasi footer">{navigation.map(([label, href]) => <a href={href} key={href}>{label}</a>)}<Link to="/login">Masuk ke Aplikasi</Link></nav></div><div className="lp-footer-bottom"><span>© {new Date().getFullYear()} ComeHear.</span><span>Prototipe untuk demonstrasi · Integrasi SATUSEHAT dalam lingkungan uji.</span></div></div></footer>
  </div>
}
