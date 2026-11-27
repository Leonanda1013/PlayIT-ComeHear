import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getScribe, retryScribe, SCRIBE_ACTIVE_STATUSES, visitPath } from '@/lib/clinical'
import type { Consultation, ScribeState } from '@/lib/types'

const isActiveStatus = (status?: string | null) =>
  Boolean(status && (SCRIBE_ACTIVE_STATUSES as readonly string[]).includes(status))

/**
 * Pantau status Scribe & ICD-10 secara real-time via SSE, dengan fallback otomatis ke polling
 * bila EventSource gagal atau tidak tersedia. Tidak memblokir interaksi dokter.
 */
export function useScribeMonitor(consultation: Consultation) {
  const id = consultation.visit.id
  const queryClient = useQueryClient()
  const [sseFallback, setSseFallback] = useState(() => typeof EventSource === 'undefined')
  const [retryBusy, setRetryBusy] = useState(false)
  const [retryError, setRetryError] = useState('')

  const initialStatus = consultation.session?.status || (consultation.failed_session ? 'failed' : null)
  const shouldMonitor = !consultation.locked && Boolean(consultation.session || consultation.failed_session)
  const prevState = useRef<{ status?: string | null; sReady?: boolean; icdReady?: boolean }>({
    status: initialStatus,
    sReady: Boolean(consultation.session?.subjective_ready || consultation.session?.extraction),
    icdReady: Boolean(consultation.session?.icd_ready || consultation.session?.icd_suggestions),
  })

  const scribe = useQuery({
    queryKey: ['scribe', id],
    queryFn: () => getScribe(id),
    enabled: shouldMonitor,
    refetchInterval: (query) => {
      if (!sseFallback) return false
      const st = query.state.data?.status ?? initialStatus
      return isActiveStatus(st) ? 3000 : false
    },
  })

  useEffect(() => {
    if (!shouldMonitor || typeof EventSource === 'undefined') return
    const activeNow = isActiveStatus(scribe.data?.status ?? initialStatus)
    if (!activeNow) return

    const source = new EventSource(visitPath(id, '/scribe/events'), { withCredentials: true })

    const handleScribeEvent = (event: MessageEvent<string>) => {
      try {
        const next = JSON.parse(event.data) as ScribeState
        setSseFallback(false)
        queryClient.setQueryData(['scribe', id], next)

        const prev = prevState.current
        const nextSReady = Boolean(next.subjective_ready || next.extraction)
        const nextIcdReady = Boolean(next.icd_ready || next.icd)
        if (
          next.status !== prev.status ||
          (nextSReady && !prev.sReady) ||
          (nextIcdReady && !prev.icdReady)
        ) {
          prevState.current = { status: next.status, sReady: nextSReady, icdReady: nextIcdReady }
          if (
            (nextSReady && !prev.sReady) ||
            (nextIcdReady && !prev.icdReady) ||
            next.status === 'done' ||
            next.status === 'failed'
          ) {
            void queryClient.invalidateQueries({ queryKey: ['consultation', id] })
          }
        }
      } catch {
        // Abaikan event malformed
      }
    }

    source.addEventListener('scribe', handleScribeEvent as EventListener)
    source.onerror = () => {
      setSseFallback(true)
      source.close()
    }

    return () => {
      source.removeEventListener('scribe', handleScribeEvent as EventListener)
      source.close()
    }
  }, [id, initialStatus, queryClient, scribe.data?.status, shouldMonitor])

  // Sinkronkan invalidation saat jalur fallback polling mendeteksi perubahan tahap.
  useEffect(() => {
    const next = scribe.data
    if (!next) return
    const prev = prevState.current
    const nextSReady = Boolean(next.subjective_ready || next.extraction)
    const nextIcdReady = Boolean(next.icd_ready || next.icd)
    if (
      (nextSReady && !prev.sReady) ||
      (nextIcdReady && !prev.icdReady) ||
      ((next.status === 'done' || next.status === 'failed') && next.status !== prev.status)
    ) {
      prevState.current = { status: next.status, sReady: nextSReady, icdReady: nextIcdReady }
      void queryClient.invalidateQueries({ queryKey: ['consultation', id] })
    }
  }, [id, queryClient, scribe.data])

  async function retry() {
    const sessionId = consultation.failed_session?.id || consultation.session?.id
    if (!sessionId || retryBusy) return
    setRetryBusy(true)
    setRetryError('')
    try {
      await retryScribe(id, sessionId)
      setSseFallback(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['consultation', id] }),
        queryClient.invalidateQueries({ queryKey: ['scribe', id] }),
      ])
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : 'Pemrosesan belum berhasil diulang.')
    } finally {
      setRetryBusy(false)
    }
  }

  return { scribe, retryBusy, retryError, retry }
}
