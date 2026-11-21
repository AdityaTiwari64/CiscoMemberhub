import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { IconX, IconLink, IconCheck, IconAlertCircle } from './Icons'

export default function LinkUserModal({ member, isOpen, onClose, notify }) {
  const [userId, setUserId] = useState('')
  const [currentLink, setCurrentLink] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!member || !isOpen) return
    async function fetchExistingLink() {
      setLoading(true)
      const { data, error } = await supabase
        .from('member_users')
        .select('user_id')
        .eq('member_id', member.id)
        .maybeSingle()

      if (!error && data) {
        setCurrentLink(data.user_id)
        setUserId(data.user_id)
      } else {
        setCurrentLink(null)
        setUserId('')
      }
      setLoading(false)
    }
    fetchExistingLink()
  }, [member, isOpen])

  // ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !member) return null

  const handleLink = async (e) => {
    e.preventDefault()
    const cleanId = userId.trim()
    if (!cleanId) return
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanId)) {
      notify?.error?.('Enter a valid Supabase Auth user UUID.')
      return
    }

    setBusy(true)
    const { error } = await supabase.rpc('link_member_user', {
      p_member_id: member.id,
      p_user_id: cleanId
    })

    setBusy(false)
    if (error) {
      if (error.code === '23503' && error.message?.includes('member_users_user_id_fkey')) {
        notify?.error?.('No Auth user exists for this UUID. Invite or create the user under Authentication → Users first, then paste their Auth user ID.')
      } else {
        notify?.error?.(error.message)
      }
    } else {
      notify?.success?.(`Linked ${member.full_name} to user account`)
      onClose()
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-modal-title"
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon-badge">
              <IconLink size={18} />
            </span>
            <div>
              <h3 id="link-modal-title" className="modal-title">
                Link Member User Account
              </h3>
              <p className="modal-subtitle">
                Enable portal login for {member.full_name}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <IconX size={18} />
          </button>
        </div>

        <form onSubmit={handleLink} className="modal-body form-grid">
          <div className="info-box mb-3">
            <IconAlertCircle size={18} className="text-primary flex-shrink-0" />
            <div className="text-sm">
              Invite or create the user under <strong>Supabase &gt; Authentication &gt; Users</strong> first, then copy their Auth user UUID to enable the Member Dashboard.
            </div>
          </div>

          {currentLink && (
            <div className="status-banner mb-3">
              <span className="status-dot active"></span>
              <span className="text-sm">
                Currently linked to UUID: <code className="code-badge">{currentLink}</code>
              </span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="auth-user-id">Supabase Auth User UUID</label>
            <input
              id="auth-user-id"
              type="text"
              className="input-field font-mono"
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            />
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !userId.trim()}
            >
              <IconCheck size={16} />
              <span>{busy ? 'Linking…' : 'Save Link'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
