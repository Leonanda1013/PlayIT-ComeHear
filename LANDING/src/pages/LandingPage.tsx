import { useEffect, useRef, useState } from 'react'
import { ArrowRight, AudioLines, Check, ChevronDown, ClipboardCheck, FileClock, FileText, HeartHandshake, ListChecks, LogIn, Mail, Menu, MessageSquareText, Network, Play, Send, ShieldCheck, Sparkles, Stethoscope, Users, X } from 'lucide-react'
import { ProductDemo, Waveform } from '@/components/landing/ProductPreview'
import { CareJourney, FilmSection, ListeningPreview } from '@/components/landing/Experience'
import './landing.css'
import './experience.css'

const navigation = [['Fitur', '#fitur'], ['Cara Kerja', '#cara-kerja'], ['Untuk Siapa', '#untuk-siapa'], ['FAQ', '#faq']] as const
const contactEmail = 'penguasalimit@gmail.com'
const contactHref = `mailto:${contactEmail}`
const logoUrl = `${import.meta.env.BASE_URL}comehear-logo.png`
// Aplikasi klinis disajikan di domain yang sama (/login); bisa diganti lewat VITE_APP_LOGIN_URL.
const loginHref = import.meta.env.VITE_APP_LOGIN_URL || '/login'
const features = [
  { icon: FileText, title: 'Usulan kode ICD-10', text: 'Dukungan pencarian kode diagnosis dalam Klasifikasi Penyakit Internasional (ICD-10). Dokter meninjau usulan dan menetapkan pilihan akhir.', detail: 'Usulan AI · keputusan dokter' },
  { icon: ListChecks, title: 'Alur SOAP terstruktur', text: 'Subjektif, Objektif, Asesmen, dan Plan (SOAP) tersusun berurutan. Dokter melengkapi catatan dan memvalidasi hasilnya.', detail: 'S → O → A → P → Validasi' },
  { icon: Users, title: 'Pendaftaran & antrean', text: 'Dari menyiapkan kunjungan hingga memanggil pasien, petugas dan dokter dapat mengikuti alur pelayanan.', detail: 'Terdaftar · Menunggu · Diperiksa' },
  { icon: FileClock, title: 'Riwayat & resume kunjungan', text: 'Telusuri dokumentasi kunjungan sebelumnya dan baca kembali ringkasan yang sudah divalidasi dokter.', detail: 'Konteks kunjungan tetap terhubung' },
  { icon: Send, title: 'Pemantauan SATUSEHAT', text: 'Lihat status pengiriman dan kendala yang perlu ditindaklanjuti. Integrasi pada prototipe menggunakan lingkungan uji (sandbox).', detail: 'Status pengiriman terpisah dari kunjungan' },
]
const faqs = [
  ['Apa yang dibantu AI di ComeHear?', 'AI mengolah rekaman percakapan konsultasi menjadi transkrip dan draf Subjektif, serta memberikan usulan kode ICD-10 untuk ditinjau dokter.'],
  ['Apakah AI membuat seluruh SOAP secara otomatis?', 'Tidak. AI membantu menyusun draf Subjektif dan usulan kode ICD-10. Dokter mengisi Objektif, Asesmen, dan Plan, memeriksa draf, serta memvalidasi seluruh dokumentasi.'],
  ['Apakah pasien harus menyetujui perekaman?', 'Ya, perekaman dilakukan setelah persetujuan pasien. Jika pasien menolak perekaman, dokter dapat melanjutkan dengan pengisian manual.'],
  ['Siapa yang memvalidasi hasil dokumentasi?', 'Dokter memeriksa dan memperbaiki draf AI, melengkapi SOAP, lalu memfinalisasi dokumentasi. Keputusan klinis tetap berada pada dokter.'],
  ['Apa perbedaan kunjungan selesai dan data terkirim?', 'Kunjungan selesai menandakan alur pelayanan telah diselesaikan. Data terkirim menandakan pengiriman ke SATUSEHAT berhasil. Status ini terpisah; kunjungan yang selesai masih dapat menunggu pengiriman atau memerlukan tindak lanjut.'],
  ['Bagaimana status integrasi SATUSEHAT pada demo?', 'ComeHear masih berupa prototipe. Integrasi menggunakan lingkungan uji (sandbox), bukan integrasi produksi tersertifikasi. Preview di halaman ini hanya simulasi dengan data sintetis dan tidak mengirim data.'],
]

function ContactLink() {
  return <a href={contactHref} className="lp-button lp-button-primary"><Mail size={17} />Hubungi Kami<ArrowRight className="lp-button-arrow" size={17} /></a>
}

function LoginLink() {
  return <a href={loginHref} className="lp-button lp-button-secondary"><LogIn size={17} />Masuk</a>
}

function DemoLink() {
  return <a href="#demo" className="lp-button lp-button-secondary"><Play size={17} />Lihat Demo</a>
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
        <a href="#beranda" className="lp-logo-link" aria-label="ComeHear, kembali ke beranda"><img src={logoUrl} alt="ComeHear — AI Medical Scribe" width="210" height="50" /></a>
        <button className="lp-menu-toggle" type="button" ref={menuRef} aria-label={menuOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi'} aria-expanded={menuOpen} aria-controls="landing-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        <nav id="landing-nav" className={`lp-nav-links ${menuOpen ? 'is-open' : ''}`} aria-label="Navigasi utama" onClick={event => { if ((event.target as HTMLElement).closest('a')) setMenuOpen(false) }}>
          {navigation.map(([label, href]) => <a key={href} href={href} className="lp-nav-link">{label}</a>)}
          <span className="lp-nav-divider" /><LoginLink /><ContactLink />
        </nav>
      </div>
    </header>

    <main id="konten">
      <section className="lp-hero" id="beranda" aria-labelledby="hero-title">
        <div className="lp-container lp-hero-grid">
          <div className="lp-hero-copy">
            <h1 id="hero-title">Dengarkan<br />ceritanya.<span>Kami bantu<br />catatkan.</span></h1>
            <p className="lp-hero-description">Tatap pasien Anda. ComeHear membantu menata percakapan menjadi draf Subjektif, agar Anda punya ruang untuk mendengar lebih baik.</p>
            <div className="lp-actions"><a href="#demo" className="lp-button lp-button-primary"><Play size={16} />Coba demo interaktif<ArrowRight size={17} /></a><a href={contactHref} className="hero-contact">Bicara dengan tim <ArrowRight size={16} /></a></div>
            <p className="lp-hero-microcopy"><ShieldCheck size={15} />AI membantu mencatat. Keputusan tetap pada dokter.</p>
          </div>
          <ListeningPreview />
        </div>
        <div className="lp-container"><div className="lp-value-strip">
          {[{ icon: MessageSquareText, text: '01 / Dengarkan percakapan' }, { icon: ClipboardCheck, text: '02 / Tinjau draf dengan bukti' }, { icon: ShieldCheck, text: '03 / Validasi oleh dokter' }].map(({ icon: Icon, text }) => <div key={text}><Icon size={20} /><span>{text}</span></div>)}
        </div></div>
      </section>

      <section className="lp-section lp-problem" aria-labelledby="problem-title">
        <div className="lp-container lp-problem-grid" data-reveal>
          <div><p className="lp-section-label">KEMBALIKAN RUANG UNTUK PASIEN.</p><h2 id="problem-title">Percakapan yang baik<br />butuh <em>perhatian penuh.</em></h2><p>Di antara mendengar, memeriksa, dan mencatat, perhatian mudah terbagi. ComeHear hadir untuk membantu bagian pencatatannya.</p><a href="#cara-kerja" className="lp-text-link">Temukan alur yang lebih terarah <ArrowRight size={17} /></a></div>
          <div className="lp-problem-list">
            {[{ icon: HeartHandshake, title: 'Mendengar sambil mencatat', text: 'Perhatian dapat terbagi antara percakapan dengan pasien dan kebutuhan dokumentasi.' }, { icon: FileText, title: 'Menyusun informasi yang beragam', text: 'Cerita pasien perlu dirangkai menjadi catatan yang terstruktur dan mudah ditinjau.' }, { icon: Network, title: 'Menjaga koordinasi antarperan', text: 'Status dokumentasi dan pengiriman perlu terlihat oleh petugas yang menanganinya.' }].map(({ icon: Icon, title, text }) => <div key={title}><span className="lp-line-icon"><Icon /></span><div><h3>{title}</h3><p>{text}</p></div></div>)}
          </div>
        </div>
      </section>

      <section id="fitur" className="lp-section lp-features" aria-labelledby="features-title">
        <div className="lp-container">
          <div className="lp-section-heading" data-reveal><p className="lp-section-label">PERANGKAT KERJA, DENGAN EMPATI.</p><h2 id="features-title">Dari kata-kata pasien.<br /><span>Menjadi catatan bermakna.</span></h2><p>Dukungan di setiap tahap dokumentasi, dengan kendali pada tim Anda.</p></div>
          <div className="lp-feature-grid" data-reveal>
            <article className="lp-feature-card lp-featured"><span className="lp-feature-icon"><AudioLines /></span><span className="lp-small-label">AI SCRIBE</span><h3>Transkrip dan<br />draf Subjektif</h3><p>Membantu menyusun informasi dari percakapan konsultasi menjadi draf yang dapat ditinjau dan diperbaiki dokter.</p><div className="lp-feature-mini"><div><MessageSquareText size={17} /><span>Percakapan konsultasi</span></div><div className="lp-mini-wave"><Waveform /></div><div><Sparkles size={17} /><strong>Draf Subjektif</strong><Check size={16} /></div></div><a href="#demo" className="lp-text-link">Lihat gambaran alurnya <ArrowRight size={17} /></a></article>
            {features.map(({ icon: Icon, title, text, detail }) => <article key={title} className="lp-feature-card"><span className="lp-feature-icon"><Icon /></span><h3>{title}</h3><p>{text}</p><div className="lp-feature-detail">{detail}</div></article>)}
          </div>
        </div>
      </section>

      <section id="cara-kerja" className="lp-section lp-workflow" aria-labelledby="workflow-title"><div className="lp-container">
        <div className="lp-section-heading" data-reveal><p className="lp-section-label">SATU KUNJUNGAN. EMPAT LANGKAH.</p><h2 id="workflow-title">Ikuti perjalanan<br /><span>satu konsultasi.</span></h2><p>Klik setiap tahap. Lihat bagaimana informasi berpindah bersama tim Anda.</p></div>
        <CareJourney />
      </div></section>

      <section id="demo" className="lp-section lp-preview-section" aria-labelledby="demo-title"><div className="lp-container">
        <div className="lp-section-heading" data-reveal><p className="lp-section-label">JANGAN HANYA DIBAYANGKAN. COBA.</p><h2 id="demo-title">Percakapannya ada.<br /><span>Buktinya bisa ditelusuri.</span></h2><p>Pilih sitasi pada draf untuk melihat sumber percakapan. Jelajahi SOAP dan status pengiriman lewat tab di bawah.</p></div>
        <ProductDemo />
        <p className="lp-demo-footnote">Prototipe ComeHear · Ilustrasi antarmuka · Tanpa data pasien asli</p>
      </div></section>

      <FilmSection />

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
        <div className="lp-final-wave" aria-hidden="true"><Waveform /><Waveform /></div><span className="lp-final-mark"><AudioLines size={32} /></span><p className="lp-section-label">KENALI COMEHEAR BERSAMA KAMI</p><h2 id="final-title">Bicarakan kebutuhan klinik Anda.</h2><p>Hubungi tim PenguasaLimit untuk mengenal ComeHear dan berdiskusi tentang kebutuhan dokumentasi konsultasi.</p><div className="lp-actions"><ContactLink /><DemoLink /></div><a className="lp-contact-address" href={contactHref}>{contactEmail}</a>
      </div></div></section>
    </main>

    <footer className="lp-footer"><div className="lp-container"><div className="lp-footer-main"><div><a href="#beranda" className="lp-logo-link" aria-label="ComeHear, kembali ke beranda"><img src={logoUrl} alt="ComeHear — AI Medical Scribe" width="210" height="50" loading="lazy" /></a><p>AI Medical Scribe untuk mendukung<br />dokumentasi konsultasi.</p></div><nav aria-label="Navigasi footer">{navigation.map(([label, href]) => <a href={href} key={href}>{label}</a>)}<a href={contactHref}>Hubungi Kami</a></nav></div><div className="lp-footer-bottom"><span>© {new Date().getFullYear()} ComeHear.</span><span>Prototipe untuk demonstrasi · Integrasi SATUSEHAT dalam lingkungan uji.</span></div></div></footer>
  </div>
}
