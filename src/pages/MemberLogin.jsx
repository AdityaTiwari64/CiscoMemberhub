import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function MemberLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Invalid email or password')
    setBusy(false)
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h2>Member Sign In</h2>
      <p className="muted" style={{ margin: 0 }}>View your contributions and attendance</p>
      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
      {error && <p className="err">{error}</p>}
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}
