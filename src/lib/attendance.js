const EVENT_NOTE_PREFIX = '[cisco-event:'

export function createEventAttendanceNote(event) {
  const eventId = String(event?.id || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)
  const eventName = String(event?.name || '').trim().slice(0, 120)
  if (!eventId || !eventName) throw new Error('Select a valid event before scanning attendance')
  return `${EVENT_NOTE_PREFIX}${eventId}] ${eventName}`
}

export function getAttendanceEventName(note) {
  if (!note || !String(note).startsWith(EVENT_NOTE_PREFIX)) return ''
  const close = String(note).indexOf('] ')
  return close < 0 ? '' : String(note).slice(close + 2).trim()
}

export function readLocalEvents() {
  try {
    const stored = JSON.parse(localStorage.getItem('cisco_attendance_events_v1') || '[]')
    if (!Array.isArray(stored)) return []
    return stored
      .filter((event) => event && typeof event === 'object')
      .map((event) => ({
        id: String(event.id || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64),
        name: String(event.name || '').trim().slice(0, 120),
        location: String(event.location || '').trim().slice(0, 120),
        date: String(event.date || '').slice(0, 32),
        active: event.active === true
      }))
      .filter((event) => event.id && event.name)
      .slice(0, 100)
  } catch {
    return []
  }
}

export function saveLocalEvents(events) {
  try {
    localStorage.setItem('cisco_attendance_events_v1', JSON.stringify(events.slice(0, 100)))
    return true
  } catch {
    return false
  }
}
