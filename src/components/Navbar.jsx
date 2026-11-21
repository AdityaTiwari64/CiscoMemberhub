import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from './ThemeContext'
import {
  IconSun,
  IconMoon,
  IconLogOut,
  IconCamera,
  IconUsers,
  IconCalendar,
  IconAward,
  IconIdCard,
  IconLayoutGrid,
  IconX
} from './Icons'

const ADMIN_ITEMS = [
  { id: 'overview', label: 'Dashboard', icon: IconLayoutGrid },
  { id: 'members', label: 'Members', icon: IconUsers },
  { id: 'attendance', label: 'Attendance', icon: IconCalendar },
  { id: 'contributions', label: 'Contributions', icon: IconAward }
]

const MEMBER_ITEMS = [
  { id: 'pass', label: 'My digital pass', icon: IconIdCard },
  { id: 'contributions', label: 'Contributions', icon: IconAward },
  { id: 'attendance', label: 'Attendance history', icon: IconCalendar }
]

const HR_ITEMS = [
  { id: 'attendance', label: 'Attendance', icon: IconCalendar }
]

export default function Navbar({
  role = 'admin',
  userName = '',
  onOpenScanner,
  activeTab = 'overview',
  setActiveTab
}) {
  const { theme, toggleTheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const items = role === 'member' ? MEMBER_ITEMS : role === 'hr' ? HR_ITEMS : ADMIN_ITEMS
  const title = role === 'member' ? 'Member portal' : role === 'hr' ? 'HR attendance' : 'Admin workspace'
  const initials = userName
    ? userName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
    : role === 'admin' ? 'AD' : role === 'hr' ? 'HR' : 'MB'

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  useEffect(() => {
    if (!mobileOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileOpen])

  useEffect(() => {
    const closeOnDesktop = () => {
      if (window.innerWidth > 800) setMobileOpen(false)
    }
    window.addEventListener('resize', closeOnDesktop)
    return () => window.removeEventListener('resize', closeOnDesktop)
  }, [])

  return (
    <>
      <div className="mobile-menu-bar">
        <button
          type="button"
          className="mobile-menu-trigger"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileOpen}
          aria-controls="community-navigation"
        >
          {mobileOpen ? <IconX size={23} /> : (
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>
      {mobileOpen && <button type="button" className="mobile-sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation menu" />}

      <aside id="community-navigation" className={`site-header app-sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand-wrap">
          <a className="sidebar-brand" href="/" aria-label="Cisco Community home">
            <img src="/logo.png" alt="Cisco Community VIT Bhopal" />
          </a>
        </div>

        <div className="sidebar-workspace-label">WORKSPACE</div>
        <nav aria-label={`${role} navigation`} className="rail-nav">
          {items.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`rail-nav-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => { setActiveTab?.(id); setMobileOpen(false) }}
              aria-label={label}
              aria-current={activeTab === id ? 'page' : undefined}
              data-tooltip={label}
              title={label}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {(role === 'admin' || role === 'hr') && onOpenScanner && (
          <button type="button" className="sidebar-scan-button" onClick={() => { onOpenScanner(); setMobileOpen(false) }} aria-label="Scan attendance" title="Scan attendance">
            <IconCamera size={17} />
            <span>Scan attendance</span>
          </button>
        )}

        <div className="sidebar-footer">
          <div className="sidebar-user-avatar" aria-label={userName || title} title={userName || title}>{initials}</div>
          <div className="sidebar-user-copy">
            <strong>{userName || title}</strong>
            <span>{role === 'member' ? 'Community member' : role === 'hr' ? 'Attendance manager' : 'Administrator'}</span>
          </div>
          <button
            type="button"
            className="sidebar-footer-icon"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
          </button>
          <button type="button" className="sidebar-footer-icon" onClick={handleSignOut} title="Sign out" aria-label="Sign out">
            <IconLogOut size={17} />
          </button>
        </div>
      </aside>
    </>
  )
}
