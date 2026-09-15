import { DateTime } from "luxon";
import { z } from "zod";
import { AppError } from "./errors.js";

export const DEFAULT_TIME_ZONE = "Europe/Madrid";
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(
  (value) => DateTime.fromISO(value, { zone: "utc" }).isValid,
  "Invalid calendar date",
);
const DateTimeWithOffset = z.string().refine((value) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value), {
  message: "dateTime must be ISO 8601 with an explicit UTC offset",
}).refine((value) => DateTime.fromISO(value, { setZone: true }).isValid, "Invalid dateTime");

export const CalendarRefSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
}).refine((value) => !(value.id && value.name), "Use calendar.id or calendar.name, not both").optional();
export type CalendarRef = z.infer<typeof CalendarRefSchema>;

const AllDayBoundary = z.object({ date: DateOnly });
const TimedBoundary = z.object({
  dateTime: DateTimeWithOffset,
  timeZone: z.literal(DEFAULT_TIME_ZONE).default(DEFAULT_TIME_ZONE),
});
const EventBase = z.object({
  calendar: CalendarRefSchema,
  summary: z.string().trim().min(1).max(1024),
  description: z.string().max(8192).optional(),
  location: z.string().max(1024).optional(),
});

export const CreateEventSchema = z.union([
  EventBase.extend({
    start: AllDayBoundary,
    end: AllDayBoundary,
    duplicatePolicy: z.enum(["reject", "allow"]).default("reject"),
  }).superRefine((event, ctx) => {
    if (event.end.date <= event.start.date) ctx.addIssue({ code: "custom", path: ["end", "date"], message: "end.date is exclusive and must be after start.date" });
  }),
  EventBase.extend({
    start: TimedBoundary,
    end: TimedBoundary,
    duplicatePolicy: z.enum(["reject", "allow"]).default("reject"),
  }).superRefine(validateTimedRange),
]);

export const UpdateEventSchema = z.object({
  calendar: CalendarRefSchema,
  eventId: z.string().min(1),
  etag: z.string().min(1).optional(),
  summary: z.string().trim().min(1).max(1024).optional(),
  description: z.string().max(8192).nullable().optional(),
  location: z.string().max(1024).nullable().optional(),
  start: z.union([AllDayBoundary, TimedBoundary]).optional(),
  end: z.union([AllDayBoundary, TimedBoundary]).optional(),
}).superRefine((event, ctx) => {
  if (!event.summary && event.description === undefined && event.location === undefined && !event.start && !event.end) {
    ctx.addIssue({ code: "custom", message: "At least one field to update is required" });
  }
  if ((event.start && !event.end) || (!event.start && event.end)) {
    ctx.addIssue({ code: "custom", path: ["start"], message: "start and end must be updated together" });
    return;
  }
  if (!event.start || !event.end) return;
  const bothDates = "date" in event.start && "date" in event.end;
  const bothDateTimes = "dateTime" in event.start && "dateTime" in event.end;
  if (!bothDates && !bothDateTimes) ctx.addIssue({ code: "custom", path: ["end"], message: "start and end must use the same representation" });
  else if (bothDates && "date" in event.start && "date" in event.end && event.end.date <= event.start.date) {
    ctx.addIssue({ code: "custom", path: ["end", "date"], message: "end.date is exclusive and must be after start.date" });
  } else if (bothDateTimes && "dateTime" in event.start && "dateTime" in event.end) validateTimedRange({ start: event.start, end: event.end }, ctx);
});

function validateTimedRange(event: { start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } }, ctx: z.RefinementCtx) {
  const start = DateTime.fromISO(event.start.dateTime, { setZone: true });
  const end = DateTime.fromISO(event.end.dateTime, { setZone: true });
  if (end.toMillis() <= start.toMillis()) ctx.addIssue({ code: "custom", path: ["end", "dateTime"], message: "end.dateTime must be after start.dateTime" });
  for (const [key, value] of [["start", start], ["end", end]] as const) {
    if (value.offset !== value.setZone(DEFAULT_TIME_ZONE).offset) {
      ctx.addIssue({ code: "custom", path: [key, "dateTime"], message: `UTC offset does not match ${DEFAULT_TIME_ZONE} at that instant` });
    }
  }
}

export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;
export interface CalendarInfo { id: string; summary: string; primary: boolean; accessRole: string; timeZone?: string }
export interface CalendarEvent {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone?: string };
  end: { date: string } | { dateTime: string; timeZone?: string };
  status?: string;
  htmlLink?: string;
  etag?: string;
  updated?: string;
}

export function eventFingerprint(event: Pick<CalendarEvent, "summary" | "start" | "end" | "location">): string {
  const normalize = (value?: string) => value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es") ?? "";
  return JSON.stringify({ summary: normalize(event.summary), start: event.start, end: event.end, location: normalize(event.location) });
}

export function toCandidate(input: CreateEventInput, calendarId: string): CalendarEvent {
  return {
    id: "candidate", calendarId, summary: input.summary,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    start: input.start, end: input.end,
  };
}

export function eventTimeWindow(event: Pick<CalendarEvent, "start" | "end">): { timeMin: string; timeMax: string } {
  if ("date" in event.start && "date" in event.end) return {
    timeMin: DateTime.fromISO(event.start.date, { zone: DEFAULT_TIME_ZONE }).startOf("day").toUTC().toISO()!,
    timeMax: DateTime.fromISO(event.end.date, { zone: DEFAULT_TIME_ZONE }).startOf("day").toUTC().toISO()!,
  };
  if ("dateTime" in event.start && "dateTime" in event.end) return { timeMin: event.start.dateTime, timeMax: event.end.dateTime };
  throw new AppError("Event boundaries use inconsistent representations", "INVALID_EVENT_RANGE");
}
