import { describe, expect, it, vi } from "vitest";
import { google, type calendar_v3 } from "googleapis";
import { GoogleCalendarGateway } from "../src/adapters/google-calendar-gateway.js";

describe("GoogleCalendarGateway", () => {
  it("paginates calendar lists and preserves immutable IDs", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: { items: [{ id: "family-id", summary: "Familiar", accessRole: "owner", timeZone: "Europe/Madrid" }], nextPageToken: "p2" } })
      .mockResolvedValueOnce({ data: { items: [{ id: "work-id", summary: "Trabajo", accessRole: "reader" }] } });
    const api = { calendarList: { list }, events: {} } as unknown as calendar_v3.Calendar;
    const gateway = new GoogleCalendarGateway(new google.auth.OAuth2(), api);
    await expect(gateway.listCalendars()).resolves.toEqual([
      { id: "family-id", summary: "Familiar", primary: false, accessRole: "owner", timeZone: "Europe/Madrid" },
      { id: "work-id", summary: "Trabajo", primary: false, accessRole: "reader" },
    ]);
    expect(list).toHaveBeenNthCalledWith(2, { maxResults: 250, pageToken: "p2" });
  });

  it("sends all-day boundaries as date fields and disables guest notifications", async () => {
    const insert = vi.fn().mockResolvedValue({
      data: { id: "e1", summary: "Fiesta", start: { date: "2027-06-21" }, end: { date: "2027-06-22" } },
    });
    const api = { calendarList: {}, events: { insert } } as unknown as calendar_v3.Calendar;
    const gateway = new GoogleCalendarGateway(new google.auth.OAuth2(), api);
    await gateway.createEvent("family-id", { summary: "Fiesta", start: { date: "2027-06-21" }, end: { date: "2027-06-22" } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: "family-id", sendUpdates: "none",
      requestBody: expect.objectContaining({ start: { date: "2027-06-21" }, end: { date: "2027-06-22" } }),
    }));
  });
});

