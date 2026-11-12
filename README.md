<div align="center">

# 🗄️ mssql-mcp

**เชื่อม AI ของคุณเข้ากับ Microsoft SQL Server ผ่าน Model Context Protocol**

ถามข้อมูลด้วยภาษาคน · ดู schema ได้ทันที · อ่านอย่างเดียวเป็นค่าเริ่มต้น

![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![SQL Server](https://img.shields.io/badge/SQL%20Server-CC2927?logo=microsoftsqlserver&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-compatible-8A63D2)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

## ✨ จุดเด่น

- 🔒 **Read-only โดยค่าเริ่มต้น** อนุญาตเฉพาะ `SELECT` ปลอดภัยต่อข้อมูล
- ⚡ **ติดตั้งบรรทัดเดียว** ผ่าน `npx` ไม่ต้อง clone เอง
- 🌐 **รองรับหลาย environment** ตั้ง dev / uat / prod ในเซิร์ฟเวอร์เดียว และกำหนด read-only แยกรายตัวได้
- 🧰 **5 เครื่องมือพร้อมใช้** ดูรายการ connection ฐานข้อมูล ตาราง โครงสร้างคอลัมน์ และรัน query
- 🛡️ **จำกัดจำนวนแถว** ป้องกันผลลัพธ์ใหญ่เกินไป (ค่าเริ่มต้น 500 แถว)
- 🔌 ใช้ได้กับ **Claude Desktop, Claude Code** และ MCP client อื่น ๆ

## 🧰 เครื่องมือ (Tools)

| Tool | หน้าที่ |
|---|---|
| `list_connections` | แสดงรายการ connection/environment ที่ตั้งไว้ (ไม่แสดงรหัสผ่าน) |
| `list_databases` | แสดงรายชื่อฐานข้อมูลบนเซิร์ฟเวอร์ |
| `list_tables` | แสดงตารางและ view (กรองตาม schema ได้) |
| `describe_table` | แสดงคอลัมน์ ชนิดข้อมูล nullable และ primary key |
| `query` | รัน T-SQL (อ่านอย่างเดียวหากไม่ปิดโหมด read-only) |

## 📦 ติดตั้ง

**สิ่งที่ต้องมี:** [Node.js 18+](https://nodejs.org) และ SQL Server ที่เชื่อมต่อได้ด้วย SQL Authentication

> ⚠️ ยังไม่รองรับ Windows Authentication (Integrated Security)

### วิธีที่ 1: ใช้ผ่าน `npx` จาก GitHub (แนะนำ)

ไม่ต้องติดตั้งล่วงหน้า แค่ใส่ config ใน MCP client (ดูหัวข้อถัดไป)

> ตัวอย่างนี้ใช้ repo ของ `koravut-Dev`

### วิธีที่ 2: clone แล้ว build เอง

```bash
git clone https://github.com/koravut-Dev/mssql-mcp.git
cd mssql-mcp
npm install      # build อัตโนมัติผ่าน prepare script
```

> ทุก tool (ยกเว้น `list_connections`) รับพารามิเตอร์ `connection` เพิ่มเติม เช่น "ดูตารางใน uat" ถ้าไม่ระบุจะใช้ connection ค่าเริ่มต้น

## 🔧 ตั้งค่า MCP Client

### Claude Desktop

แก้ไฟล์ `claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\` · macOS: `~/Library/Application Support/Claude/`)

```json
{
  "mcpServers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "github:koravut-Dev/mssql-mcp"],
      "env": {
        "MSSQL_SERVER": "localhost",
        "MSSQL_PORT": "1433",
        "MSSQL_DATABASE": "MyDatabase",
        "MSSQL_USER": "readonly_user",
        "MSSQL_PASSWORD": "your_password",
        "MSSQL_TRUST_SERVER_CERTIFICATE": "true"
      }
    }
  }
}
```

จากนั้นรีสตาร์ท Claude Desktop

### Claude Code

```bash
claude mcp add mssql \
  -e MSSQL_SERVER=localhost \
  -e MSSQL_DATABASE=MyDatabase \
  -e MSSQL_USER=readonly_user \
  -e MSSQL_PASSWORD=your_password \
  -e MSSQL_TRUST_SERVER_CERTIFICATE=true \
  -- npx -y github:koravut-Dev/mssql-mcp
```

### ถ้า clone มาเอง

ใช้ `"command": "node"` และ `"args": ["C:/path/to/mssql-mcp/dist/index.js"]` แทน `npx`

## 🌐 หลาย Environment (dev / uat / prod)

สร้างไฟล์ config แล้วชี้ด้วย `MSSQL_CONFIG` (คัดลอกจาก [`mssql-mcp.config.example.json`](mssql-mcp.config.example.json))

```json
{
  "default": "dev",
  "connections": {
    "dev":  { "server": "dev-sql.example.com",  "database": "MyApp", "user": "dev_user",
              "password": "${MSSQL_DEV_PASSWORD}", "readonly": false },
    "prod": { "server": "prod-sql.example.com", "database": "MyApp", "user": "prod_reader",
              "password": "${MSSQL_PROD_PASSWORD}", "readonly": true, "maxRows": 200 }
  }
}
```

ตั้งค่าใน MCP client:

```json
{
  "mcpServers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "github:koravut-Dev/mssql-mcp"],
      "env": {
        "MSSQL_CONFIG": "C:/secrets/mssql-mcp.config.json",
        "MSSQL_DEV_PASSWORD": "...",
        "MSSQL_PROD_PASSWORD": "..."
      }
    }
  }
}
```

- 🔑 ใช้ `${ENV_VAR}` ในค่าใดก็ได้ เพื่อเก็บรหัสผ่านไว้นอกไฟล์ config
- 🔒 `readonly` ตั้งแยกได้ทีละ connection (ค่าเริ่มต้น `true`) แนะนำให้ prod เป็น read-only เสมอ
- field ที่ใช้ได้ในแต่ละ connection: `server`, `port`, `instance`, `database`, `user`, `password`, `encrypt`, `trustServerCertificate`, `readonly`, `maxRows`, `requestTimeout`, `description`
- ไฟล์ `mssql-mcp.config.json` อยู่ใน `.gitignore` แล้ว อย่า commit ขึ้น Git
- ถ้าไม่ตั้ง `MSSQL_CONFIG` จะใช้โหมด connection เดียวจากตัวแปรด้านล่าง (ชื่อ `default`)

## ⚙️ ตัวแปรสภาพแวดล้อม (โหมด connection เดียว)

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|
| `MSSQL_SERVER` | `localhost` | ชื่อหรือ IP ของเซิร์ฟเวอร์ |
| `MSSQL_PORT` | `1433` | พอร์ต |
| `MSSQL_INSTANCE` | – | ชื่อ named instance (ถ้ามี) |
| `MSSQL_DATABASE` | – | ฐานข้อมูลเริ่มต้น |
| `MSSQL_USER` | – | ผู้ใช้ SQL |
| `MSSQL_PASSWORD` | – | รหัสผ่าน |
| `MSSQL_ENCRYPT` | `true` | เข้ารหัสการเชื่อมต่อ (Azure SQL ต้องเป็น `true`) |
| `MSSQL_TRUST_SERVER_CERTIFICATE` | `false` | ตั้งเป็น `true` ถ้าใช้ self-signed certificate (เซิร์ฟเวอร์ local/dev) |
| `MSSQL_READONLY` | `true` | `false` เพื่ออนุญาต INSERT/UPDATE/DELETE |
| `MSSQL_MAX_ROWS` | `500` | จำนวนแถวสูงสุดที่ส่งกลับ |
| `MSSQL_REQUEST_TIMEOUT` | `30000` | timeout ของ query (มิลลิวินาที) |

## 🛡️ ความปลอดภัย

โหมด read-only ใน `mssql-mcp` เป็น **ด่านตรวจเสริม** ที่ตรวจว่า query ขึ้นต้นด้วย `SELECT`/`WITH` และไม่มีคำสั่งแก้ไขข้อมูล แต่ไม่ใช่การป้องกันที่สมบูรณ์

**แนวทางที่ปลอดภัยจริง: สร้างผู้ใช้ที่มีสิทธิ์อ่านอย่างเดียวใน SQL Server**

```sql
CREATE LOGIN mcp_reader WITH PASSWORD = 'ใส่รหัสผ่านที่แข็งแรง';
USE MyDatabase;
CREATE USER mcp_reader FOR LOGIN mcp_reader;
ALTER ROLE db_datareader ADD MEMBER mcp_reader;
```

และอย่า commit ไฟล์ `.env` หรือรหัสผ่านขึ้น Git

## 💬 ตัวอย่างการใช้งาน

เมื่อเชื่อมต่อแล้ว ลองถาม AI ว่า:

- "มี environment อะไรให้เชื่อมต่อบ้าง"
- "มีตารางอะไรในฐานข้อมูล uat บ้าง"
- "ตาราง Orders มีคอลัมน์อะไรบ้าง"
- "ยอดขายรวมแต่ละเดือนของปีนี้เป็นเท่าไร"
- "ลูกค้า 10 อันดับแรกที่สั่งซื้อมากที่สุดคือใคร"

## 🧑‍💻 สำหรับนักพัฒนา

```bash
npm install
npm run build        # คอมไพล์ TypeScript -> dist/
npm run dev          # watch mode
```

ทดสอบด้วย [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## 🔍 แก้ปัญหาเบื้องต้น

<details>
<summary><b>Failed to connect / self-signed certificate</b></summary>

ตั้ง `MSSQL_TRUST_SERVER_CERTIFICATE=true` สำหรับเซิร์ฟเวอร์ที่ใช้ certificate แบบ self-signed
</details>

<details>
<summary><b>Login failed for user</b></summary>

ตรวจว่า SQL Server เปิดโหมด **SQL Server and Windows Authentication** และผู้ใช้มีสิทธิ์เข้าถึงฐานข้อมูลนั้น
</details>

<details>
<summary><b>เชื่อมต่อไม่ได้ (timeout / ECONNREFUSED)</b></summary>

เปิด TCP/IP ใน SQL Server Configuration Manager, เปิดพอร์ต 1433 บน firewall, หรือใช้ `MSSQL_INSTANCE` กรณี named instance
</details>

## 📄 License

[MIT](LICENSE)
