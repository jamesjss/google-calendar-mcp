import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleCalendarGateway } from "../src/mcps/google-calendar/google-calendar-gateway.js";

afterEach(() => vi.unstubAllGlobals());

describe("GoogleCalendarGateway over fetch", () => {
  it("paginates calendar lists and preserves immutable IDs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [{ id: "family-id", summary: "Familiar", accessRole: "owner", timeZone: "Europe/Madrid" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: "work-id", summary: "Trabajo", accessRole: "reader" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new GoogleCalendarGateway({ accessToken: async () => "access" });
    await expect(gateway.listCalendars()).resolves.toEqual([
      { id: "family-id", summary: "Familiar", primary: false, accessRole: "owner", timeZone: "Europe/Madrid" },
      { id: "work-id", summary: "Trabajo", primary: false, accessRole: "reader" },
    ]);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("pageToken=p2");
  });
  it("sends all-day boundaries as date fields and disables notifications", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "e1", summary: "Fiesta", start: { date: "2027-06-21" }, end: { date: "2027-06-22" } }));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new GoogleCalendarGateway({ accessToken: async () => "access" });
    await gateway.createEvent("family/id", { summary: "Fiesta", start: { date: "2027-06-21" }, end: { date: "2027-06-22" } });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("calendars/family%2Fid/events?sendUpdates=none");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ start: { date: "2027-06-21" }, end: { date: "2027-06-22" } });
  });
  it("retries once with a refreshed token after a 401", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 401 })).mockResolvedValueOnce(Response.json({ items: [] }));
    const accessToken = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new").mockResolvedValueOnce("new");
    vi.stubGlobal("fetch", fetchMock);
    await new GoogleCalendarGateway({ accessToken }).listCalendars();
    expect(accessToken).toHaveBeenCalledWith(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
