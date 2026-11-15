const TZ = 'Asia/Jakarta'

export const isDoctor = (role?: string) => role === 'dokter'

/** "20/01/2007" dari "2007-01-20". */
export function dateId(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ }).format(d)
}

/** "27 Okt 2026". */
export function dateShort(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }).format(d).replace('.', '')
}

/** "Selasa, 3 November 2026". */
export function dateLong(value?: string | Date | null) {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T00:00:00` : value) : value
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(d)
}

/** "09.15 WIB". */
export function timeWib(value?: string | null) {
  if (!value) return '—'
  return `${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(value))} WIB`
}

export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

export function genderShort(label?: string | null) {
  return (label || '').toLowerCase().startsWith('l') ? 'L' : 'P'
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Status pengiriman SATUSEHAT untuk badge. */
export function submissionMeta(status: string | null | undefined, approved = true): { label: string; tone: 'ok' | 'bad' | 'info' | 'muted' } {
  if (!approved) return { label: 'Draf SOAP', tone: 'muted' }
  switch (status) {
    case 'SENT': return { label: 'SATUSEHAT Terkirim', tone: 'ok' }
    case 'NEEDS_ATTENTION': return { label: 'Gagal Terkirim', tone: 'bad' }
    case 'QUEUED': case 'SENDING': case 'RETRY_WAIT': case 'RECONCILING': return { label: 'Dalam Proses', tone: 'info' }
    default: return { label: 'Belum Dikirim', tone: 'muted' }
  }
}

export const rmStatusMeta: Record<string, { label: string; tone: 'info' | 'muted' | 'blue' | 'ok' }> = {
  terjadwal: { label: 'Terjadwal', tone: 'info' },
  menunggu_pemeriksaan: { label: 'Menunggu Pemeriksaan', tone: 'muted' },
  dalam_pemeriksaan: { label: 'Dalam Pemeriksaan', tone: 'blue' },
  selesai: { label: 'Selesai', tone: 'ok' },
}
