#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sql from "mssql";
import { z } from "zod";

const env = process.env;
const READONLY = (env.MSSQL_READONLY ?? "true").toLowerCase() !== "false";
const MAX_ROWS = Number(env.MSSQL_MAX_ROWS ?? 500);

const config: sql.config = {
  server: env.MSSQL_SERVER ?? "localhost",
  port: Number(env.MSSQL_PORT ?? 1433),
  database: env.MSSQL_DATABASE,
  user: env.MSSQL_USER,
  password: env.MSSQL_PASSWORD,
  options: {
    encrypt: (env.MSSQL_ENCRYPT ?? "true").toLowerCase() !== "false",
    trustServerCertificate:
      (env.MSSQL_TRUST_SERVER_CERTIFICATE ?? "false").toLowerCase() === "true",
    ...(env.MSSQL_INSTANCE ? { instanceName: env.MSSQL_INSTANCE } : {}),
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  requestTimeout: Number(env.MSSQL_REQUEST_TIMEOUT ?? 30000),
};

let pool: sql.ConnectionPool | undefined;
async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool || !pool.connected) {
    pool = await new sql.ConnectionPool(config).connect();
  }
  return pool;
}

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

const server = new McpServer({ name: "mssql-mcp", version: "1.0.0" });

server.tool("list_databases", "List databases on the SQL Server instance.", async () => {
  try {
    const r = await (await getPool()).request().query("SELECT name FROM sys.databases ORDER BY name");
    return text(r.recordset.map((x) => x.name));
  } catch (e) {
    return fail(e);
  }
});

server.tool(
  "list_tables",
  "List tables and views in the current database.",
  { schema: z.string().optional().describe("Filter by schema name, e.g. dbo") },
  async ({ schema }) => {
    try {
      const req = (await getPool()).request();
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
  { table: z.string().describe("Table name"), schema: z.string().default("dbo") },
  async ({ table, schema }) => {
    try {
      const req = (await getPool()).request();
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
  READONLY
    ? `Run a read-only T-SQL SELECT query. Results are capped at ${MAX_ROWS} rows.`
    : "Run a T-SQL query (read/write enabled).",
  { sql: z.string().describe("T-SQL statement") },
  async ({ sql: query }) => {
    try {
      if (READONLY) assertReadOnly(query);
      const r = await (await getPool()).request().query(query);
      const rows = r.recordset ?? [];
      return text({
        rowCount: rows.length,
        truncated: rows.length > MAX_ROWS,
        rowsAffected: r.rowsAffected,
        rows: rows.slice(0, MAX_ROWS),
      });
    } catch (e) {
      return fail(e);
    }
  }
);

await server.connect(new StdioServerTransport());
console.error(`mssql-mcp ready (readonly=${READONLY}, server=${config.server})`);
process.on("SIGINT", async () => {
  await pool?.close();
  process.exit(0);
});
