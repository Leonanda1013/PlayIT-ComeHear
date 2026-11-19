import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { SessionProps } from '@/App'
import { AppShell } from '@/components/AppShell'
import { btn, Dialog } from '@/components/ui/kit'
import { getClinicProfile } from '@/lib/clinicConfig'
import { initials } from '@/lib/format'
import { getLocations } from '@/lib/rm'

/** Preferensi disimpan di perangkat ini saja (per akun), bukan di server. */
type Prefs = { language: 'id' | 'en'; queueNotif: boolean; examReminder: boolean }
const DEFAULT_PREFS: Prefs = { language: 'id', queueNotif: true, examReminder: true }
const prefsKey = (userId: number) => `comehear:prefs:${userId}`

function loadPrefs(userId: number): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(prefsKey(userId)) || '{}') } } catch { return DEFAULT_PREFS }
}

function readLocCookie() {
  const match = document.cookie.match(/(?:^|; )loc=(\d+)/)
  return match ? Number(match[1]) : null
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex min-h-[50px] items-center justify-between gap-4 text-[13px]"><span className="text-[#5f7284]">{label}</span><span className="text-right font-semibold text-ch-ink">{children}</span></div>
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`font-semibold ${on ? 'text-ch-ink' : 'text-[#9aabba]'} hover:text-ch-teal`}>{on ? 'Aktif' : 'Nonaktif'}</button>
}

export function SettingsPage({ user, onLogout }: SessionProps) {
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(user.id))
  const [confirmLogout, setConfirmLogout] = useState(false)
  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations, staleTime: 5 * 60_000 })
  const clinic = useQuery({ queryKey: ['clinic-profile'], queryFn: getClinicProfile, staleTime: 10 * 60_000 })
  // Nama dari backend berformat kop surat (huruf kapital); di layar ditampilkan Title Case seperti desain.
  const clinicName = (clinic.data?.name || 'Klinik Bunga Melati').toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  const locId = readLocCookie()
  const current = locations.data?.find((l) => l.id === locId)
    || locations.data?.find((l) => l.id === user.default_location_id) || locations.data?.at(-1)

  function update(patch: Partial<Prefs>) {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    try { localStorage.setItem(prefsKey(user.id), JSON.stringify(next)) } catch { /* penyimpanan perangkat tidak tersedia */ }
  }

  const card = 'rounded-[16px] border border-[#dce6eb] bg-[#fbfdfe] px-6 pb-4 pt-6'

  return <AppShell user={user} onLogout={onLogout}>
    <div className="-mt-2 mb-[22px] flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-[28px] font-bold leading-9 tracking-[-0.02em] text-ch-ink">Pengaturan Akun</h1><p className="mt-1 text-[13px] text-[#5f7284]">Kelola informasi akun, preferensi kerja, dan sesi dokter.</p></div>
      <button type="button" onClick={() => navigate('/kunjungan')} className="inline-flex h-[44px] items-center gap-2 rounded-[10px] border border-[#dce6eb] bg-white px-4 text-[13px] font-medium text-[#3d5266] hover:border-ch-brand hover:text-ch-teal"><ArrowLeft className="size-4" /> Kembali ke antrean</button>
    </div>

    <div className="grid items-start gap-[22px] lg:grid-cols-2">
      <section className={card}>
        <h2 className="text-[19px] font-bold text-ch-ink">Profil Dokter</h2>
        <p className="mt-3 text-[12px] text-[#5f7284]">Akun yang sedang digunakan pada perangkat ini.</p>
        <div className="mt-3 flex items-center gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-ch-brand text-[15px] font-bold text-white">{initials(user.name.replace(/^dr\.?\s*/i, ''))}</span>
          <div className="min-w-0"><p className="truncate text-[15px] font-bold text-ch-ink">{user.name}</p><p className="text-[12px] text-[#5f7284]">Dokter · {clinicName}</p></div>
        </div>
        <div className="mt-2">
          <Row label="Fasilitas">{clinicName}</Row>
          <Row label="Poli aktif">{current?.poli || '—'}</Row>
          <Row label="Bilik aktif">{current?.name.replace(/^Bilik\s*/i, '') || '—'}</Row>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-[19px] font-bold text-ch-ink">Preferensi</h2>
        <p className="mt-3 text-[12px] text-[#5f7284]">Atur cara kerja dan pemberitahuan selama bertugas.</p>
        <div className="mt-2">
          <Row label="Bahasa aplikasi">
            <label className="relative inline-flex items-center"><span className="sr-only">Bahasa aplikasi</span>
              <select value={prefs.language} onChange={(e) => update({ language: e.target.value as Prefs['language'] })} className="appearance-none bg-transparent pr-5 text-right font-semibold text-ch-ink outline-none">
                <option value="id">Bahasa Indonesia</option>
                <option value="en">English</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 size-3.5" />
            </label>
          </Row>
          <Row label="Notifikasi antrean"><Toggle label="Notifikasi antrean" on={prefs.queueNotif} onChange={(v) => update({ queueNotif: v })} /></Row>
          <Row label="Pengingat pemeriksaan"><Toggle label="Pengingat pemeriksaan" on={prefs.examReminder} onChange={(v) => update({ examReminder: v })} /></Row>
        </div>
        <p className="mt-2 rounded-[10px] bg-[#e4f4f7] px-3.5 py-3 text-[12px] text-[#3d5266]">Perubahan preferensi berlaku untuk akun dokter ini.</p>
      </section>
    </div>

    <section className="mt-[25px] flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[#f1c7cd] bg-white px-6 py-[22px]">
      <div><h2 className="text-[18px] font-bold text-ch-ink">Keluar dari akun</h2><p className="mt-1 text-[13px] text-[#5f7284]">Akhiri sesi dokter pada perangkat ini. Pastikan catatan yang sedang dikerjakan telah tersimpan.</p></div>
      <button type="button" onClick={() => setConfirmLogout(true)} className="inline-flex h-[44px] w-[138px] items-center justify-center rounded-[10px] border border-[#f0b4bb] bg-[#fdeef0] text-[14px] font-semibold text-[#c2303b] hover:bg-[#fbe0e4]">Logout</button>
    </section>

    <Dialog open={confirmLogout} onClose={() => setConfirmLogout(false)} title="Keluar dari akun?">
      <p className="text-sm text-ch-muted">Sesi dokter akan diakhiri. Draf yang belum disimpan pada halaman lain akan hilang.</p>
      <div className="mt-6 flex justify-end gap-3"><button type="button" className={btn.outline} onClick={() => setConfirmLogout(false)}>Batal</button><button type="button" className={btn.danger} onClick={onLogout}><LogOut className="size-4" /> Ya, Logout</button></div>
    </Dialog>
  </AppShell>
}
