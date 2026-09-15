import { describe, expect, it } from "vitest";
import type { CalendarGateway, ListEventsQuery } from "../src/mcps/google-calendar/application/calendar-port.js";
import { CalendarService } from "../src/mcps/google-calendar/application/calendar-service.js";
import type { CalendarEvent, CalendarInfo } from "../src/mcps/google-calendar/domain/calendar.js";

class MemoryGateway implements CalendarGateway {
  calendars: CalendarInfo[] = [
    { id: "primary@example.com", summary: "Personal", primary: true, accessRole: "owner" },
    { id: "family-id", summary: "Familiar", primary: false, accessRole: "owner", timeZone: "Europe/Madrid" },
  ];
  events: CalendarEvent[] = [];
  listCalendars = async () => this.calendars;
  listEvents = async (_calendarId: string, _query: ListEventsQuery) => this.events;
  getEvent = async (_calendarId: string, eventId: string) => this.events.find((event) => event.id === eventId)!;
  createEvent = async (calendarId: string, event: Omit<CalendarEvent, "id" | "calendarId">) => ({ ...event, id: "new", calendarId });
  updateEvent = async (calendarId: string, eventId: string, patch: Partial<CalendarEvent>) => ({
    ...this.events.find((event) => event.id === eventId)!, ...patch, id: eventId, calendarId,
  });
  deleteEvent = async () => undefined;
}

describe("CalendarService", () => {
  it("resolves a secondary calendar by exact case-insensitive name", async () => {
    const service = new CalendarService(new MemoryGateway());
    await expect(service.resolveCalendar({ name: "familiar" })).resolves.toBe("family-id");
  });

  it("requires an ID when display names are ambiguous", async () => {
    const gateway = new MemoryGateway();
    gateway.calendars.push({ id: "family-2", summary: "Familiar", primary: false, accessRole: "reader" });
    await expect(new CalendarService(gateway).resolveCalendar({ name: "Familiar" })).rejects.toMatchObject({ code: "AMBIGUOUS_CALENDAR" });
  });

  it("rejects an exact duplicate by default", async () => {
    const gateway = new MemoryGateway();
    gateway.events.push({
      id: "existing", calendarId: "family-id", summary: "Fiesta", start: { date: "2027-06-21" }, end: { date: "2027-06-22" },
    });
    const service = new CalendarService(gateway);
    await expect(service.createEvent({
      calendar: { name: "Familiar" }, summary: " fiesta ", start: { date: "2027-06-21" }, end: { date: "2027-06-22" }, duplicatePolicy: "reject",
    })).rejects.toMatchObject({ code: "DUPLICATE_EVENT" });
  });

  it("creates in the resolved secondary calendar when duplicate allowance is explicit", async () => {
    const service = new CalendarService(new MemoryGateway());
    await expect(service.createEvent({
      calendar: { name: "Familiar" }, summary: "Fiesta", start: { date: "2027-06-21" }, end: { date: "2027-06-22" }, duplicatePolicy: "allow",
    })).resolves.toMatchObject({ id: "new", calendarId: "family-id" });
  });
});
