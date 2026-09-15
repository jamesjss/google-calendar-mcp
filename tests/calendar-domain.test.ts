import { describe, expect, it } from "vitest";
import { CreateEventSchema, UpdateEventSchema, eventFingerprint } from "../src/domain/calendar.js";

describe("calendar event validation", () => {
  it("accepts an all-day event with an exclusive end date", () => {
    const event = CreateEventSchema.parse({
      summary: "Colonias", start: { date: "2027-06-02" }, end: { date: "2027-06-05" },
    });
    expect(event.start).toEqual({ date: "2027-06-02" });
    expect(event.end).toEqual({ date: "2027-06-05" });
  });

  it("rejects a non-exclusive all-day range", () => {
    expect(() => CreateEventSchema.parse({
      summary: "Fiesta", start: { date: "2027-06-21" }, end: { date: "2027-06-21" },
    })).toThrow(/exclusive/);
  });

  it("accepts Europe/Madrid summer and winter offsets", () => {
    expect(CreateEventSchema.safeParse({
      summary: "Verano", start: { dateTime: "2027-06-21T10:00:00+02:00" }, end: { dateTime: "2027-06-21T11:00:00+02:00" },
    }).success).toBe(true);
    expect(CreateEventSchema.safeParse({
      summary: "Invierno", start: { dateTime: "2027-01-21T10:00:00+01:00" }, end: { dateTime: "2027-01-21T11:00:00+01:00" },
    }).success).toBe(true);
  });

  it("rejects a UTC offset that does not match Europe/Madrid", () => {
    const parsed = CreateEventSchema.safeParse({
      summary: "Desfasado", start: { dateTime: "2027-06-21T10:00:00+01:00" }, end: { dateTime: "2027-06-21T11:00:00+01:00" },
    });
    expect(parsed.success).toBe(false);
  });

  it("requires both boundaries when changing an event time", () => {
    expect(UpdateEventSchema.safeParse({ eventId: "e1", start: { date: "2027-01-01" } }).success).toBe(false);
  });

  it("normalizes title and location when fingerprinting duplicates", () => {
    const base = { start: { date: "2027-01-01" }, end: { date: "2027-01-02" } } as const;
    expect(eventFingerprint({ ...base, summary: "  Fiesta  FINAL ", location: " Aula  1 " }))
      .toBe(eventFingerprint({ ...base, summary: "fiesta final", location: "aula 1" }));
  });
});

