import type { CalendarGateway, ListEventsQuery } from "./calendar-port.js";
import {
  type CalendarEvent,
  type CalendarRef,
  type CreateEventInput,
  type UpdateEventInput,
  eventFingerprint,
  eventTimeWindow,
  toCandidate,
} from "../domain/calendar.js";
import { AppError } from "../domain/errors.js";

export class CalendarService {
  constructor(private readonly gateway: CalendarGateway) {}

  listCalendars() {
    return this.gateway.listCalendars();
  }

  async resolveCalendar(ref?: CalendarRef): Promise<string> {
    if (!ref || (!ref.id && !ref.name)) return "primary";
    const calendars = await this.gateway.listCalendars();
    if (ref.id) {
      const match = calendars.find((calendar) => calendar.id === ref.id);
      if (!match) throw new AppError(`Calendar id not found: ${ref.id}`, "CALENDAR_NOT_FOUND", 404);
      return match.id;
    }
    const needle = ref.name!.normalize("NFKC").trim().toLocaleLowerCase("es");
    const matches = calendars.filter((calendar) => calendar.summary.normalize("NFKC").trim().toLocaleLowerCase("es") === needle);
    if (matches.length === 0) throw new AppError(`Calendar name not found: ${ref.name}`, "CALENDAR_NOT_FOUND", 404);
    if (matches.length > 1) {
      throw new AppError(`Calendar name is ambiguous: ${ref.name}. Use its id.`, "AMBIGUOUS_CALENDAR", 409, matches);
    }
    return matches[0]!.id;
  }

  async listEvents(ref: CalendarRef, query: ListEventsQuery) {
    return this.gateway.listEvents(await this.resolveCalendar(ref), query);
  }

  async getEvent(ref: CalendarRef, eventId: string) {
    return this.gateway.getEvent(await this.resolveCalendar(ref), eventId);
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const calendarId = await this.resolveCalendar(input.calendar);
    const candidate = toCandidate(input, calendarId);
    if (input.duplicatePolicy !== "allow") {
      const existing = await this.gateway.listEvents(calendarId, { ...eventTimeWindow(candidate), maxResults: 250 });
      const fingerprint = eventFingerprint(candidate);
      const duplicate = existing.find((event) => eventFingerprint(event) === fingerprint && event.status !== "cancelled");
      if (duplicate) {
        throw new AppError("A matching event already exists; pass duplicatePolicy=allow only if intentional", "DUPLICATE_EVENT", 409, duplicate);
      }
    }
    const { id: _id, calendarId: _calendarId, ...payload } = candidate;
    return this.gateway.createEvent(calendarId, payload);
  }

  async updateEvent(input: UpdateEventInput): Promise<CalendarEvent> {
    const calendarId = await this.resolveCalendar(input.calendar);
    const patch: Partial<CalendarEvent> = {};
    for (const key of ["summary", "description", "location", "start", "end"] as const) {
      if (input[key] !== undefined) Object.assign(patch, { [key]: input[key] });
    }
    return this.gateway.updateEvent(calendarId, input.eventId, patch, input.etag);
  }

  async deleteEvent(ref: CalendarRef, eventId: string, etag?: string): Promise<void> {
    return this.gateway.deleteEvent(await this.resolveCalendar(ref), eventId, etag);
  }
}
