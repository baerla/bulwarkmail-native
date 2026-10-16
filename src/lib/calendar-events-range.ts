import type { Calendar, CalendarEvent } from '../api/types';
import {
  getEvents as fetchEvents,
  queryEvents,
  isCalendarAccessDenied,
  noteCalendarAccessError,
  supportsSyntheticCalendarIds,
  queryExpandedEvents,
  hydrateExpandedOccurrences,
} from '../api/calendar';
import type { JMAPClient } from '../api/jmap-client';
import { expandRecurringEvents } from './recurrence-expansion';
import { isTaskLikeObject } from './calendar-component-detection';

// Store-free on purpose: the calendar store, the foreground reminder sync and
// the headless reminder refresh (calendar-reminders-background) all load
// events through this.

// Map a server CalendarEvent onto its store representation. For events from a
// shared/group account the JMAP id is only unique within that account, so we
// namespace `id` (stashing the real id in originalId) and remap the event's
// `calendarIds` from raw server ids onto the namespaced store calendar ids so
// visibility filtering and per-calendar colour lookup line up. Events from the
// primary account are returned unchanged. Mirrors webmail's
// mapServerEventToStoreEvent.
export function mapServerEventToStoreEvent(
  event: CalendarEvent,
  calendars: Calendar[],
  accountId?: string,
): CalendarEvent {
  if (!accountId) return event;
  const mapped: Record<string, boolean> = {};
  for (const [calId, included] of Object.entries(event.calendarIds || {})) {
    const cal = calendars.find(
      (c) => (c.originalId || c.id) === calId && c.accountId === accountId,
    );
    mapped[cal?.id || calId] = included;
  }
  return {
    ...event,
    id: `${accountId}:${event.id}`,
    originalId: event.id,
    originalCalendarIds: event.calendarIds,
    calendarIds: Object.keys(mapped).length > 0 ? mapped : event.calendarIds,
    accountId,
    isShared: true,
  };
}

/**
 * The events of the given calendars (store ids) that overlap [after, before],
 * mapped to store ids and with recurring series expanded over the window:
 * by the server when it accepts the synthetic occurrence ids that gives
 * (Stalwart >= 0.16.20, see lib/recurrence-instances), else on the device.
 * Doesn't touch the store: fetchEvents keeps the result as the visible
 * window, the reminders load their own upcoming window with it. Throws when
 * the primary account fails; a failing shared account is skipped.
 */
export async function loadEventsInRange(
  calendars: Calendar[],
  calendarIds: string[],
  after: string,
  before: string,
  // The active account's singleton unless a detached client is given
  // (the headless reminder refresh).
  client?: JMAPClient,
): Promise<CalendarEvent[]> {
  // Without a client the calls keep their original shape, bound to the singleton.
  // Group the requested calendars by owning account: the primary account
  // (calendars without an accountId tag) plus one group per shared
  // account, since CalendarEvent/query is scoped to a single account. The
  // incoming ids are store ids (shared calendars are namespaced
  // `${accountId}:${id}`); map them back to the raw server ids the query
  // filter expects.
  const byId = new Map(calendars.map((c) => [c.id, c]));
  const groups = new Map<string | undefined, string[]>();
  for (const id of calendarIds) {
    const cal = byId.get(id);
    const accountId = cal?.accountId;
    const serverId = cal?.originalId || id;
    const group = groups.get(accountId);
    if (group) group.push(serverId);
    else groups.set(accountId, [serverId]);
  }
  if (groups.size === 0) groups.set(undefined, []);

  const expand = !!after && !!before
    && await (client ? supportsSyntheticCalendarIds(client) : supportsSyntheticCalendarIds()).catch(() => false);
  const raw: CalendarEvent[] = [];
  for (const [accountId, ids] of groups) {
    if (accountId && isCalendarAccessDenied(accountId)) continue;
    try {
      let fetched: CalendarEvent[] | null = null;
      if (expand) {
        // null: the server won't expand a range this long; the series are
        // then fetched whole and expanded below.
        const expandedIds = await (client
          ? queryExpandedEvents(after, before, accountId, client)
          : queryExpandedEvents(after, before, accountId));
        if (expandedIds) {
          const occurrences = expandedIds.length > 0
            ? (await (client
              ? fetchEvents(expandedIds, accountId, { expanded: true }, client)
              : fetchEvents(expandedIds, accountId, { expanded: true }))) ?? []
            : [];
          // The expanded query spans the account; keep the asked-for calendars.
          const wanted = new Set(ids);
          const inCalendars = wanted.size === 0
            ? occurrences
            : occurrences.filter((e) => Object.keys(e.calendarIds || {}).some((id) => wanted.has(id)));
          fetched = await (client
            ? hydrateExpandedOccurrences(inCalendars, accountId, client)
            : hydrateExpandedOccurrences(inCalendars, accountId));
        }
      }
      if (!fetched) {
        // The window is sent as after/before so accounts with more than
        // 1000 objects don't silently lose events and navigating past the
        // loaded range doesn't re-download everything.
        const eventIds = (await (client
          ? queryEvents(ids, after, before, accountId, client)
          : queryEvents(ids, after, before, accountId))) ?? [];
        if (eventIds.length === 0) continue;
        fetched = (await (client ? fetchEvents(eventIds, accountId, undefined, client) : fetchEvents(eventIds, accountId))) ?? [];
      }
      raw.push(...fetched.map((e) => mapServerEventToStoreEvent(e, calendars, accountId)));
    } catch (err) {
      // A failing shared account must not hide the user's own events;
      // remember an access rejection so it isn't re-probed every fetch.
      if (!accountId) throw err;
      noteCalendarAccessError(accountId, err);
    }
  }
  // Stalwart returns both Events and Tasks from CalendarEvent/query. Tasks
  // (also CalDAV ones without an `@type`) are surfaced by fetchTasks so
  // they don't pollute the grid.
  const onlyEvents = raw.filter((e) => !isTaskLikeObject(e) && !!e.start);
  return expandRecurringEvents(onlyEvents, after, before);
}
