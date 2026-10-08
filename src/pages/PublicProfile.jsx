import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function PublicProfile() {
  const { token } = useParams()
  const [member, setMember] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    supabase.rpc('get_member_by_token', { p_token: token }).then(({ data, error }) => {
      if (error || !data) return setStatus('notfound')
      setMember(data); setStatus('ok')
    })
  }, [token])

  if (status === 'loading') return <p className="center">Loading…</p>
  if (status === 'notfound') return <p className="center">This ID is not valid or is no longer active.</p>

  return (
    <div className="card narrow">
      <h2>{member.full_name}</h2>
      <p className="muted">{[member.role, member.department].filter(Boolean).join(' · ')}</p>
      <h3>Contributions</h3>
      {member.contributions.length === 0 && <p className="muted">No contributions added yet.</p>}
      {member.contributions.map((c, i) => (
        <div key={i} className="contrib">
          <strong>{c.title}</strong>
          <span className="muted"> · {new Date(c.date).toLocaleDateString()}</span>
          {c.description && <p>{c.description}</p>}
          {c.link && /^https?:\/\//.test(c.link) && (
            <a href={c.link} target="_blank" rel="noopener noreferrer">View work ↗</a>
          )}
        </div>
      ))}
    </div>
  )
}
