import { google, type calendar_v3, type Auth } from "googleapis";
import type { CalendarGateway, ListEventsQuery } from "../application/calendar-port.js";
import type { CalendarEvent, CalendarInfo } from "../domain/calendar.js";
import { AppError } from "../domain/errors.js";

export class GoogleCalendarGateway implements CalendarGateway {
  private readonly api: calendar_v3.Calendar;

  constructor(auth: Auth.OAuth2Client, api?: calendar_v3.Calendar) {
    this.api = api ?? google.calendar({ version: "v3", auth });
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const result: CalendarInfo[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.api.calendarList.list({ maxResults: 250, pageToken });
      for (const item of response.data.items ?? []) {
        if (!item.id || !item.summary) continue;
        result.push({
          id: item.id,
          summary: item.summary,
          primary: item.primary ?? false,
          accessRole: item.accessRole ?? "reader",
          ...(item.timeZone ? { timeZone: item.timeZone } : {}),
        });
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
    return result;
  }

  async listEvents(calendarId: string, query: ListEventsQuery): Promise<CalendarEvent[]> {
    const result: CalendarEvent[] = [];
    let pageToken: string | undefined;
    const limit = Math.min(query.maxResults ?? 250, 2500);
    do {
      const response = await this.api.events.list({
        calendarId,
        timeMin: query.timeMin,
        timeMax: query.timeMax,
        maxResults: Math.min(250, limit - result.length),
        singleEvents: true,
        orderBy: "startTime",
        timeZone: "Europe/Madrid",
        ...(query.query ? { q: query.query } : {}),
        pageToken,
      });
      result.push(...(response.data.items ?? []).map((item) => mapEvent(calendarId, item)));
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken && result.length < limit);
    return result.slice(0, limit);
  }

  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
    try {
      const response = await this.api.events.get({ calendarId, eventId, timeZone: "Europe/Madrid" });
      return mapEvent(calendarId, response.data);
    } catch (error) {
      throw mapGoogleError(error, "Unable to read the event");
    }
  }

  async createEvent(calendarId: string, event: Omit<CalendarEvent, "id" | "calendarId">): Promise<CalendarEvent> {
    try {
      const response = await this.api.events.insert({
        calendarId,
        sendUpdates: "none",
        requestBody: toGoogleEvent(event),
      });
      return mapEvent(calendarId, response.data);
    } catch (error) {
      throw mapGoogleError(error, "Unable to create the event");
    }
  }

  async updateEvent(calendarId: string, eventId: string, patch: Partial<CalendarEvent>, etag?: string): Promise<CalendarEvent> {
    try {
      const response = await this.api.events.patch({
        calendarId,
        eventId,
        sendUpdates: "none",
        requestBody: toGoogleEvent(patch),
      }, etag ? { headers: { "If-Match": etag } } : undefined);
      return mapEvent(calendarId, response.data);
    } catch (error) {
      throw mapGoogleError(error, "Unable to update the event");
    }
  }

  async deleteEvent(calendarId: string, eventId: string, etag?: string): Promise<void> {
    try {
      await this.api.events.delete({ calendarId, eventId, sendUpdates: "none" }, etag ? { headers: { "If-Match": etag } } : undefined);
    } catch (error) {
      throw mapGoogleError(error, "Unable to delete the event");
    }
  }
}

function mapEvent(calendarId: string, item: calendar_v3.Schema$Event): CalendarEvent {
  if (!item.id || !item.start || !item.end) throw new AppError("Google returned an incomplete event", "INVALID_GOOGLE_RESPONSE", 502);
  const start = mapBoundary(item.start);
  const end = mapBoundary(item.end);
  return {
    id: item.id,
    calendarId,
    summary: item.summary ?? "(sin título)",
    start,
    end,
    ...(item.description != null ? { description: item.description } : {}),
    ...(item.location != null ? { location: item.location } : {}),
    ...(item.status != null ? { status: item.status } : {}),
    ...(item.htmlLink != null ? { htmlLink: item.htmlLink } : {}),
    ...(item.etag != null ? { etag: item.etag } : {}),
    ...(item.updated != null ? { updated: item.updated } : {}),
  };
}

function mapBoundary(value: calendar_v3.Schema$EventDateTime): CalendarEvent["start"] {
  if (value.date) return { date: value.date };
  if (value.dateTime) return { dateTime: value.dateTime, ...(value.timeZone ? { timeZone: value.timeZone } : {}) };
  throw new AppError("Google event boundary has neither date nor dateTime", "INVALID_GOOGLE_RESPONSE", 502);
}

function toGoogleEvent(event: Partial<Omit<CalendarEvent, "id" | "calendarId">>): calendar_v3.Schema$Event {
  return {
    ...(event.summary !== undefined ? { summary: event.summary } : {}),
    ...(event.description !== undefined ? { description: event.description ?? null } : {}),
    ...(event.location !== undefined ? { location: event.location ?? null } : {}),
    ...(event.start !== undefined ? { start: event.start } : {}),
    ...(event.end !== undefined ? { end: event.end } : {}),
  };
}

function mapGoogleError(error: unknown, fallback: string): AppError {
  const status = typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : 502;
  if (status === 404) return new AppError("Calendar or event not found", "NOT_FOUND", 404);
  if (status === 412) return new AppError("The event changed since it was read; fetch it again before writing", "ETAG_MISMATCH", 409);
  if (status === 403) return new AppError("Google Calendar denied this operation", "GOOGLE_FORBIDDEN", 403);
  return new AppError(fallback, "GOOGLE_API_ERROR", status >= 400 && status < 600 ? status : 502);
}
