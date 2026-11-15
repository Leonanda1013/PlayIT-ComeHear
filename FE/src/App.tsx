import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { ErrorState, LoadingState } from '@/components/Feedback'
import { Button } from '@/components/ui/button'
import { apiRequest, ApiError } from '@/lib/api'
import type { User } from '@/lib/types'
import { getConsultation } from '@/lib/clinical'
import { LoginPage } from '@/pages/LoginPage'
import { VisitsPage } from '@/pages/VisitsPage'
import { SubjectivePage } from '@/pages/SubjectivePage'
import { DraftSubjectivePage } from '@/pages/DraftSubjectivePage'
import { OapPage } from '@/pages/OapPage'
import { ReviewPage } from '@/pages/ReviewPage'
import { ResumePage } from '@/pages/ResumePage'

async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiRequest<User>('/api/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

function DoctorVisitRoute({ user, onLogout, onSessionExpired }: { user: User; onLogout: () => void; onSessionExpired: () => void }) {
  const { visitId, stage } = useParams()
  const id = Number(visitId)
  const consultation = useQuery({ queryKey: ['consultation', id], queryFn: () => getConsultation(id), enabled: Number.isInteger(id) && id > 0 && stage !== 'resume' })
  const expired = consultation.error instanceof ApiError && consultation.error.status === 401
  useEffect(() => { if (expired) onSessionExpired() }, [expired, onSessionExpired])
  if (!Number.isInteger(id) || id <= 0) return <Navigate to="/kunjungan" replace />
  if (stage === 'resume') return <ResumePage id={id} user={user} onLogout={onLogout} />
  if (!['subjektif', 'draf-s', 'oap', 'verifikasi'].includes(stage || '')) return <Navigate to="/kunjungan" replace />
  if (expired) return <LoadingState label="Sesi berakhir…" />
  if (consultation.isPending) return <LoadingState label="Memuat konsultasi…" />
  if (consultation.isError) return <div className="mx-auto mt-20 max-w-lg"><ErrorState message={consultation.error.message} onRetry={() => consultation.refetch()} /></div>
  if (consultation.data.locked) return <Navigate to={`/kunjungan/${id}/resume`} replace />
  const hasSubjective = Boolean(consultation.data.note.subjective_summary.trim() || Object.values(consultation.data.note.subjective).some((value) => value.trim()))
  if (stage !== 'subjektif' && !consultation.data.visit.consent && !hasSubjective) return <Navigate to={`/kunjungan/${id}/subjektif`} replace />
  const titles: Record<string, string> = { subjektif: 'SOAP · Subjektif', 'draf-s': 'SOAP · Tinjau Subjektif', oap: 'SOAP · O-A-P', verifikasi: 'SOAP · Verifikasi' }
  return <AppShell user={user} location={consultation.data.visit.location.label} pageTitle={titles[stage!]} visitId={id} onLogout={onLogout}>
    {stage === 'subjektif' ? <SubjectivePage data={consultation.data} /> : stage === 'draf-s' ? <DraftSubjectivePage data={consultation.data} /> : stage === 'oap' ? <OapPage data={consultation.data} /> : <ReviewPage data={consultation.data} />}
  </AppShell>
}

function App() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: getCurrentUser, retry: 1 })

  async function logout() {
    try { await apiRequest('/api/backend/logout', { method: 'POST' }) } finally {
      queryClient.setQueryData(['me'], null)
      queryClient.removeQueries({ queryKey: ['queue'] })
      navigate('/login', { replace: true })
    }
  }

  async function login(email: string, password: string) {
    const result = await apiRequest<{ user: User }>('/api/backend/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (result.user.role !== 'dokter') {
      await apiRequest('/api/backend/logout', { method: 'POST' })
      throw new Error('Akun ini bukan akun dokter. Masuk dengan akun dokter.')
    }
    queryClient.setQueryData(['me'], result.user)
    navigate('/kunjungan', { replace: true })
  }

  function expireSession() {
    queryClient.setQueryData(['me'], null)
    queryClient.removeQueries({ queryKey: ['queue'] })
    navigate('/login?expired=1', { replace: true })
  }

  if (me.isPending) return <div className="grid min-h-screen place-items-center"><LoadingState label="Memeriksa sesi…" /></div>
  if (me.isError) return <div className="mx-auto mt-20 max-w-lg p-5"><ErrorState message={me.error.message} onRetry={() => me.refetch()} /></div>

  return <Routes>
    <Route path="/login" element={me.data ? <Navigate to={me.data.role === 'dokter' ? '/kunjungan' : '/akses-ditolak'} replace /> : <LoginPage onLogin={login} />} />
    <Route path="/kunjungan" element={me.data?.role === 'dokter' ? <VisitsPage user={me.data} onLogout={logout} onSessionExpired={expireSession} /> : <Navigate to={me.data ? '/akses-ditolak' : '/login'} replace />} />
    <Route path="/kunjungan/:visitId/:stage" element={me.data?.role === 'dokter' ? <DoctorVisitRoute user={me.data} onLogout={logout} onSessionExpired={expireSession} /> : <Navigate to={me.data ? '/akses-ditolak' : '/login'} replace />} />
    <Route path="/akses-ditolak" element={<div className="mx-auto mt-20 max-w-lg space-y-4 rounded-xl bg-white p-8"><h1 className="text-xl font-bold">Akses dokter diperlukan</h1><p>Halaman ini hanya tersedia untuk akun dokter.</p><Button onClick={logout}>Keluar</Button></div>} />
    <Route path="*" element={<Navigate to={me.data ? '/kunjungan' : '/login'} replace />} />
  </Routes>
}

export default App
