import { useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, LoaderCircle, Pencil, RefreshCw, Sparkles, X } from 'lucide-react'
import { Link } from 'react-router'
import { SCRIBE_S_PROCESSING_STATUSES, subjectiveStagePath } from '@/lib/clinical'
import { dateId } from '@/lib/format'
import { useScribeMonitor } from '@/lib/useScribeMonitor'
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

export function PatientIdentity({ patient, children, onEdit }: { patient: Patient; children?: React.ReactNode; onEdit?: (p: Patient) => void }) {
  const details = [
    ['No. RM', patient.rm_number],
    ['No. Telepon/WA', patient.phone || '—'],
    ['Tanggal Lahir', dateId(patient.birth_date)],
    ['Usia', patient.usia || '—'],
    ['Jenis Kelamin', patient.gender_label || '—'],
  ]
  return (
    <section className="rounded-[16px] border border-[#dce6eb] bg-[#fbfdfe] px-[15px] pb-[15px] pt-[15px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium leading-4 text-[#3f5468]">Informasi Pasien</p>
          <h2 className="mt-0.5 text-[19px] font-bold leading-6 text-ch-ink">{patient.name}</h2>
          <p className="text-[12px] leading-4 text-[#5f7284]">{patient.address || 'Alamat belum tercatat'}</p>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(patient)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#d2e1e7] bg-white px-2.5 text-xs font-semibold text-[#3d5266] shadow-sm hover:border-ch-brand hover:text-ch-teal"
          >
            <Pencil className="size-3" /> Edit Pasien
          </button>
        )}
      </div>
      <div className="mb-3 mt-[11px] border-t border-[#dce6eb]" />
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[160fr_282fr_160fr_282fr_140fr]">
        {details.map(([label, value]) => <div key={label} className="flex h-[62px] min-w-0 flex-col justify-center rounded-[10px] border border-[#dce6eb] bg-white px-3"><dt className="text-[12px] font-medium leading-4 text-[#3f5468]">{label}</dt><dd className="mt-1.5 truncate text-[15px] font-bold leading-5 text-ch-ink">{value}</dd></div>)}
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
  const { scribe, retryBusy, retryError, retry } = useScribeMonitor(consultation)
  const [dismissedReadyKey, setDismissedReadyKey] = useState<string | null>(null)

  const scribeStatus = scribe.data?.status ?? consultation.session?.status ?? (consultation.failed_session ? 'failed' : null)
  const sProcessing = Boolean(scribeStatus && (SCRIBE_S_PROCESSING_STATUSES as readonly string[]).includes(scribeStatus))
  const codingOnly = scribeStatus === 'coding'
  const sReady = Boolean(scribe.data?.subjective_ready || scribe.data?.extraction || consultation.session?.subjective_ready || consultation.session?.extraction)
  const manualConflict = Boolean(
    scribe.data?.manual_conflict ||
    scribe.data?.applied_to_note === false ||
    consultation.session?.manual_conflict ||
    consultation.session?.applied_to_note === false
  )
  const isFailed = scribeStatus === 'failed' || (!consultation.session && Boolean(consultation.failed_session))
  const readyKey = `${consultation.session?.id ?? 0}:${scribe.data?.job_id ?? consultation.session?.job_id ?? ''}:${manualConflict}`
  const showBanner = stage !== 'subjektif' && stage !== 'draf-s' && !consultation.locked && (
    sProcessing ||
    isFailed ||
    (sReady && dismissedReadyKey !== readyKey)
  )

  const processingLabel = scribeStatus === 'transcribing'
    ? 'Mentranskrip percakapan…'
    : scribeStatus === 'refining'
      ? 'Menyempurnakan transkrip akhir…'
      : scribeStatus === 'extracting'
        ? 'Menyusun draf Subjektif AI…'
        : 'Menyiapkan pemrosesan AI…'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4"><Link to="/kunjungan" aria-label="Kembali ke antrean" className="grid size-9 place-items-center rounded-[10px] border border-[#d2e1e7] bg-white text-[#587083] shadow-sm hover:border-ch-brand hover:text-ch-teal"><ArrowLeft className="size-[18px]" /></Link><h1 className="text-[28px] font-bold tracking-[-0.02em] text-ch-ink">Pemeriksaan Konsultasi &amp; SOAP</h1></div>
        <nav className="flex items-center gap-1.5" aria-label="Tahap SOAP">
          {steps.map((item) => {
            const on = active === item.key
            const to = item.key === 's'
              ? `/kunjungan/${id}/${subjectiveStagePath(consultation)}`
              : `/kunjungan/${id}/${item.path}`
            return <Link key={item.key} to={to} aria-current={on ? 'step' : undefined} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-colors ${on ? 'border-ch-brand bg-ch-brand text-white' : 'border-[#d2e1e7] bg-[#f4f9fb] text-[#5d7285] hover:border-[#8bdbe7]'}`}>
              {item.key === 's' && !on && sProcessing && <LoaderCircle className="size-3 animate-spin text-ch-brand" />}
              {item.key === 's' && !on && !sProcessing && isFailed && <span className="size-2 rounded-full bg-[#e03131]" aria-hidden />}
              {item.key === 's' && !on && !sProcessing && !isFailed && sReady && <span className="size-2 rounded-full bg-[#198754]" aria-hidden />}
              {on ? item.long : item.short}
            </Link>
          })}
        </nav>
      </div>
      <PatientIdentity patient={consultation.visit.patient}>{patientExtra}</PatientIdentity>
      {showBanner && (
        <div
          role="status"
          aria-live="polite"
          className={`flex flex-wrap items-center justify-between gap-3 rounded-[12px] border px-4 py-2.5 text-xs ${
            isFailed
              ? 'border-[#f5c2c7] bg-[#fdf2f2] text-[#8b2020]'
              : manualConflict
                ? 'border-[#f0d08a] bg-[#fffaf0] text-[#78350f]'
                : sReady
                  ? 'border-[#9fdcc0] bg-[#f0faf4] text-[#145a32]'
                  : 'border-[#a3dfea] bg-[#edf9fb] text-[#0b6e7d]'
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {sProcessing ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-ch-brand" />
            ) : isFailed ? (
              <AlertTriangle className="size-4 shrink-0 text-[#dc3545]" />
            ) : manualConflict ? (
              <AlertTriangle className="size-4 shrink-0 text-[#d97706]" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-[#198754]" />
            )}
            <div className="min-w-0">
              {sProcessing ? (
                <p>
                  <b className="font-semibold">{processingLabel}</b>{' '}
                  Anda dapat langsung mengisi Objektif/Asesmen; draf Subjektif akan memberi notifikasi saat siap.
                </p>
              ) : isFailed ? (
                <p>
                  <b className="font-semibold">Pemrosesan AI gagal.</b>{' '}
                  {retryError || scribe.data?.error || consultation.failed_session?.error || 'Isian Anda tetap tersimpan; coba lagi atau isi Subjektif manual.'}
                </p>
              ) : manualConflict ? (
                <p>
                  <b className="font-semibold">Draf Subjektif AI selesai</b> — isian manual Anda tetap dipertahankan dan tidak ditimpa.
                </p>
              ) : (
                <p>
                  <b className="font-semibold">Draf Subjektif AI siap diverifikasi.</b>
                  {codingOnly && (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-[#0b6e7d]">
                      <Sparkles className="size-3" /> Usulan ICD-10 masih disusun di latar belakang…
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isFailed && (
              <>
                <button
                  type="button"
                  disabled={retryBusy}
                  onClick={() => void retry()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e3a3a8] bg-white px-3 font-semibold text-[#8b2020] hover:bg-[#fff5f5] disabled:opacity-50"
                >
                  <RefreshCw className={`size-3.5 ${retryBusy ? 'animate-spin' : ''}`} />
                  {retryBusy ? 'Mengulang…' : 'Coba Lagi'}
                </button>
                <Link
                  to={`/kunjungan/${id}/draf-s?manual=1`}
                  className="inline-flex h-8 items-center rounded-[8px] bg-[#bf2e36] px-3 font-semibold text-white hover:bg-[#a5242c]"
                >
                  Isi S Manual
                </Link>
              </>
            )}
            {sProcessing && (
              <Link
                to={`/kunjungan/${id}/draf-s`}
                className="inline-flex h-8 items-center rounded-[8px] border border-[#8edbe6] bg-white px-3 font-semibold text-[#0b6e7d] hover:bg-[#e4f6f9]"
              >
                Lihat Proses S
              </Link>
            )}
            {!sProcessing && !isFailed && sReady && (
              <>
                <Link
                  to={`/kunjungan/${id}/draf-s`}
                  className="inline-flex h-8 items-center rounded-[8px] bg-ch-brand px-3 font-semibold text-white hover:bg-ch-brand-hover"
                >
                  {manualConflict ? 'Lihat / Terapkan Draf AI' : 'Tinjau Draf S'}
                </Link>
                <button
                  type="button"
                  aria-label="Tutup pemberitahuan"
                  onClick={() => setDismissedReadyKey(readyKey)}
                  className="grid size-7 place-items-center rounded-md hover:bg-black/5"
                >
                  <X className="size-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
