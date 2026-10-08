import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

const profileUrl = (token) => `${window.location.origin}/m/${token}`

export default function IdCard({ member, clubName = 'CLUB ID' }) {
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!member?.qr_token) return
    drawCard()
  }, [member])

  async function drawCard() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = 675, H = 425
    canvas.width = W; canvas.height = H

    // background gradient
    const grad = ctx.createLinearGradient(0, 0, W, H)
    grad.addColorStop(0, '#1a1a5e')
    grad.addColorStop(0.5, '#2d2d8c')
    grad.addColorStop(1, '#5a2d82')
    ctx.fillStyle = grad
    roundRect(ctx, 0, 0, W, H, 16)
    ctx.fill()

    // subtle pattern overlay
    ctx.globalAlpha = 0.05
    for (let i = 0; i < W; i += 20) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.strokeStyle = '#fff'; ctx.stroke()
    }
    ctx.globalAlpha = 1

    // top accent bar
    const bar = ctx.createLinearGradient(0, 0, W, 0)
    bar.addColorStop(0, '#3b5bdb'); bar.addColorStop(1, '#7c3aed')
    ctx.fillStyle = bar
    ctx.fillRect(0, 0, W, 6)

    // club name
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = 'bold 14px system-ui, sans-serif'
    ctx.fillText(clubName, 28, 40)

    // member name
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 28px system-ui, sans-serif'
    const name = member.full_name.length > 22 ? member.full_name.slice(0, 20) + '…' : member.full_name
    ctx.fillText(name, 28, 90)

    // role & department
    ctx.font = '16px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    const roleDept = [member.role, member.department].filter(Boolean).join(' · ')
    ctx.fillText(roleDept, 28, 120)

    // divider
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(28, 145); ctx.lineTo(380, 145); ctx.stroke()

    // member since
    ctx.font = '13px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    const joined = new Date(member.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    ctx.fillText(`Member since ${joined}`, 28, 172)

    // member ID
    ctx.font = 'bold 12px monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fillText(`ID: ${member.id.slice(0, 8).toUpperCase()}`, 28, 200)

    // status badge
    const statusText = member.is_active ? 'ACTIVE' : 'INACTIVE'
    const statusColor = member.is_active ? '#2b8a3e' : '#c92a2a'
    ctx.font = 'bold 11px system-ui, sans-serif'
    const tw = ctx.measureText(statusText).width
    ctx.fillStyle = statusColor
    roundRect(ctx, 28, 215, tw + 16, 22, 4)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(statusText, 36, 231)

    // bottom text
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.fillText('Scan QR code to verify membership', 28, H - 20)

    // QR code — white background with padding
    const qrSize = 160
    const qrX = W - qrSize - 30
    const qrY = (H - qrSize) / 2
    ctx.fillStyle = '#fff'
    roundRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 10)
    ctx.fill()

    // draw QR
    try {
      const qrDataUrl = await QRCode.toDataURL(profileUrl(member.qr_token), {
        width: qrSize, margin: 1, color: { dark: '#1a1a5e', light: '#ffffff' }
      })
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, qrX, qrY, qrSize, qrSize)
        setReady(true)
      }
      img.src = qrDataUrl
    } catch { setReady(true) }
  }

  function download() {
    const a = document.createElement('a')
    a.href = canvasRef.current.toDataURL('image/png')
    a.download = `${member.full_name.replace(/\s+/g, '_')}_ID.png`
    a.click()
  }

  function print() {
    const w = window.open('', '_blank')
    w.document.write(`<img src="${canvasRef.current.toDataURL('image/png')}" style="width:100%;max-width:675px" />`)
    w.document.close()
    setTimeout(() => { w.print() }, 300)
  }

  if (!member?.qr_token) {
    return (
      <div style={styles.noQr}>
        <p>Assign a QR code to this member first before generating an ID card.</p>
      </div>
    )
  }

  return (
    <div style={styles.wrap}>
      <canvas ref={canvasRef} style={styles.canvas} />
      <div style={styles.buttons}>
        <button onClick={download} disabled={!ready}>📥 Download ID Card</button>
        <button onClick={print} disabled={!ready}>🖨️ Print</button>
      </div>
    </div>
  )
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

const styles = {
  wrap: { textAlign: 'center' },
  canvas: { maxWidth: '100%', borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,.2)' },
  buttons: { display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 },
  noQr: { padding: 16, textAlign: 'center', color: '#777' }
}
