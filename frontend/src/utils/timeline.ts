import type { TimelineEventRead } from '../types/cases'

export function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-CL')
}

export function stripCorreoSuffix(description: string | null): string {
  if (!description) return ''
  return description.replace(/\s*\(correo:.*\)$/, '')
}

export interface TimelineGroup {
  event: TimelineEventRead
  children: TimelineEventRead[]
}

export function groupTimelineEvents(timeline: TimelineEventRead[]): TimelineGroup[] {
  const childrenByMessageId: Record<string, TimelineEventRead[]> = {}
  for (const ev of timeline) {
    if (ev.action_type === 'document_shared' && ev.source_message_id) {
      childrenByMessageId[ev.source_message_id] = [
        ...(childrenByMessageId[ev.source_message_id] ?? []),
        ev,
      ]
    }
  }
  const attachedEventIds = new Set(Object.values(childrenByMessageId).flat().map((e) => e.event_id))
  return timeline
    .filter((ev) => !attachedEventIds.has(ev.event_id))
    .map((ev) => ({
      event: ev,
      children:
        ev.action_type === 'email_sent' && ev.source_message_id
          ? childrenByMessageId[ev.source_message_id] ?? []
          : [],
    }))
}
