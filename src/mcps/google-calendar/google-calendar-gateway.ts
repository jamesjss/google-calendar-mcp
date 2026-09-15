import type { CalendarGateway, ListEventsQuery } from "./application/calendar-port.js";
import type { CalendarEvent, CalendarInfo } from "./domain/calendar.js";
import { AppError } from "./domain/errors.js";
import type { Env } from "../../platform/env.js";
import { D1Store, type GoogleCredentials } from "../../platform/d1-store.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

interface GoogleEventResource {
  id?: string;
  summary?: string;
  description?: string | null;
  location?: string | null;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  status?: string;
  htmlLink?: string;
  etag?: string;
  updated?: string;
}

export class GoogleTokenManager {
  constructor(private readonly env: Env, private readonly store: D1Store, private readonly subject: string, private readonly mcpSlug = "google-calendar") {}

  async accessToken(forceRefresh = false): Promise<string> {
    const account = await this.store.getGoogleAccount(this.subject, this.mcpSlug);
    if (!account) throw new AppError("Google account is no longer connected", "GOOGLE_ACCOUNT_MISSING", 401);
    const credentials = account.credentials;
    if (!forceRefresh && credentials.access_token && (credentials.expires_at ?? 0) > Date.now() + 60_000) return credentials.access_token;
    const body = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID,
      client_secret: this.env.GOOGLE_CLIENT_SECRET,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    });
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const token = await response.json<Partial<GoogleCredentials> & { expires_in?: number; error?: string }>();
    if (!response.ok || !token.access_token) throw new AppError("Google authorization must be renewed", "GOOGLE_REAUTH_REQUIRED", 401);
    const updated: GoogleCredentials = {
      ...credentials,
      ...token,
      refresh_token: token.refresh_token ?? credentials.refresh_token,
      expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
    };
    await this.store.putGoogleAccount({ ...account, credentials: updated }, this.mcpSlug);
    return updated.access_token!;
  }
}

export class GoogleCalendarGateway implements CalendarGateway {
  constructor(private readonly tokens: Pick<GoogleTokenManager, "accessToken">) {}

  async listCalendars(): Promise<CalendarInfo[]> {
    const result: CalendarInfo[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.request<{ items?: Array<{ id?: string; summary?: string; primary?: boolean; accessRole?: string; timeZone?: string }>; nextPageToken?: string }>(
        "/users/me/calendarList", { maxResults: "250", ...(pageToken ? { pageToken } : {}) },
      );
      for (const item of data.items ?? []) {
        if (!item.id || !item.summary) continue;
        result.push({ id: item.id, summary: item.summary, primary: item.primary ?? false, accessRole: item.accessRole ?? "reader", ...(item.timeZone ? { timeZone: item.timeZone } : {}) });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return result;
  }

  async listEvents(calendarId: string, query: ListEventsQuery): Promise<CalendarEvent[]> {
    const result: CalendarEvent[] = [];
    const limit = Math.min(query.maxResults ?? 250, 2500);
    let pageToken: string | undefined;
    do {
      const data = await this.request<{ items?: GoogleEventResource[]; nextPageToken?: string }>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        timeMin: query.timeMin, timeMax: query.timeMax, maxResults: String(Math.min(250, limit - result.length)), singleEvents: "true", orderBy: "startTime",
        timeZone: "Europe/Madrid", ...(query.query ? { q: query.query } : {}), ...(pageToken ? { pageToken } : {}),
      });
      result.push(...(data.items ?? []).map((item) => mapEvent(calendarId, item)));
      pageToken = data.nextPageToken;
    } while (pageToken && result.length < limit);
    return result.slice(0, limit);
  }

  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
    return mapEvent(calendarId, await this.request(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { timeZone: "Europe/Madrid" }));
  }

  async createEvent(calendarId: string, event: Omit<CalendarEvent, "id" | "calendarId">): Promise<CalendarEvent> {
    const data = await this.request<GoogleEventResource>(`/calendars/${encodeURIComponent(calendarId)}/events`, { sendUpdates: "none" }, {
      method: "POST", body: JSON.stringify(toGoogleEvent(event)), headers: { "Content-Type": "application/json" },
    });
    return mapEvent(calendarId, data);
  }

  async updateEvent(calendarId: string, eventId: string, patch: Partial<CalendarEvent>, etag?: string): Promise<CalendarEvent> {
    const data = await this.request<GoogleEventResource>(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { sendUpdates: "none" }, {
      method: "PATCH", body: JSON.stringify(toGoogleEvent(patch)), headers: { "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
    });
    return mapEvent(calendarId, data);
  }

  async deleteEvent(calendarId: string, eventId: string, etag?: string): Promise<void> {
    await this.request(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { sendUpdates: "none" }, {
      method: "DELETE", headers: etag ? { "If-Match": etag } : {},
    });
  }

  private async request<T = GoogleEventResource>(path: string, query: Record<string, string>, init: RequestInit = {}, retry = true): Promise<T> {
    const url = new URL(`${CALENDAR_API}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await this.tokens.accessToken()}` } });
    if (response.status === 401 && retry) {
      await this.tokens.accessToken(true);
      return this.request<T>(path, query, init, false);
    }
    if (!response.ok) throw await mapGoogleError(response);
    if (response.status === 204) return undefined as T;
    return response.json<T>();
  }
}

function mapEvent(calendarId: string, item: GoogleEventResource): CalendarEvent {
  if (!item.id || !item.start || !item.end) throw new AppError("Google returned an incomplete event", "INVALID_GOOGLE_RESPONSE", 502);
  return {
    id: item.id, calendarId, summary: item.summary ?? "(sin título)", start: mapBoundary(item.start), end: mapBoundary(item.end),
    ...(item.description != null ? { description: item.description } : {}), ...(item.location != null ? { location: item.location } : {}),
    ...(item.status ? { status: item.status } : {}), ...(item.htmlLink ? { htmlLink: item.htmlLink } : {}),
    ...(item.etag ? { etag: item.etag } : {}), ...(item.updated ? { updated: item.updated } : {}),
  };
}

function mapBoundary(value: NonNullable<GoogleEventResource["start"]>): CalendarEvent["start"] {
  if (value.date) return { date: value.date };
  if (value.dateTime) return { dateTime: value.dateTime, ...(value.timeZone ? { timeZone: value.timeZone } : {}) };
  throw new AppError("Google event boundary has neither date nor dateTime", "INVALID_GOOGLE_RESPONSE", 502);
}

function toGoogleEvent(event: Partial<Omit<CalendarEvent, "id" | "calendarId">>): GoogleEventResource {
  return {
    ...(event.summary !== undefined ? { summary: event.summary } : {}), ...(event.description !== undefined ? { description: event.description } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}), ...(event.start !== undefined ? { start: event.start } : {}),
    ...(event.end !== undefined ? { end: event.end } : {}),
  };
}

async function mapGoogleError(response: Response): Promise<AppError> {
  if (response.status === 404) return new AppError("Calendar or event not found", "NOT_FOUND", 404);
  if (response.status === 412) return new AppError("The event changed since it was read; fetch it again before writing", "ETAG_MISMATCH", 409);
  if (response.status === 403) return new AppError("Google Calendar denied this operation", "GOOGLE_FORBIDDEN", 403);
  return new AppError("Google Calendar request failed", "GOOGLE_API_ERROR", response.status >= 400 && response.status < 600 ? response.status : 502);
}
