import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CalendarService } from "../application/calendar-service.js";
import { CalendarRefSchema, CreateEventSchema, UpdateEventSchema } from "../domain/calendar.js";
import { asSafeError } from "../domain/errors.js";

const IsoInstant = z.string().datetime({ offset: true });

function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data },
  };
}

function failure(error: unknown) {
  const safe = asSafeError(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: safe.code, message: safe.message, details: safe.details }) }],
  };
}

export function registerCalendarTools(server: McpServer, service: CalendarService, grantedScope = "calendar.read calendar.write") {
  const scopes = new Set(grantedScope.split(/\s+/));
  const requireScope = (scope: "calendar.read" | "calendar.write") => {
    if (!scopes.has(scope)) throw new Error(`OAuth scope ${scope} is required`);
  };
  server.registerTool("list_calendars", {
    title: "List Google calendars",
    description: "List calendar IDs, names, access roles, and time zones. Use this before selecting a secondary calendar such as Familiar.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    try { requireScope("calendar.read"); return result(await service.listCalendars()); } catch (error) { return failure(error); }
  });

  server.registerTool("list_events", {
    title: "List calendar events",
    description: "List events in a half-open time range. calendar may identify a secondary calendar by immutable id or exact, unambiguous name.",
    inputSchema: {
      calendar: CalendarRefSchema,
      timeMin: IsoInstant.describe("Inclusive ISO 8601 instant with UTC offset"),
      timeMax: IsoInstant.describe("Exclusive ISO 8601 instant with UTC offset"),
      query: z.string().optional().describe("Optional Google free-text search"),
      maxResults: z.number().int().min(1).max(2500).default(250),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => {
    try {
      requireScope("calendar.read");
      if (Date.parse(input.timeMax) <= Date.parse(input.timeMin)) throw new Error("timeMax must be after timeMin");
      return result(await service.listEvents(input.calendar, input));
    } catch (error) { return failure(error); }
  });

  server.registerTool("get_event", {
    title: "Get a calendar event",
    description: "Read one event by its Google event ID, including its ETag for safe updates or deletion.",
    inputSchema: { calendar: CalendarRefSchema, eventId: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ calendar, eventId }) => {
    try { requireScope("calendar.read"); return result(await service.getEvent(calendar, eventId)); } catch (error) { return failure(error); }
  });

  server.registerTool("create_event", {
    title: "Create a calendar event",
    description: "Create an event. All-day events MUST use start.date/end.date (end is exclusive); timed events MUST use start.dateTime/end.dateTime with a Europe/Madrid-compatible offset.",
    inputSchema: CreateEventSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => {
    try { requireScope("calendar.write"); return result(await service.createEvent(input)); } catch (error) { return failure(error); }
  });

  server.registerTool("update_event", {
    title: "Update a calendar event",
    description: "Patch one event. Supply the ETag returned by get_event to prevent overwriting a concurrent edit. Updating time requires both start and end.",
    inputSchema: UpdateEventSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async (input) => {
    try { requireScope("calendar.write"); return result(await service.updateEvent(input)); } catch (error) { return failure(error); }
  });

  server.registerTool("delete_event", {
    title: "Delete a calendar event",
    description: "Delete one event. Supply its ETag when possible to avoid deleting a concurrently changed event.",
    inputSchema: { calendar: CalendarRefSchema, eventId: z.string().min(1), etag: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ calendar, eventId, etag }) => {
    try {
      requireScope("calendar.write");
      await service.deleteEvent(calendar, eventId, etag);
      return result({ deleted: true, eventId });
    } catch (error) { return failure(error); }
  });
}
