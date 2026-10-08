import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { supabase, configMissing } from './lib/supabase'
import Login from './pages/Login'
import MemberLogin from './pages/MemberLogin'
import Dashboard from './pages/Dashboard'
import MemberDashboard from './pages/MemberDashboard'
import PublicProfile from './pages/PublicProfile'

// Determines: admin → Dashboard, linked member → MemberDashboard, unknown → denied
function AuthGate() {
  const [state, setState] = useState('loading') // loading | out | admin | member | denied
  const [mode, setMode] = useState('admin')     // which login form: 'admin' | 'member'

  useEffect(() => {
    async function check(session) {
      if (!session) return setState('out')

      // Check if user is an admin
      const { data: adminRow } = await supabase
        .from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle()
      if (adminRow) return setState('admin')

      // Check if user is a linked member
      const { data: memberLink } = await supabase
        .from('member_users').select('member_id').eq('user_id', session.user.id).maybeSingle()
      if (memberLink) return setState('member')

      setState('denied')
    }
    supabase.auth.getSession().then(({ data }) => check(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setTimeout(() => check(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (state === 'loading') return <p className="center">Loading…</p>

  if (state === 'out') {
    return (
      <div className="card narrow">
        <div className="login-toggle">
          <button
            className={mode === 'admin' ? 'active' : ''}
            onClick={() => setMode('admin')}
          >Admin</button>
          <button
            className={mode === 'member' ? 'active' : ''}
            onClick={() => setMode('member')}
          >Member</button>
        </div>
        {mode === 'admin' ? <Login /> : <MemberLogin />}
      </div>
    )
  }

  if (state === 'denied') {
    return (
      <div className="card narrow">
        <p>This account is not recognized as an admin or linked member.</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )
  }

  if (state === 'admin') return <Dashboard />
  return <MemberDashboard />
}

export default function App() {
  if (configMissing)
    return (
      <div className="card narrow">
        <h2>Supabase is not configured</h2>
        <p>Create a <code>.env</code> file in the project root (next to package.json) with <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>.</p>
      </div>
    )
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/m/:token" element={<PublicProfile />} />
        <Route path="*" element={<AuthGate />} />
      </Routes>
    </BrowserRouter>
  )
}
