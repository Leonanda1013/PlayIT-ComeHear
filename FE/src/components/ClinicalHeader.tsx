import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import type { Consultation, Patient } from '@/lib/types'

const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat('id-ID').format(new Date(`${value}T00:00:00`)) : '—'

export function PatientIdentity({ patient, children }: { patient: Patient; code?: string; location?: string; children?: React.ReactNode }) {
  const details = [
    ['No. RM', patient.rm_number],
    ['No. Telepon/WA', '—'],
    ['Tanggal Lahir', dateLabel(patient.birth_date)],
    ['Usia', patient.usia || '—'],
    ['Jenis Kelamin', patient.gender_label || '—'],
  ]
  return (
    <section className="rounded-2xl border border-[#d3e2e8] bg-[#fbfdfe] p-4 shadow-[0_1px_1px_rgba(16,42,67,0.02)]">
      <p className="text-xs font-semibold text-[#5c7084]">Informasi Pasien</p>
      <h2 className="mt-0.5 text-[18px] font-bold leading-5 text-[#102a43]">{patient.name}</h2>
      <p className="mt-0.5 text-xs text-[#6b7f93]">Alamat pasien belum tersedia</p>
      <div className="my-3 border-t border-[#d7e4e9]" />
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_1.75fr_1fr_1.75fr_.9fr]">
        {details.map(([label, value]) => <div key={label} className="min-w-0 rounded-xl border border-[#d2e1e7] bg-[#f9fcfd] px-3 py-2.5"><dt className="text-[11px] font-semibold text-[#60758a]">{label}</dt><dd className="mt-1 truncate text-sm font-bold text-[#102a43]">{value}</dd></div>)}
      </dl>
      {children}
    </section>
  )
}

export function ClinicalHeader({ consultation, stage, patientExtra }: { consultation: Consultation; stage: string; title?: string; description?: string; patientExtra?: React.ReactNode }) {
  const id = consultation.visit.id
  const active = stage === 'oap' ? 'o' : stage === 'verifikasi' || stage === 'resume' ? 'validasi' : 's'
  const steps = [
    { key: 's', label: stage === 'subjektif' || stage === 'draf-s' ? 'Subjektif' : 'S', to: `/kunjungan/${id}/draf-s` },
    { key: 'o', label: 'Objektif', to: `/kunjungan/${id}/oap` },
    { key: 'ap', label: 'A - P', to: `/kunjungan/${id}/oap` },
    { key: 'validasi', label: 'Validasi', to: `/kunjungan/${id}/verifikasi` },
  ]
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4"><Link to="/kunjungan" aria-label="Kembali ke antrean" className="grid size-10 place-items-center rounded-xl border border-[#d2e1e7] bg-white text-[#587083] hover:border-[#0ea5b7] hover:text-[#0b8191]"><ArrowLeft className="size-5" /></Link><h1 className="text-[26px] font-bold tracking-[-0.03em] text-[#102a43] sm:text-[28px]">Pemeriksaan Konsultasi &amp; SOAP</h1></div>
        <nav className="flex items-center gap-2" aria-label="Tahap SOAP">
          {steps.map((item) => <Link key={item.key} to={item.to} aria-current={active === item.key ? 'step' : undefined} className={`min-h-9 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${active === item.key ? 'border-[#16a4b7] bg-[#16a4b7] text-white' : 'border-[#ccdde5] bg-[#f4f9fb] text-[#6b8295] hover:border-[#8bdbe7]'}`}>{item.label}</Link>)}
        </nav>
      </div>
      <PatientIdentity patient={consultation.visit.patient}>{patientExtra}</PatientIdentity>
    </div>
  )
}
