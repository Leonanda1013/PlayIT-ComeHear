import { Pencil } from 'lucide-react'
import { Link } from 'react-router'
import { Badge, FieldCaps, Panel, PanelTitle } from '@/components/ui/kit'
import { subjectiveFields } from '@/lib/clinical'
import type { ClinicalNote } from '@/lib/types'

type ApExtra = { tindakan?: string; plan?: string; dx?: { text: string; icd: { code: string; display: string } | null; onset: string }[]; with_rx?: boolean; rx?: unknown[]; next_date?: string; next_note?: string }

const VITALS: [string, string, string][] = [
  ['body_weight', 'Berat Badan', 'kg'], ['body_height', 'Tinggi Badan', 'cm'], ['body_temperature', 'Suhu', '°C'],
  ['heart_rate', 'Nadi', '/menit'], ['respiratory_rate', 'Frekuensi Pernapasan', '/menit'], ['oxygen_saturation', 'SpO₂', '%'],
]

function vitalValue(note: ClinicalNote, key: string, unit: string) {
  const v = note.vitals?.[key]
  return v === undefined || v === null ? '—' : `${v} ${unit}`
}
const bp = (note: ClinicalNote) => note.vitals?.systolic ? `${note.vitals.systolic}/${note.vitals.diastolic} mmHg` : '—'

function EditLink({ to }: { to: string }) {
  return <Link to={to} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#d2e1e7] bg-white px-3 text-xs font-semibold text-[#3d5266] hover:border-ch-brand hover:text-ch-teal"><Pencil className="size-3.5" /> Edit</Link>
}

/** Ringkasan SOAP. variant "review" = panel per bagian (layar Validasi), "compact" = daftar berlabel S/O/A/P (riwayat & resume). */
export function SoapSummary({ note, editBase, aiDraft, variant = 'review' }: { note: ClinicalNote; editBase?: string; aiDraft?: boolean; variant?: 'review' | 'compact' }) {
  const ap = (note.extra?.asesmen_plan || {}) as ApExtra
  const diagnoses = note.diagnoses || []

  if (variant === 'compact') return <div className="space-y-5">
    <Block letter="S" title={`Subjektif${aiDraft ? ' — Hasil Ekstraksi AI Medical Scribe' : ''}`}>
      {subjectiveFields.map(([key, label]) => <div key={key} className="mb-2"><FieldCaps>{label}</FieldCaps><p className="text-[13px] text-ch-ink-2">{note.subjective?.[key] || '—'}</p></div>)}
      {note.subjective_summary && <div><FieldCaps>Rangkuman</FieldCaps><p className="text-[13px] text-ch-ink-2">{note.subjective_summary}</p></div>}
    </Block>
    <Block letter="O" title="Objektif — Pemeriksaan Fisik & TTV">
      <div className="grid gap-2 sm:grid-cols-4">{[['Tekanan Darah', bp(note)], ['Nadi', vitalValue(note, 'heart_rate', 'x/menit')], ['Suhu Tubuh', vitalValue(note, 'body_temperature', '°C')], ['SpO₂', vitalValue(note, 'oxygen_saturation', '%')]].map(([label, value]) => <div key={label} className="rounded-[8px] bg-[#f1f6f8] px-3 py-2"><p className="text-[10px] text-ch-muted">{label}</p><p className="text-[13px] font-semibold">{value}</p></div>)}</div>
      <p className="mt-3 whitespace-pre-line text-[13px] leading-5 text-ch-ink-2">{note.exam_text || 'Pemeriksaan fisik belum dicatat.'}</p>
    </Block>
    <Block letter="A" title="Asesmen — Diagnosis">
      {diagnoses.length ? diagnoses.map((d) => <p key={d.code} className="text-[13px]"><Badge tone={d.rank === 1 ? 'info' : 'muted'} className="mr-2">{d.rank === 1 ? 'Utama' : 'Sekunder'}</Badge><b>{d.code}</b> — {d.display}</p>) : <p className="text-[13px] text-ch-muted">Belum ada diagnosis.</p>}
      {note.assessment && <p className="mt-2 text-[13px] text-ch-ink-2">{note.assessment}</p>}
    </Block>
    <Block letter="P" title="Plan — Tatalaksana">
      <p className="whitespace-pre-line text-[13px] leading-5 text-ch-ink-2">{note.plan_text || '—'}</p>
    </Block>
  </div>

  return <div className="space-y-5">
    <Panel highlight={aiDraft}>
      <PanelTitle action={<div className="flex items-center gap-2">{aiDraft && <Badge tone="info" className="py-1">Draf AI</Badge>}{editBase && <EditLink to={`${editBase}/draf-s`} />}</div>}>Subjektif</PanelTitle>
      <div className="mt-3 space-y-2.5">
        {subjectiveFields.map(([key, label]) => <div key={key}><FieldCaps>{label}</FieldCaps><p className="rounded-[8px] border border-[#d6e3e9] bg-white px-3 py-2 text-xs text-ch-ink">{note.subjective?.[key] || <span className="text-ch-faint">Tidak dibahas.</span>}</p></div>)}
        {note.subjective_summary && <div><FieldCaps>Rangkuman Subjektif</FieldCaps><p className="rounded-[8px] bg-[#eaf6f8] px-3 py-2 text-xs leading-5">{note.subjective_summary}</p></div>}
      </div>
    </Panel>

    <Panel>
      <PanelTitle action={editBase && <EditLink to={`${editBase}/objektif`} />}>Objektif</PanelTitle>
      <h3 className="mb-3 mt-4 text-xs font-semibold uppercase tracking-wide text-[#4d6275]">01 Tanda Vital</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {VITALS.map(([key, label, unit]) => <ReadBox key={key} label={label} value={vitalValue(note, key, unit)} />)}
        <ReadBox label="Tekanan Darah" value={bp(note)} />
      </div>
      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-[#4d6275]">Pemeriksaan</h3>
      <p className="whitespace-pre-line rounded-[10px] border border-[#d6e3e9] bg-white p-3 text-xs leading-5">{note.exam_text || 'Belum diisi.'}</p>
    </Panel>

    <Panel>
      <PanelTitle action={editBase && <EditLink to={`${editBase}/asesmen`} />}>Asesmen</PanelTitle>
      <div className="mt-3 divide-y divide-[#e3ecf0]">
        {diagnoses.length ? diagnoses.map((d, i) => {
          const text = ap.dx?.[i]?.text
          return <div key={d.code} className="grid gap-3 py-2.5 md:grid-cols-2"><div><FieldCaps>Diagnosis {i === 0 ? 'Utama' : `Sekunder ${i}`}</FieldCaps><p className="rounded-full border border-[#d6e3e9] bg-ch-field px-4 py-2 text-[13px]">{text || d.display}</p></div><div><FieldCaps>ICD-10 {i === 0 ? 'Utama' : `Sekunder ${i}`}</FieldCaps><p className="rounded-full border border-[#d6e3e9] bg-ch-field px-4 py-2 text-[13px]">{d.code} - {d.display}</p></div></div>
        }) : <p className="py-2 text-[13px] text-ch-muted">Belum ada diagnosis dengan kode ICD-10.</p>}
      </div>
    </Panel>

    {ap.tindakan && <Panel><PanelTitle>Permintaan Tindakan</PanelTitle><p className="mt-3 whitespace-pre-line rounded-[12px] border border-[#d6e3e9] bg-ch-field p-3 text-[13px]">{ap.tindakan}</p></Panel>}

    <Panel>
      <PanelTitle action={editBase && <EditLink to={`${editBase}/asesmen`} />}>Plan</PanelTitle>
      <p className="mt-3 whitespace-pre-line rounded-[12px] border border-[#d6e3e9] bg-ch-field p-3 text-[13px] leading-5">{note.plan_text || 'Belum diisi.'}</p>
    </Panel>
  </div>
}

function ReadBox({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[12px] border border-[#d6e3e9] bg-ch-field p-3"><p className="mb-2 text-xs font-semibold text-[#3f5468]">{label}</p><p className="font-inter flex h-10 items-center rounded-[10px] border border-[#d2e1e7] bg-white px-3 text-sm">{value}</p></div>
}

function Block({ letter, title, children }: { letter: string; title: string; children: React.ReactNode }) {
  return <div className="flex gap-3">
    <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-[#dff4f7] text-[13px] font-bold text-ch-teal">{letter}</span>
    <div className="min-w-0 flex-1"><h3 className="text-[15px] font-bold text-ch-ink">{title}</h3><div className="mt-2.5">{children}</div></div>
  </div>
}
