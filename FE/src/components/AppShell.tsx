import { useState } from 'react'
import { Bell, Building2, CalendarDays, History, Menu, Settings, Stethoscope, X } from 'lucide-react'
import { NavLink } from 'react-router'
import { Button } from '@/components/ui/button'
import type { User } from '@/lib/types'

const today = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta',
}).format(new Date())

export function AppShell({ user, location, visitId, onLogout, children }: {
  user: User
  location?: string
  pageTitle?: string
  visitId?: number
  onLogout: () => void
  children: React.ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const room = location?.replace('Poli ', '') || 'Umum 03'

  return (
    <div className="min-h-screen bg-[#eaf3f6] lg:grid lg:grid-cols-[288px_minmax(0,1fr)]">
      <aside className="z-20 flex flex-col border-b border-[#cfdee5] bg-[#f8fbfc] lg:fixed lg:inset-y-0 lg:left-0 lg:w-72 lg:border-b-0 lg:border-r">
        <div className="flex h-[70px] items-center justify-between border-b border-[#cfdee5] px-6">
          <img src="/comehear-logo.png" alt="ComeHear" className="h-[44px] w-[190px] object-contain object-left" />
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}</Button>
        </div>

        <div className={`${menuOpen ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col px-4 pb-5 pt-8 lg:flex`}>
          <p className="px-2 text-[11px] font-medium tracking-wide text-[#5d6e7d]">LAYANAN KLINIS</p>
          <nav className="mt-2 space-y-1" aria-label="Layanan klinis">
            <NavLink to="/kunjungan" className={({ isActive }) => `flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold transition-colors ${isActive || visitId ? 'bg-[#16a4b7] text-white' : 'text-[#4b5d6b] hover:bg-[#e5f4f7]'}`}>
              <Stethoscope className="size-[18px]" /> Pemeriksaan Pasien
            </NavLink>
            <span aria-disabled="true" className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-[#4b5d6b]">
              <History className="size-[18px]" /> Riwayat Pasien
            </span>
          </nav>

          <div className="mt-auto rounded-xl border border-[#8bdbe7] bg-[#dcf5f8] px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#087b8c] text-white"><Stethoscope className="size-5" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-[#102a43]">{user.name}</p><p className="truncate text-[11px] text-[#3d5566]">Klinik Bunga Melati</p></div>
              <button type="button" onClick={onLogout} aria-label="Keluar dari akun" title="Keluar" className="grid size-8 place-items-center rounded-lg text-[#38505e] hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-[#0ea5b7]"><Settings className="size-[18px]" /></button>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 lg:col-start-2">
        <header className="sticky top-0 z-10 flex min-h-[70px] flex-wrap items-center justify-between gap-3 border-b border-[#cfdee5] bg-[#f9fcfd]/95 px-6 py-3 backdrop-blur">
          <div><p className="text-[11px] font-medium text-[#00889a]">Poli Umum</p><p className="text-base font-bold leading-5 text-[#102a43]">Bilik Konsultasi 03</p></div>
          <div className="flex items-center gap-2 text-sm text-[#102a43]">
            <button type="button" className="hidden h-10 items-center gap-2 rounded-xl border border-[#d2e1e7] bg-white px-3 shadow-sm sm:flex"><Building2 className="size-4 text-[#0ea5b7]" /> {room}</button>
            <span className="hidden h-10 items-center gap-2 rounded-xl border border-[#d2e1e7] bg-white px-3 font-semibold shadow-sm md:flex"><CalendarDays className="size-4 text-[#0ea5b7]" /> {today}</span>
            <span className="relative grid size-10 place-items-center rounded-xl border border-[#d2e1e7] bg-white shadow-sm" aria-label="Notifikasi"><Bell className="size-[18px] text-[#305165]" /><span className="absolute right-2 top-2 size-2 rounded-full bg-[#e03131] ring-2 ring-white" /></span>
          </div>
        </header>
        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
