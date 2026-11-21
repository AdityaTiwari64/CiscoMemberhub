import React, { useState } from 'react'
import { useTheme } from '../components/ThemeContext'
import Login from './Login'
import MemberLogin from './MemberLogin'
import { IconShield, IconUsers, IconSun, IconMoon, IconLock, IconMonitor, IconCheck } from '../components/Icons'

export default function Home() {
  const { theme, toggleTheme } = useTheme()
  const [selectedRole, setSelectedRole] = useState(null)

  return (
    <div className="auth-fullscreen-container login-page-shell">
      <button
        type="button"
        className="btn-icon auth-floating-theme"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
      >
        {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </button>

      <div className="login-split-card">
        <section className="login-form-panel">
          <a className="login-brand-row" href="/" aria-label="Cisco Community home">
            <img src="/logo.png" alt="Cisco Community VIT Bhopal" />
          </a>

          <div className="login-form-content">
            <div className="login-heading-copy">
              <span className="login-security-icon"><IconLock size={19} /></span>
              <p className="page-eyebrow">CISCO COMMUNITY · VIT BHOPAL</p>
              <h1>{selectedRole === null ? 'Welcome to your community' : 'Sign in to continue'}</h1>
              <p className="login-intro-copy">
                {selectedRole === null
                  ? <><span className="portal-selection-highlight">Choose your workspace</span> to access member records and event activity.</>
                  : selectedRole === 'admin'
                    ? 'Use your administrator account to manage the community.'
                    : selectedRole === 'hr'
                      ? 'Use your HR account to manage event attendance.'
                      : 'Use your linked member account to open your pass and contributions.'}
              </p>
            </div>

            {selectedRole === null && (
              <div className="role-selection-grid login-role-grid">
                <button type="button" className="role-selection-card admin-card" onClick={() => setSelectedRole('admin')}>
                  <div className="role-card-icon"><IconShield size={24} /></div>
                  <span className="role-card-copy"><span className="role-card-kicker">ADMIN WORKSPACE</span><strong>Administrator</strong><small>Manage members, events, and attendance</small></span>
                  <span className="role-card-arrow-wrap" aria-hidden="true"><svg className="role-card-arrow" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></span>
                </button>
                <button type="button" className="role-selection-card member-card" onClick={() => setSelectedRole('member')}>
                  <div className="role-card-icon"><IconUsers size={24} /></div>
                  <span className="role-card-copy"><span className="role-card-kicker">MEMBER PORTAL</span><strong>Community member</strong><small>Open your pass, attendance, and contributions</small></span>
                  <span className="role-card-arrow-wrap" aria-hidden="true"><svg className="role-card-arrow" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></span>
                </button>
              </div>
            )}

            {selectedRole === null && (
              <p className="hr-login-shortcut">
                HR team? <button type="button" onClick={() => setSelectedRole('hr')}>Sign in to attendance</button>
              </p>
            )}

            {selectedRole === 'admin' && <div className="role-form-wrapper"><Login /></div>}
            {(selectedRole === 'member' || selectedRole === 'hr') && (
              <div className="role-form-wrapper"><MemberLogin portal={selectedRole} /></div>
            )}

            {selectedRole && (
              <button type="button" className="login-back-link" onClick={() => setSelectedRole(null)}>
                ← Back to portal selection
              </button>
            )}

          </div>
        </section>

        <aside className="login-visual-panel" aria-label="Cisco Community workspace">
          <div className="login-visual-badge"><IconLock size={12} /><span>Almost there</span></div>
          <div className="login-preview-card">
            <div className="login-preview-top"><span>Password strength</span><b>Strong</b></div>
            <div className="login-preview-strength"><i /><i /><i /><i /></div>
            <div className="login-preview-rules" aria-label="Password requirements">
              <div><span className="strength-radio checked"><IconCheck size={9} /></span><span>At least 8 characters</span></div>
              <div><span className="strength-radio checked"><IconCheck size={9} /></span><span>One number</span></div>
              <div><span className="strength-radio" /><span>One special character</span></div>
            </div>
          </div>
          <div className="login-device-card">
            <span className="preview-icon"><IconMonitor size={15} /></span>
            <span><small>For your security</small><strong>Other devices will be signed out</strong></span>
          </div>
          <div className="login-visual-copy">
            <span>VIT BHOPAL COMMUNITY</span>
            <h2>Make every<br />member moment count.</h2>
            <p>One place for digital passes, event attendance, and the work your community is proud of.</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
