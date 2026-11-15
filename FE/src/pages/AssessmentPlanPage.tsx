import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Plus, Sparkles, Trash2 } from 'lucide-react'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { IcdPicker, type IcdValue } from '@/components/IcdPicker'
import { btn, Check, FieldCaps, inputClass, Label, Notice, Panel, Radio, SelectInput, TextArea } from '@/components/ui/kit'
import { saveSoap } from '@/lib/clinical'
import type { Consultation } from '@/lib/types'

/** Obat dengan kode KFA yang sudah terbukti diterima sandbox; hanya ini yang dikirim sebagai MedicationRequest. */
export const KFA_DRUGS = [{ code: '93001926', display: 'Paracetamol 120 mg/5 mL Sirup (CASETAMOL)', unit: 'mL' }]

type Dx = { text: string; icd: IcdValue; onset: 'akut' | 'kronis' }
type Ingredient = { name: string; dose: string }
type Rx = {
  type: 'non' | 'racikan'
  kfa: string; drug: string; dose: string; unit: string; interval: string; days: string; qty: string; prn: boolean; prn_text: string; instruction: string
  r_name: string; r_form: string; r_qty: string; r_ingredients: Ingredient[]; r_instruction: string
}
export type ApState = { dx: Dx[]; tindakan: string; plan: string; with_rx: boolean; rx: Rx[]; next_date: string; next_note: string }

const emptyRx = (): Rx => ({ type: 'non', kfa: '', drug: '', dose: '', unit: 'mL', interval: '8', days: '3', qty: '1', prn: false, prn_text: '', instruction: '', r_name: '', r_form: 'Puyer', r_qty: '10', r_ingredients: [{ name: '', dose: '' }], r_instruction: '' })

export function loadAp(data: Consultation): ApState {
  const saved = data.note.extra?.asesmen_plan as ApState | undefined
  if (saved) return saved
  const dx: Dx[] = data.note.diagnoses.length
    ? data.note.diagnoses.map((d) => ({ text: d.display, icd: { code: d.code, display: d.display }, onset: 'akut' as const }))
    : [{ text: '', icd: null, onset: 'akut' }]
  return { dx, tindakan: '', plan: data.note.plan_text || '', with_rx: false, rx: [emptyRx()], next_date: '', next_note: '' }
}

export function rxText(r: Rx) {
  if (r.type === 'racikan') return `Racikan ${r.r_name || '-'} (${r.r_form}, ${r.r_qty || '-'} bungkus): ${r.r_ingredients.filter((i) => i.name).map((i) => `${i.name} ${i.dose}`).join(', ') || '-'}. ${r.r_instruction}`.trim()
  return `${r.drug || KFA_DRUGS.find((d) => d.code === r.kfa)?.display || '-'} ${r.dose || '-'} ${r.unit} tiap ${r.interval || '-'} jam selama ${r.days || '-'} hari, jumlah ${r.qty || '-'}${r.prn ? `, bila perlu (${r.prn_text || 'sesuai keluhan'})` : ''}. ${r.instruction}`.trim()
}

export function AssessmentPlanPage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [s, setS] = useState<ApState>(() => loadAp(data))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const suggestions = data.session?.icd_suggestions || []
  const set = <K extends keyof ApState>(key: K, value: ApState[K]) => setS((current) => ({ ...current, [key]: value }))
  const patchDx = (index: number, patch: Partial<Dx>) => set('dx', s.dx.map((d, i) => i === index ? { ...d, ...patch } : d))
  const patchRx = (index: number, patch: Partial<Rx>) => set('rx', s.rx.map((r, i) => i === index ? { ...r, ...patch } : r))

  async function save(next: boolean) {
    setError(''); setNotice('')
    const primary = s.dx[0]
    if (next && !primary?.icd) { setError('Pilih kode ICD-10 untuk diagnosis utama sebelum validasi.'); return }
    setBusy(true)
    const structured = s.with_rx ? s.rx.find((r) => r.type === 'non' && KFA_DRUGS.some((d) => d.code === r.kfa)) : undefined
    const planParts = [s.plan.trim(), s.tindakan.trim() && `Permintaan tindakan:\n${s.tindakan.trim()}`, s.with_rx && `Resep:\n${s.rx.map((r, i) => `${i + 1}. ${rxText(r)}`).join('\n')}`, s.next_date && `Konsultasi berikutnya: ${s.next_date}${s.next_note ? ` — ${s.next_note}` : ''}`].filter(Boolean)
    const assessment = s.dx.filter((d) => d.icd || d.text).map((d, i) => `${i === 0 ? 'Diagnosis utama' : `Diagnosis sekunder ${i}`}: ${d.text || d.icd?.display} (${d.icd?.code || 'tanpa kode'}, ${d.onset}).`).join(' ')
    try {
      await saveSoap(id, {
        step: 'ap', action: next ? 'to_verify' : 'save',
        dx_primary: primary?.icd?.code || '', dx_secondary: s.dx.slice(1).map((d) => d.icd?.code).filter(Boolean).join(', '),
        assessment_text: assessment, plan_text: planParts.join('\n\n'), rx_present: '1', rx_enabled: structured ? 'ya' : 'tidak',
        ...(structured ? { rx_kfa: structured.kfa, rx_dose: structured.dose, rx_period: structured.interval, rx_period_max: structured.interval, rx_prn: structured.prn ? structured.prn_text || 'bila perlu' : '', rx_duration: structured.days, rx_qty: structured.qty, rx_instruction: structured.instruction } : {}),
        extra_json: JSON.stringify({ asesmen_plan: s }),
      })
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      if (next) navigate(`/kunjungan/${id}/verifikasi`); else setNotice('Draf Asesmen & Plan tersimpan.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Draf belum tersimpan.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-5">
    <ClinicalHeader consultation={data} stage="asesmen" />
    {error && <Notice tone="bad">{error}</Notice>}
    {notice && <Notice>{notice}</Notice>}

    <Panel className="p-5 sm:p-6">
      <h2 className="text-[20px] font-bold text-ch-ink">Asesmen</h2>
      {suggestions.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] bg-[#eef8fa] p-2.5 text-xs"><span className="flex items-center gap-1 font-semibold text-ch-teal"><Sparkles className="size-3.5" /> Usulan AI dari anamnesis:</span>{suggestions.map((item) => <button key={item.code} type="button" title={item.alasan} onClick={() => { const empty = s.dx.findIndex((d) => !d.icd); if (empty >= 0) patchDx(empty, { icd: { code: item.code, display: item.display }, text: s.dx[empty].text || item.deskripsi_id || item.display }); else set('dx', [...s.dx, { text: item.deskripsi_id || item.display, icd: { code: item.code, display: item.display }, onset: 'akut' }]) }} className="rounded-full border border-[#9ddce5] bg-white px-2.5 py-1 text-[11px] text-[#174b55] hover:border-ch-brand"><b>{item.code}</b> · {item.deskripsi_id || item.display}</button>)}<span className="text-[11px] text-ch-muted">Klik untuk memakai, dokter tetap memutuskan.</span></div>}
      <div className="mt-3 divide-y divide-[#e3ecf0]">
        {s.dx.map((d, index) => {
          const label = index === 0 ? 'UTAMA' : `SEKUNDER ${index}`
          return <div key={index} className="py-3 first:pt-1">
            <div className="grid gap-3 md:grid-cols-2">
              <div><FieldCaps>Diagnosis {label}</FieldCaps><input aria-label={`Diagnosis ${label.toLowerCase()}`} className={`${inputClass} rounded-full bg-ch-field px-4`} value={d.text} onChange={(e) => patchDx(index, { text: e.target.value })} placeholder={`Diagnosis ${index === 0 ? 'Utama' : 'Sekunder'}`} /></div>
              <div><FieldCaps>ICD-10 {label}</FieldCaps><div className="flex items-center gap-2"><div className="flex-1"><IcdPicker value={d.icd} onChange={(icd) => patchDx(index, { icd })} placeholder={`ICD-10 ${label}`} /></div>{index > 0 && <button type="button" aria-label="Hapus diagnosis" onClick={() => set('dx', s.dx.filter((_, i) => i !== index))} className="grid size-9 place-items-center rounded-full text-[#bd3030] hover:bg-[#fdecec]"><Trash2 className="size-4" /></button>}</div></div>
            </div>
            {index === 0 && <div className="mt-3 flex gap-5"><Radio name="onset" label="Akut" checked={d.onset === 'akut'} onChange={() => patchDx(0, { onset: 'akut' })} /><Radio name="onset" label="Kronis" checked={d.onset === 'kronis'} onChange={() => patchDx(0, { onset: 'kronis' })} /></div>}
          </div>
        })}
      </div>
      <button type="button" onClick={() => set('dx', [...s.dx, { text: '', icd: null, onset: 'akut' }])} className="mt-1 flex h-[34px] w-full items-center justify-center gap-2 rounded-[10px] border border-[#d2e1e7] bg-white text-xs font-semibold text-ch-brand hover:border-ch-brand"><Plus className="size-4" /> Tambah Diagnosis</button>
    </Panel>

    <Panel className="p-5 sm:p-6">
      <h2 className="text-[20px] font-bold text-ch-ink">Permintaan Tindakan</h2>
      <TextArea aria-label="Permintaan tindakan" rows={3} className="mt-3 rounded-[12px] bg-ch-field" value={s.tindakan} onChange={(e) => set('tindakan', e.target.value)} placeholder="- Tindakan" />
    </Panel>

    <Panel className="p-5 sm:p-6">
      <h2 className="text-[20px] font-bold text-ch-ink">Plan</h2>
      <TextArea aria-label="Plan" rows={3} className="mt-3 rounded-[12px] bg-ch-field" value={s.plan} onChange={(e) => set('plan', e.target.value)} placeholder="- Plan (rencana perawatan dan edukasi)" />
      <div className="mt-3"><Check label="Sertakan resep" checked={s.with_rx} onChange={(v) => set('with_rx', v)} /></div>
      {s.with_rx && <>
        <p className="mt-2 text-xs font-semibold text-ch-brand">Resep terstruktur (dikirim ke SATUSEHAT sebagai MedicationRequest)</p>
        <div className="mt-3 space-y-3">
          {s.rx.map((r, index) => <div key={index} className="rounded-[12px] border border-[#d6e3e9] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><b className="text-[13px]">Resep {index + 1}</b>{s.rx.length > 1 && <button type="button" onClick={() => set('rx', s.rx.filter((_, i) => i !== index))} className="inline-flex items-center gap-1 text-xs font-semibold text-[#bd3030]"><Trash2 className="size-3.5" /> Hapus resep</button>}</div>
            <div className="mt-2 flex flex-wrap items-center gap-4 border-b border-[#e3ecf0] pb-3 text-xs"><span className="text-ch-muted">Tipe Resep:</span><Radio name={`tipe-${index}`} label="Non-Racikan" checked={r.type === 'non'} onChange={() => patchRx(index, { type: 'non' })} /><Radio name={`tipe-${index}`} label="Racikan / Puyer" checked={r.type === 'racikan'} onChange={() => patchRx(index, { type: 'racikan' })} /></div>
            {r.type === 'non' ? <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2"><Label>Obat (KFA)</Label><SelectInput value={r.kfa} onChange={(e) => { const drug = KFA_DRUGS.find((d) => d.code === e.target.value); patchRx(index, { kfa: e.target.value, drug: drug?.display || '', unit: drug?.unit || r.unit }) }}><option value="">Pilih obat</option>{KFA_DRUGS.map((d) => <option key={d.code} value={d.code}>{d.display} · KFA {d.code}</option>)}<option value="manual">Obat lain (tulis manual, tidak dikirim terstruktur)</option></SelectInput>{r.kfa === 'manual' && <input className={`${inputClass} mt-2`} value={r.drug} onChange={(e) => patchRx(index, { drug: e.target.value })} placeholder="Nama obat dan kekuatan" />}</div>
              <div><Label>Dosis / satuan</Label><div className="flex gap-2"><input className={inputClass} inputMode="decimal" value={r.dose} onChange={(e) => patchRx(index, { dose: e.target.value })} placeholder="5" /><input aria-label="Satuan" className={`${inputClass} w-20`} value={r.unit} onChange={(e) => patchRx(index, { unit: e.target.value })} /></div></div>
              <div><Label>Interval (jam)</Label><input className={inputClass} inputMode="numeric" value={r.interval} onChange={(e) => patchRx(index, { interval: e.target.value })} /></div>
              <div><Label>Lama (hari)</Label><input className={inputClass} inputMode="numeric" value={r.days} onChange={(e) => patchRx(index, { days: e.target.value })} /></div>
              <div><Label>Jumlah</Label><input className={inputClass} inputMode="numeric" value={r.qty} onChange={(e) => patchRx(index, { qty: e.target.value })} /></div>
              <div className="md:col-span-3 flex flex-wrap items-center gap-3"><Check label="Bila perlu (PRN)" checked={r.prn} onChange={(v) => patchRx(index, { prn: v })} />{r.prn && <input className={`${inputClass} max-w-xs`} value={r.prn_text} onChange={(e) => patchRx(index, { prn_text: e.target.value })} placeholder="Contoh: bila demam ≥ 38 °C" />}</div>
              <div className="md:col-span-3"><Label>Aturan pakai</Label><input className={inputClass} value={r.instruction} onChange={(e) => patchRx(index, { instruction: e.target.value })} placeholder="Contoh: diminum sesudah makan" /></div>
            </div> : <div className="mt-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-3"><div><Label>Nama racikan</Label><input className={inputClass} value={r.r_name} onChange={(e) => patchRx(index, { r_name: e.target.value })} placeholder="Contoh: Puyer batuk" /></div><div><Label>Bentuk</Label><SelectInput value={r.r_form} onChange={(e) => patchRx(index, { r_form: e.target.value })}>{['Puyer', 'Kapsul', 'Sirup'].map((f) => <option key={f}>{f}</option>)}</SelectInput></div><div><Label>Jumlah (bungkus)</Label><input className={inputClass} inputMode="numeric" value={r.r_qty} onChange={(e) => patchRx(index, { r_qty: e.target.value })} /></div></div>
              <div><Label>Bahan dan dosis per bahan</Label><div className="space-y-2">{r.r_ingredients.map((ing, k) => <div key={k} className="flex gap-2"><input aria-label={`Bahan ${k + 1}`} className={inputClass} value={ing.name} onChange={(e) => patchRx(index, { r_ingredients: r.r_ingredients.map((x, j) => j === k ? { ...x, name: e.target.value } : x) })} placeholder={`Bahan ${k + 1}`} /><input aria-label={`Dosis bahan ${k + 1}`} className={`${inputClass} w-36`} value={ing.dose} onChange={(e) => patchRx(index, { r_ingredients: r.r_ingredients.map((x, j) => j === k ? { ...x, dose: e.target.value } : x) })} placeholder="mg" />{r.r_ingredients.length > 1 && <button type="button" aria-label="Hapus bahan" onClick={() => patchRx(index, { r_ingredients: r.r_ingredients.filter((_, j) => j !== k) })} className="grid size-10 shrink-0 place-items-center rounded-[10px] text-[#bd3030] hover:bg-[#fdecec]"><Trash2 className="size-4" /></button>}</div>)}</div><button type="button" onClick={() => patchRx(index, { r_ingredients: [...r.r_ingredients, { name: '', dose: '' }] })} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ch-brand"><Plus className="size-3.5" /> Tambah bahan</button></div>
              <div><Label>Aturan pakai paket</Label><input className={inputClass} value={r.r_instruction} onChange={(e) => patchRx(index, { r_instruction: e.target.value })} placeholder="Contoh: 3 × 1 bungkus sesudah makan" /></div>
              <p className="text-[11px] text-ch-muted">Racikan dicatat di Plan dan resume; belum dikirim sebagai MedicationRequest.</p>
            </div>}
          </div>)}
          <button type="button" onClick={() => set('rx', [...s.rx, emptyRx()])} className={`${btn.outline} h-9 text-xs`}><Plus className="size-4" /> Tambah resep</button>
        </div>
      </>}

      <div className="mt-5 rounded-[12px] border border-[#c5e3ea] bg-[#f3fafb] p-4">
        <p className="text-[13px] font-bold text-ch-ink">Rencana konsultasi berikutnya</p>
        <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]"><div><Label htmlFor="next-date">Tanggal kontrol</Label><input id="next-date" type="date" className={inputClass} value={s.next_date} onChange={(e) => set('next_date', e.target.value)} /></div><div><Label htmlFor="next-note">Catatan</Label><input id="next-note" className={inputClass} value={s.next_note} onChange={(e) => set('next_note', e.target.value)} placeholder="Contoh: kontrol bila keluhan menetap" /></div></div>
      </div>
    </Panel>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" className={btn.outline} onClick={() => navigate(`/kunjungan/${id}/objektif`)}>Kembali</button>
      <div className="flex gap-3"><button type="button" className={btn.outline} disabled={busy} onClick={() => save(false)}>Simpan Draf</button><button type="button" disabled={busy} onClick={() => save(true)} className={btn.primary}>Lanjut ke Validasi <ArrowRight className="size-4" /></button></div>
    </div>
  </div>
}
