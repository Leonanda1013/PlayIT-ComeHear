import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { dateId } from '@/lib/format'
import type { Consultation, Patient } from '@/lib/types'

export function PageTitle({ title, back, subtitle, action }: { title: string; back?: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
    <div className="flex items-center gap-4">
      {back && (back === 'history'
        ? <button type="button" onClick={() => window.history.back()} aria-label="Kembali" className="grid size-9 place-items-center rounded-[10px] border border-[#d2e1e7] bg-white text-[#587083] shadow-sm hover:border-ch-brand hover:text-ch-teal"><ArrowLeft className="size-[18px]" /></button>
        : <Link to={back} aria-label="Kembali" className="grid size-9 place-items-center rounded-[10px] border border-[#d2e1e7] bg-white text-[#587083] shadow-sm hover:border-ch-brand hover:text-ch-teal"><ArrowLeft className="size-[18px]" /></Link>)}
      <div><h1 className="text-[28px] font-bold leading-9 tracking-[-0.02em] text-ch-ink">{title}</h1>{subtitle && <p className="mt-0.5 text-[13px] text-ch-muted">{subtitle}</p>}</div>
    </div>
    {action}
  </div>
}

export function PatientIdentity({ patient, children }: { patient: Patient; children?: React.ReactNode }) {
  const details = [
    ['No. RM', patient.rm_number],
    ['No. Telepon/WA', patient.phone || '—'],
    ['Tanggal Lahir', dateId(patient.birth_date)],
    ['Usia', patient.usia || '—'],
    ['Jenis Kelamin', patient.gender_label || '—'],
  ]
  return (
    <section className="rounded-[16px] border border-[#d3e2e8] bg-ch-panel p-4">
      <p className="text-xs font-medium text-[#3f5468]">Informasi Pasien</p>
      <h2 className="text-[18px] font-bold leading-6 text-ch-ink">{patient.name}</h2>
      <p className="text-xs text-[#6b7f93]">{patient.address || 'Alamat belum tercatat'}</p>
      <div className="my-3 border-t border-[#d7e4e9]" />
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_1.85fr_1fr_1.85fr_.9fr]">
        {details.map(([label, value]) => <div key={label} className="min-w-0 rounded-[10px] border border-[#d6e3e9] bg-white px-3 py-2.5"><dt className="text-[11px] text-[#526578]">{label}</dt><dd className="mt-0.5 truncate text-sm font-bold text-ch-ink">{value}</dd></div>)}
      </dl>
      {children}
    </section>
  )
}

const steps = [
  { key: 's', short: 'S', long: 'Subjektif', path: 'draf-s' },
  { key: 'o', short: 'O', long: 'Objektif', path: 'objektif' },
  { key: 'ap', short: 'A-P', long: 'Asesmen - Plan', path: 'asesmen' },
  { key: 'validasi', short: 'Validasi', long: 'Validasi', path: 'verifikasi' },
] as const

export function stageKey(stage: string) {
  if (stage === 'objektif') return 'o'
  if (stage === 'asesmen') return 'ap'
  if (stage === 'verifikasi') return 'validasi'
  return 's'
}

export function ClinicalHeader({ consultation, stage, patientExtra }: { consultation: Consultation; stage: string; patientExtra?: React.ReactNode }) {
  const id = consultation.visit.id
  const active = stageKey(stage)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4"><Link to="/kunjungan" aria-label="Kembali ke antrean" className="grid size-9 place-items-center rounded-[10px] border border-[#d2e1e7] bg-white text-[#587083] shadow-sm hover:border-ch-brand hover:text-ch-teal"><ArrowLeft className="size-[18px]" /></Link><h1 className="text-[28px] font-bold tracking-[-0.02em] text-ch-ink">Pemeriksaan Konsultasi &amp; SOAP</h1></div>
        <nav className="flex items-center gap-1.5" aria-label="Tahap SOAP">
          {steps.map((item) => {
            const on = active === item.key
            const to = item.key === 's' ? `/kunjungan/${id}/${consultation.session || consultation.note.subjective_summary ? 'draf-s' : 'subjektif'}` : `/kunjungan/${id}/${item.path}`
            return <Link key={item.key} to={to} aria-current={on ? 'step' : undefined} className={`inline-flex h-8 items-center rounded-full border px-3 text-[11px] font-semibold transition-colors ${on ? 'border-ch-brand bg-ch-brand text-white' : 'border-[#d2e1e7] bg-[#f4f9fb] text-[#5d7285] hover:border-[#8bdbe7]'}`}>{on ? item.long : item.short}</Link>
          })}
        </nav>
      </div>
      <PatientIdentity patient={consultation.visit.patient}>{patientExtra}</PatientIdentity>
    </div>
  )
}
