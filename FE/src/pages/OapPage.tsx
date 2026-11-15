import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { apiRequest } from '@/lib/api'
import { saveSoap } from '@/lib/clinical'
import type { Consultation } from '@/lib/types'

const examParts = ['Kepala', 'Mata', 'Leher', 'Dada / Jantung', 'Paru', 'Perut', 'Alat Gerak Atas', 'Alat Gerak Bawah', 'Anus–Genitalia', 'Kulit', 'Lain-lain']
const baseInput = 'h-10 w-full rounded-lg border border-[#cfdee6] bg-white px-3 text-sm font-medium text-[#182c3f] outline-none placeholder:text-[#a3b1bf] focus:border-[#0ea5b7] focus:ring-2 focus:ring-[#0ea5b7]/10'

export function OapPage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const vitals = data.note.vitals
  const extra = data.note.extra
  const [form, setForm] = useState<Record<string, string>>({
    suhu: String(vitals.body_temperature ?? '36'), tensi: vitals.systolic && vitals.diastolic ? `${vitals.systolic}/${vitals.diastolic}` : '110/80', spo2: String(vitals.oxygen_saturation ?? '98'),
    bb: String(vitals.body_weight ?? ''), tb: String(vitals.body_height ?? ''), rr: String(vitals.respiratory_rate ?? '20'), nadi: String(vitals.heart_rate ?? ''),
    gcs: extra.gcs || '15 (E4 V5 M6)', kesadaran: extra.kesadaran || 'Compos mentis', keadaan: extra.keadaan || 'Baik', irama: extra.irama || 'Teratur', pupil_k: extra.pupil_k || '3', pupil_l: extra.pupil_l || '3', refleks_k: extra.refleks_k || '+', refleks_l: extra.refleks_l || '+',
    nyeri: extra.nyeri || 'tidak', skala_nyeri: extra.skala_nyeri || '0/10', lokasi_nyeri: extra.lokasi_nyeri || 'Tidak ada', alergi: extra.alergi || '', exam_text: data.note.exam_text || '',
    assessment_text: data.note.assessment || '', dx_primary: data.note.diagnoses[0]?.code || '', dx_secondary: data.note.diagnoses.slice(1).map((d) => d.code).join(', '),
    plan_text: data.note.plan_text || '', instruksi: extra.instruksi || '', evaluasi: extra.evaluasi || '',
  })
  const [exam, setExam] = useState<Record<string, { normal: boolean; note: string }>>(() => Object.fromEntries(examParts.map((part) => [part, { normal: true, note: 'Dalam batas normal' }])))
  const [hasWound, setHasWound] = useState(false)
  const [hasSupport, setHasSupport] = useState(false)
  const [wounds, setWounds] = useState([{ name: 'Luka 1', location: '', size: '', description: '' }])
  const [supports, setSupports] = useState([{ type: '', name: '', date: '', summary: '', source: '', note: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const icdSearch = useQuery({ queryKey: ['icd', form.dx_primary], queryFn: () => apiRequest<{ code: string; display: string }[]>(`/api/icd?q=${encodeURIComponent(form.dx_primary)}`), enabled: form.dx_primary.trim().length >= 2, staleTime: 60_000 })

  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))
  async function save(next: boolean) {
    setBusy(true); setError(''); setNotice('')
    const physical = examParts.map((part) => `${part}: ${exam[part].normal ? 'normal' : 'tidak normal'} — ${exam[part].note}`).join('\n')
    const woundText = hasWound ? wounds.map((w) => `Luka ${w.name}: ${w.location}; ${w.size}; ${w.description}`).join('\n') : 'Tidak ada luka.'
    const supportText = hasSupport ? supports.map((s) => `${s.type} ${s.name} (${s.date}): ${s.summary}`).join('\n') : 'Tidak ada pemeriksaan penunjang.'
    try {
      await saveSoap(id, { step: 'oap', action: next ? 'to_verify' : 'save', ...form, exam_text: [form.exam_text, physical, woundText, supportText].filter(Boolean).join('\n\n') })
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      if (next) navigate(`/kunjungan/${id}/verifikasi`); else setNotice('Draf pemeriksaan tersimpan.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Draf belum tersimpan.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-6"><ClinicalHeader consultation={data} stage="oap" />
    {error && <p role="alert" className="rounded-xl border border-[#f2b8b8] bg-[#fff0f0] p-3 text-sm text-[#9d2525]">{error}</p>}{notice && <p role="status" className="rounded-xl border border-[#a8dfc8] bg-[#eaf8f2] p-3 text-sm text-[#176e4e]">{notice}</p>}

    <section className="rounded-2xl border border-[#d2e1e7] bg-[#fbfdfe] p-5 sm:p-6">
      <h2 className="text-[21px] font-bold text-[#101f35]">Objektif</h2><p className="mt-1 text-xs text-[#6b7f95]">Contoh pengisian dengan data simulasi; sesuaikan dengan hasil pemeriksaan pasien.</p>
      <SectionTitle number="01" title="TANDA VITAL" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <FieldBox label="Berat Badan"><UnitInput value={form.bb} onChange={(v) => set('bb', v)} placeholder="berat badan" unit="kg" /></FieldBox>
        <FieldBox label="Tinggi Badan"><UnitInput value={form.tb} onChange={(v) => set('tb', v)} placeholder="tinggi badan" unit="cm" /></FieldBox>
        <FieldBox label="Suhu"><UnitInput value={form.suhu} onChange={(v) => set('suhu', v)} unit="°C" /></FieldBox>
        <FieldBox label="Nadi"><UnitInput value={form.nadi} onChange={(v) => set('nadi', v)} placeholder="nadi" unit="/menit" /></FieldBox>
        <FieldBox label="Tekanan Darah"><div className="flex items-center gap-2"><input className={baseInput} value={form.tensi.split('/')[0] || ''} onChange={(e) => set('tensi', `${e.target.value}/${form.tensi.split('/')[1] || ''}`)} /><b className="text-[#72869a]">/</b><input className={baseInput} value={form.tensi.split('/')[1] || ''} onChange={(e) => set('tensi', `${form.tensi.split('/')[0] || ''}/${e.target.value}`)} /><span className="text-[11px] text-[#8296aa]">mmHg</span></div></FieldBox>
        <FieldBox label="Frekuensi Pernapasan"><UnitInput value={form.rr} onChange={(v) => set('rr', v)} unit="/menit" /></FieldBox>
        <FieldBox label="SpO₂"><UnitInput value={form.spo2} onChange={(v) => set('spo2', v)} unit="%" /></FieldBox>
      </div>

      <SectionTitle number="02" title="KEADAAN UMUM, NEUROLOGIS & NYERI" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <FieldBox label="Kesadaran"><select className={baseInput} value={form.kesadaran} onChange={(e) => set('kesadaran', e.target.value)}><option>Compos mentis</option><option>Apatis</option><option>Somnolen</option><option>Sopor</option></select></FieldBox>
        <FieldBox label="GCS (E–V–M)"><UnitInput value={form.gcs} onChange={(v) => set('gcs', v)} unit="GCS" /></FieldBox>
        <FieldBox label="Irama Nadi"><select className={baseInput} value={form.irama} onChange={(e) => set('irama', e.target.value)}><option>Teratur</option><option>Tidak teratur</option></select></FieldBox>
        <FieldBox label="Keadaan Umum"><input className={baseInput} value={form.keadaan} onChange={(e) => set('keadaan', e.target.value)} /></FieldBox>
        <FieldBox label="Pupil (kanan / kiri)"><PairInput left={form.pupil_k} right={form.pupil_l} onLeft={(v) => set('pupil_k', v)} onRight={(v) => set('pupil_l', v)} unit="mm" /></FieldBox>
        <FieldBox label="Refleks Cahaya (kanan / kiri)"><PairInput left={form.refleks_k} right={form.refleks_l} onLeft={(v) => set('refleks_k', v)} onRight={(v) => set('refleks_l', v)} /></FieldBox>
        <FieldBox label="Skrining Nyeri"><RadioPair value={form.nyeri} onChange={(v) => set('nyeri', v)} no="tidak" yes="ya" /></FieldBox>
        <FieldBox label="Skala Nyeri"><input className={baseInput} value={form.skala_nyeri} onChange={(e) => set('skala_nyeri', e.target.value)} /></FieldBox>
        <FieldBox label="Lokasi Nyeri"><input className={baseInput} value={form.lokasi_nyeri} onChange={(e) => set('lokasi_nyeri', e.target.value)} /></FieldBox>
      </div>

      <SectionTitle number="03" title="PEMERIKSAAN FISIK" />
      <div className="overflow-hidden rounded-xl border border-[#cfdee6]"><div className="grid min-w-[680px] grid-cols-[200px_90px_1fr] bg-[#edf3f7] px-3 py-3 text-[11px] font-bold text-[#4f6377]"><span>Bagian pemeriksaan</span><span className="text-center">Normal</span><span>Deskripsi / temuan</span></div><div className="min-w-[680px] divide-y divide-[#e0e9ed]">{examParts.map((part) => <div key={part} className="grid grid-cols-[200px_90px_1fr] items-center px-3 py-2"><span className="text-xs font-semibold text-[#4b6075]">{part}</span><label className="mx-auto grid size-5 place-items-center"><input type="checkbox" checked={exam[part].normal} onChange={(e) => setExam({ ...exam, [part]: { ...exam[part], normal: e.target.checked } })} className="size-4 accent-[#13a6b8]" /><span className="sr-only">{part} normal</span></label><input className="h-9 rounded-lg border border-[#cfdee6] bg-white px-3 text-xs outline-none focus:border-[#0ea5b7]" value={exam[part].note} onChange={(e) => setExam({ ...exam, [part]: { ...exam[part], note: e.target.value } })} /></div>)}</div></div>

      <SectionTitle number="04" title="STATUS LOKALIS / LUKA" />
      <div className="flex items-center gap-5 text-xs"><b className="text-[#3e5368]">Ada luka?</b><Choice label="Tidak" active={!hasWound} onClick={() => setHasWound(false)} /><Choice label="Ya" active={hasWound} onClick={() => setHasWound(true)} /></div>
      {hasWound && <div className="mt-4 space-y-3">{wounds.map((wound, index) => <div key={index} className="rounded-xl border border-[#b9dce4] bg-[#f3fafb] p-5"><div className="flex items-center justify-between"><label className="w-full max-w-[420px] text-xs font-semibold text-[#62768b]">Nama luka<input className={`${baseInput} mt-2`} value={wound.name} onChange={(e) => setWounds(wounds.map((w, i) => i === index ? { ...w, name: e.target.value } : w))} /></label><Button variant="outline" className="border-[#efc1c1] text-[#bd3030]" onClick={() => setWounds(wounds.filter((_, i) => i !== index))}><Trash2 className="size-4" /> Hapus luka</Button></div><div className="mt-4 grid gap-3 md:grid-cols-2"><SimpleField label="Lokasi luka" value={wound.location} onChange={(v) => setWounds(wounds.map((w, i) => i === index ? { ...w, location: v } : w))} placeholder="Contoh: tungkai kanan bawah" /><SimpleField label="Ukuran luka (P × L × D)" value={wound.size} onChange={(v) => setWounds(wounds.map((w, i) => i === index ? { ...w, size: v } : w))} placeholder="Panjang × lebar × kedalaman (cm)" /></div><label className="mt-4 block text-xs font-semibold text-[#62768b]">Pengkajian / deskripsi luka<textarea rows={4} className="mt-2 w-full rounded-xl border border-[#cfdee6] bg-white p-3 text-sm outline-none focus:border-[#0ea5b7]" value={wound.description} onChange={(e) => setWounds(wounds.map((w, i) => i === index ? { ...w, description: e.target.value } : w))} placeholder="Catat kondisi luka, jaringan, eksudat, dan kulit sekitar" /></label></div>)}<Button onClick={() => setWounds([...wounds, { name: `Luka ${wounds.length + 1}`, location: '', size: '', description: '' }])} className="bg-[#14a2b5]"><Plus className="size-4" /> Tambah luka</Button></div>}

      <SectionTitle number="05" title="HASIL PEMERIKSAAN PENUNJANG" />
      <div className="flex items-center gap-5 text-xs"><b className="text-[#3e5368]">Ada hasil pemeriksaan penunjang?</b><Choice label="Tidak" active={!hasSupport} onClick={() => setHasSupport(false)} /><Choice label="Ya" active={hasSupport} onClick={() => setHasSupport(true)} /></div>
      {hasSupport && <div className="mt-4 space-y-3">{supports.map((support, index) => <div key={index} className="rounded-xl border border-[#b9dce4] bg-[#f3fafb] p-5"><div className="flex items-center justify-between"><b className="text-sm text-[#21384b]">Hasil {index + 1}</b><Button variant="outline" className="border-[#efc1c1] text-[#bd3030]" onClick={() => setSupports(supports.filter((_, i) => i !== index))}><Trash2 className="size-4" /> Hapus hasil</Button></div><div className="mt-4 grid gap-3 md:grid-cols-3"><SimpleField label="Jenis hasil" value={support.type} onChange={(v) => setSupports(supports.map((s, i) => i === index ? { ...s, type: v } : s))} placeholder="Pilih jenis" /><SimpleField label="Nama pemeriksaan" value={support.name} onChange={(v) => setSupports(supports.map((s, i) => i === index ? { ...s, name: v } : s))} placeholder="Contoh: Rontgen thoraks" /><SimpleField label="Tanggal hasil" value={support.date} onChange={(v) => setSupports(supports.map((s, i) => i === index ? { ...s, date: v } : s))} placeholder="Pilih tanggal" /></div><label className="mt-4 block text-xs font-semibold text-[#62768b]">Ringkasan hasil<textarea rows={4} className="mt-2 w-full rounded-xl border border-[#cfdee6] bg-white p-3 text-sm outline-none focus:border-[#0ea5b7]" value={support.summary} onChange={(e) => setSupports(supports.map((s, i) => i === index ? { ...s, summary: e.target.value } : s))} placeholder="Catat temuan utama yang relevan" /></label></div>)}<Button onClick={() => setSupports([...supports, { type: '', name: '', date: '', summary: '', source: '', note: '' }])} className="bg-[#14a2b5]"><Plus className="size-4" /> Tambah Hasil Pemeriksaan Penunjang</Button></div>}
    </section>

    <section className="rounded-2xl border border-[#d2e1e7] bg-[#fbfdfe] p-5 sm:p-6"><h2 className="text-[21px] font-bold text-[#101f35]">Asesmen &amp; Rencana</h2><p className="mt-1 text-xs text-[#6b7f95]">Tetapkan diagnosis dan rencana klinis setelah pemeriksaan objektif selesai.</p><div className="mt-5 grid gap-4 lg:grid-cols-2"><Area label="Asesmen klinis" value={form.assessment_text} onChange={(v) => set('assessment_text', v)} /><Area label="Rencana pemeriksaan, terapi, dan tindak lanjut" value={form.plan_text} onChange={(v) => set('plan_text', v)} /></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><div><SimpleField label="Kode ICD-10 primer" value={form.dx_primary} onChange={(v) => set('dx_primary', v)} placeholder="Contoh: H81.1" />{icdSearch.data && <div className="mt-2 overflow-hidden rounded-xl border border-[#cfdee6] bg-white">{icdSearch.data.slice(0, 4).map((item) => <button key={item.code} type="button" onClick={() => set('dx_primary', item.code)} className="block w-full border-b px-3 py-2 text-left text-xs hover:bg-[#e7f6f8]"><b>{item.code}</b> · {item.display}</button>)}</div>}</div><SimpleField label="Kode ICD-10 tambahan" value={form.dx_secondary} onChange={(v) => set('dx_secondary', v)} placeholder="Pisahkan dengan koma" /></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><Area label="Instruksi kepada pasien" value={form.instruksi} onChange={(v) => set('instruksi', v)} /><Area label="Evaluasi dokter" value={form.evaluasi} onChange={(v) => set('evaluasi', v)} /></div></section>
    <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className="rounded-xl" onClick={() => navigate(`/kunjungan/${id}/draf-s`)}>Kembali</Button><Button variant="outline" className="rounded-xl" disabled={busy} onClick={() => save(false)}>Simpan draf</Button><Button disabled={busy} onClick={() => save(true)} className="rounded-xl bg-[#14a2b5] text-white hover:bg-[#0c8fa1]">Lanjut ke Tinjau &amp; Sahkan</Button></div>
  </div>
}

function SectionTitle({ number, title }: { number: string; title: string }) { return <h3 className="mb-3 mt-5 text-xs font-bold text-[#63778f]"><span className="mr-2">{number}</span>{title}</h3> }
function FieldBox({ label, children }: { label: string; children: React.ReactNode }) { return <label className="rounded-xl border border-[#d2e1e7] bg-[#f8fbfc] p-3 text-xs font-semibold text-[#62768b]">{label}<span className="mt-2 block">{children}</span></label> }
function UnitInput({ value, onChange, placeholder, unit }: { value: string; onChange: (value: string) => void; placeholder?: string; unit?: string }) { return <span className="relative block"><input className={`${baseInput} pr-16`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /><span className="absolute inset-y-0 right-3 flex items-center text-[11px] font-medium text-[#8799ad]">{unit}</span></span> }
function PairInput({ left, right, onLeft, onRight, unit }: { left: string; right: string; onLeft: (v: string) => void; onRight: (v: string) => void; unit?: string }) { return <span className="flex items-center gap-2"><input className={baseInput} value={left} onChange={(e) => onLeft(e.target.value)} /><b className="text-[#72869a]">/</b><input className={baseInput} value={right} onChange={(e) => onRight(e.target.value)} /><small className="text-[#8799ad]">{unit}</small></span> }
function RadioPair({ value, onChange, no, yes }: { value: string; onChange: (v: string) => void; no: string; yes: string }) { return <span className="flex h-10 items-center gap-5 rounded-lg border border-[#cfdee6] bg-white px-3"><Choice label="Tidak" active={value === no} onClick={() => onChange(no)} /><Choice label="Ya" active={value === yes} onClick={() => onChange(yes)} /></span> }
function Choice({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className="inline-flex items-center gap-2 text-xs text-[#43576b]"><span className={`grid size-4 place-items-center rounded-full border ${active ? 'border-[#0ea5b7]' : 'border-[#9aabba]'}`}>{active && <span className="size-2 rounded-full bg-[#0ea5b7]" />}</span>{label}</button> }
function SimpleField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) { return <label className="block text-xs font-semibold text-[#62768b]">{label}<input className={`${baseInput} mt-2`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></label> }
function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) { return <label className="block text-xs font-semibold text-[#62768b]">{label}<textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl border border-[#cfdee6] bg-white p-3 text-sm font-normal outline-none focus:border-[#0ea5b7]" /></label> }
