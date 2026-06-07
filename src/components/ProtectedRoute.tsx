import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Spinner } from './ui'
import type { Role } from '../lib/types'

/** Gate that requires a session and (optionally) a specific role. */
export default function ProtectedRoute({
  role,
  children,
}: {
  role?: Role
  children: ReactNode
}) {
  const { session, profile, loading } = useAuth()

  if (loading) return <Spinner label="Laden…" />
  if (!session) return <Navigate to="/login" replace />
  if (role && profile && profile.role !== role) {
    // Signed in but wrong side of the marketplace — send to their home.
    return <Navigate to="/bookings" replace />
  }
  return <>{children}</>
}
