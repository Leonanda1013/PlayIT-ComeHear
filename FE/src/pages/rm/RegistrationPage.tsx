import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowRight, CheckCircle2, FileText, Pencil, Search } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { SessionProps } from '@/App'
import { AppShell } from '@/components/AppShell'
import { PageTitle } from '@/components/ClinicalHeader'
import { EditPatientDialog } from '@/components/EditPatientDialog'
import { btn, Dialog, inputClass, Label, Notice, Panel, SelectInput, TextArea } from '@/components/ui/kit'
import { dateLong, dateShort, initials, todayIso } from '@/lib/format'
import { createPatient, createVisit, getLocations, getPractitioners, getRegistration, type NewPatient } from '@/lib/rm'
import type { Patient } from '@/lib/types'

const STEPS = ['Cari Pasien', 'Data Kunjungan', 'Konfirmasi']
const emptyPatient: NewPatient = { name: '', nik: '', birth_date: '', gender: '', phone: '', address: '' }
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
const maskNik = (nik?: string | null) => nik && nik.length === 16 ? `${nik.slice(0, 4)}••••••••${nik.slice(-4)}` : 'Belum tercatat'

function Stepper({ step }: { step: number }) {
  return <ol className="mb-5 flex flex-wrap items-center gap-3 text-[12px]">
    {STEPS.map((label, i) => <li key={label} className="flex items-center gap-3">
      <span className={`flex items-center gap-2 ${i <= step ? 'font-semibold text-ch-teal' : 'text-ch-muted'}`}><span className={`grid size-5 place-items-center rounded-full text-[10px] font-bold ${i <= step ? 'bg-ch-brand text-white' : 'bg-[#e1eaee] text-ch-muted'}`}>{i + 1}</span>{label}</span>
      {i < STEPS.length - 1 && <span className={`h-px w-16 ${i < step ? 'bg-ch-brand' : 'bg-[#cfdde4]'}`} />}
    </li>)}
  </ol>
}

function PatientLine({ p }: { p: Patient }) {
  return <p className="text-[11px] text-ch-muted">RM-{p.rm_number} · {dateShort(p.birth_date)} · {p.gender_label}{p.nik ? ` · NIK ${maskNik(p.nik)}` : ''}</p>
}

export function RegistrationPage({ user, onLogout }: SessionProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [searchPage, setSearchPage] = useState(1)
  const [showAllSearch, setShowAllSearch] = useState(false)
  const [selected, setSelected] = useState<Patient | null>(null)
  const [np, setNp] = useState<NewPatient>(emptyPatient)
  const [npErrors, setNpErrors] = useState<Partial<Record<keyof NewPatient, string>>>({})
  const [nikApiError, setNikApiError] = useState<string | null>(null)
  const [visit, setVisit] = useState({ visit_date: todayIso(), location_id: 0, practitioner_id: 0, visit_type: 'Baru', admin_note: '' })
  const [visitErrors, setVisitErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState<string | null>(null)
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null)

  const registry = useQuery({ queryKey: ['registry'], queryFn: () => getRegistration() })
  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations })
  const doctors = useQuery({ queryKey: ['practitioners'], queryFn: getPractitioners })
  const patients = useMemo(() => registry.data?.patients || [], [registry.data])

  const PAGE_SIZE = 6

  const allSearchResults = useMemo(() => {
    const q = norm(submitted)
    if (!q) return []
    const tokens = q.split(/[\s-–]+/).filter((t) => t.length > 1)
    return patients.filter((p) => {
      const hay = norm(`${p.name} ${p.rm_number} ${p.nik || ''} ${dateShort(p.birth_date)} ${p.birth_date || ''}`)
      return tokens.every((t) => hay.includes(t)) || hay.includes(q)
    })
  }, [submitted, patients])

  const totalSearchPages = Math.max(1, Math.ceil(allSearchResults.length / PAGE_SIZE))
  const results = useMemo(() => {
    if (showAllSearch) return allSearchResults
    const start = (searchPage - 1) * PAGE_SIZE
    return allSearchResults.slice(start, start + PAGE_SIZE)
  }, [allSearchResults, searchPage, showAllSearch])

  const duplicate = useMemo(() => np.name.trim() && np.birth_date ? patients.find((p) => norm(p.name) === norm(np.name) && p.birth_date === np.birth_date) : undefined, [np, patients])
  const duplicateNikPatient = useMemo(() => np.nik.length === 16 ? patients.find((p) => p.nik === np.nik) : null, [np.nik, patients])

  const savePatient = useMutation({
    mutationFn: () => createPatient(np),
    onSuccess: async (data) => {
      setSelected(data.patient)
      setNp(emptyPatient)
      setNikApiError(null)
      await queryClient.invalidateQueries({ queryKey: ['registry'] })
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan pasien.'
      if (/nik|duplikat|terdaftar|conflict/i.test(msg)) {
        setNikApiError(msg)
      }
    },
  })
  const saveVisit = useMutation({
    mutationFn: () => createVisit({ ...visit, patient_id: selected!.id }),
    onSuccess: async (data) => { setSuccess(data.message); await queryClient.invalidateQueries({ queryKey: ['rm-visits'] }); await queryClient.invalidateQueries({ queryKey: ['registry'] }) },
  })

  function submitPatient() {
    const errors: typeof npErrors = {}
    if (!np.name.trim()) errors.name = 'Nama lengkap wajib diisi.'
    if (!/^\d{16}$/.test(np.nik)) errors.nik = 'NIK harus 16 digit angka.'
    if (!np.birth_date) errors.birth_date = 'Pilih tanggal lahir.'
    if (!np.gender) errors.gender = 'Pilih jenis kelamin.'
    if (!np.address.trim()) errors.address = 'Alamat wajib diisi.'
    setNpErrors(errors)
    if (!Object.keys(errors).length) savePatient.mutate()
  }

  function toConfirm() {
    const errors: Record<string, string> = {}
    if (!visit.visit_date) errors.visit_date = 'Pilih tanggal kunjungan.'
    if (!visit.location_id) errors.location_id = 'Pilih bilik tujuan.'
    if (!visit.practitioner_id) errors.practitioner_id = 'Pilih dokter tujuan.'
    setVisitErrors(errors)
    if (!Object.keys(errors).length) setStep(2)
  }

  // Isi otomatis hanya kolom yang masih kosong: pilihan dokter/bilik dari petugas tidak boleh ditimpa.
  function selectRoom(location_id: number) {
    const doctor = doctors.data?.find((d) => d.default_location_id === location_id)
    setVisit({ ...visit, location_id, practitioner_id: visit.practitioner_id || doctor?.id || 0 })
  }

  function selectDoctor(practitioner_id: number) {
    const doctor = doctors.data?.find((d) => d.id === practitioner_id)
    setVisit({ ...visit, practitioner_id, location_id: visit.location_id || doctor?.default_location_id || 0 })
  }

  const loc = locations.data?.find((l) => l.id === visit.location_id)
  const doc = doctors.data?.find((d) => d.id === visit.practitioner_id)
  const err = (m?: string) => m ? <p className="mt-1 text-[11px] text-ch-bad">{m}</p> : null
  const set = (k: keyof NewPatient, v: string) => setNp({ ...np, [k]: v })

  return <AppShell user={user} onLogout={onLogout}>
    <PageTitle title="Pendaftaran Pasien & Kunjungan" subtitle="Lengkapi data pasien dan kunjungan sebelum memasukkan ke antrean dokter." />
    <Stepper step={step} />

    {step === 0 && <>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel className="min-h-[430px]">
          <h2 className="text-[16px] font-bold">Cari pasien lama</h2>
          <form className="mt-3" onSubmit={(e) => { e.preventDefault(); setSubmitted(query); setSearchPage(1); setShowAllSearch(false) }}>
            <Label htmlFor="cari" required>Nomor RM, NIK, atau nama dan tanggal lahir</Label>
            <label className="relative block"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b7f93]" /><input id="cari" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Contoh: Ayu Lestari – 12 Mei 1992" className={`${inputClass} pl-9`} /></label>
            <button type="submit" className={`${btn.primary} mt-3 h-9 text-[13px]`}>Cari Pasien</button>
          </form>
          {registry.isError && <div className="mt-3"><Notice tone="bad">{registry.error.message}</Notice></div>}
          {submitted && <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-ch-muted">
              <span>Ditemukan <b>{allSearchResults.length}</b> pasien untuk pencarian "{submitted}"</span>
              {allSearchResults.length > PAGE_SIZE && !showAllSearch && (
                <button
                  type="button"
                  onClick={() => setShowAllSearch(true)}
                  className="text-[11px] font-semibold text-ch-brand hover:underline"
                >
                  Lihat Semua ({allSearchResults.length})
                </button>
              )}
              {showAllSearch && (
                <button
                  type="button"
                  onClick={() => setShowAllSearch(false)}
                  className="text-[11px] font-semibold text-ch-brand hover:underline"
                >
                  Tampilkan per Halaman
                </button>
              )}
            </div>

            {results.length === 0 ? <p className="rounded-[10px] bg-[#f1f6f8] p-3 text-xs text-ch-muted">Pasien tidak ditemukan. Daftarkan sebagai pasien baru di panel kanan.</p> : results.map((p) => {
              const active = selected?.id === p.id
              return <div key={p.id} className={`flex items-center gap-3 rounded-[12px] border bg-white px-3 py-2.5 ${active ? 'border-ch-brand ring-1 ring-ch-brand' : 'border-[#d6e3e9]'}`}>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#dff4f7] text-xs font-bold text-ch-teal">{initials(p.name)}</span>
                <div className="min-w-0 flex-1"><p className="text-[13px] font-bold">{p.name}</p><PatientLine p={p} /></div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => setEditingPatient(p)} title="Edit data pasien" className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#d2e1e7] bg-white px-2.5 text-[11px] font-semibold text-[#374e61] hover:border-ch-brand hover:text-ch-teal"><Pencil className="size-3" /> Edit</button>
                  <button type="button" onClick={() => setSelected(p)} className={`inline-flex h-7 items-center rounded-[7px] px-3 text-[11px] font-semibold ${active ? 'border border-ch-brand bg-white text-ch-teal' : 'bg-ch-brand text-white hover:bg-ch-brand-hover'}`}>{active ? 'Terpilih' : 'Pilih Pasien'}</button>
                </div>
              </div>
            })}

            {/* Kontrol Paginasi untuk melihat lebih dari 6 hasil */}
            {allSearchResults.length > PAGE_SIZE && !showAllSearch && (
              <div className="mt-3 flex items-center justify-between border-t border-[#dce6eb] pt-3 text-xs">
                <span className="text-ch-muted">
                  Menampilkan {(searchPage - 1) * PAGE_SIZE + 1}–{Math.min(searchPage * PAGE_SIZE, allSearchResults.length)} dari {allSearchResults.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={searchPage <= 1}
                    onClick={() => setSearchPage((p) => Math.max(1, p - 1))}
                    className="inline-flex h-7 items-center rounded-[6px] border border-[#d2e1e7] bg-white px-2.5 text-[11px] font-semibold text-[#374e61] hover:bg-[#f0f4f7] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Sebelumnya
                  </button>
                  <span className="px-1 text-[11px] font-semibold text-[#374e61]">
                    {searchPage} / {totalSearchPages}
                  </span>
                  <button
                    type="button"
                    disabled={searchPage >= totalSearchPages}
                    onClick={() => setSearchPage((p) => Math.min(totalSearchPages, p + 1))}
                    className="inline-flex h-7 items-center rounded-[6px] border border-[#d2e1e7] bg-white px-2.5 text-[11px] font-semibold text-[#374e61] hover:bg-[#f0f4f7] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Berikutnya
                  </button>
                </div>
              </div>
            )}
          </div>}
          {duplicate && <div role="alert" className="mt-3 flex gap-3 rounded-[12px] border border-[#f3c58b] bg-[#fff6ec] p-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#f2a23a] text-xs font-bold text-white">!</span><div><p className="text-[12px] font-bold text-[#b45309]">Periksa kandidat sebelum membuat data baru.</p><p className="text-[11px] text-[#9a3412]">{duplicate.name} (RM-{duplicate.rm_number}) memiliki nama dan tanggal lahir yang sama. <button type="button" className="font-semibold underline" onClick={() => setSelected(duplicate)}>Pilih pasien ini</button></p></div></div>}
        </Panel>

        <Panel className="min-h-[430px]">
          <h2 className="text-[16px] font-bold">Daftarkan pasien baru</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="nama" required>Nama lengkap</Label><input id="nama" className={inputClass} value={np.name} onChange={(e) => set('name', e.target.value)} placeholder="Masukkan nama lengkap" />{err(npErrors.name)}</div>
            <div>
              <Label htmlFor="nik" required>NIK</Label>
              <input
                id="nik"
                inputMode="numeric"
                maxLength={16}
                className={`${inputClass} ${(nikApiError || duplicateNikPatient) ? 'border-ch-bad ring-1 ring-ch-bad' : ''}`}
                value={np.nik}
                onChange={(e) => {
                  set('nik', e.target.value.replace(/\D/g, ''))
                  setNikApiError(null)
                }}
                placeholder="Masukkan 16 digit"
              />
              {nikApiError ? (
                <p className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-ch-bad">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{nikApiError}</span>
                </p>
              ) : duplicateNikPatient ? (
                <p className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-ch-warn">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>NIK sudah terdaftar: {duplicateNikPatient.name} (RM-{duplicateNikPatient.rm_number})</span>
                </p>
              ) : err(npErrors.nik) || (
                <p className="mt-1 text-[10px] text-ch-faint">{np.nik.length}/16 digit</p>
              )}
            </div>
            <div><Label htmlFor="lahir" required>Tanggal lahir</Label><input id="lahir" type="date" max={todayIso()} className={inputClass} value={np.birth_date} onChange={(e) => set('birth_date', e.target.value)} />{err(npErrors.birth_date)}</div>
            <div><Label htmlFor="jk" required>Jenis kelamin</Label><SelectInput id="jk" value={np.gender} onChange={(e) => set('gender', e.target.value)}><option value="">Pilih jenis kelamin</option><option value="male">Laki-laki</option><option value="female">Perempuan</option></SelectInput>{err(npErrors.gender)}</div>
            <div className="sm:col-span-2"><Label htmlFor="telp">Nomor telepon</Label><input id="telp" inputMode="tel" className={inputClass} value={np.phone} onChange={(e) => set('phone', e.target.value.replace(/[^\d+]/g, ''))} placeholder="08xxxxxxxxxx" /></div>
            <div className="sm:col-span-2"><Label htmlFor="alamat" required>Alamat</Label><input id="alamat" className={inputClass} value={np.address} onChange={(e) => set('address', e.target.value)} placeholder="Masukkan alamat lengkap" />{err(npErrors.address)}</div>
          </div>
          <p className="mt-3 text-[11px] text-ch-muted">Nomor RM akan dibuat otomatis setelah pasien tersimpan.</p>
          {savePatient.isError && (
            <div className="mt-2">
              <Notice tone="bad">
                <AlertCircle className="mr-1 inline size-4" />
                {savePatient.error.message}
              </Notice>
            </div>
          )}
          {savePatient.isSuccess && <div className="mt-2"><Notice>{savePatient.data.message} Pasien otomatis dipilih.</Notice></div>}
          <button type="button" onClick={submitPatient} disabled={savePatient.isPending} className={`${btn.primary} mt-3 w-full`}>{savePatient.isPending ? 'Menyimpan…' : 'Simpan Pasien Baru'}</button>
        </Panel>
      </div>
      <div className="mt-5 flex gap-3"><button type="button" className={btn.outline} onClick={() => navigate('/rm/kunjungan')}>Kembali</button><button type="button" className={btn.primary} disabled={!selected} onClick={() => setStep(1)}>Lanjut ke Data Kunjungan <ArrowRight className="size-4" /></button></div>
      {!selected && <p className="mt-2 text-[11px] text-ch-muted">Pilih pasien lama atau simpan pasien baru untuk melanjutkan.</p>}
    </>}

    {step >= 1 && selected && <div className="mb-4 flex items-center gap-3 rounded-[14px] border border-[#8edbe6] bg-[#e6f6f8] px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-ch-teal">{initials(selected.name)}</span>
      <div className="min-w-0 flex-1"><p className="text-[13px] font-bold">{selected.name}</p><PatientLine p={selected} /></div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setEditingPatient(selected)} className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#8edbe6] bg-white px-2.5 text-[11px] font-semibold text-ch-teal hover:bg-[#d8f4f8]"><Pencil className="size-3" /> Edit Pasien</button>
        <button type="button" onClick={() => { setStep(0); setSelected(null) }} className="inline-flex h-7 items-center rounded-[7px] border border-[#8edbe6] bg-white px-3 text-[11px] font-semibold text-ch-teal">Ganti Pasien</button>
      </div>
    </div>}

    {step === 1 && <>
      <Panel className="p-5 sm:p-6">
        <h2 className="text-[16px] font-bold">Data Kunjungan</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div><Label htmlFor="tgl" required>Tanggal kunjungan</Label><input id="tgl" type="date" min={todayIso()} className={inputClass} value={visit.visit_date} onChange={(e) => setVisit({ ...visit, visit_date: e.target.value })} />{visit.visit_date && <p className="mt-1 text-[10px] text-ch-faint">{dateLong(visit.visit_date)}</p>}{err(visitErrors.visit_date)}</div>
          <div><Label htmlFor="bilik" required>Bilik tujuan</Label><SelectInput id="bilik" value={visit.location_id || ''} onChange={(e) => selectRoom(Number(e.target.value))}><option value="">Pilih bilik tujuan</option>{(locations.data || []).map((l) => <option key={l.id} value={l.id}>{l.poli} · {l.name}</option>)}</SelectInput>{err(visitErrors.location_id)}</div>
          <div><Label htmlFor="dokter" required>Dokter tujuan</Label><SelectInput id="dokter" value={visit.practitioner_id || ''} onChange={(e) => selectDoctor(Number(e.target.value))}><option value="">Pilih dokter</option>{(doctors.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</SelectInput>{err(visitErrors.practitioner_id)}</div>
          <div><Label htmlFor="jenis">Jenis kunjungan</Label><SelectInput id="jenis" value={visit.visit_type} onChange={(e) => setVisit({ ...visit, visit_type: e.target.value })}><option value="Baru">Baru</option><option value="Kontrol">Kontrol</option></SelectInput></div>
          <div className="md:col-span-2"><Label htmlFor="catatan">Catatan administratif (opsional)</Label><TextArea id="catatan" rows={2} value={visit.admin_note} onChange={(e) => setVisit({ ...visit, admin_note: e.target.value })} placeholder="Contoh: pasien membawa hasil laboratorium sebelumnya." /></div>
        </div>
        <p className="mt-3 flex items-center gap-2 text-[11px] text-ch-muted"><CheckCircle2 className="size-4 text-ch-brand" /> Nomor antrean akan ditentukan sistem setelah kunjungan disimpan.</p>
      </Panel>
      <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-[#a3dfea] bg-[#e6f6f8] px-4 py-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#0b6e7d] text-white"><FileText className="size-4" /></span><div><p className="text-[13px] font-bold">Setelah dikonfirmasi kedatangannya, kunjungan tersedia pada antrean dokter.</p><p className="text-[11px] text-ch-muted">Dokter menggunakan sesi akunnya sendiri untuk konsultasi dan pengesahan resume.</p></div></div>
      <div className="mt-5 flex gap-3"><button type="button" className={btn.outline} onClick={() => setStep(0)}>Kembali</button><button type="button" className={btn.primary} onClick={toConfirm}>Lanjut ke Konfirmasi <ArrowRight className="size-4" /></button></div>
    </>}

    {step === 2 && selected && <>
      <Panel className="p-5 sm:p-6">
        <h2 className="text-[16px] font-bold">Konfirmasi Pendaftaran</h2>
        <p className="mt-1 text-xs text-ch-muted">Periksa kembali identitas dan data kunjungan sebelum disimpan.</p>
        <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-[12px] border border-[#d6e3e9] bg-ch-field p-4 text-[13px] md:grid-cols-2">
          {[['Nama pasien', selected.name], ['Nomor RM', `RM-${selected.rm_number}`], ['Tanggal lahir', dateShort(selected.birth_date)], ['Jenis kelamin', selected.gender_label], ['Tanggal kunjungan', dateLong(visit.visit_date)], ['Poli tujuan', loc ? `${loc.poli} · ${loc.name}` : '—'], ['Dokter tujuan', doc?.name || '—'], ['Jenis kunjungan', visit.visit_type], ['Catatan', visit.admin_note || '—']].map(([k, v]) => <div key={k}><dt className="text-[11px] text-ch-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
        </dl>
        {saveVisit.isError && <div className="mt-3"><Notice tone="bad"><AlertCircle className="mr-1 inline size-4" />{saveVisit.error.message} Data belum tersimpan; periksa lalu coba lagi.</Notice></div>}
      </Panel>
      <div className="mt-5 flex gap-3"><button type="button" className={btn.outline} onClick={() => setStep(1)}>Kembali</button><button type="button" className={btn.primary} disabled={saveVisit.isPending} onClick={() => saveVisit.mutate()}>{saveVisit.isPending ? 'Menyimpan…' : 'Konfirmasi Pendaftaran'}</button></div>
    </>}

    <Dialog open={!!success} onClose={() => navigate('/rm/kunjungan')} title="Pendaftaran berhasil">
      <div className="text-center"><CheckCircle2 className="mx-auto size-10 text-ch-ok" /><p className="mt-3 text-sm">{success}</p><p className="mt-1 text-xs text-ch-muted">Status awal: Terjadwal. Konfirmasi kedatangan saat pasien tiba.</p></div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2"><button type="button" className={btn.outline} onClick={() => { setSuccess(null); setSelected(null); setStep(0); setQuery(''); setSubmitted(''); saveVisit.reset() }}>Daftarkan pasien lain</button><button type="button" className={btn.primary} onClick={() => navigate('/rm/kunjungan')}>Lihat Daftar Kunjungan</button></div>
    </Dialog>

    <EditPatientDialog
      patient={editingPatient}
      open={!!editingPatient}
      onClose={() => setEditingPatient(null)}
      onSuccess={(updated) => {
        if (selected?.id === updated.id) setSelected(updated)
      }}
    />
  </AppShell>
}
