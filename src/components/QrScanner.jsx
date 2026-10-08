import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { supabase } from '../lib/supabase'

// simple beep via Web Audio API
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 880; gain.gain.value = 0.3
    osc.start(); osc.stop(ctx.currentTime + 0.15)
  } catch { /* silent if audio is blocked */ }
}

function tokenFromPayload(payload) {
  try {
    const m = new URL(payload).pathname.match(/^\/m\/([A-Za-z0-9_-]{16,})$/)
    if (m) return m[1]
  } catch { /* not a URL */ }
  if (/^[A-Za-z0-9_-]{16,}$/.test(payload.trim())) return payload.trim()
  return null
}

export default function QrScanner({ onClose, onScan }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const cooldownRef = useRef(false)
  const rafRef = useRef(null)
  const [log, setLog] = useState([])        // last 5 scans
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(true)

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  // start camera
  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      } catch {
        setError('Camera access denied. Please allow camera permissions.')
      }
    }
    start()
    return () => { cancelled = true; stopCamera() }
  }, [stopCamera])

  // scan loop
  useEffect(() => {
    if (!scanning) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const video = videoRef.current
    if (!ctx || !video) return

    function tick() {
      if (video.readyState >= video.HAVE_ENOUGH_DATA && !cooldownRef.current) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
        if (qr) {
          const token = tokenFromPayload(qr.data)
          if (token) {
            cooldownRef.current = true
            handleScan(token)
            setTimeout(() => { cooldownRef.current = false }, 3000)
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [scanning])

  async function handleScan(token) {
    try {
      const { data, error: err } = await supabase.rpc('record_attendance', { p_token: token })
      if (err) throw new Error(err.message)
      playBeep()
      const entry = {
        name: data.member_name,
        role: data.member_role,
        time: new Date(data.scanned_at).toLocaleTimeString(),
        ok: true
      }
      setLog(prev => [entry, ...prev].slice(0, 5))
      onScan?.(data)
    } catch (err) {
      setLog(prev => [{ name: err.message, time: new Date().toLocaleTimeString(), ok: false }, ...prev].slice(0, 5))
    }
  }

  function close() {
    stopCamera()
    setScanning(false)
    onClose?.()
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={{ margin: 0 }}>📷 QR Attendance Scanner</h3>
          <button onClick={close} style={styles.closeBtn}>✕</button>
        </div>

        {error && <p className="err">{error}</p>}

        <div style={styles.videoWrap}>
          <video ref={videoRef} style={styles.video} playsInline muted />
          <div style={styles.scanLine} />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>

        <p style={styles.hint}>Point camera at a member's ID card QR code</p>

        {log.length > 0 && (
          <div style={styles.log}>
            <strong>Recent scans</strong>
            {log.map((l, i) => (
              <div key={i} style={{ ...styles.logItem, color: l.ok ? '#2b8a3e' : '#c92a2a' }}>
                <span>{l.ok ? '✅' : '❌'} {l.name}</span>
                <span style={{ color: '#777', fontSize: 12 }}>{l.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
  },
  modal: {
    background: '#fff', borderRadius: 12, padding: 20, maxWidth: 440, width: '95%',
    maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,.25)'
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  closeBtn: {
    background: '#e03131', color: '#fff', border: 'none', borderRadius: 6,
    padding: '6px 12px', cursor: 'pointer', fontSize: 16
  },
  videoWrap: { position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000' },
  video: { width: '100%', display: 'block' },
  scanLine: {
    position: 'absolute', left: 0, right: 0, height: 2, background: '#3b5bdb',
    top: '50%', animation: 'scanPulse 2s ease-in-out infinite', boxShadow: '0 0 8px #3b5bdb'
  },
  hint: { textAlign: 'center', color: '#777', fontSize: 13, margin: '8px 0' },
  log: { marginTop: 12 },
  logItem: {
    display: 'flex', justifyContent: 'space-between', padding: '6px 0',
    borderBottom: '1px solid #eee', fontSize: 14
  }
}
