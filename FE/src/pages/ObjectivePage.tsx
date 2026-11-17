import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { btn, FieldBox, inputClass, Label, Notice, Panel, Radio, SectionLabel, SelectInput, TextArea, UnitInput } from '@/components/ui/kit'
import { saveSoap, subjectiveStagePath } from '@/lib/clinical'
import type { Consultation } from '@/lib/types'

export const EXAM_PARTS = ['Kepala', 'Mata', 'Leher', 'Dada / Jantung', 'Paru', 'Perut', 'Alat Gerak Atas', 'Alat Gerak Bawah', 'Anus–Genitalia', 'Kulit', 'Lain-lain']
const NORMAL = 'Dalam batas normal'
const pairClass = `${inputClass.replace('w-full ', '')} font-inter w-[76px] flex-none`

/** Hanya angka desimal: koma diubah ke titik, satu titik, batas digit bulat & desimal. */
export function decimalOnly(raw: string, maxInt = 3, maxDec = 1) {
  const [int = '', ...rest] = raw.replace(',', '.').replace(/[^\d.]/g, '').split('.')
  const decimals = rest.join('')
  return raw.match(/[.,]/) && maxDec > 0 ? `${int.slice(0, maxInt)}.${decimals.slice(0, maxDec)}` : int.slice(0, maxInt)
}

/** Hanya bilangan bulat, dengan batas panjang dan nilai maksimum. */
export function integerOnly(raw: string, maxLen = 3, max?: number) {
  const digits = raw.replace(/\D/g, '').slice(0, maxLen)
  return max !== undefined && digits && Number(digits) > max ? String(max) : digits
}

type Wound = { name: string; location: string; p: string; l: string; d: string; description: string }
type Support = { type: string; name: string; date: string; summary: string; source: string; note: string }
export type ObjectiveState = {
  bb: string; tb: string; suhu: string; nadi: string; sistolik: string; diastolik: string; rr: string; spo2: string
  kesadaran: string; gcs: string; irama: string; keadaan: string; pupil_ka: string; pupil_ki: string; refleks_ka: string; refleks_ki: string
  nyeri: 'ya' | 'tidak' | ''; skala_nyeri: string; lokasi_nyeri: string
  exam: Record<string, { normal: boolean; note: string }>
  ada_luka: boolean; luka: Wound[]
  ada_penunjang: boolean; penunjang: Support[]
}

const str = (value: unknown) => value === undefined || value === null ? '' : String(value)
const emptyWound = (n: number): Wound => ({ name: `Luka ${n}`, location: '', p: '', l: '', d: '', description: '' })
const emptySupport = (): Support => ({ type: '', name: '', date: '', summary: '', source: '', note: '' })

export function loadObjective(data: Consultation): ObjectiveState {
  const saved = data.note.extra?.objektif as Partial<ObjectiveState> | undefined
  const v = data.note.vitals || {}
  const base: ObjectiveState = {
    bb: str(v.body_weight), tb: str(v.body_height), suhu: str(v.body_temperature), nadi: str(v.heart_rate),
    sistolik: str(v.systolic), diastolik: str(v.diastolic), rr: str(v.respiratory_rate), spo2: str(v.oxygen_saturation),
    kesadaran: str(data.note.extra?.kesadaran), gcs: str(data.note.extra?.gcs), irama: '', keadaan: '',
    pupil_ka: '', pupil_ki: '', refleks_ka: '', refleks_ki: '', nyeri: '', skala_nyeri: '', lokasi_nyeri: '',
    exam: Object.fromEntries(EXAM_PARTS.map((part) => [part, { normal: false, note: '' }])),
    ada_luka: false, luka: [emptyWound(1)], ada_penunjang: false, penunjang: [emptySupport()],
  }
  return saved ? { ...base, ...saved, exam: { ...base.exam, ...(saved.exam || {}) } } : base
}

/** Ringkasan teks O untuk FHIR dan resume: disusun ulang setiap simpan, tidak ditumpuk. */
export function composeExam(s: ObjectiveState) {
  const lines: string[] = []
  const general = [
    s.keadaan && `Keadaan umum ${s.keadaan}`, s.kesadaran && `kesadaran ${s.kesadaran}`, s.gcs && `GCS ${s.gcs}`,
    s.irama && `irama nadi ${s.irama.toLowerCase()}`, (s.pupil_ka || s.pupil_ki) && `pupil ${s.pupil_ka || '-'}/${s.pupil_ki || '-'} mm`,
    (s.refleks_ka || s.refleks_ki) && `refleks cahaya ${s.refleks_ka || '-'}/${s.refleks_ki || '-'}`,
    s.nyeri === 'ya' ? `nyeri skala ${s.skala_nyeri || '-'} di ${s.lokasi_nyeri || '-'}` : s.nyeri === 'tidak' ? 'tidak ada nyeri' : '',
  ].filter(Boolean)
  if (general.length) { const text = general.join(', '); lines.push(`${text.charAt(0).toUpperCase()}${text.slice(1)}.`) }
  const exam = EXAM_PARTS.filter((part) => s.exam[part]?.note.trim()).map((part) => `${part}: ${s.exam[part].note.trim()}`)
  if (exam.length) lines.push(`Pemeriksaan fisik — ${exam.join('; ')}.`)
  lines.push(s.ada_luka ? `Status lokalis — ${s.luka.map((w) => `${w.name}: ${w.location || '-'}, ${[w.p, w.l, w.d].filter(Boolean).join(' × ') || '-'} cm, ${w.description || '-'}`).join('; ')}.` : 'Status lokalis: tidak ditemukan luka.')
  lines.push(s.ada_penunjang ? `Penunjang — ${s.penunjang.map((p) => `${p.type || ''} ${p.name}${p.date ? ` (${p.date})` : ''}: ${p.summary || '-'}`.trim()).join('; ')}.` : 'Pemeriksaan penunjang: belum ada hasil.')
  return lines.join('\n')
}

export function ObjectivePage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [s, setS] = useState<ObjectiveState>(() => loadObjective(data))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const set = <K extends keyof ObjectiveState>(key: K, value: ObjectiveState[K]) => setS((current) => ({ ...current, [key]: value }))
  const setExam = (part: string, patch: Partial<{ normal: boolean; note: string }>) => setS((current) => ({ ...current, exam: { ...current.exam, [part]: { ...current.exam[part], ...patch } } }))

  function toggleNormal(part: string, checked: boolean) {
    const row = s.exam[part]
    if (checked) setExam(part, { normal: true, note: row.note.trim() ? row.note : NORMAL })
    else setExam(part, { normal: false, note: row.note === NORMAL ? '' : row.note })
  }

  async function save(next: boolean) {
    setBusy(true); setError(''); setNotice('')
    const tensi = s.sistolik || s.diastolik ? `${s.sistolik}/${s.diastolik}` : ''
    try {
      await saveSoap(id, {
        step: 'o', action: next ? 'to_ap' : 'save',
        suhu: s.suhu, spo2: s.spo2, bb: s.bb, tb: s.tb, rr: s.rr, nadi: s.nadi, tensi,
        kesadaran: s.kesadaran, gcs: s.gcs, exam_text: composeExam(s), extra_json: JSON.stringify({ objektif: s }),
      })
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      if (next) navigate(`/kunjungan/${id}/asesmen`); else setNotice('Draf Objektif tersimpan.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Draf belum tersimpan.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-5">
    <ClinicalHeader consultation={data} stage="objektif" />
    {error && <Notice tone="bad">{error}</Notice>}
    {notice && <Notice>{notice}</Notice>}

    <Panel className="p-5 sm:p-6">
      <h2 className="text-[20px] font-bold text-ch-ink">Objektif</h2>
      <p className="mt-0.5 text-xs text-ch-muted">Isi sesuai hasil pemeriksaan pasien. Label dan satuan tetap ditampilkan meski nilai kosong.</p>

      <SectionLabel number="01">Tanda Vital</SectionLabel>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <FieldBox label="Berat Badan" htmlFor="bb"><UnitInput id="bb" inputMode="decimal" value={s.bb} onChange={(e) => set('bb', decimalOnly(e.target.value, 3, 1))} placeholder="berat badan" unit="kg" /></FieldBox>
        <FieldBox label="Tinggi Badan" htmlFor="tb"><UnitInput id="tb" inputMode="decimal" value={s.tb} onChange={(e) => set('tb', decimalOnly(e.target.value, 3, 1))} placeholder="tinggi badan" unit="cm" /></FieldBox>
        <FieldBox label="Suhu" htmlFor="suhu"><UnitInput id="suhu" inputMode="decimal" value={s.suhu} onChange={(e) => set('suhu', decimalOnly(e.target.value, 2, 1))} placeholder="36" unit="°C" /></FieldBox>
        <FieldBox label="Nadi" htmlFor="nadi"><UnitInput id="nadi" inputMode="numeric" value={s.nadi} onChange={(e) => set('nadi', integerOnly(e.target.value, 3))} placeholder="nadi" unit="/menit" /></FieldBox>
        <FieldBox label="Tekanan Darah" htmlFor="sistolik"><div className="flex items-center gap-2"><input id="sistolik" aria-label="Sistolik" inputMode="numeric" className={pairClass} value={s.sistolik} onChange={(e) => set('sistolik', integerOnly(e.target.value, 3))} placeholder="110" /><b className="text-[#72869a]">/</b><input aria-label="Diastolik" inputMode="numeric" className={pairClass} value={s.diastolik} onChange={(e) => set('diastolik', integerOnly(e.target.value, 3))} placeholder="80" /><span className="text-[11px] text-[#8799ad]">mmHg</span></div></FieldBox>
        <FieldBox label="Frekuensi Pernapasan" htmlFor="rr"><UnitInput id="rr" inputMode="numeric" value={s.rr} onChange={(e) => set('rr', integerOnly(e.target.value, 3))} placeholder="20" unit="/menit" /></FieldBox>
        <FieldBox label={<>SpO<sub>2</sub></>} htmlFor="spo2"><UnitInput id="spo2" inputMode="numeric" value={s.spo2} onChange={(e) => set('spo2', integerOnly(e.target.value, 3, 100))} placeholder="98" unit="%" /></FieldBox>
      </div>

      <SectionLabel number="02">Keadaan Umum, Neurologis &amp; Nyeri</SectionLabel>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <FieldBox label="Kesadaran" htmlFor="kesadaran"><SelectInput id="kesadaran" value={s.kesadaran} onChange={(e) => set('kesadaran', e.target.value)}><option value="">Pilih kesadaran</option>{['Compos mentis', 'Apatis', 'Somnolen', 'Sopor', 'Koma'].map((o) => <option key={o}>{o}</option>)}</SelectInput></FieldBox>
        <FieldBox label="GCS (E–V–M)" htmlFor="gcs"><UnitInput id="gcs" value={s.gcs} onChange={(e) => set('gcs', e.target.value)} placeholder="15 (E4 V5 M6)" unit="GCS" /></FieldBox>
        <FieldBox label="Irama Nadi" htmlFor="irama"><SelectInput id="irama" value={s.irama} onChange={(e) => set('irama', e.target.value)}><option value="">Pilih irama</option><option>Teratur</option><option>Tidak teratur</option></SelectInput></FieldBox>
        <FieldBox label="Keadaan Umum" htmlFor="keadaan"><input id="keadaan" className={`${inputClass} font-inter`} value={s.keadaan} onChange={(e) => set('keadaan', e.target.value)} placeholder="Baik" /></FieldBox>
        <FieldBox label="Pupil (kanan / kiri)"><div className="flex items-center gap-2"><input aria-label="Pupil kanan" inputMode="decimal" className={pairClass} value={s.pupil_ka} onChange={(e) => set('pupil_ka', decimalOnly(e.target.value, 1, 1))} placeholder="3" /><b className="text-[#72869a]">/</b><input aria-label="Pupil kiri" inputMode="decimal" className={pairClass} value={s.pupil_ki} onChange={(e) => set('pupil_ki', decimalOnly(e.target.value, 1, 1))} placeholder="3" /><span className="text-[11px] text-[#8799ad]">mm</span></div></FieldBox>
        <FieldBox label="Refleks Cahaya (kanan / kiri)"><div className="flex items-center gap-2"><ReflexSelect label="Refleks cahaya kanan" value={s.refleks_ka} onChange={(v) => set('refleks_ka', v)} /><b className="text-[#72869a]">/</b><ReflexSelect label="Refleks cahaya kiri" value={s.refleks_ki} onChange={(v) => set('refleks_ki', v)} /></div></FieldBox>
        <FieldBox label="Skrining Nyeri"><div className="flex h-10 items-center gap-5 rounded-[10px] border border-[#d2e1e7] bg-white px-3"><Radio name="nyeri" label="Tidak" checked={s.nyeri === 'tidak'} onChange={() => set('nyeri', 'tidak')} /><Radio name="nyeri" label="Ya" checked={s.nyeri === 'ya'} onChange={() => set('nyeri', 'ya')} /></div></FieldBox>
        <FieldBox label="Skala Nyeri" htmlFor="skala"><UnitInput id="skala" inputMode="numeric" disabled={s.nyeri !== 'ya'} value={s.skala_nyeri} onChange={(e) => set('skala_nyeri', integerOnly(e.target.value, 2, 10))} placeholder="0–10" unit="/10" /></FieldBox>
        <FieldBox label="Lokasi Nyeri" htmlFor="lokasi"><input id="lokasi" disabled={s.nyeri !== 'ya'} className={`${inputClass} font-inter`} value={s.lokasi_nyeri} onChange={(e) => set('lokasi_nyeri', e.target.value)} placeholder="Contoh: kepala" /></FieldBox>
      </div>

      <SectionLabel number="03">Pemeriksaan Fisik</SectionLabel>
      <div className="overflow-x-auto rounded-[12px] border border-[#d6e3e9]">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[190px_80px_1fr] bg-[#eaf1f4] px-3 py-2.5 text-[11px] font-semibold text-[#3f5468]"><span>Bagian pemeriksaan</span><span className="text-center">Normal</span><span>Deskripsi / temuan</span></div>
          <div className="divide-y divide-[#e3ecf0] bg-white">{EXAM_PARTS.map((part) => <div key={part} className="grid grid-cols-[190px_80px_1fr] items-center px-3 py-1.5">
            <span className="text-xs font-semibold text-[#3f5468]">{part}</span>
            <label className="mx-auto grid size-6 cursor-pointer place-items-center"><input type="checkbox" checked={s.exam[part]?.normal || false} onChange={(e) => toggleNormal(part, e.target.checked)} className="size-4 accent-ch-brand" /><span className="sr-only">{part} dalam batas normal</span></label>
            <input aria-label={`Temuan ${part}`} className="h-9 rounded-[8px] border border-[#d6e3e9] bg-ch-field px-3 text-xs outline-none focus:border-ch-brand" value={s.exam[part]?.note || ''} onChange={(e) => setExam(part, { note: e.target.value, normal: e.target.value === NORMAL })} placeholder="Catat temuan bila ada" />
          </div>)}</div>
        </div>
      </div>

      <SectionLabel number="04">Status Lokalis / Luka</SectionLabel>
      <div className="flex items-center gap-5 text-xs"><b className="text-[#3e5368]">Ada luka?</b><Radio name="luka" label="Tidak" checked={!s.ada_luka} onChange={() => set('ada_luka', false)} /><Radio name="luka" label="Ya" checked={s.ada_luka} onChange={() => set('ada_luka', true)} /></div>
      {s.ada_luka && <div className="mt-4 space-y-3">
        {s.luka.map((w, index) => {
          const patch = (p: Partial<Wound>) => set('luka', s.luka.map((item, i) => i === index ? { ...item, ...p } : item))
          return <div key={index} className="rounded-[12px] border border-[#c5e3ea] bg-[#f3fafb] p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="w-full max-w-[360px]"><Label htmlFor={`luka-${index}`}>{index + 1}. Nama luka</Label><input id={`luka-${index}`} className={inputClass} value={w.name} onChange={(e) => patch({ name: e.target.value })} /></div>
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#efc1c1] bg-white px-3 text-xs font-semibold text-[#bd3030] hover:bg-[#fdecec]" onClick={() => set('luka', s.luka.filter((_, i) => i !== index))} disabled={s.luka.length === 1}><Trash2 className="size-3.5" /> Hapus luka</button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div><Label>Lokasi luka</Label><input className={inputClass} value={w.location} onChange={(e) => patch({ location: e.target.value })} placeholder="Contoh: tungkai kanan bawah" /></div>
              <div><Label>Ukuran luka (P × L × D)</Label><div className="flex items-center gap-2">{(['p', 'l', 'd'] as const).map((k, i) => <span key={k} className="contents"><UnitInput aria-label={['Panjang', 'Lebar', 'Kedalaman'][i]} inputMode="decimal" value={w[k]} onChange={(e) => patch({ [k]: decimalOnly(e.target.value, 3, 1) })} unit="cm" />{i < 2 && <b className="text-[#72869a]">×</b>}</span>)}</div></div>
            </div>
            <div className="mt-3"><Label>Pengkajian / deskripsi luka</Label><TextArea rows={3} value={w.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Catat kondisi luka, jaringan, eksudat, dan kulit sekitar" /></div>
          </div>
        })}
        <button type="button" onClick={() => set('luka', [...s.luka, emptyWound(s.luka.length + 1)])} className={`${btn.outline} h-9 text-xs`}><Plus className="size-4" /> Tambah luka</button>
      </div>}

      <SectionLabel number="05">Hasil Pemeriksaan Penunjang</SectionLabel>
      <div className="flex items-center gap-5 text-xs"><b className="text-[#3e5368]">Ada hasil pemeriksaan penunjang?</b><Radio name="penunjang" label="Tidak" checked={!s.ada_penunjang} onChange={() => set('ada_penunjang', false)} /><Radio name="penunjang" label="Ya" checked={s.ada_penunjang} onChange={() => set('ada_penunjang', true)} /></div>
      {s.ada_penunjang && <div className="mt-4 space-y-3">
        {s.penunjang.map((p, index) => {
          const patch = (q: Partial<Support>) => set('penunjang', s.penunjang.map((item, i) => i === index ? { ...item, ...q } : item))
          return <div key={index} className="rounded-[12px] border border-[#c5e3ea] bg-[#f3fafb] p-4">
            <div className="flex items-center justify-between"><b className="text-sm text-ch-ink">Hasil {index + 1}</b><button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#efc1c1] bg-white px-3 text-xs font-semibold text-[#bd3030] hover:bg-[#fdecec]" onClick={() => set('penunjang', s.penunjang.filter((_, i) => i !== index))} disabled={s.penunjang.length === 1}><Trash2 className="size-3.5" /> Hapus hasil</button></div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div><Label>Jenis hasil</Label><SelectInput value={p.type} onChange={(e) => patch({ type: e.target.value })}><option value="">Pilih jenis</option>{['Laboratorium', 'Radiologi', 'EKG', 'Lainnya'].map((o) => <option key={o}>{o}</option>)}</SelectInput></div>
              <div><Label>Nama pemeriksaan</Label><input className={inputClass} value={p.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Contoh: Rontgen thoraks" /></div>
              <div><Label>Tanggal hasil</Label><input type="date" className={inputClass} value={p.date} onChange={(e) => patch({ date: e.target.value })} /></div>
            </div>
            <div className="mt-3"><Label>Ringkasan hasil</Label><TextArea rows={3} value={p.summary} onChange={(e) => patch({ summary: e.target.value })} placeholder="Catat temuan utama yang relevan" /></div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div><Label>Sumber / lampiran</Label><input className={inputClass} value={p.source} onChange={(e) => patch({ source: e.target.value })} placeholder="Contoh: hasil lab dibawa pasien" /></div>
              <div><Label>Keterangan (opsional)</Label><input className={inputClass} value={p.note} onChange={(e) => patch({ note: e.target.value })} /></div>
            </div>
          </div>
        })}
        <button type="button" onClick={() => set('penunjang', [...s.penunjang, emptySupport()])} className={`${btn.outline} h-9 text-xs`}><Plus className="size-4" /> Tambah hasil pemeriksaan penunjang</button>
      </div>}
    </Panel>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <button
        type="button"
        className={btn.outline}
        onClick={() => {
          navigate(`/kunjungan/${id}/${subjectiveStagePath(data)}`)
        }}
      >
        Kembali
      </button>
      <div className="flex gap-3"><button type="button" className={btn.outline} disabled={busy} onClick={() => save(false)}>Simpan Draf</button><button type="button" disabled={busy} onClick={() => save(true)} className={btn.primary}>Lanjut ke Asesmen &amp; Plan <ArrowRight className="size-4" /></button></div>
    </div>
  </div>
}

/** Refleks cahaya: "Pilih", "+ Positif", "− Negatif" — latar putih tanpa warna, lebar cukup untuk teks penuh. */
function ReflexSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <SelectInput aria-label={label} className="w-[132px]" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">Pilih</option>
    <option value="+">+ Positif</option>
    <option value="−">− Negatif</option>
  </SelectInput>
}
