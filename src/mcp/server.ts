import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import type { CalendarService } from "../application/calendar-service.js";
import { registerCalendarTools } from "./tools.js";

export async function handleMcpRequest(req: Request, res: Response, service: CalendarService, scope: string): Promise<void> {
  const server = new McpServer({
    name: "google-calendar-chatgpt-mcp",
    version: "0.1.0",
  });
  registerCalendarTools(server, service, scope);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await transport.close();
    await server.close();
  }
}
