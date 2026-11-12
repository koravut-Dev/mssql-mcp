#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sql from "mssql";
import { readFileSync } from "node:fs";
import { z } from "zod";

// ---------- Configuration ----------

interface ConnectionSettings {
  server?: string;
  port?: number | string;
  instance?: string;
  database?: string;
  user?: string;
  password?: string;
  encrypt?: boolean | string;
  trustServerCertificate?: boolean | string;
  readonly?: boolean | string;
  maxRows?: number | string;
  requestTimeout?: number | string;
  description?: string;
}

interface Resolved {
  name: string;
  description?: string;
  readonly: boolean;
  maxRows: number;
  config: sql.config;
}

const env = process.env;
const bool = (v: unknown, def: boolean) =>
  v === undefined || v === "" ? def : String(v).toLowerCase() !== "false";

/** Replace ${VAR} with process.env.VAR so secrets can stay out of the config file. */
function interpolate(v: unknown): unknown {
  if (typeof v !== "string") return v;
  return v.replace(/\$\{(\w+)\}/g, (_, k) => env[k] ?? "");
}

function resolve(name: string, raw: ConnectionSettings): Resolved {
  const s: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) s[k] = interpolate(v);
  const c = s as ConnectionSettings;
  return {
    name,
    description: c.description,
    readonly: bool(c.readonly, true),
    maxRows: Number(c.maxRows ?? 500),
    config: {
      server: c.server ?? "localhost",
      port: Number(c.port ?? 1433),
      database: c.database || undefined,
      user: c.user || undefined,
      password: c.password || undefined,
      options: {
        encrypt: bool(c.encrypt, true),
        trustServerCertificate: c.trustServerCertificate !== undefined && String(c.trustServerCertificate).toLowerCase() === "true",
        ...(c.instance ? { instanceName: c.instance } : {}),
      },
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      requestTimeout: Number(c.requestTimeout ?? 30000),
    },
  };
}

function loadConnections(): { map: Map<string, Resolved>; defaultName: string } {
  const map = new Map<string, Resolved>();
  const file = env.MSSQL_CONFIG;
  if (file) {
    const json = JSON.parse(readFileSync(file, "utf8")) as {
      default?: string;
      connections: Record<string, ConnectionSettings>;
    };
    for (const [name, s] of Object.entries(json.connections ?? {})) map.set(name, resolve(name, s));
    if (map.size === 0) throw new Error(`No connections defined in ${file}`);
    const def = json.default && map.has(json.default) ? json.default : [...map.keys()][0];
    return { map, defaultName: def };
  }
  // Single-connection mode (backwards compatible with plain env vars)
  map.set(
    "default",
    resolve("default", {
      server: env.MSSQL_SERVER,
      port: env.MSSQL_PORT,
      instance: env.MSSQL_INSTANCE,
      database: env.MSSQL_DATABASE,
      user: env.MSSQL_USER,
      password: env.MSSQL_PASSWORD,
      encrypt: env.MSSQL_ENCRYPT,
      trustServerCertificate: env.MSSQL_TRUST_SERVER_CERTIFICATE,
      readonly: env.MSSQL_READONLY,
      maxRows: env.MSSQL_MAX_ROWS,
      requestTimeout: env.MSSQL_REQUEST_TIMEOUT,
    })
  );
  return { map, defaultName: "default" };
}

const { map: connections, defaultName } = loadConnections();
const pools = new Map<string, sql.ConnectionPool>();

function getConn(name?: string): Resolved {
  const n = name ?? defaultName;
  const c = connections.get(n);
  if (!c) {
    throw new Error(`Unknown connection "${n}". Available: ${[...connections.keys()].join(", ")}`);
  }
  return c;
}

async function getPool(c: Resolved): Promise<sql.ConnectionPool> {
  const existing = pools.get(c.name);
  if (existing?.connected) return existing;
  const pool = await new sql.ConnectionPool(c.config).connect();
  pools.set(c.name, pool);
  return pool;
}

// ---------- Helpers ----------

/** Best-effort guard. For real safety, connect with a read-only DB user. */
function assertReadOnly(query: string) {
  const q = query
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  if (!/^(select|with)\b/i.test(q)) {
    throw new Error("Read-only mode: only SELECT / WITH queries are allowed.");
  }
  if (/;\s*\S/.test(q)) {
    throw new Error("Read-only mode: multiple statements are not allowed.");
  }
  if (
    /\b(insert|update|delete|drop|alter|create|truncate|merge|exec|execute|grant|revoke|into)\b/i.test(q)
  ) {
    throw new Error("Read-only mode: query contains a forbidden keyword.");
  }
}

const text = (v: unknown) => ({
  content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }],
});
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
});

const connectionParam = z
  .string()
  .optional()
  .describe(`Connection/environment name (default: "${defaultName}"). Use list_connections to see options.`);

// ---------- Tools ----------

const server = new McpServer({ name: "mssql-mcp", version: "1.1.0" });

server.tool(
  "list_connections",
  "List configured SQL Server connections (environments). Passwords are never shown.",
  async () =>
    text(
      [...connections.values()].map((c) => ({
        name: c.name,
        isDefault: c.name === defaultName,
        description: c.description,
        server: c.config.server,
        port: c.config.port,
        database: c.config.database,
        readonly: c.readonly,
      }))
    )
);

server.tool(
  "list_databases",
  "List databases on the SQL Server instance.",
  { connection: connectionParam },
  async ({ connection }) => {
    try {
      const pool = await getPool(getConn(connection));
      const r = await pool.request().query("SELECT name FROM sys.databases ORDER BY name");
      return text(r.recordset.map((x) => x.name));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "list_tables",
  "List tables and views in the current database.",
  { schema: z.string().optional().describe("Filter by schema name, e.g. dbo"), connection: connectionParam },
  async ({ schema, connection }) => {
    try {
      const req = (await getPool(getConn(connection))).request();
      let q =
        "SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS [name], TABLE_TYPE AS [type] FROM INFORMATION_SCHEMA.TABLES";
      if (schema) {
        req.input("schema", sql.NVarChar, schema);
        q += " WHERE TABLE_SCHEMA = @schema";
      }
      const r = await req.query(q + " ORDER BY 1, 2");
      return text(r.recordset);
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "describe_table",
  "Show columns, types, nullability and primary keys of a table.",
  { table: z.string().describe("Table name"), schema: z.string().default("dbo"), connection: connectionParam },
  async ({ table, schema, connection }) => {
    try {
      const req = (await getPool(getConn(connection))).request();
      req.input("t", sql.NVarChar, table);
      req.input("s", sql.NVarChar, schema);
      const r = await req.query(`
        SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS type, c.CHARACTER_MAXIMUM_LENGTH AS maxLength,
               c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS [default],
               CASE WHEN pk.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS isPrimaryKey
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
          SELECT k.TABLE_SCHEMA, k.TABLE_NAME, k.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
            ON k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ) pk ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
        WHERE c.TABLE_NAME = @t AND c.TABLE_SCHEMA = @s
        ORDER BY c.ORDINAL_POSITION`);
      return r.recordset.length ? text(r.recordset) : fail(new Error(`Table ${schema}.${table} not found`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "query",
  "Run a T-SQL query on the chosen connection. Connections in read-only mode accept SELECT only; results are capped at that connection's max rows.",
  { sql: z.string().describe("T-SQL statement"), connection: connectionParam },
  async ({ sql: query, connection }) => {
    try {
      const c = getConn(connection);
      if (c.readonly) assertReadOnly(query);
      const r = await (await getPool(c)).request().query(query);
      const rows = r.recordset ?? [];
      return text({
        connection: c.name,
        rowCount: rows.length,
        truncated: rows.length > c.maxRows,
        rowsAffected: r.rowsAffected,
        rows: rows.slice(0, c.maxRows),
      });
    } catch (e) {
      return fail(e);
    }
  }
);

await server.connect(new StdioServerTransport());
console.error(
  `mssql-mcp ready (connections: ${[...connections.keys()].join(", ")}; default: ${defaultName})`
);
process.on("SIGINT", async () => {
  await Promise.all([...pools.values()].map((p) => p.close()));
  process.exit(0);
});
