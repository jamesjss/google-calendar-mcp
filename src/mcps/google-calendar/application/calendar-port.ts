import type { CalendarEvent, CalendarInfo } from "../domain/calendar.js";

export interface ListEventsQuery { timeMin: string; timeMax: string; query?: string; maxResults?: number }
export interface CalendarGateway {
  listCalendars(): Promise<CalendarInfo[]>;
  listEvents(calendarId: string, query: ListEventsQuery): Promise<CalendarEvent[]>;
  getEvent(calendarId: string, eventId: string): Promise<CalendarEvent>;
  createEvent(calendarId: string, event: Omit<CalendarEvent, "id" | "calendarId">): Promise<CalendarEvent>;
  updateEvent(calendarId: string, eventId: string, patch: Partial<CalendarEvent>, etag?: string): Promise<CalendarEvent>;
  deleteEvent(calendarId: string, eventId: string, etag?: string): Promise<void>;
}
