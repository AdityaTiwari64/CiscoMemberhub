import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { supabase, configMissing } from '../lib/supabase'
import { DEMO_MEMBERS, DEMO_ATTENDANCE, DEMO_CONTRIBUTIONS } from '../data/demoData'
import Navbar from '../components/Navbar'
import MemberModal from '../components/MemberModal'
import ContributionsModal from '../components/ContributionsModal'
import LinkUserModal from '../components/LinkUserModal'
import IdCard from '../components/IdCard'
import QrScanner from '../components/QrScanner'
import { createEventAttendanceNote, getAttendanceEventName, readLocalEvents, saveLocalEvents } from '../lib/attendance'
import { useToast } from '../components/Toast'
import {
  IconUsers,
  IconUserPlus,
  IconSearch,
  IconFilter,
  IconQrCode,
  IconCamera,
  IconIdCard,
  IconAward,
  IconDownload,
  IconUpload,
  IconEdit,
  IconTrash,
  IconRefresh,
  IconFileSpreadsheet,
  IconLayoutGrid,
  IconLayoutList,
  IconCheckCircle,
  IconAlertCircle,
  IconX,
  IconCalendar,
  IconClock,
  IconLink,
  IconSparkles
} from '../components/Icons'

const profileUrl = (token) => `${window.location.origin}/m/${token}`

// Helper: decode QR from uploaded image file
async function decodeQrFromFile(file) {
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error('Image dimensions are too large')
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Could not process this image')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const result = jsQR(img.data, img.width, img.height)
    if (!result) throw new Error('No QR code found in uploaded image')
    return result.data
  } finally {
    bitmap.close?.()
  }
}

function tokenFromPayload(payload) {
  try {
    const m = new URL(payload).pathname.match(/\/m\/([A-Za-z0-9_-]{16,})/i)
    if (m) return m[1]
  } catch {
    /* not a valid URL */
  }
  if (/^[A-Za-z0-9_-]{16,}$/.test(payload.trim())) return payload.trim()
  throw new Error('This QR does not contain a valid token or /m/<token> link')
}

function localDateInputValue() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function eventFromDatabase(row) {
  return {
    id: row.id,
    name: row.name,
    location: row.location || '',
    date: row.event_date || '',
    active: row.active === true
  }
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(filename, rows) {
  const blob = new Blob([`\uFEFF${rows.map((row) => row.join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function downloadQrCodeImage(member, notify) {
  try {
    const dataUrl = await QRCode.toDataURL(profileUrl(member.qr_token), {
      width: 600,
      margin: 2,
      color: { dark: '#0a101f', light: '#ffffff' }
    })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${member.full_name.replace(/\s+/g, '_')}_QR.png`
    a.click()
    notify?.success?.(`Downloaded QR for ${member.full_name}`)
  } catch (err) {
    notify?.error?.('Failed to download QR code')
  }
}

export default function Dashboard({ isDemo = false, onExitDemo, onOpenDbModal, accessRole = 'admin' }) {
  const notify = useToast()
  const isAttendanceHr = accessRole === 'hr'
  const useDemo = isDemo || configMissing
  const [members, setMembers] = useState(() => (useDemo ? DEMO_MEMBERS : []))
  const [loading, setLoading] = useState(!useDemo)
  const [tab, setTab] = useState(isAttendanceHr ? 'attendance' : 'overview') // 'overview' | 'members' | 'attendance' | 'contributions'
  const [overviewPeriod, setOverviewPeriod] = useState('month')

  // Search & Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'active' | 'inactive'
  const [qrFilter, setQrFilter] = useState('all') // 'all' | 'assigned' | 'missing'
  const [deptFilter, setDeptFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest') // 'newest' | 'name' | 'dept'
  const [viewMode, setViewMode] = useState('table') // 'table' | 'grid'

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingMember, setEditingMember] = useState(null)
  const [selectedContributions, setSelectedContributions] = useState(null)
  const [idCardMember, setIdCardMember] = useState(null)
  const [linkingMember, setLinkingMember] = useState(null)
  const [showScanner, setShowScanner] = useState(false)
  const [memberToDelete, setMemberToDelete] = useState(null)
  const [attendanceToDelete, setAttendanceToDelete] = useState(null)
  const [eventToDelete, setEventToDelete] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [eventSaving, setEventSaving] = useState(false)

  // Attendance
  const [attLog, setAttLog] = useState(() => (useDemo ? DEMO_ATTENDANCE : []))
  const [attLoading, setAttLoading] = useState(false)
  const [attSearch, setAttSearch] = useState('')
  const [contributions, setContributions] = useState(() => (useDemo ? DEMO_CONTRIBUTIONS : []))
  const [contribLoading, setContribLoading] = useState(false)
  const [contribSearch, setContribSearch] = useState('')
  const [contribTargetId, setContribTargetId] = useState('')

  // Live events are loaded from Supabase; demo events stay local to the browser.
  const [events, setEvents] = useState(() => (useDemo ? readLocalEvents() : []))
  const [activeEventId, setActiveEventId] = useState(() => (useDemo ? readLocalEvents().find((event) => event.active)?.id || '' : ''))
  const [showEventForm, setShowEventForm] = useState(false)
  const [eventForm, setEventForm] = useState({ name: '', location: '', date: localDateInputValue() })
  const activeEvent = events.find((event) => event.id === activeEventId && event.active) || events.find((event) => event.active) || null
  const activeEventNote = activeEvent ? createEventAttendanceNote(activeEvent) : ''
  const activeEventCheckIns = activeEventNote ? attLog.filter((record) => record.notes === activeEventNote).length : 0

  // Upload QR handling
  const fileRef = useRef(null)
  const uploadTarget = useRef(null)

  // Load members
  const loadMembers = useCallback(async () => {
    if (isAttendanceHr) {
      setMembers([])
      setLoading(false)
      return
    }
    if (useDemo) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      notify.error(error.message)
    } else {
      setMembers(data || [])
    }
    setLoading(false)
  }, [isAttendanceHr, useDemo, notify])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  // Load attendance log
  const loadAttendance = useCallback(async () => {
    if (useDemo) {
      setAttLoading(false)
      return
    }
    setAttLoading(true)
    if (isAttendanceHr) {
      const { data, error } = await supabase.rpc('get_attendance_log', { p_days: 30 })
      if (error) {
        notify.error(error.message)
      } else {
        setAttLog(Array.isArray(data) ? data : [])
      }
      setAttLoading(false)
      return
    }
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from('attendance')
      .select('id, scanned_at, notes, members!inner(full_name, role)')
      .gte('scanned_at', since)
      .order('scanned_at', { ascending: false })
    if (error) {
      notify.error(error.message)
    } else {
      setAttLog((data || []).map((record) => ({
        ...record,
        member_name: record.members?.full_name || 'Member',
        member_role: record.members?.role || 'Member'
      })))
    }
    setAttLoading(false)
  }, [isAttendanceHr, useDemo, notify])

  useEffect(() => {
    if (tab === 'attendance' || tab === 'overview') {
      loadAttendance()
    }
  }, [tab, loadAttendance])

  const loadEvents = useCallback(async () => {
    if (useDemo) {
      const localEvents = readLocalEvents()
      setEvents(localEvents)
      setActiveEventId(localEvents.find((event) => event.active)?.id || '')
      return
    }

    const { data, error } = await supabase
      .from('events')
      .select('id, name, location, event_date, active, created_at')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      notify.error(`Could not load events: ${error.message}`)
      return
    }

    let rows = data || []
    // Preserve event setups made on this device before event sync was added.
    if (rows.length === 0) {
      const localEvents = readLocalEvents()
      if (localEvents.length) {
        const legacyRows = localEvents.map((event) => ({
          ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id) ? { id: event.id } : {}),
          name: event.name,
          location: event.location || '',
          event_date: /^\d{4}-\d{2}-\d{2}$/.test(event.date) ? event.date : null,
          active: event.active === true
        }))
        const { error: syncError } = await supabase
          .from('events')
          .upsert(legacyRows, { onConflict: 'id', ignoreDuplicates: true })
        if (syncError) {
          notify.warn(`Could not sync events saved on this device: ${syncError.message}`)
        } else {
          const { data: syncedRows, error: reloadError } = await supabase
            .from('events')
            .select('id, name, location, event_date, active, created_at')
            .order('created_at', { ascending: false })
            .limit(100)
          if (reloadError) {
            notify.error(`Could not reload synced events: ${reloadError.message}`)
          } else {
            rows = syncedRows || []
          }
        }
      }
    }

    const nextEvents = rows.map(eventFromDatabase)
    setEvents(nextEvents)
    setActiveEventId(nextEvents.find((event) => event.active)?.id || '')
  }, [useDemo, notify])

  useEffect(() => {
    loadEvents()
  }, [loadEvents])

  useEffect(() => {
    if (useDemo) return undefined
    const channel = supabase
      .channel('attendance-events-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, loadEvents)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, loadAttendance)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadAttendance, loadEvents, useDemo])

  useEffect(() => {
    if (useDemo) return undefined
    const refreshEvents = () => {
      if (document.visibilityState === 'visible') loadEvents()
    }
    window.addEventListener('focus', refreshEvents)
    document.addEventListener('visibilitychange', refreshEvents)
    return () => {
      window.removeEventListener('focus', refreshEvents)
      document.removeEventListener('visibilitychange', refreshEvents)
    }
  }, [loadEvents, useDemo])

  const loadContributions = useCallback(async () => {
    if (useDemo) {
      setContributions(DEMO_CONTRIBUTIONS.map((item) => ({
        ...item,
        member_name: DEMO_MEMBERS.find((member) => member.id === item.member_id)?.full_name || 'Member'
      })))
      setContribLoading(false)
      return
    }
    setContribLoading(true)
    const { data, error } = await supabase
      .from('contributions')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      notify.error(error.message)
    } else {
      const memberNames = new Map(members.map((member) => [member.id, member.full_name]))
      setContributions((data || []).map((item) => ({ ...item, member_name: memberNames.get(item.member_id) || 'Member' })))
    }
    setContribLoading(false)
  }, [useDemo, members, notify])

  useEffect(() => {
    if (tab === 'contributions' || tab === 'overview') loadContributions()
  }, [tab, loadContributions])

  useEffect(() => {
    if (useDemo) saveLocalEvents(events)
  }, [events, useDemo])

  const handleCreateEvent = async (event) => {
    event.preventDefault()
    const name = eventForm.name.trim().slice(0, 120)
    if (!name) {
      notify.warn('Enter an event name first')
      return
    }
    setEventSaving(true)
    try {
      if (useDemo) {
        const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const nextEvents = [
          { id, name, location: eventForm.location.trim().slice(0, 120), date: eventForm.date, active: true },
          ...events.map((item) => ({ ...item, active: false }))
        ].slice(0, 100)
        if (!saveLocalEvents(nextEvents)) throw new Error('This browser could not save event setup.')
        setEvents(nextEvents)
        setActiveEventId(id)
      } else {
        const { error } = await supabase.rpc('create_attendance_event', {
          p_name: name,
          p_location: eventForm.location.trim().slice(0, 120),
          p_event_date: eventForm.date || null
        })
        if (error) throw error
        await loadEvents()
      }
      setEventForm({ name: '', location: '', date: localDateInputValue() })
      setShowEventForm(false)
      notify.success('Event saved. Attendance scanning is ready on your devices.')
    } catch (error) {
      notify.error(error.message || 'Could not save this event')
    } finally {
      setEventSaving(false)
    }
  }

  const handleEndEvent = async () => {
    if (!activeEvent) return
    setEventSaving(true)
    try {
      if (useDemo) {
        const endedEvents = events.map((item) => ({ ...item, active: false }))
        if (!saveLocalEvents(endedEvents)) throw new Error('This browser could not save the event update.')
        setEvents(endedEvents)
        setActiveEventId('')
      } else {
        const { error } = await supabase.rpc('set_attendance_event_active', {
          p_event_id: activeEvent.id,
          p_active: false
        })
        if (error) throw error
        await loadEvents()
      }
      notify.success(`${activeEvent.name} ended`)
    } catch (error) {
      notify.error(error.message || 'Could not end this event')
    } finally {
      setEventSaving(false)
    }
  }

  const handleActivateEvent = async (eventToActivate) => {
    if (!eventToActivate?.id) return
    if (useDemo) {
      const nextEvents = events.map((item) => ({ ...item, active: item.id === eventToActivate.id }))
      if (!saveLocalEvents(nextEvents)) {
        notify.error('This browser could not save the event update.')
        return
      }
      setEvents(nextEvents)
      setActiveEventId(eventToActivate.id)
      return
    }

    setEventSaving(true)
    try {
      const { error } = await supabase.rpc('set_attendance_event_active', {
        p_event_id: eventToActivate.id,
        p_active: true
      })
      if (error) throw error
      await loadEvents()
      notify.success(`${eventToActivate.name} is now active`)
    } catch (error) {
      notify.error(error.message || 'Could not activate this event')
    } finally {
      setEventSaving(false)
    }
  }

  const confirmDeleteEvent = async () => {
    if (!eventToDelete || deleteBusy) return
    setDeleteBusy(true)
    try {
      if (useDemo) {
        const attendanceNote = createEventAttendanceNote(eventToDelete)
        const remainingEvents = events.filter((event) => event.id !== eventToDelete.id)
        if (!saveLocalEvents(remainingEvents)) throw new Error('Could not update the event list.')
        setAttLog((previous) => previous.filter((record) => record.notes !== attendanceNote))
        setEvents(remainingEvents)
        if (activeEventId === eventToDelete.id) setActiveEventId('')
      } else {
        const { error } = await supabase.rpc('delete_attendance_event', { p_event_id: eventToDelete.id })
        if (error) throw error
        await Promise.all([loadEvents(), loadAttendance()])
      }

      notify.success(`Deleted ${eventToDelete.name} and its attendance records`)
      setEventToDelete(null)
    } catch (error) {
      notify.error(error.message || 'Could not delete this event')
    } finally {
      setDeleteBusy(false)
    }
  }

  const confirmDeleteAttendance = async () => {
    if (!attendanceToDelete?.id || deleteBusy) return
    setDeleteBusy(true)
    try {
      if (useDemo) {
        setAttLog((previous) => previous.filter((record) => record.id !== attendanceToDelete.id))
      } else {
        const { error } = await supabase
          .from('attendance')
          .delete()
          .eq('id', attendanceToDelete.id)
        if (error) throw error
        setAttLog((previous) => previous.filter((record) => record.id !== attendanceToDelete.id))
      }
      notify.success(`Removed ${attendanceToDelete.member_name}'s attendance record`)
      setAttendanceToDelete(null)
    } catch (error) {
      notify.error(error.message || 'Could not delete this attendance record')
    } finally {
      setDeleteBusy(false)
    }
  }

  // Add / Edit Member
  const handleSaveMember = async (formValues) => {
    try {
      if (useDemo) {
        if (formValues.id) {
          // Edit in demo
          setMembers((prev) =>
            prev.map((m) =>
              m.id === formValues.id
                ? {
                    ...m,
                    full_name: formValues.full_name,
                    email: formValues.email,
                    role: formValues.role,
                    department: formValues.department,
                    is_active: formValues.is_active
                  }
                : m
            )
          )
          notify.success(`Updated ${formValues.full_name} (Demo)`)
          setEditingMember(null)
        } else {
          const demoToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
          const newM = {
            id: `demo-${Date.now()}`,
            full_name: formValues.full_name,
            email: formValues.email,
            role: formValues.role,
            department: formValues.department,
            qr_token: demoToken,
            is_active: true,
            created_at: new Date().toISOString()
          }
          setMembers((prev) => [newM, ...prev])
          notify.success(`Member ${formValues.full_name} added with QR ✓ (Demo)`)
          setShowAddModal(false)
        }
        return
      }

      // Live Supabase
      if (formValues.id) {
        const { error } = await supabase
          .from('members')
          .update({
            full_name: formValues.full_name,
            email: formValues.email,
            role: formValues.role,
            department: formValues.department,
            is_active: formValues.is_active
          })
          .eq('id', formValues.id)

        if (error) throw error
        notify.success(`Updated ${formValues.full_name}`)
        setEditingMember(null)
      } else {
        // Auto-generate 32-char hex QR token on member creation
        const newQrToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')

        const { error } = await supabase.from('members').insert({
          full_name: formValues.full_name,
          email: formValues.email,
          role: formValues.role,
          department: formValues.department,
          qr_token: newQrToken,
          is_active: true
        })

        if (error) throw error
        notify.success(`Member ${formValues.full_name} added with QR generated ✓`)
        setShowAddModal(false)
      }
      loadMembers()
    } catch (err) {
      notify.error(err.message)
    }
  }

  // Assign or Re-assign QR code
  const handleAssignQr = async (member) => {
    if (
      member.qr_token &&
      !window.confirm(
        `This will replace the existing QR code for ${member.full_name}. The old card will be revoked immediately. Continue?`
      )
    ) {
      return
    }

    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    if (useDemo) {
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, qr_token: token } : m))
      )
      notify.success(`New QR token assigned to ${member.full_name} (Demo)`)
      return
    }

    try {
      // Direct update to members table
      const { error: updateError } = await supabase
        .from('members')
        .update({ qr_token: token })
        .eq('id', member.id)

      if (updateError) {
        // Fallback to assign_qr RPC
        const { error: rpcError } = await supabase.rpc('assign_qr', { p_member: member.id })
        if (rpcError) throw new Error(updateError.message || rpcError.message)
      }

      notify.success(`QR token generated & saved in database for ${member.full_name} ✓`)
      loadMembers()
    } catch (err) {
      notify.error(err.message || 'Failed to generate QR')
    }
  }

  // Upload QR code image
  const triggerPickUpload = (member) => {
    uploadTarget.current = member
    if (fileRef.current) {
      fileRef.current.value = ''
      fileRef.current.click()
    }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    const member = uploadTarget.current
    if (!file || !member) return

    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      notify.error('Please upload a PNG or JPEG image under 2MB')
      return
    }

    try {
      notify.info('Scanning uploaded QR code…')
      const rawText = await decodeQrFromFile(file)
      const token = tokenFromPayload(rawText)

      if (useDemo) {
        setMembers((prev) =>
          prev.map((m) => (m.id === member.id ? { ...m, qr_token: token } : m))
        )
        notify.success(`QR linked to ${member.full_name} (Demo)`)
        return
      }

      const path = `${member.id}/${Date.now()}.${file.type === 'image/png' ? 'png' : 'jpg'}`
      const up = await supabase.storage
        .from('qr-codes')
        .upload(path, file, { contentType: file.type })

      if (up.error) throw up.error

      const { error } = await supabase
        .from('members')
        .update({ qr_token: token, qr_image_path: path })
        .eq('id', member.id)

      if (error) {
        throw new Error(
          error.code === '23505'
            ? 'That QR code is already linked to another member'
            : error.message
        )
      }

      notify.success(`QR successfully linked to ${member.full_name}`)
      loadMembers()
    } catch (err) {
      notify.error(err.message)
    }
  }

  // Toggle active/inactive
  const handleToggleActive = async (member) => {
    const nextState = !member.is_active
    if (useDemo) {
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, is_active: nextState } : m))
      )
      notify.success(`${member.full_name} is now ${nextState ? 'Active' : 'Deactivated'} (Demo)`)
      return
    }

    try {
      const { error } = await supabase
        .from('members')
        .update({ is_active: nextState })
        .eq('id', member.id)

      if (error) throw error
      notify.success(
        `${member.full_name} is now ${nextState ? 'Active' : 'Deactivated'}`
      )
      loadMembers()
    } catch (err) {
      notify.error(err.message)
    }
  }

  // Delete member
  const confirmDeleteMember = async () => {
    if (!memberToDelete) return
    if (useDemo) {
      setMembers((prev) => prev.filter((m) => m.id !== memberToDelete.id))
      notify.success(`Deleted ${memberToDelete.full_name} (Demo)`)
      setMemberToDelete(null)
      return
    }

    try {
      const { error } = await supabase
        .from('members')
        .delete()
        .eq('id', memberToDelete.id)

      if (error) throw error
      notify.success(`Deleted ${memberToDelete.full_name}`)
      setMemberToDelete(null)
      loadMembers()
    } catch (err) {
      notify.error(err.message)
    }
  }

  // Export members to CSV
  const handleExportMembersCSV = () => {
    if (members.length === 0) {
      notify.warn('No members to export')
      return
    }

    const headers = ['Full Name', 'Role', 'Department', 'Email', 'Active', 'Has QR', 'Joined Date'].map(csvCell)
    const rows = filteredMembers.map((m) => [
      csvCell(m.full_name),
      csvCell(m.role),
      csvCell(m.department),
      csvCell(m.email),
      csvCell(m.is_active ? 'Active' : 'Inactive'),
      csvCell(m.qr_token ? 'Yes' : 'No'),
      csvCell(new Date(m.created_at).toISOString().split('T')[0])
    ])

    downloadCsv(`club_members_${localDateInputValue()}.csv`, [headers, ...rows])
    notify.success('Exported members CSV')
  }

  // Export attendance log to CSV
  const handleExportAttendanceCSV = () => {
    if (attLog.length === 0) {
      notify.warn('No attendance records to export')
      return
    }

    const headers = ['Member Name', 'Role', 'Event', 'Date', 'Time'].map(csvCell)
    const rows = attLog.map((a) => {
      const d = new Date(a.scanned_at)
      return [
        csvCell(a.member_name),
        csvCell(a.member_role),
        csvCell(getAttendanceEventName(a.notes) || a.notes),
        csvCell(d.toLocaleDateString()),
        csvCell(d.toLocaleTimeString())
      ]
    })

    downloadCsv(`attendance_log_${localDateInputValue()}.csv`, [headers, ...rows])
    notify.success('Exported attendance log CSV')
  }

  // Departments list for filter
  const allDepartments = useMemo(() => {
    const set = new Set()
    members.forEach((m) => {
      if (m.department) set.add(m.department.trim())
    })
    return Array.from(set).sort()
  }, [members])

  // Filtered members list
  const filteredMembers = useMemo(() => {
    return members
      .filter((m) => {
        const text = `${m.full_name} ${m.email || ''} ${m.department || ''} ${m.role || ''}`.toLowerCase()
        if (search && !text.includes(search.toLowerCase())) return false

        if (statusFilter === 'active' && !m.is_active) return false
        if (statusFilter === 'inactive' && m.is_active) return false

        if (qrFilter === 'assigned' && !m.qr_token) return false
        if (qrFilter === 'missing' && m.qr_token) return false

        if (deptFilter !== 'all' && m.department !== deptFilter) return false

        return true
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.full_name.localeCompare(b.full_name)
        if (sortBy === 'dept') return (a.department || '').localeCompare(b.department || '')
        return new Date(b.created_at) - new Date(a.created_at)
      })
  }, [members, search, statusFilter, qrFilter, deptFilter, sortBy])

  // Filtered attendance records
  const filteredAttendance = useMemo(() => {
    if (!attSearch.trim()) return attLog
    const q = attSearch.toLowerCase()
    return attLog.filter((a) =>
      `${a.member_name} ${a.member_role} ${a.notes || ''}`.toLowerCase().includes(q)
    )
  }, [attLog, attSearch])

  const filteredContributions = useMemo(() => {
    if (!contribSearch.trim()) return contributions
    const q = contribSearch.toLowerCase()
    return contributions.filter((item) =>
      `${item.title || ''} ${item.description || ''} ${item.member_name || ''}`.toLowerCase().includes(q)
    )
  }, [contributions, contribSearch])

  // Stats
  const stats = useMemo(() => {
    const total = members.length
    const active = members.filter((m) => m.is_active).length
    const withQr = members.filter((m) => m.qr_token && m.is_active).length
    const attCount = attLog.length
    return { total, active, withQr, attCount }
  }, [members, attLog])

  const overviewData = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const attendanceBuckets = []
    const getCount = (matches) => attLog.filter((record) => {
      const scannedAt = new Date(record.scanned_at)
      return !Number.isNaN(scannedAt.getTime()) && matches(scannedAt)
    }).length

    if (overviewPeriod === 'today') {
      for (let index = 0; index < 6; index += 1) {
        const startHour = index * 4
        attendanceBuckets.push({
          label: startHour === 0 ? '12a' : startHour < 12 ? `${startHour}a` : startHour === 12 ? '12p' : `${startHour - 12}p`,
          count: getCount((scannedAt) => scannedAt.toDateString() === today.toDateString() && Math.floor(scannedAt.getHours() / 4) === index)
        })
      }
    } else if (overviewPeriod === 'week') {
      const firstDay = new Date(today)
      firstDay.setDate(today.getDate() - ((today.getDay() + 6) % 7))
      for (let index = 0; index < 7; index += 1) {
        const date = new Date(firstDay)
        date.setDate(firstDay.getDate() + index)
        attendanceBuckets.push({
          label: date.toLocaleDateString(undefined, { weekday: 'short' }),
          count: getCount((scannedAt) => scannedAt.toDateString() === date.toDateString())
        })
      }
    } else {
      const daysThisMonth = today.getDate()
      const weekCount = Math.ceil(daysThisMonth / 7)
      for (let index = 0; index < weekCount; index += 1) {
        const startDay = index * 7 + 1
        const endDay = Math.min(startDay + 6, daysThisMonth)
        const start = new Date(today.getFullYear(), today.getMonth(), startDay)
        const end = new Date(today.getFullYear(), today.getMonth(), endDay, 23, 59, 59, 999)
        attendanceBuckets.push({
          label: `W${index + 1}`,
          count: getCount((scannedAt) => scannedAt >= start && scannedAt <= end)
        })
      }
    }

    const maxAttendance = Math.max(1, ...attendanceBuckets.map((bucket) => bucket.count))
    const recentContributions = [...contributions]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 4)
    const recentAttendance = [...attLog]
      .sort((a, b) => new Date(b.scanned_at || 0) - new Date(a.scanned_at || 0))
      .slice(0, 5)
    const eventCards = [...events]
      .sort((a, b) => Number(b.active) - Number(a.active) || String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 4)
      .map((event) => ({
      ...event,
      checkIns: attLog.filter((record) => getAttendanceEventName(record.notes) === event.name).length
      }))
    const activePercent = stats.total ? Math.round((stats.active / stats.total) * 100) : 0
    const passPercent = stats.total ? Math.round((stats.withQr / stats.total) * 100) : 0

    return { attendanceBuckets, maxAttendance, recentContributions, recentAttendance, eventCards, activePercent, passPercent }
  }, [attLog, contributions, events, overviewPeriod, stats])

  return (
    <div className="dashboard-layout">
      {/* Demo Mode Notice Top Banner */}
      {useDemo && (
        <div className="demo-mode-top-banner">
          <div className="demo-banner-content wrap">
            <span className="demo-banner-badge">
              <IconSparkles size={14} /> DEMO MODE
            </span>
            <span className="demo-banner-text">
              Exploring with interactive in-memory sample members & attendance.
            </span>
            <div className="demo-banner-actions">
              {onOpenDbModal && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline text-xs"
                  onClick={onOpenDbModal}
                >
                  ⚙️ Connect Supabase
                </button>
              )}
              {onExitDemo && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost text-xs"
                  onClick={onExitDemo}
                >
                  Exit Demo
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <Navbar
        role={accessRole}
        onOpenScanner={() => {
          if (activeEvent) setShowScanner(true)
          else {
            setTab('attendance')
            setShowEventForm(true)
            notify.warn('Create an event before scanning attendance')
          }
        }}
        activeTab={tab}
        setActiveTab={setTab}
      />

      <main className={`wrap main-content ${tab === 'attendance' ? 'attendance-main-content' : ''}`}>
        <header className="page-heading">
          <div>
            <p className="page-eyebrow">CISCO COMMUNITY · VIT BHOPAL</p>
            <h1>{tab === 'overview' ? 'Community dashboard' : tab === 'members' ? 'Members' : tab === 'attendance' ? 'Attendance' : 'Contributions'}</h1>
            <p>{tab === 'overview'
              ? 'Manage and track your community activity.'
              : tab === 'members'
              ? 'Manage your community roster and member passes.'
              : tab === 'attendance'
              ? 'Create an event, then scan member passes to record attendance.'
              : 'Recognize the projects, milestones, and service behind your community.'}</p>
          </div>
          {tab === 'attendance' && activeEvent && (
            <div className="active-event-pill"><span className="status-dot" /> Scanning for {activeEvent.name}</div>
          )}
          {tab === 'overview' && (
            <div className="overview-heading-tools">
              <label className="overview-search" aria-label="Search members">
                <IconSearch size={17} />
                <input
                  type="search"
                  placeholder="Search members…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') setTab('members') }}
                />
              </label>
              <div className="overview-filter-row">
                <div className="overview-period-tabs" role="group" aria-label="Attendance chart date range">
                  {[
                    { id: 'today', label: 'Today' },
                    { id: 'week', label: 'This week' },
                    { id: 'month', label: 'This month' }
                  ].map((period) => (
                    <button
                      key={period.id}
                      type="button"
                      className={overviewPeriod === period.id ? 'active' : ''}
                      onClick={() => setOverviewPeriod(period.id)}
                      aria-pressed={overviewPeriod === period.id}
                    >
                      {period.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="overview-report-button" onClick={() => setTab('attendance')}>Reports</button>
              </div>
            </div>
          )}
        </header>

        {/* KPI Stats Bar */}
        {tab !== 'overview' && <section aria-label="Key Performance Indicators" className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon-wrap bg-blue-subtle text-primary">
              <IconUsers size={22} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Total Members</div>
            </div>
            <div className="stat-pill text-success">{stats.active} Active</div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrap bg-purple-subtle text-accent">
              <IconIdCard size={22} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{stats.withQr}</div>
              <div className="stat-label">Active ID Passes</div>
            </div>
            <div className="stat-pill">
              {stats.total > 0 ? `${Math.round((stats.withQr / stats.total) * 100)}%` : '0%'}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrap bg-emerald-subtle text-success">
              <IconCalendar size={22} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{stats.attCount}</div>
              <div className="stat-label">Check-Ins (30d)</div>
            </div>
            <button
              type="button"
              className="stat-action-btn"
              onClick={() => {
                setTab('attendance')
                loadAttendance()
              }}
            >
              View Log ↗
            </button>
          </div>
        </section>}

        {/* Hidden file input for QR upload */}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />

        {tab === 'overview' && (
          <section className="community-dashboard-grid" aria-label="Community dashboard overview">
            <section className="overview-panel overview-event-board" aria-labelledby="event-board-title">
              <div className="overview-panel-heading">
                <div>
                  <h2 id="event-board-title">Events</h2>
                  <p>Coordinate upcoming and active check-ins</p>
                </div>
                <button
                  type="button"
                  className="overview-add-event"
                  aria-label="Create event"
                  onClick={() => { setTab('attendance'); setShowEventForm(true) }}
                >
                  +
                </button>
              </div>
              <div className="overview-event-list">
                {overviewData.eventCards.length > 0 ? overviewData.eventCards.map((event) => (
                  <article className={`overview-event-item ${event.active ? 'active' : ''}`} key={event.id}>
                    <div className="overview-event-item-top">
                      <span className={`overview-event-dot ${event.active ? 'active' : ''}`} />
                      <span className="overview-event-item-state">{event.active ? 'Active event' : 'Event'}</span>
                      {event.active && <span className="overview-live-mark">LIVE</span>}
                    </div>
                    <h3>{event.name}</h3>
                    <p>{[event.date, event.location].filter(Boolean).join(' · ') || 'Event details not added'}</p>
                    <div className="overview-event-item-footer">
                      <span>{event.checkIns} check-in{event.checkIns === 1 ? '' : 's'}</span>
                      {event.active ? (
                        <button type="button" onClick={() => setTab('attendance')}>Open event</button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleActivateEvent(event)}
                          disabled={eventSaving}
                        >
                          Set active
                        </button>
                      )}
                    </div>
                  </article>
                )) : (
                  <div className="overview-empty-state overview-events-empty">
                    <IconCalendar size={27} />
                    <strong>No events set up yet</strong>
                    <span>Create an event to start recording attendance.</span>
                    <button type="button" className="btn btn-primary" onClick={() => { setTab('attendance'); setShowEventForm(true) }} disabled={eventSaving}>Create event</button>
                  </div>
                )}
              </div>
              {overviewData.eventCards.length > 0 && (
                <button type="button" className="overview-see-all" onClick={() => setTab('attendance')}>Manage events <span aria-hidden="true">›</span></button>
              )}
            </section>

            <div className="overview-center-column">
              <div className="overview-chart-row">
                <section className="overview-panel overview-members-panel" aria-labelledby="member-snapshot-title">
                  <div className="overview-panel-heading">
                    <div>
                      <h2 id="member-snapshot-title">Member overview</h2>
                      <p>Active community profiles</p>
                    </div>
                    <button type="button" className="overview-panel-icon-button" onClick={() => setTab('members')} aria-label="Manage members">↗</button>
                  </div>
                  <div className="overview-donut-wrap">
                    <div className="overview-donut" style={{ '--active-ratio': `${overviewData.activePercent}%` }} role="img" aria-label={`${overviewData.activePercent}% active members`}>
                      <div><strong>{stats.total}</strong><span>members</span></div>
                    </div>
                  </div>
                  <div className="overview-member-legend">
                    <div><span className="overview-legend-dot metric-green-dot" /><span>Active</span><strong>{stats.active}</strong></div>
                    <div><span className="overview-legend-dot metric-muted-dot" /><span>Inactive</span><strong>{stats.total - stats.active}</strong></div>
                  </div>
                </section>

                <section className="overview-panel overview-attendance-panel" aria-labelledby="attendance-trend-title">
                  <div className="overview-panel-heading">
                    <div>
                      <h2 id="attendance-trend-title">Attendance trend</h2>
                      <p>{overviewPeriod === 'today' ? 'Check-ins by time of day' : overviewPeriod === 'week' ? 'Check-ins over the last 7 days' : 'Check-ins by week this month'}</p>
                    </div>
                    <button type="button" className="overview-panel-icon-button" onClick={() => setTab('attendance')} aria-label="Open attendance">↗</button>
                  </div>
                  <div className="overview-line-chart" role="img" aria-label={`Attendance trend: ${overviewData.attendanceBuckets.map((bucket) => `${bucket.label} ${bucket.count}`).join(', ')}`}>
                    <div className="overview-chart-grid-lines" aria-hidden="true"><i /><i /><i /></div>
                    <div className="overview-chart-bars" style={{ '--bucket-count': overviewData.attendanceBuckets.length }}>
                      {overviewData.attendanceBuckets.map((bucket) => (
                        <div className="overview-chart-bar-column" key={bucket.label}>
                          <span>{bucket.count || ''}</span>
                          <div className="overview-chart-bar-track">
                            <div className="overview-chart-bar-fill" style={{ height: `${bucket.count ? Math.max(9, (bucket.count / overviewData.maxAttendance) * 100) : 3}%` }} />
                          </div>
                          <small>{bucket.label}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="overview-chart-footnote"><span className="overview-legend-dot metric-blue-dot" /> {overviewData.attendanceBuckets.reduce((sum, bucket) => sum + bucket.count, 0)} check-ins in this range</div>
                </section>
              </div>

              <section className="overview-panel overview-progress-panel" aria-labelledby="community-coverage-title">
                <div className="overview-panel-heading">
                  <div>
                    <h2 id="community-coverage-title">Community coverage</h2>
                    <p>Member readiness and event participation</p>
                  </div>
                  <button type="button" className="overview-panel-icon-button" onClick={() => setTab('members')} aria-label="View community records">↗</button>
                </div>
                <div className="overview-progress-list">
                  <div className="overview-progress-item">
                    <div><span>Active members</span><strong>{stats.active} / {stats.total}</strong></div>
                    <div className="overview-progress-track"><span className="coverage-green" style={{ width: `${overviewData.activePercent}%` }} /></div>
                  </div>
                  <div className="overview-progress-item">
                    <div><span>Digital passes issued</span><strong>{stats.withQr} / {stats.total}</strong></div>
                    <div className="overview-progress-track"><span className="coverage-blue" style={{ width: `${overviewData.passPercent}%` }} /></div>
                  </div>
                  <div className="overview-progress-item">
                    <div><span>Current event check-ins</span><strong>{activeEvent ? `${activeEventCheckIns} / ${stats.active}` : 'No active event'}</strong></div>
                    <div className="overview-progress-track"><span className="coverage-pink" style={{ width: `${stats.active ? Math.min(100, Math.round((activeEventCheckIns / stats.active) * 100)) : 0}%` }} /></div>
                  </div>
                </div>
              </section>
            </div>

            <aside className="overview-side-column" aria-label="Recent community activity">
              <section className="overview-panel overview-side-panel" aria-labelledby="recent-checkins-title">
                <div className="overview-panel-heading">
                  <div>
                    <h2 id="recent-checkins-title">Recent check-ins</h2>
                    <p>Latest event attendance</p>
                  </div>
                  <button type="button" className="overview-panel-icon-button" onClick={() => setTab('attendance')} aria-label="View attendance history">↗</button>
                </div>
                {overviewData.recentAttendance.length > 0 ? (
                  <div className="overview-activity-list">
                    {overviewData.recentAttendance.map((record) => (
                      <article className="overview-activity-item" key={record.id}>
                        <span className="overview-activity-avatar">{(record.member_name || 'M').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
                        <div>
                          <strong>{record.member_name || 'Community member'}</strong>
                          <small>{getAttendanceEventName(record.notes) || record.notes || 'Member check-in'}</small>
                        </div>
                        <time dateTime={record.scanned_at}>{record.scanned_at ? new Date(record.scanned_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</time>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="overview-empty-state overview-activity-empty">No check-ins recorded yet.</div>
                )}
                <button type="button" className="overview-see-all" onClick={() => setTab('attendance')}>See attendance log <span aria-hidden="true">›</span></button>
              </section>

              <section className="overview-panel overview-side-panel" aria-labelledby="recent-contributions-title">
                <div className="overview-panel-heading">
                  <div>
                    <h2 id="recent-contributions-title">Contributions</h2>
                    <p>Recent member achievements</p>
                  </div>
                  <button type="button" className="overview-panel-icon-button" onClick={() => setTab('contributions')} aria-label="View contributions">↗</button>
                </div>
                {overviewData.recentContributions.length > 0 ? (
                  <div className="overview-contribution-list">
                    {overviewData.recentContributions.slice(0, 3).map((item) => (
                      <article className="overview-contribution-item" key={item.id}>
                        <span className="overview-contribution-mark"><IconAward size={15} /></span>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.member_name || members.find((member) => member.id === item.member_id)?.full_name || 'Community member'}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="overview-empty-state overview-activity-empty">No contributions recorded yet.</div>
                )}
                <button type="button" className="overview-see-all" onClick={() => setTab('contributions')}>See all contributions <span aria-hidden="true">›</span></button>
              </section>
            </aside>
          </section>
        )}

        {/* TAB 1: MEMBERS DIRECTORY */}
        {tab === 'members' && (
          <section aria-label="Members Directory">
            {/* Action Bar */}
            <div className="controls-panel">
              <div className="controls-top">
                <div className="search-input-wrap flex-1">
                  <IconSearch size={18} className="search-icon" />
                  <input
                    type="search"
                    className="input-field search-input"
                    placeholder="Search by name, role, department or email…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      type="button"
                      className="search-clear-btn"
                      onClick={() => setSearch('')}
                    >
                      <IconX size={14} />
                    </button>
                  )}
                </div>

                <div className="action-buttons-group">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowAddModal(true)}
                  >
                    <IconUserPlus size={16} />
                    <span>Add Member</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleExportMembersCSV}
                    title="Export filtered members to CSV"
                  >
                    <IconFileSpreadsheet size={16} />
                    <span className="hide-on-mobile">Export CSV</span>
                  </button>

                  <button
                    type="button"
                    className="btn-icon"
                    onClick={loadMembers}
                    title="Reload members list"
                  >
                    <IconRefresh size={16} className={loading ? 'spin' : ''} />
                  </button>
                </div>
              </div>

              {/* Filter Pills row */}
              <div className="controls-filters">
                <div className="filter-item">
                  <span className="filter-label">Status:</span>
                  <select
                    className="input-field filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active Only</option>
                    <option value="inactive">Inactive Only</option>
                  </select>
                </div>

                <div className="filter-item">
                  <span className="filter-label">QR Badge:</span>
                  <select
                    className="input-field filter-select"
                    value={qrFilter}
                    onChange={(e) => setQrFilter(e.target.value)}
                  >
                    <option value="all">All QR</option>
                    <option value="assigned">Assigned Passes</option>
                    <option value="missing">Missing QR</option>
                  </select>
                </div>

                {allDepartments.length > 0 && (
                  <div className="filter-item">
                    <span className="filter-label">Team:</span>
                    <select
                      className="input-field filter-select"
                      value={deptFilter}
                      onChange={(e) => setDeptFilter(e.target.value)}
                    >
                      <option value="all">All Teams</option>
                      {allDepartments.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="filter-item">
                  <span className="filter-label">Sort:</span>
                  <select
                    className="input-field filter-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="newest">Recently Added</option>
                    <option value="name">Name (A-Z)</option>
                    <option value="dept">Team</option>
                  </select>
                </div>

                {/* View Mode Toggle */}
                <div className="view-mode-toggle">
                  <button
                    type="button"
                    className={`btn-icon-sm ${viewMode === 'table' ? 'active' : ''}`}
                    onClick={() => setViewMode('table')}
                    title="Table View"
                  >
                    <IconLayoutList size={16} />
                  </button>
                  <button
                    type="button"
                    className={`btn-icon-sm ${viewMode === 'grid' ? 'active' : ''}`}
                    onClick={() => setViewMode('grid')}
                    title="Grid Card View"
                  >
                    <IconLayoutGrid size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Results count */}
            <div className="results-meta-bar">
              <span className="text-sm text-muted">
                Showing <strong>{filteredMembers.length}</strong> of{' '}
                <strong>{members.length}</strong> members
              </span>
            </div>

            {/* Loading State */}
            {loading && (
              <div className="card loading-card">
                <IconRefresh size={28} className="spin text-primary mb-2" />
                <p className="text-muted">Loading members directory…</p>
              </div>
            )}

            {/* Empty State */}
            {!loading && filteredMembers.length === 0 && (
              <div className="empty-state-panel">
                <IconUsers size={48} className="text-muted opacity-40 mb-3" />
                <h3>No members found</h3>
                <p className="text-muted text-sm max-w-sm mb-4">
                  {search || statusFilter !== 'all' || qrFilter !== 'all'
                    ? 'Try adjusting your search criteria or clearing filters.'
                    : 'Get started by adding your first club member.'}
                </p>
                {search || statusFilter !== 'all' || qrFilter !== 'all' ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('all')
                      setQrFilter('all')
                      setDeptFilter('all')
                    }}
                  >
                    Clear Filters
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowAddModal(true)}
                  >
                    <IconUserPlus size={16} />
                    <span>Add First Member</span>
                  </button>
                )}
              </div>
            )}

            {/* VIEW MODE 1: DATA TABLE */}
            {!loading && filteredMembers.length > 0 && viewMode === 'table' && (
              <div className="table-responsive-container">
                <table className="modern-table members-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role & Team</th>
                      <th>Digital Pass</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map((m) => {
                      const initials = m.full_name
                        .split(' ')
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()

                      return (
                        <tr key={m.id} className={!m.is_active ? 'row-inactive' : ''}>
                          <td>
                            <div className="member-avatar-cell">
                              <div className="avatar-circle">{initials}</div>
                              <div className="avatar-meta">
                                <span className="member-name-text">{m.full_name}</span>
                                {m.email && <span className="member-email-text">{m.email}</span>}
                              </div>
                            </div>
                          </td>

                          <td>
                            <div className="role-cell">
                              <span className="role-badge">{m.role || 'Member'}</span>
                              {m.department && (
                                <span className="dept-tag">{m.department}</span>
                              )}
                            </div>
                          </td>

                          <td>
                            {m.qr_token ? (
                              <button
                                type="button"
                                className="qr-status-pill assigned"
                                onClick={() => setIdCardMember(m)}
                                title="Click to view ID card"
                              >
                                <IconCheckCircle size={14} className="text-success" />
                                <span>Badge Ready</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="qr-status-pill unassigned"
                                onClick={() => handleAssignQr(m)}
                                title="Click to generate QR token"
                              >
                                <IconAlertCircle size={14} className="text-muted" />
                                <span>No QR Pass</span>
                              </button>
                            )}
                          </td>

                          <td>
                            <button
                              type="button"
                              className={`status-chip ${m.is_active ? 'active' : 'inactive'}`}
                              onClick={() => handleToggleActive(m)}
                              title="Click to toggle member status"
                            >
                              <span className="status-dot"></span>
                              <span>{m.is_active ? 'Active' : 'Inactive'}</span>
                            </button>
                          </td>

                          <td>
                            <div className="actions-cluster">
                              {/* ID Card */}
                              {m.qr_token && (
                                <button
                                  type="button"
                                  className="btn-action-icon accent"
                                  onClick={() => setIdCardMember(m)}
                                  title="View & Download ID Card"
                                >
                                  <IconIdCard size={15} />
                                </button>
                              )}

                              {/* Assign / Reassign */}
                              <button
                                type="button"
                                className="btn-action-icon"
                                onClick={() => handleAssignQr(m)}
                                title={m.qr_token ? 'Re-assign QR Token' : 'Generate QR Token'}
                              >
                                <IconQrCode size={15} />
                              </button>

                              {/* Upload QR image */}
                              <button
                                type="button"
                                className="btn-action-icon"
                                onClick={() => triggerPickUpload(m)}
                                title="Upload physical QR scan image"
                              >
                                <IconUpload size={15} />
                              </button>

                              {/* Download QR */}
                              {m.qr_token && (
                                <button
                                  type="button"
                                  className="btn-action-icon"
                                  onClick={() => downloadQrCodeImage(m, notify)}
                                  title="Download Raw QR Image"
                                >
                                  <IconDownload size={15} />
                                </button>
                              )}

                              {/* Achievements / Contributions */}
                              <button
                                type="button"
                                className="btn-action-icon"
                                onClick={() => setSelectedContributions(m)}
                                title="Contributions & Achievements"
                              >
                                <IconAward size={15} />
                              </button>

                              {/* Link Auth User */}
                              <button
                                type="button"
                                className="btn-action-icon"
                                onClick={() => setLinkingMember(m)}
                                title="Link Member User Login"
                              >
                                <IconLink size={15} />
                              </button>

                              {/* Edit */}
                              <button
                                type="button"
                                className="btn-action-icon"
                                onClick={() => setEditingMember(m)}
                                title="Edit details"
                              >
                                <IconEdit size={15} />
                              </button>

                              {/* Delete */}
                              <button
                                type="button"
                                className="btn-action-icon text-danger"
                                onClick={() => setMemberToDelete(m)}
                                title="Delete Member"
                              >
                                <IconTrash size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* VIEW MODE 2: GRID CARDS */}
            {!loading && filteredMembers.length > 0 && viewMode === 'grid' && (
              <div className="members-card-grid">
                {filteredMembers.map((m) => {
                  const initials = m.full_name
                    .split(' ')
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()

                  return (
                    <div
                      key={m.id}
                      className={`member-grid-card ${!m.is_active ? 'card-inactive' : ''}`}
                    >
                      <div className="card-top">
                        <div className="avatar-circle avatar-large">{initials}</div>
                        <div className="card-status-cluster">
                          <button
                            type="button"
                            className={`status-chip ${m.is_active ? 'active' : 'inactive'}`}
                            onClick={() => handleToggleActive(m)}
                          >
                            <span className="status-dot"></span>
                            <span>{m.is_active ? 'Active' : 'Inactive'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="grid-card-body">
                        <h4 className="member-grid-name">{m.full_name}</h4>
                        <div className="member-grid-role">
                          <span className="role-badge">{m.role || 'Member'}</span>
                          {m.department && <span className="dept-tag">{m.department}</span>}
                        </div>
                        {m.email && <div className="member-grid-email">{m.email}</div>}
                      </div>

                      <div className="grid-card-badge-status">
                        {m.qr_token ? (
                          <div className="badge-preview-row">
                            <span className="text-xs text-success flex-center gap-1 font-semibold">
                              <IconCheckCircle size={13} /> Digital ID Ready
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm btn-accent"
                              onClick={() => setIdCardMember(m)}
                            >
                              <IconIdCard size={13} /> View ID
                            </button>
                          </div>
                        ) : (
                          <div className="badge-preview-row">
                            <span className="text-xs text-muted flex-center gap-1">
                              <IconAlertCircle size={13} /> No QR Assigned
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => handleAssignQr(m)}
                            >
                              Assign QR
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="grid-card-actions">
                        <button
                          type="button"
                          className="btn-icon-sm"
                          onClick={() => setSelectedContributions(m)}
                          title="Contributions"
                        >
                          <IconAward size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-sm"
                          onClick={() => triggerPickUpload(m)}
                          title="Upload QR"
                        >
                          <IconUpload size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-sm"
                          onClick={() => setLinkingMember(m)}
                          title="Link User Login"
                        >
                          <IconLink size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-sm"
                          onClick={() => setEditingMember(m)}
                          title="Edit"
                        >
                          <IconEdit size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-sm text-danger"
                          onClick={() => setMemberToDelete(m)}
                          title="Delete"
                        >
                          <IconTrash size={15} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {tab === 'contributions' && (
          <section aria-label="Community contributions" className="contributions-page">
            <div className="controls-panel">
              <div className="controls-top">
                <div className="search-input-wrap flex-1">
                  <IconSearch size={18} className="search-icon" />
                  <input
                    type="search"
                    className="input-field search-input"
                    placeholder="Search achievements or members…"
                    value={contribSearch}
                    onChange={(event) => setContribSearch(event.target.value)}
                  />
                </div>
                <div className="action-buttons-group contribution-actions">
                  <select
                    className="input-field contribution-member-select"
                    value={contribTargetId}
                    onChange={(event) => setContribTargetId(event.target.value)}
                    aria-label="Choose a member"
                  >
                    <option value="">Choose a member</option>
                    {members.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!members.some((member) => member.id === contribTargetId)}
                    onClick={() => setSelectedContributions(members.find((member) => member.id === contribTargetId))}
                  >
                    <IconAward size={16} />
                    <span>Add contribution</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="results-meta-bar">
              <span className="text-sm text-muted">Showing <strong>{filteredContributions.length}</strong> of <strong>{contributions.length}</strong> records</span>
            </div>

            {contribLoading && <div className="card loading-card"><IconRefresh size={28} className="spin text-primary mb-2" /><p className="text-muted">Loading contributions…</p></div>}

            {!contribLoading && filteredContributions.length === 0 && (
              <div className="empty-state-panel">
                <IconAward size={46} className="text-muted opacity-40 mb-3" />
                <h3>{contribSearch ? 'No matching contributions' : 'No contributions recorded yet'}</h3>
                <p className="text-muted text-sm max-w-sm mb-4">Record workshops, projects, leadership, and other community achievements.</p>
              </div>
            )}

            {!contribLoading && filteredContributions.length > 0 && (
              <div className="contribution-record-list">
                {filteredContributions.map((item) => (
                  <article className="contribution-record" key={item.id}>
                    <div className="contribution-record-icon"><IconAward size={19} /></div>
                    <div className="contribution-record-main">
                      <strong>{item.title}</strong>
                      <span>{item.member_name || 'Member'}{item.created_at ? ` · ${new Date(item.created_at).toLocaleDateString()}` : ''}</span>
                      {item.description && <p>{item.description}</p>}
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm contribution-manage-button"
                      onClick={() => setSelectedContributions(members.find((member) => member.id === item.member_id) || { id: item.member_id, full_name: item.member_name || 'Member', role: 'Member' })}
                    >
                      Manage
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: ATTENDANCE TRACKER */}
        {tab === 'attendance' && (
          <section aria-label="Attendance Log">
            <div className={`event-manager-card ${activeEvent ? 'event-active' : ''}`}>
              <div className="event-manager-copy">
                <div className="event-manager-title-row">
                  <span className={`event-status-dot ${activeEvent ? 'active' : ''}`} />
                  <span className="event-status-label">{activeEvent ? 'ACTIVE EVENT' : 'EVENT SETUP'}</span>
                </div>
                <h2>{activeEvent?.name || 'Create an event to begin'}</h2>
                {activeEvent ? (
                  <p>{[activeEvent.date, activeEvent.location].filter(Boolean).join(' · ') || 'Ready for member check-ins'}</p>
                ) : (
                  <p>Attendance is recorded against an event when you scan a member’s QR pass.</p>
                )}
              </div>
              <div className="event-manager-actions attendance-event-actions">
                {activeEvent ? (
                  <>
                    <button type="button" className="btn btn-primary" onClick={() => setShowScanner(true)}><IconCamera size={16} /> Scan passes</button>
                    <button type="button" className="btn btn-outline" onClick={handleEndEvent} disabled={eventSaving}>End event</button>
                    <button type="button" className="btn btn-danger" onClick={() => setEventToDelete(activeEvent)} disabled={eventSaving}><IconTrash size={15} /> Delete event</button>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => setShowEventForm(true)} disabled={eventSaving}><IconCalendar size={16} /> Create event</button>
                )}
              </div>
            </div>

            {events.filter((event) => !event.active).length > 0 && (
              <details className="event-history-details">
                <summary>Recent events ({events.filter((event) => !event.active).length})</summary>
                <div className="event-history-list">
                  {events.filter((event) => !event.active).map((event) => (
                    <div className="event-history-item" key={event.id}>
                      <div className="event-history-copy">
                        <span>{event.name}</span>
                        <small>{[event.date, event.location].filter(Boolean).join(' · ') || 'Event ended'}</small>
                      </div>
                      <button type="button" className="btn-icon-danger event-delete-action" onClick={() => setEventToDelete(event)} aria-label={`Delete ${event.name} and its attendance records`} title="Delete event and check-ins" disabled={deleteBusy}>
                        <IconTrash size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="controls-panel attendance-controls-panel">
              <div className="controls-top">
                <div className="search-input-wrap flex-1">
                  <IconSearch size={18} className="search-icon" />
                  <input
                    type="search"
                    className="input-field search-input"
                    placeholder="Search attendance by member name or role…"
                    value={attSearch}
                    onChange={(e) => setAttSearch(e.target.value)}
                  />
                  {attSearch && (
                    <button
                      type="button"
                      className="search-clear-btn"
                      onClick={() => setAttSearch('')}
                    >
                      <IconX size={14} />
                    </button>
                  )}
                </div>

                <div className="action-buttons-group attendance-control-actions">
                  <button
                    type="button"
                    className="btn btn-primary attendance-open-scanner-button"
                    disabled={!activeEvent}
                    onClick={() => activeEvent ? setShowScanner(true) : setShowEventForm(true)}
                  >
                    <IconCamera size={16} />
                    <span>{activeEvent ? 'Open Scanner' : 'Create event first'}</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleExportAttendanceCSV}
                  >
                    <IconFileSpreadsheet size={16} />
                    <span className="hide-on-mobile">Export CSV</span>
                  </button>

                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => { loadAttendance(); loadEvents() }}
                    title="Refresh attendance and events"
                  >
                    <IconRefresh size={16} className={attLoading ? 'spin' : ''} />
                  </button>
                </div>
              </div>
            </div>

            <div className="results-meta-bar">
              <span className="text-sm text-muted">
                Showing <strong>{filteredAttendance.length}</strong> recorded check-ins
                over the last 30 days
              </span>
            </div>

            {attLoading && (
              <div className="card loading-card">
                <IconRefresh size={28} className="spin text-primary mb-2" />
                <p className="text-muted">Loading attendance records…</p>
              </div>
            )}

            {!attLoading && filteredAttendance.length === 0 && (
              <div className="empty-state-panel">
                <IconCalendar size={48} className="text-muted opacity-40 mb-3" />
                <h3>No attendance check-ins yet</h3>
                <p className="text-muted text-sm max-w-sm mb-4">
                  {activeEvent
                    ? 'Scan a member’s QR pass to record the first check-in for this event.'
                    : 'Create an event first, then scan member QR passes to post attendance.'}
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => activeEvent ? setShowScanner(true) : setShowEventForm(true)}
                >
                  {activeEvent ? <IconCamera size={16} /> : <IconCalendar size={16} />}
                  <span>{activeEvent ? 'Launch QR Scanner' : 'Create event'}</span>
                </button>
              </div>
            )}

            {!attLoading && filteredAttendance.length > 0 && (
              <div className="table-responsive-container">
                <table className="modern-table attendance-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Member Name</th>
                      <th>Event</th>
                      <th>Role</th>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Verification</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAttendance.map((a, index) => {
                      const d = new Date(a.scanned_at)
                      return (
                        <tr key={a.id || index}>
                          <td className="text-muted font-mono text-sm">
                            {filteredAttendance.length - index}
                          </td>
                          <td>
                            <strong>{a.member_name}</strong>
                          </td>
                          <td>{getAttendanceEventName(a.notes) || a.notes || 'Member check-in'}</td>
                          <td>
                            <span className="role-badge">{a.member_role || 'Member'}</span>
                          </td>
                          <td>
                            <span className="flex-center gap-1 text-sm">
                              <IconCalendar size={13} className="text-muted" />
                              {d.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </span>
                          </td>
                          <td>
                            <span className="flex-center gap-1 text-sm font-mono">
                              <IconClock size={13} className="text-muted" />
                              {d.toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                              })}
                            </span>
                          </td>
                          <td>
                            <span className="badge badge-success text-xs">
                              <IconCheckCircle size={12} /> Verified Pass
                            </span>
                          </td>
                          <td className="attendance-delete-cell">
                            <button
                              type="button"
                              className="btn-icon-danger attendance-delete-action"
                              onClick={() => setAttendanceToDelete(a)}
                              aria-label={`Delete attendance for ${a.member_name}`}
                              title="Delete attendance record"
                            >
                              <IconTrash size={15} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      {tab === 'attendance' && (
        <div className="attendance-quick-bar" role="region" aria-label="Attendance capture">
          <div className="attendance-quick-copy">
            <span className="attendance-quick-indicator" />
            <span className="attendance-quick-label">{activeEvent?.name || 'Attendance capture'}</span>
            <small>{activeEvent ? `${activeEventCheckIns} recent check-ins` : 'Create an event to start checking in'}</small>
          </div>
          <button
            type="button"
            className="attendance-quick-action"
            onClick={() => activeEvent ? setShowScanner(true) : setShowEventForm(true)}
          >
            {activeEvent ? <IconCamera size={16} /> : <IconCalendar size={16} />}
            <span>{activeEvent ? 'Capture attendance' : 'Create event'}</span>
          </button>
        </div>
      )}

      {showEventForm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="event-form-title" onClick={() => setShowEventForm(false)}>
          <div className="modal-card event-form-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-icon-badge"><IconCalendar size={18} /></span>
                <div><h3 id="event-form-title" className="modal-title">Create an event</h3><p className="modal-subtitle">Start a check-in session for member QR passes.</p></div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setShowEventForm(false)} aria-label="Close event form"><IconX size={18} /></button>
            </div>
            <form onSubmit={handleCreateEvent}>
              <div className="modal-body form-grid">
                <div className="form-group">
                  <label htmlFor="event-name">Event name <span className="req">*</span></label>
                  <input id="event-name" className="input-field" maxLength={120} autoFocus required placeholder="e.g. Cisco Networking Workshop" value={eventForm.name} onChange={(event) => setEventForm((current) => ({ ...current, name: event.target.value }))} />
                </div>
                <div className="form-row event-form-row">
                  <div className="form-group flex-1">
                    <label htmlFor="event-date">Date</label>
                    <input id="event-date" type="date" className="input-field" value={eventForm.date} onChange={(event) => setEventForm((current) => ({ ...current, date: event.target.value }))} />
                  </div>
                  <div className="form-group flex-2">
                    <label htmlFor="event-location">Location <span className="text-muted">(optional)</span></label>
                    <input id="event-location" className="input-field" maxLength={120} placeholder="e.g. Lab 204" value={eventForm.location} onChange={(event) => setEventForm((current) => ({ ...current, location: event.target.value }))} />
                  </div>
                </div>
                <p className="event-storage-note">{useDemo ? 'Demo events are saved on this device.' : 'Events and attendance check-ins are saved in Supabase and shared across devices.'}</p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowEventForm(false)} disabled={eventSaving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={eventSaving}><IconCalendar size={16} /> {eventSaving ? 'Saving…' : 'Create event'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {eventToDelete && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-event-title" onClick={() => { if (!deleteBusy) setEventToDelete(null) }}>
          <div className="modal-card modal-sm" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-icon-badge"><IconTrash size={18} /></span>
                <div><h3 id="delete-event-title" className="modal-title">Delete event?</h3><p className="modal-subtitle">{eventToDelete.name}</p></div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setEventToDelete(null)} aria-label="Close delete event dialog" disabled={deleteBusy}><IconX size={18} /></button>
            </div>
            <div className="modal-body">
              <p className="text-sm">{useDemo ? 'This removes the demo event and its demo check-ins from this browser.' : 'This removes the event from Supabase and permanently deletes all attendance check-ins recorded for it.'}</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setEventToDelete(null)} disabled={deleteBusy}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={confirmDeleteEvent} disabled={deleteBusy}><IconTrash size={15} /> {deleteBusy ? 'Deleting…' : 'Delete event and check-ins'}</button>
            </div>
          </div>
        </div>
      )}

      {attendanceToDelete && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-attendance-title" onClick={() => { if (!deleteBusy) setAttendanceToDelete(null) }}>
          <div className="modal-card modal-sm" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-icon-badge"><IconTrash size={18} /></span>
                <div><h3 id="delete-attendance-title" className="modal-title">Delete attendance record?</h3><p className="modal-subtitle">{attendanceToDelete.member_name}</p></div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setAttendanceToDelete(null)} aria-label="Close delete attendance dialog" disabled={deleteBusy}><IconX size={18} /></button>
            </div>
            <div className="modal-body">
              <p className="text-sm">This permanently removes this check-in from the attendance history.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setAttendanceToDelete(null)} disabled={deleteBusy}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={confirmDeleteAttendance} disabled={deleteBusy}><IconTrash size={15} /> {deleteBusy ? 'Deleting…' : 'Delete record'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: Add or Edit Member */}
      <MemberModal
        isOpen={showAddModal || !!editingMember}
        member={editingMember}
        onClose={() => {
          setShowAddModal(false)
          setEditingMember(null)
        }}
        onSubmit={handleSaveMember}
      />

      {/* MODAL 2: ID Card View & Print */}
      {idCardMember && (
        <div
          className="modal-backdrop"
          onClick={() => setIdCardMember(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-card modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-icon-badge">
                  <IconIdCard size={18} />
                </span>
                <div>
                  <h3 className="modal-title">Member QR Code</h3>
                  <p className="modal-subtitle">{idCardMember.full_name}</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setIdCardMember(null)}
                aria-label="Close"
              >
                <IconX size={18} />
              </button>
            </div>
            <div className="modal-body">
              <IdCard member={idCardMember} notify={notify} />
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Member Contributions */}
      {selectedContributions && (
        <ContributionsModal
          member={selectedContributions}
          isDemo={useDemo}
          demoContributions={contributions}
          onDemoChange={(items) => setContributions(items.map((item) => ({
            ...item,
            member_name: members.find((member) => member.id === item.member_id)?.full_name || 'Member'
          })))}
          onClose={() => {
            setSelectedContributions(null)
            if (!useDemo) loadContributions()
          }}
          notify={notify}
        />
      )}

      {/* MODAL 4: Link Member User Login */}
      {linkingMember && (
        <LinkUserModal
          member={linkingMember}
          isOpen={!!linkingMember}
          onClose={() => setLinkingMember(null)}
          notify={notify}
        />
      )}

      {/* MODAL 5: QR Scanner */}
      {showScanner && (
        <QrScanner
          activeEvent={activeEvent}
          members={members}
          isDemo={useDemo}
          onClose={() => setShowScanner(false)}
          onScan={(data) => {
            if (useDemo && data?.member_name) {
              setAttLog((prev) => [
                {
                  id: `att-${Date.now()}`,
                  member_name: data.member_name,
                  member_role: data.member_role || 'Member',
                  scanned_at: new Date().toISOString(),
                  notes: createEventAttendanceNote(activeEvent)
                },
                ...prev
              ])
            } else if (tab === 'attendance') {
              loadAttendance()
            }
          }}
          notify={notify}
        />
      )}

      {/* MODAL 6: Delete Confirmation */}
      {memberToDelete && (
        <div
          className="modal-backdrop"
          onClick={() => setMemberToDelete(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-card modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-icon-badge bg-red-subtle text-danger">
                  <IconTrash size={18} />
                </span>
                <h3 className="modal-title">Delete Member</h3>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setMemberToDelete(null)}
              >
                <IconX size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-sm">
                Are you sure you want to permanently delete{' '}
                <strong>{memberToDelete.full_name}</strong>?
              </p>
              <p className="text-xs text-danger mt-2">
                This will delete their profile, ID pass, attendance history, and
                contributions permanently.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setMemberToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmDeleteMember}
              >
                <IconTrash size={16} />
                <span>Delete Permanently</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
