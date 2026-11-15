import type { Visit } from '@/lib/types'

export const QUEUE_KEY = ['queue']

const byQueue = (rows: Visit[]) => [...rows].sort((a, b) => (a.queue_no ?? 0) - (b.queue_no ?? 0) || a.id - b.id)

/** Tandai pasien berikutnya (setelah yang aktif) sebagai "selanjutnya"; sisanya "menunggu". */
function markNext(rows: Visit[]): Visit[] {
  const current = rows.findIndex((v) => v.state === 'saat_ini')
  const after = rows.slice(current + 1).find((v) => v.state === 'menunggu') || rows.find((v) => v.state === 'menunggu')
  return rows.map((v) => v === after ? { ...v, state: 'selanjutnya' } : v)
}

/** Pasien dipanggil: ia menjadi "saat ini", yang lain belum selesai kembali "menunggu". */
export function applyCall(rows: Visit[], id: number): Visit[] {
  return markNext(byQueue(rows).map((v): Visit => v.state === 'selesai' ? v : { ...v, state: v.id === id ? 'saat_ini' : 'menunggu' }))
}

/** SOAP pasien divalidasi: ia "selesai", lalu pasien menunggu berikutnya otomatis "saat ini" (sama dengan backend). */
export function applyFinish(rows: Visit[], id: number): Visit[] {
  const ordered = byQueue(rows).map((v): Visit => v.id === id ? { ...v, state: 'selesai', is_approved: true, has_note: true } : v.state === 'selanjutnya' ? { ...v, state: 'menunggu' } : v)
  if (ordered.some((v) => v.state === 'saat_ini')) return markNext(ordered)
  const done = ordered.find((v) => v.id === id)
  const pending = ordered.filter((v) => v.state !== 'selesai')
  const next = pending.find((v) => (v.queue_no ?? 0) > (done?.queue_no ?? 0)) || pending[0]
  return next ? applyCall(ordered, next.id) : ordered
}
