import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { supabase, configMissing } from './lib/supabase'
import { ThemeProvider } from './components/ThemeContext'
import { ToastProvider } from './components/Toast'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import MemberDashboard from './pages/MemberDashboard'
import PublicProfile from './pages/PublicProfile'
import { IconAlertCircle } from './components/Icons'

function AuthGate() {
  const [state, setState] = useState('out') // out | admin | hr | member | denied
  const [demoRole, setDemoRole] = useState(null) // 'admin' | 'member' | null

  useEffect(() => {
    if (configMissing) {
      setState('out')
      return
    }

    async function check(session) {
      if (!session) {
        return setState('out')
      }

      // Use is_admin() RPC — security definer, bypasses RLS permission issues
      const { data: isAdmin, error: adminErr } = await supabase.rpc('is_admin')
      if (adminErr) {
        setState('denied')
        return
      }
      if (isAdmin) return setState('admin')

      const { data: isAttendanceHr, error: hrError } = await supabase.rpc('is_attendance_hr')
      if (hrError && !['PGRST202', '42883'].includes(hrError.code)) {
        setState('denied')
        return
      }
      if (isAttendanceHr) return setState('hr')

      // Use get_my_member_profile() RPC — also security definer
      const { data: profile, error: memberErr } = await supabase.rpc('get_my_member_profile')
      if (memberErr) return setState('denied')
      if (profile) return setState('member')

      setState('denied')
    }

    supabase.auth.getSession().then(({ data }) => check(data?.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setTimeout(() => check(s), 0)
    })
    return () => sub?.subscription?.unsubscribe?.()
  }, [])

  // Demo Preview Mode
  if (demoRole === 'admin') {
    return <Dashboard isDemo={true} onExitDemo={() => setDemoRole(null)} />
  }

  if (demoRole === 'member') {
    return <MemberDashboard isDemo={true} onExitDemo={() => setDemoRole(null)} />
  }

  // Authenticated Portals
  if (state === 'admin') return <Dashboard />
  if (state === 'hr') return <Dashboard accessRole="hr" />
  if (state === 'member') return <MemberDashboard />

  if (state === 'denied') {
    return (
      <div className="auth-fullscreen-container">
        <div className="card narrow text-center" style={{ maxWidth: 500 }}>
          <div className="modal-icon-badge bg-red-subtle text-danger mx-auto mb-3">
            <IconAlertCircle size={32} />
          </div>
          <h2>Account Not Recognized</h2>
          <p className="text-muted text-sm mt-2 mb-3">
            This account does not have access to a community workspace. Contact your administrator.
          </p>

          <div className="action-buttons-group justify-center">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => supabase.auth.signOut()}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Public Home Landing & Portal
  return <Home onEnterDemo={(role) => setDemoRole(role)} />
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/m/:token" element={<PublicProfile />} />
            <Route path="*" element={<AuthGate />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  )
}
