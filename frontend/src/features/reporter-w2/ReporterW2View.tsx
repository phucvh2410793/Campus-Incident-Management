import { useState } from 'react'
import type { UserSummary } from '../../types/auth.ts'
import { reporterApiClient } from './reporterApiClient.ts'
import { ReporterLoginView } from './ReporterLoginView.tsx'
import { ReporterDashboardView } from './ReporterDashboardView.tsx'
import { transitionGui } from '../../utils/transition.ts'

export function ReporterW2View() {
  const [currentUser, setCurrentUser] = useState<UserSummary | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(reporterApiClient.isAuthenticated())

  const handleLoginSuccess = (user: UserSummary) => {
    transitionGui(() => {
      setCurrentUser(user)
      setIsAuthenticated(true)
    })
  }

  const handleLogout = () => {
    transitionGui(() => {
      setCurrentUser(null)
      setIsAuthenticated(false)
    })
  }

  return (
    <div className="reporter-w2-container">
      {!isAuthenticated || !currentUser ? (
        <ReporterLoginView onLoginSuccess={handleLoginSuccess} />
      ) : (
        <ReporterDashboardView
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      )}
    </div>
  )
}
