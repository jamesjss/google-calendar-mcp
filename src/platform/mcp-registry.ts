export const GOOGLE_CALENDAR_SCOPES = ["google-calendar.read", "google-calendar.write"] as const;

export interface McpDefinition {
  slug: string;
  title: string;
  route: `/mcp/${string}`;
  scopes: readonly string[];
}

export const MCP_REGISTRY = {
  "google-calendar": {
    slug: "google-calendar",
    title: "Google Calendar",
    route: "/mcp/google-calendar",
    scopes: GOOGLE_CALENDAR_SCOPES,
  },
} as const satisfies Record<string, McpDefinition>;

export type McpSlug = keyof typeof MCP_REGISTRY;

export function mcpByPath(pathname: string): McpDefinition | undefined {
  return Object.values(MCP_REGISTRY).find((definition) => definition.route === pathname);
}

export function mcpByResource(resource: string | string[] | undefined): McpDefinition | undefined {
  if (!resource) return Object.values(MCP_REGISTRY).length === 1 ? Object.values(MCP_REGISTRY)[0] : undefined;
  const values = Array.isArray(resource) ? resource : [resource];
  if (values.length !== 1) return undefined;
  try { return mcpByPath(new URL(values[0]!).pathname); } catch { return undefined; }
}

export const ALL_MCP_SCOPES = [...new Set(Object.values(MCP_REGISTRY).flatMap((definition) => [...definition.scopes]))];
