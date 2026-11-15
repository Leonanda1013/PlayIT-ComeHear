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

/**
 * Format nama file ekspor dokumen ComeHear sesuai standar administrasi rekam medis:
 * ComeHear_NoRM_YYYYMMDD_JenisDokumen(.pdf)
 * 
 * Contoh: ComeHear_2026-9041_20261115_ResumeMedis.pdf
 */
export function formatExportFileName({
  rmNumber,
  visitDate,
  visitCode,
  docType = 'ResumeMedis',
  extension = '',
}: {
  rmNumber?: string | null
  visitDate?: string | Date | null
  visitCode?: string | null
  docType?: string
  extension?: string
}): string {
  // 1. Sanitasi Nomor RM dari karakter tidak valid pada nama file
  const rawRm = (rmNumber || 'UNKNOWN').trim()
  const cleanRm = rawRm
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '')
    .replace(/^-+|-+$/g, '') || 'RM'

  // 2. Ekstraksi tanggal kunjungan pasien (YYYYMMDD) berbasis tanggal kunjungan, bukan waktu unduh
  let yyyymmdd = ''

  if (visitDate) {
    const d = typeof visitDate === 'string' ? new Date(visitDate.length === 10 ? `${visitDate}T00:00:00` : visitDate) : visitDate
    if (!Number.isNaN(d.getTime())) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(d)
      const y = parts.find((p) => p.type === 'year')?.value || ''
      const m = parts.find((p) => p.type === 'month')?.value || ''
      const day = parts.find((p) => p.type === 'day')?.value || ''
      if (y && m && day) {
        yyyymmdd = `${y}${m}${day}`
      }
    }
  }

  // Jika belum dapat, ekstraksi tanggal dari visitCode (misal format "2026/11/15/0008")
  if (!yyyymmdd && visitCode) {
    const codeMatch = visitCode.match(/(\d{4})[/-](\d{2})[/-](\d{2})/)
    if (codeMatch) {
      yyyymmdd = `${codeMatch[1]}${codeMatch[2]}${codeMatch[3]}`
    }
  }

  // Fallback jika tidak ada info tanggal kunjungan
  if (!yyyymmdd) {
    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    yyyymmdd = `${parts.find((p) => p.type === 'year')?.value || ''}${parts.find((p) => p.type === 'month')?.value || ''}${parts.find((p) => p.type === 'day')?.value || ''}`
  }

  // 3. Sanitasi jenis dokumen
  const cleanDocType = (docType || 'Dokumen')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '')

  const ext = extension ? (extension.startsWith('.') ? extension : `.${extension}`) : ''
  return `ComeHear_${cleanRm}_${yyyymmdd}_${cleanDocType}${ext}`
}

/**
 * Mencetak dokumen dengan mengatur judul dokumen (document.title) otomatis
 * agar nama file default saat simpan/ekspor PDF sesuai format ComeHear.
 */
export function printResumeDocument(params: {
  rmNumber?: string | null
  visitDate?: string | Date | null
  visitCode?: string | null
  docType?: string
}) {
  const originalTitle = document.title
  const targetTitle = formatExportFileName(params)

  document.title = targetTitle

  const restore = () => {
    document.title = originalTitle
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)

  try {
    window.print()
  } finally {
    setTimeout(() => {
      document.title = originalTitle
    }, 1500)
  }
}

