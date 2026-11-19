import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { ErrorState, LoadingState } from '@/components/Feedback'
import { apiRequest, ApiError } from '@/lib/api'
import { getConsultation, isManualSubjective } from '@/lib/clinical'
import { isDoctor } from '@/lib/format'
import type { User } from '@/lib/types'
import { LoginPage } from '@/pages/LoginPage'
import { VisitsPage } from '@/pages/VisitsPage'
import { SubjectivePage } from '@/pages/SubjectivePage'
import { DraftSubjectivePage } from '@/pages/DraftSubjectivePage'
import { ObjectivePage } from '@/pages/ObjectivePage'
import { AssessmentPlanPage } from '@/pages/AssessmentPlanPage'
import { ReviewPage } from '@/pages/ReviewPage'
import { ResumePage } from '@/pages/ResumePage'
import { HistoryListPage, HistoryDetailPage } from '@/pages/HistoryPage'
import { RmDashboardPage } from '@/pages/rm/RmDashboardPage'
import { RegistrationPage } from '@/pages/rm/RegistrationPage'
import { RmVisitsPage } from '@/pages/rm/RmVisitsPage'
import { SatusehatPage } from '@/pages/rm/SatusehatPage'
import { SettingsPage } from '@/pages/SettingsPage'

async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiRequest<User>('/api/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

const homeOf = (user: User | null | undefined) => !user ? '/login' : isDoctor(user.role) ? '/kunjungan' : '/rm'
const clinicalStages = ['subjektif', 'draf-s', 'objektif', 'asesmen', 'verifikasi']

export type SessionProps = { user: User; onLogout: () => void; onSessionExpired: () => void }

function DoctorVisitRoute({ user, onLogout, onSessionExpired }: SessionProps) {
  const { visitId, stage = '' } = useParams()
  const id = Number(visitId)
  const valid = Number.isInteger(id) && id > 0
  const consultation = useQuery({ queryKey: ['consultation', id], queryFn: () => getConsultation(id), enabled: valid && clinicalStages.includes(stage) })
  const expired = consultation.error instanceof ApiError && consultation.error.status === 401
  useEffect(() => { if (expired) onSessionExpired() }, [expired, onSessionExpired])
  if (!valid) return <Navigate to="/kunjungan" replace />
  if (stage === 'oap') return <Navigate to={`/kunjungan/${id}/objektif`} replace />
  if (stage === 'resume') return <ResumePage id={id} user={user} onLogout={onLogout} />
  if (!clinicalStages.includes(stage)) return <Navigate to="/kunjungan" replace />

  const body = expired ? <LoadingState label="Sesi berakhir…" />
    : consultation.isPending ? <LoadingState label="Memuat konsultasi…" />
    : consultation.isError ? <ErrorState message={consultation.error.message} onRetry={() => consultation.refetch()} />
    : null
  if (body) return <AppShell user={user} onLogout={onLogout}>{body}</AppShell>
  const data = consultation.data!
  if (data.locked) return <Navigate to={`/kunjungan/${id}/resume`} replace />
  const hasSubjective = Boolean(data.note.subjective_summary.trim() || Object.values(data.note.subjective).some((value) => String(value).trim()))

  if (stage === 'draf-s') {
    if (isManualSubjective(data)) {
      const isRefused = data.visit.status === 'manual' || (data.visit.consent as { decision?: string } | null)?.decision === 'tolak'
      return (
        <Navigate
          to={`/kunjungan/${id}/subjektif`}
          replace
          state={{
            redirectReason: isRefused
              ? 'Pasien menolak perekaman AI. Anda dialihkan ke halaman pengisian Subjektif manual.'
              : 'Belum ada rekaman audio atau draf Subjektif. Anda dialihkan ke halaman Subjektif untuk memulai perekaman.',
          }}
        />
      )
    }
  }

  if (stage !== 'subjektif' && !data.visit.consent && !hasSubjective && !data.session) {
    return (
      <Navigate
        to={`/kunjungan/${id}/subjektif`}
        replace
        state={{ redirectReason: 'Lengkapi persetujuan dan data Subjektif terlebih dahulu sebelum berpindah tahap.' }}
      />
    )
  }

  const page = stage === 'subjektif' ? <SubjectivePage data={data} />
    : stage === 'draf-s' ? <DraftSubjectivePage data={data} />
    : stage === 'objektif' ? <ObjectivePage data={data} />
    : stage === 'asesmen' ? <AssessmentPlanPage data={data} />
    : <ReviewPage data={data} />
  return <AppShell user={user} onLogout={onLogout}>{page}</AppShell>
}

function App() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: getCurrentUser, retry: 1 })

  const logout = useCallback(async () => {
    try { await apiRequest('/api/backend/logout', { method: 'POST' }) } finally {
      queryClient.clear()
      queryClient.setQueryData(['me'], null)
      navigate('/login', { replace: true })
    }
  }, [navigate, queryClient])

  async function login(email: string, password: string) {
    const result = await apiRequest<{ user: User }>('/api/backend/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    queryClient.setQueryData(['me'], result.user)
    navigate(homeOf(result.user), { replace: true })
  }

  const expireSession = useCallback(() => {
    queryClient.clear()
    queryClient.setQueryData(['me'], null)
    navigate('/login?expired=1', { replace: true })
  }, [navigate, queryClient])

  if (me.isPending) return <div className="grid min-h-screen place-items-center"><LoadingState label="Memeriksa sesi…" /></div>
  if (me.isError) return <div className="mx-auto mt-20 max-w-lg p-5"><ErrorState message={me.error.message} onRetry={() => me.refetch()} /></div>

  const user = me.data
  const session = user ? { user, onLogout: logout, onSessionExpired: expireSession } : null
  const doctorOnly = (element: React.ReactNode) => !session ? <Navigate to="/login" replace /> : isDoctor(session.user.role) ? element : <Navigate to="/rm" replace />
  const rmOnly = (element: React.ReactNode) => !session ? <Navigate to="/login" replace /> : !isDoctor(session.user.role) ? element : <Navigate to="/kunjungan" replace />

  return <Routes>
    <Route path="/login" element={user ? <Navigate to={homeOf(user)} replace /> : <LoginPage onLogin={login} />} />
    <Route path="/kunjungan" element={doctorOnly(session && <VisitsPage {...session} />)} />
    <Route path="/kunjungan/:visitId/:stage" element={doctorOnly(session && <DoctorVisitRoute {...session} />)} />
    <Route path="/riwayat" element={doctorOnly(session && <HistoryListPage {...session} base="/riwayat" />)} />
    <Route path="/riwayat/:visitId" element={doctorOnly(session && <HistoryDetailPage {...session} base="/riwayat" />)} />
    <Route path="/pengaturan" element={doctorOnly(session && <SettingsPage {...session} />)} />
    <Route path="/rm" element={rmOnly(session && <RmDashboardPage {...session} />)} />
    <Route path="/rm/pendaftaran" element={rmOnly(session && <RegistrationPage {...session} />)} />
    <Route path="/rm/kunjungan" element={rmOnly(session && <RmVisitsPage {...session} />)} />
    <Route path="/rm/riwayat" element={rmOnly(session && <HistoryListPage {...session} base="/rm/riwayat" />)} />
    <Route path="/rm/riwayat/:visitId" element={rmOnly(session && <HistoryDetailPage {...session} base="/rm/riwayat" />)} />
    <Route path="/rm/satusehat" element={rmOnly(session && <SatusehatPage {...session} />)} />
    <Route path="*" element={<Navigate to={homeOf(user)} replace />} />
  </Routes>
}

export default App
