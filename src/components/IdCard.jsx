import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import {
  IconDownload,
  IconPrinter,
  IconCopy,
  IconCheck,
  IconQrCode
} from './Icons'

const profileUrl = (token) => `${window.location.origin}/m/${token}`
const contributionsUrl = (token) => `${profileUrl(token)}#contributions`

export default function IdCard({ member, notify }) {
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    if (!member?.qr_token) {
      setQrDataUrl('')
      return
    }
    let current = true
    QRCode.toDataURL(profileUrl(member.qr_token), {
      width: 480,
      margin: 2,
      color: { dark: '#101820', light: '#ffffff' }
    })
      .then((url) => { if (current) setQrDataUrl(url) })
      .catch((error) => {
        console.error('QR generation error:', error)
        if (current) setQrDataUrl('')
      })
    return () => { current = false }
  }, [member?.qr_token])

  const handleDownloadQr = () => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = (member.full_name || 'member').replace(/[^a-z0-9_-]+/gi, '_') + '_QR.png'
    a.click()
    notify?.success?.('Downloaded QR for ' + member.full_name)
  }

  const handleCopyLink = async () => {
    if (!member?.qr_token) return
    try {
      await navigator.clipboard.writeText(contributionsUrl(member.qr_token))
      setCopied(true)
      notify?.success?.('Contributions link copied to clipboard')
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      notify?.error?.('Could not copy the link. Open the public page and copy it from the address bar.')
    }
  }

  if (!member?.qr_token) {
    return (
      <div className="id-card-empty-prompt">
        <IconQrCode size={48} className="text-muted opacity-40 mb-3" />
        <h4>No QR Token Assigned</h4>
        <p className="text-muted text-sm max-w-sm text-center mb-3">
          Assign or generate a QR code for this member to view their pass.
        </p>
      </div>
    )
  }

  return (
    <div className="qr-details-view">
      <div className="qr-card-container">
        <div className="qr-code-panel">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR Code for ${member.full_name}`} className="member-qr-image" />
          ) : (
            <div className="member-qr-placeholder">Generating QR…</div>
          )}
          <span className="qr-scan-caption">SCAN TO VERIFY</span>
        </div>

        <div className="member-credential-details">
          <div className="credential-title-block">
            <div className="credential-title-row">
              <h2>{member.full_name}</h2>
              <span className={`badge ${member.is_active ? 'badge-success' : 'badge-danger'}`}>
                <span className="credential-status-dot" />{member.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="credential-role-row">
              <span className="role-badge">{member.role || 'Member'}</span>
              {member.department && <span className="dept-tag">{member.department}</span>}
            </div>
          </div>

          <div className="credential-detail-grid">
            {member.email && (
              <div className="credential-detail-item">
                <span>Email</span>
                <strong>{member.email}</strong>
              </div>
            )}
            <div className="credential-detail-item">
              <span>Joined</span>
              <strong>{new Date(member.created_at || Date.now()).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</strong>
            </div>
            <div className="credential-detail-item credential-token-item">
              <span>Token ID</span>
              <code>{member.qr_token.slice(0, 16)}…</code>
            </div>
          </div>

        </div>
      </div>

      <div className="id-card-actions">
        <button type="button" className="btn btn-primary" onClick={handleDownloadQr} disabled={!qrDataUrl}>
          <IconDownload size={16} /><span>Download QR Code</span>
        </button>
        <button type="button" className="btn btn-outline" onClick={handleCopyLink}>
          {copied ? <IconCheck size={16} className="text-success" /> : <IconCopy size={16} />}
          <span>{copied ? 'Copied Link' : 'Copy Link'}</span>
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => window.print()} disabled={!qrDataUrl}>
          <IconPrinter size={16} /><span>Print</span>
        </button>
      </div>
    </div>
  )
}
