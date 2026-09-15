import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { CalendarService } from "./application/calendar-service.js";
import { CalendarRefSchema, CreateEventSchema, UpdateEventSchema } from "./domain/calendar.js";
import { asSafeError } from "./domain/errors.js";

const READ_SCOPE = "google-calendar.read";
const WRITE_SCOPE = "google-calendar.write";
const IsoInstant = z.string().datetime({ offset: true });

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
}
function failure(error: unknown) {
  const safe = asSafeError(error);
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: safe.code, message: safe.message, details: safe.details }) }] };
}

export function registerCalendarTools(server: McpServer, service: CalendarService, grantedScopes: readonly string[]) {
  const scopes = new Set(grantedScopes);
  const requireScope = (scope: string) => { if (!scopes.has(scope)) throw new Error(`OAuth scope ${scope} is required`); };

  server.registerTool("list_calendars", {
    title: "List Google calendars",
    description: "List calendar IDs, names, access roles, and time zones. Use this before selecting a secondary calendar such as Familiar.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => { try { requireScope(READ_SCOPE); return result(await service.listCalendars()); } catch (error) { return failure(error); } });

  server.registerTool("list_events", {
    title: "List calendar events",
    description: "List events in a half-open time range. A secondary calendar can be selected by immutable id or exact, unambiguous name.",
    inputSchema: z.object({
      calendar: CalendarRefSchema,
      timeMin: IsoInstant.describe("Inclusive ISO 8601 instant with UTC offset"),
      timeMax: IsoInstant.describe("Exclusive ISO 8601 instant with UTC offset"),
      query: z.string().optional(),
      maxResults: z.number().int().min(1).max(2500).default(250),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => {
    try {
      requireScope(READ_SCOPE);
      if (Date.parse(input.timeMax) <= Date.parse(input.timeMin)) throw new Error("timeMax must be after timeMin");
      return result(await service.listEvents(input.calendar, input));
    } catch (error) { return failure(error); }
  });

  server.registerTool("get_event", {
    title: "Get a calendar event", description: "Read one event by Google event ID, including its ETag for safe updates or deletion.",
    inputSchema: z.object({ calendar: CalendarRefSchema, eventId: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ calendar, eventId }) => { try { requireScope(READ_SCOPE); return result(await service.getEvent(calendar, eventId)); } catch (error) { return failure(error); } });

  server.registerTool("create_event", {
    title: "Create a calendar event",
    description: "Create an event. All-day events MUST use start.date/end.date (exclusive end); timed events MUST use dateTime with a Europe/Madrid-compatible offset.",
    inputSchema: CreateEventSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => { try { requireScope(WRITE_SCOPE); return result(await service.createEvent(input)); } catch (error) { return failure(error); } });

  server.registerTool("update_event", {
    title: "Update a calendar event", description: "Patch one event. Supply its ETag to prevent overwriting a concurrent edit. Updating time requires both start and end.",
    inputSchema: UpdateEventSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async (input) => { try { requireScope(WRITE_SCOPE); return result(await service.updateEvent(input)); } catch (error) { return failure(error); } });

  server.registerTool("delete_event", {
    title: "Delete a calendar event", description: "Delete one event. Supply its ETag when possible to avoid deleting a concurrently changed event.",
    inputSchema: z.object({ calendar: CalendarRefSchema, eventId: z.string().min(1), etag: z.string().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ calendar, eventId, etag }) => {
    try { requireScope(WRITE_SCOPE); await service.deleteEvent(calendar, eventId, etag); return result({ deleted: true, eventId }); } catch (error) { return failure(error); }
  });
}
