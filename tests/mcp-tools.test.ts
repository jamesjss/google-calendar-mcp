import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { CalendarGateway, ListEventsQuery } from "../src/mcps/google-calendar/application/calendar-port.js";
import { CalendarService } from "../src/mcps/google-calendar/application/calendar-service.js";
import type { CalendarEvent } from "../src/mcps/google-calendar/domain/calendar.js";
import { registerCalendarTools } from "../src/mcps/google-calendar/tools.js";

const gateway: CalendarGateway = {
  listCalendars: async () => [{ id: "family-id", summary: "Familiar", primary: false, accessRole: "owner" }],
  listEvents: async (_calendarId: string, _query: ListEventsQuery) => [],
  getEvent: async () => { throw new Error("unused"); },
  createEvent: async (calendarId: string, event: Omit<CalendarEvent, "id" | "calendarId">) => ({ ...event, id: "created", calendarId }),
  updateEvent: async () => { throw new Error("unused"); },
  deleteEvent: async () => undefined,
};

async function connected(scopes = ["google-calendar.read", "google-calendar.write"]) {
  const server = new McpServer({ name: "test", version: "1" });
  registerCalendarTools(server, new CalendarService(gateway), scopes);
  const client = new Client({ name: "test-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("MCP tools", () => {
  it("advertises read/write annotations", async () => {
    const { client, server } = await connected();
    const tools = await client.listTools();
    expect(tools.tools.find((tool) => tool.name === "list_events")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "delete_event")?.annotations?.destructiveHint).toBe(true);
    await client.close(); await server.close();
  });

  it("creates an all-day event with exclusive date boundaries", async () => {
    const { client, server } = await connected();
    const response = await client.callTool({ name: "create_event", arguments: {
      calendar: { name: "Familiar" }, summary: "Fiesta fin de curso",
      start: { date: "2027-06-21" }, end: { date: "2027-06-22" },
    } });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('"calendarId": "family-id"') })]));
    await client.close(); await server.close();
  });

  it("enforces the granted OAuth scope at execution time", async () => {
    const { client, server } = await connected(["google-calendar.read"]);
    const response = await client.callTool({ name: "delete_event", arguments: { eventId: "e1" } });
    expect(response.isError).toBe(true);
    await client.close(); await server.close();
  });
});
