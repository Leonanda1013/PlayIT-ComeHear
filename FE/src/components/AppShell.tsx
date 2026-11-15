import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Building2, CalendarDays, CheckCircle2, ChevronDown, CloudUpload, FileText, History, LayoutDashboard, LogOut, Menu, Settings, User as UserIcon, UserRound, Users, X } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router'
import { btn, Dialog } from '@/components/ui/kit'
import { getLocations, getNotifications, setLocation } from '@/lib/rm'
import { getClinicProfile } from '@/lib/clinicConfig'
import { isDoctor } from '@/lib/format'
import type { LocationRef, User } from '@/lib/types'

const todayLabel = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date()).replace('.', '')

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; match?: string[] }

const doctorNav: NavItem[] = [
  { to: '/kunjungan', label: 'Pemeriksaan Pasien', icon: Users, match: ['/kunjungan'] },
  { to: '/riwayat', label: 'Riwayat Pasien', icon: History, match: ['/riwayat'] },
]
const rmNav: NavItem[] = [
  { to: '/rm', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/rm/pendaftaran', label: 'Pendaftaran Pasien & Kunjungan', icon: UserRound },
  { to: '/rm/kunjungan', label: 'Daftar Kunjungan', icon: CalendarDays },
  { to: '/rm/riwayat', label: 'Riwayat Pasien', icon: FileText },
  { to: '/rm/satusehat', label: 'Integrasi SATUSEHAT', icon: CloudUpload },
]

function readLocCookie() {
  const match = document.cookie.match(/(?:^|; )loc=(\d+)/)
  return match ? Number(match[1]) : null
}

export function AppShell({ user, onLogout, title, subtitle, children }: {
  user: User
  onLogout: () => void
  /** Baris besar di header. Default: nama bilik aktif. */
  title?: string
  /** Baris kecil teal di atas judul header. Default: poli aktif. */
  subtitle?: string
  children: React.ReactNode
}) {
  const doctor = isDoctor(user.role)
  const nav = doctor ? doctorNav : rmNav
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [roomOpen, setRoomOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [locId, setLocId] = useState<number | null>(readLocCookie)
  const queryClient = useQueryClient()
  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations, staleTime: 5 * 60_000 })
  const clinic = useQuery({ queryKey: ['clinic-profile'], queryFn: getClinicProfile, staleTime: 10 * 60_000 })
  const notifs = useQuery({ queryKey: ['notifications'], queryFn: getNotifications, refetchInterval: 20_000 })
  const clinicName = clinic.data?.name || 'Klinik Bunga Melati'
  const unreadCount = notifs.data?.count || 0
  const current: LocationRef | undefined = locations.data?.find((l) => l.id === locId) || locations.data?.at(-1)
  const poli = current?.poli || 'Poli Umum'
  const room = current?.name || 'Bilik Konsultasi 03'
  const shortRoom = current?.label || 'Umum 03'

  async function chooseRoom(loc: LocationRef) {
    setRoomOpen(false)
    await setLocation(loc.id)
    setLocId(loc.id)
    await queryClient.invalidateQueries()
  }

  return (
    <div className="min-h-screen bg-ch-bg lg:grid lg:grid-cols-[288px_minmax(0,1fr)] print:block print:min-h-0 print:bg-white">
      <aside className="z-30 flex flex-col border-b border-[#d3e2e8] bg-[#f6fafb] lg:fixed lg:inset-y-0 lg:left-0 lg:w-72 lg:border-b-0 lg:border-r print:hidden">
        <div className="flex h-[71px] shrink-0 items-center justify-between border-b border-[#d3e2e8] px-6 lg:justify-center">
          <span className="relative block h-[44px] w-[160px] overflow-hidden" role="img" aria-label="ComeHear AI Medical Scribe"><img src="/comehear-logo.png" alt="" className="absolute left-[-8px] top-[-18.7px] w-[171px] max-w-none" /></span>
          <button type="button" className="grid size-9 place-items-center rounded-lg text-ch-muted hover:bg-[#e6f1f4] lg:hidden" aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}</button>
        </div>

        <div className={`${menuOpen ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col px-4 pb-[25px] pt-[30px] lg:flex`}>
          <p className="px-2 text-[11px] font-medium tracking-[0.04em] text-[#5d6e7d]">LAYANAN KLINIS</p>
          <nav className="mt-2 space-y-1" aria-label="Menu utama">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/rm'} onClick={() => setMenuOpen(false)}
                className={({ isActive }) => {
                  const active = isActive || (item.match?.some((prefix) => pathname.startsWith(prefix)) ?? false)
                  return `flex min-h-[38px] items-center gap-2.5 rounded-[6px] px-2 transition-colors ${active ? 'bg-ch-brand text-[14px] font-semibold text-white' : 'text-[13px] text-[#33475b] hover:bg-[#e3f2f5]'}`
                }}>
                <item.icon className="size-[18px]" /> {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="relative -mx-2 mt-auto pt-6">
            {accountOpen && <AccountPopover user={user} doctor={doctor} clinicName={clinicName} onClose={() => setAccountOpen(false)} onLogout={() => { setAccountOpen(false); setConfirmLogout(true) }} />}
            <button type="button" onClick={() => setAccountOpen(!accountOpen)} aria-expanded={accountOpen} className="flex w-full items-center gap-2.5 h-[60px] rounded-[10px] border border-[#a8e0e8] bg-[#dcf3f6] px-3 text-left transition hover:border-ch-brand">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#0b6e7d] text-white"><UserIcon className="size-[18px]" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold text-ch-ink">{doctor ? user.name : 'Petugas Rekam Medis'}</span><span className="block truncate text-[11px] text-[#3d5566]">{clinicName}</span></span>
              {doctor ? <Settings className="size-[17px] text-[#38505e]" /> : <ChevronDown className="size-4 text-[#38505e]" />}
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 lg:col-start-2 print:col-start-auto">
        <header className="sticky top-0 z-20 flex min-h-[71px] flex-wrap items-center justify-between gap-3 border-b border-[#d3e2e8] bg-[#f6fafb]/95 px-6 py-2.5 backdrop-blur print:hidden">
          <div><p className="text-[12px] font-medium leading-4 text-[#0b8597]">{subtitle ?? poli}</p><p className="text-[18px] font-semibold leading-6 tracking-[-0.01em] text-ch-ink">{title ?? room}</p></div>
          <div className="flex items-center gap-2 text-[14px] text-ch-ink">
            <div className="relative hidden sm:block">
              <button type="button" onClick={() => setRoomOpen(!roomOpen)} aria-expanded={roomOpen} className="flex h-9 items-center gap-2 rounded-[10px] border border-[#d6e3e9] bg-white px-3 font-medium hover:border-ch-brand"><Building2 className="size-4 text-ch-brand" /> {shortRoom} <ChevronDown className="size-3.5 text-[#6b7f93]" /></button>
              {roomOpen && <div className="absolute right-0 top-11 z-40 w-64 rounded-[12px] border border-[#d3e2e8] bg-white p-1.5 shadow-lg" role="menu">
                <p className="px-2.5 py-1.5 text-[11px] font-semibold text-ch-muted">Pilih bilik layanan</p>
                {(locations.data || []).map((loc) => <button key={loc.id} type="button" role="menuitem" onClick={() => void chooseRoom(loc)} className={`flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-[#eef6f8] ${loc.id === current?.id ? 'bg-[#e6f6f8]' : ''}`}><span className="text-[13px] font-semibold">{loc.name}</span><span className="text-[11px] text-ch-muted">{loc.poli}</span></button>)}
              </div>}
            </div>
            <span className="hidden h-9 items-center gap-2 rounded-[10px] border border-[#d6e3e9] bg-white px-3 font-semibold md:flex"><CalendarDays className="size-4 text-ch-brand" /> {todayLabel}</span>
            <div className="relative">
              <button
                type="button"
                aria-label="Notifikasi"
                aria-expanded={bellOpen}
                onClick={() => setBellOpen(!bellOpen)}
                className="relative grid size-9 place-items-center rounded-[10px] border border-[#d2e1e7] bg-white shadow-sm hover:border-ch-brand"
              >
                <Bell className="size-[17px] text-[#305165]" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#e03131] px-1 text-[10px] font-bold text-white ring-2 ring-white">
                    {unreadCount}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 top-11 z-40 w-80 rounded-[14px] border border-[#d3e2e8] bg-white p-3 text-sm shadow-xl">
                  <div className="flex items-center justify-between border-b border-[#e5eef2] pb-2">
                    <p className="font-bold text-[14px] text-ch-ink">Pemberitahuan</p>
                    <span className="rounded-full bg-[#eef5f8] px-2 py-0.5 text-[11px] font-semibold text-ch-teal">
                      {unreadCount} aktif
                    </span>
                  </div>
                  <div className="mt-2 max-h-72 overflow-y-auto divide-y divide-[#f0f5f7]">
                    {notifs.isPending ? (
                      <p className="py-4 text-center text-xs text-ch-muted">Memuat notifikasi…</p>
                    ) : !notifs.data?.items?.length ? (
                      <div className="py-6 text-center">
                        <CheckCircle2 className="mx-auto size-7 text-[#2cb170]" />
                        <p className="mt-1.5 text-xs font-semibold text-ch-ink">Semua Beres</p>
                        <p className="text-[11px] text-ch-muted">Tidak ada kendala SATUSEHAT atau antrean tertunda.</p>
                      </div>
                    ) : (
                      notifs.data.items.map((item) => (
                        <Link
                          key={item.id}
                          to={item.link}
                          onClick={() => setBellOpen(false)}
                          className="flex items-start gap-2.5 py-2.5 px-1 hover:bg-[#f3f9fb] rounded-lg transition-colors"
                        >
                          <span className={`mt-1 size-2 rounded-full shrink-0 ${
                            item.severity === 'danger' ? 'bg-[#e03131]' : item.severity === 'warning' ? 'bg-[#f59f00]' : 'bg-[#1098ad]'
                          }`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-ch-ink truncate">{item.title}</p>
                            <p className="text-[11px] text-ch-muted leading-tight line-clamp-2">{item.message}</p>
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1180px] p-4 sm:p-6 print:max-w-none print:p-0 print:m-0">{children}</main>
      </div>

      <Dialog open={confirmLogout} onClose={() => setConfirmLogout(false)} title="Keluar dari akun?">
        <p className="text-sm text-ch-muted">Sesi {doctor ? 'dokter' : 'petugas'} akan diakhiri. Draf yang belum disimpan pada halaman ini akan hilang.</p>
        <div className="mt-6 flex justify-end gap-3"><button type="button" className={btn.outline} onClick={() => setConfirmLogout(false)}>Batal</button><button type="button" className={btn.danger} onClick={onLogout}><LogOut className="size-4" /> Ya, Logout</button></div>
      </Dialog>
    </div>
  )
}

function AccountPopover({ user, doctor, clinicName, onClose, onLogout }: { user: User; doctor: boolean; clinicName: string; onClose: () => void; onLogout: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) onClose() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    setTimeout(() => document.addEventListener('mousedown', onDown))
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])
  return <div ref={ref} className="absolute bottom-[72px] left-0 z-40 w-[272px] rounded-[14px] border border-[#d3e2e8] bg-white p-3 shadow-[0_12px_32px_rgba(8,29,45,0.14)]">
    <div className="flex items-center gap-3 border-b border-[#e3ecf0] pb-3">
      <span className="grid size-10 place-items-center rounded-full bg-[#0b6e7d] text-white"><UserIcon className="size-5" /></span>
      <div className="min-w-0"><p className="truncate text-sm font-bold">{user.name}</p><p className="truncate text-xs text-ch-muted">{user.email}</p><p className="text-[11px] text-ch-teal">{doctor ? `Dokter · ${clinicName}` : `Petugas Rekam Medis · ${clinicName}`}</p></div>
    </div>
    {doctor && <button type="button" onClick={onClose} className="mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[#33475b] hover:bg-[#eef6f8]"><Settings className="size-4" /> Pengaturan</button>}
    <button type="button" onClick={onLogout} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-[#bf2e36] hover:bg-[#fdecec]"><LogOut className="size-4" /> Logout</button>
  </div>
}
