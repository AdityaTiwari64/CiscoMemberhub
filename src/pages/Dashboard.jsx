import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import QrScanner from '../components/QrScanner'
import IdCard from '../components/IdCard'

const profileUrl = (token) => `${window.location.origin}/m/${token}`

// ---------- QR helpers ----------
async function decodeQrFromFile(file) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = jsQR(img.data, img.width, img.height)
  if (!result) throw new Error('No QR code found in that image')
  return result.data
}

// Accepts either "https://yoursite/m/<token>" or a bare token. Anything else is rejected.
function tokenFromPayload(payload) {
  try {
    const m = new URL(payload).pathname.match(/^\/m\/([A-Za-z0-9_-]{16,})$/)
    if (m) return m[1]
  } catch { /* not a URL */ }
  if (/^[A-Za-z0-9_-]{16,}$/.test(payload.trim())) return payload.trim()
  throw new Error('This QR does not contain a valid token or /m/<token> link')
}

async function downloadQr(member) {
  const dataUrl = await QRCode.toDataURL(profileUrl(member.qr_token), { width: 600, margin: 2 })
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `${member.full_name.replace(/\s+/g, '_')}_qr.png`
  a.click()
}

// ---------- component ----------
export default function Dashboard() {
  const [members, setMembers] = useState([])
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState({ type: '', text: '' })
  const [form, setForm] = useState({ full_name: '', email: '', role: 'Member', department: '' })
  const [selected, setSelected] = useState(null)   // member whose contributions are open
  const [idCardMember, setIdCardMember] = useState(null) // member whose ID card is shown
  const [showScanner, setShowScanner] = useState(false)
  const [showAttLog, setShowAttLog] = useState(false)
  const [attLog, setAttLog] = useState([])
  const [tab, setTab] = useState('members') // 'members' | 'attendance'
  const fileRef = useRef(null)
  const uploadTarget = useRef(null)

  const notify = (type, text) => setMsg({ type, text })

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('members').select('*').order('created_at', { ascending: false })
    if (error) return notify('err', error.message)
    setMembers(data)
  }, [])

  useEffect(() => { load() }, [load])

  async function loadAttendance() {
    const { data, error } = await supabase.rpc('get_attendance_log', { p_days: 30 })
    if (error) return notify('err', error.message)
    setAttLog(data || [])
    setShowAttLog(true)
  }

  async function addMember(e) {
    e.preventDefault()
    const { error } = await supabase.from('members').insert({
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      role: form.role.trim() || 'Member',
      department: form.department.trim() || null,
    })
    if (error) return notify('err', error.message)
    setForm({ full_name: '', email: '', role: 'Member', department: '' })
    notify('ok', 'Member added ✓')
    load()
  }

  async function assignQr(member) {
    if (member.qr_token && !confirm('This replaces the existing QR. The old ID card will stop working. Continue?')) return
    const { error } = await supabase.rpc('assign_qr', { p_member: member.id })
    if (error) return notify('err', error.message)
    notify('ok', `QR assigned to ${member.full_name}`)
    load()
  }

  function pickUpload(member) {
    uploadTarget.current = member
    fileRef.current.value = ''
    fileRef.current.click()
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    const member = uploadTarget.current
    if (!file || !member) return
    if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024)
      return notify('err', 'Upload a PNG/JPG image under 2 MB')
    try {
      const token = tokenFromPayload(await decodeQrFromFile(file))
      const path = `${member.id}/${Date.now()}.${file.type === 'image/png' ? 'png' : 'jpg'}`
      const up = await supabase.storage.from('qr-codes').upload(path, file, { contentType: file.type })
      if (up.error) throw up.error
      const { error } = await supabase.from('members')
        .update({ qr_token: token, qr_image_path: path }).eq('id', member.id)
      if (error) throw new Error(error.code === '23505' ? 'That QR is already linked to another member' : error.message)
      notify('ok', `QR linked to ${member.full_name}`)
      load()
    } catch (err) {
      notify('err', err.message)
    }
  }

  async function toggleActive(member) {
    const { error } = await supabase.from('members').update({ is_active: !member.is_active }).eq('id', member.id)
    if (error) return notify('err', error.message)
    load()
  }

  const shown = members.filter(m =>
    `${m.full_name} ${m.email ?? ''} ${m.department ?? ''}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="wrap">
      <header>
        <h1>Club Admin</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn-accent" onClick={() => setShowScanner(true)}>📷 Scan Attendance</button>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      {msg.text && <p className={msg.type === 'err' ? 'err' : 'ok'}>{msg.text}</p>}

      {/* Tab navigation */}
      <div className="tab-bar">
        <button className={tab === 'members' ? 'tab active' : 'tab'} onClick={() => setTab('members')}>Members</button>
        <button className={tab === 'attendance' ? 'tab active' : 'tab'} onClick={() => { setTab('attendance'); loadAttendance() }}>Attendance Log</button>
      </div>

      {tab === 'members' && (
        <>
          <form className="card row" onSubmit={addMember}>
            <input placeholder="Full name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} required />
            <input type="email" placeholder="Email (private)" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <input placeholder="Role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} />
            <input placeholder="Department" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} />
            <button>Add member</button>
          </form>

          <input className="search" placeholder="Search members…" value={search} onChange={e => setSearch(e.target.value)} />

          <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={handleUpload} />

          <table>
            <thead>
              <tr><th>Name</th><th>Role</th><th>Dept</th><th>QR</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {shown.map(m => (
                <tr key={m.id} className={m.is_active ? '' : 'inactive'}>
                  <td>{m.full_name}<div className="muted">{m.email}</div></td>
                  <td>{m.role}</td>
                  <td>{m.department}</td>
                  <td>{m.qr_token ? '✅ Linked' : '— None'}</td>
                  <td className="actions">
                    <button onClick={() => assignQr(m)}>{m.qr_token ? 'Re-assign' : 'Assign QR'}</button>
                    <button onClick={() => pickUpload(m)}>Upload QR</button>
                    {m.qr_token && <button onClick={() => downloadQr(m)}>Download QR</button>}
                    {m.qr_token && <button className="btn-accent" onClick={() => setIdCardMember(m)}>🪪 ID Card</button>}
                    <button onClick={() => setSelected(m)}>Contributions</button>
                    <button onClick={() => toggleActive(m)}>{m.is_active ? 'Deactivate' : 'Activate'}</button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan="5" className="muted">No members yet.</td></tr>}
            </tbody>
          </table>
        </>
      )}

      {tab === 'attendance' && <AttendanceLog log={attLog} onRefresh={loadAttendance} />}

      {/* Modals */}
      {selected && <Contributions member={selected} onClose={() => setSelected(null)} notify={notify} />}
      {idCardMember && <IdCardModal member={idCardMember} onClose={() => setIdCardMember(null)} />}
      {showScanner && <QrScanner onClose={() => setShowScanner(false)} onScan={() => { if (tab === 'attendance') loadAttendance() }} />}
    </div>
  )
}

// ---------- Attendance Log ----------
function AttendanceLog({ log, onRefresh }) {
  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Attendance — Last 30 Days</h3>
        <button onClick={onRefresh}>Refresh</button>
      </div>
      {log.length === 0 && <p className="muted">No attendance records yet.</p>}
      {log.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Member</th><th>Role</th><th>Date</th><th>Time</th></tr>
          </thead>
          <tbody>
            {log.map((a, i) => {
              const d = new Date(a.scanned_at)
              return (
                <tr key={i}>
                  <td>{a.member_name}</td>
                  <td>{a.member_role}</td>
                  <td>{d.toLocaleDateString()}</td>
                  <td>{d.toLocaleTimeString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---------- ID Card Modal ----------
function IdCardModal({ member, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999
    }}>
      <div className="card" style={{ maxWidth: 720, width: '95%' }}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>🪪 ID Card — {member.full_name}</h3>
          <button onClick={onClose}>Close</button>
        </div>
        <IdCard member={member} />
      </div>
    </div>
  )
}

// ---------- Contributions ----------
function Contributions({ member, onClose, notify }) {
  const [items, setItems] = useState([])
  const [f, setF] = useState({ title: '', description: '', link: '' })

  const load = useCallback(async () => {
    const { data } = await supabase.from('contributions').select('*')
      .eq('member_id', member.id).order('created_at', { ascending: false })
    setItems(data ?? [])
  }, [member.id])

  useEffect(() => { load() }, [load])

  async function add(e) {
    e.preventDefault()
    if (f.link && !/^https?:\/\//.test(f.link)) return notify('err', 'Link must start with http:// or https://')
    const { error } = await supabase.from('contributions').insert({
      member_id: member.id, title: f.title.trim(),
      description: f.description.trim() || null, link: f.link.trim() || null,
    })
    if (error) return notify('err', error.message)
    setF({ title: '', description: '', link: '' })
    load()
  }

  async function remove(id) {
    if (!confirm('Delete this contribution?')) return
    await supabase.from('contributions').delete().eq('id', id)
    load()
  }

  return (
    <div className="card">
      <div className="row between">
        <h3>Contributions — {member.full_name}</h3>
        <button onClick={onClose}>Close</button>
      </div>
      <form className="row" onSubmit={add}>
        <input placeholder="Title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required />
        <input placeholder="Description" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
        <input placeholder="Link (https://…)" value={f.link} onChange={e => setF({ ...f, link: e.target.value })} />
        <button>Add</button>
      </form>
      {items.map(c => (
        <div key={c.id} className="contrib row between">
          <span><strong>{c.title}</strong> {c.description && `— ${c.description}`}</span>
          <button onClick={() => remove(c.id)}>Delete</button>
        </div>
      ))}
    </div>
  )
}
