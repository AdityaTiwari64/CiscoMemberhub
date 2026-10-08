import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function MemberDashboard() {
  const [profile, setProfile] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ok | unlinked | error

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_my_member_profile')
    if (error) return setStatus('error')
    if (!data) return setStatus('unlinked')
    setProfile(data)
    setStatus('ok')
  }, [])

  useEffect(() => { load() }, [load])

  if (status === 'loading') return <p className="center">Loading your profile…</p>

  if (status === 'unlinked') {
    return (
      <div className="card narrow">
        <h2>Account Not Linked</h2>
        <p className="muted">Your account is not linked to a member profile yet. Contact your club admin to link your account.</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="card narrow">
        <h2>Something went wrong</h2>
        <p className="muted">Could not load your profile. Try again later.</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )
  }

  const contribs = profile.contributions || []
  const attendance = profile.attendance || []
  const lastAttended = attendance.length > 0
    ? new Date(attendance[0].scanned_at).toLocaleDateString()
    : 'Never'

  return (
    <div className="wrap">
      <header>
        <h1>My Dashboard</h1>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      {/* Profile Card */}
      <div className="card">
        <h2 style={{ margin: '0 0 4px' }}>{profile.full_name}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {[profile.role, profile.department].filter(Boolean).join(' · ')}
        </p>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Member since {new Date(profile.joined).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-num">{contribs.length}</div>
          <div className="stat-label">Contributions</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{attendance.length}</div>
          <div className="stat-label">Attendance</div>
        </div>
        <div className="stat-card">
          <div className="stat-num" style={{ fontSize: 18 }}>{lastAttended}</div>
          <div className="stat-label">Last Attended</div>
        </div>
      </div>

      {/* Contributions */}
      <div className="card">
        <h3>My Contributions</h3>
        {contribs.length === 0 && <p className="muted">No contributions yet.</p>}
        {contribs.map((c, i) => (
          <div key={i} className="contrib">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>{c.title}</strong>
              <span className="muted">{new Date(c.date).toLocaleDateString()}</span>
            </div>
            {c.description && <p style={{ margin: '4px 0 0', color: '#555' }}>{c.description}</p>}
            {c.link && /^https?:\/\//.test(c.link) && (
              <a href={c.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>View work ↗</a>
            )}
          </div>
        ))}
      </div>

      {/* Attendance */}
      <div className="card">
        <h3>Attendance History</h3>
        {attendance.length === 0 && <p className="muted">No attendance records yet.</p>}
        {attendance.length > 0 && (
          <table>
            <thead>
              <tr><th>#</th><th>Date</th><th>Time</th></tr>
            </thead>
            <tbody>
              {attendance.map((a, i) => {
                const d = new Date(a.scanned_at)
                return (
                  <tr key={i}>
                    <td>{attendance.length - i}</td>
                    <td>{d.toLocaleDateString()}</td>
                    <td>{d.toLocaleTimeString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
