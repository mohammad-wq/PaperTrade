# Paper Trade Business Management System — Native Windows Deployment & Operations Manual

This guide covers the production deployment, service configuration, and day-to-day operations of the Paper Trade Management System on a **Native Windows PC** (Windows 10 / 11 / Server).

> [!IMPORTANT]
> **Zero Virtualization & Lightweight Native Execution**:
> This setup runs **100% natively on Windows** using **Node.js LTS** and a local **PostgreSQL Windows Service**.
> It has **no dependency on Docker Desktop, WSL2, or Hyper-V**. By eliminating the Docker/WSL2 virtualization layer, the server PC saves **1 to 2 GB of RAM at idle**, making it perfectly suited for budget and commercial office hardware.

---

## Architecture Overview

```
 [Counter PC 1 / Cashier]             [Warehouse PC 2]              [Manager Laptop]
     (Web Browser)                        (Web Browser)                 (Web Browser)
           │                                    │                             │
           └────────────────────────┬───────────┴─────────────────────────────┘
                                    │ Local Office LAN (Cable / Wi-Fi)
                                    ▼
         ┌─────────────────────────────────────────────────────────────┐
         │                  Windows Server PC (Host)                   │
         │                                                             │
         │  ┌───────────────────────────────────────────────────────┐  │
         │  │  Next.js 14 Standalone Application (Port 3000)        │  │
         │  │  - Managed by NSSM Windows Service (or start.bat)     │  │
         │  │  - Auto-starts on boot, auto-restarts on crash       │  │
         │  └──────────────────────────┬────────────────────────────┘  │
         │                             │ Native TCP localhost:5432     │
         │                             ▼                               │
         │  ┌───────────────────────────────────────────────────────┐  │
         │  │  PostgreSQL 16 Windows Service (Port 5432)            │  │
         │  │  - Service Name: postgresql-x64-16                    │  │
         │  │  - Native disk storage & zero WSL2 RAM overhead       │  │
         │  └──────────────────────────┬────────────────────────────┘  │
         │                             ▼                               │
         │                [C:\PaperTrade\backups\]                     │
         └─────────────────────────────────────────────────────────────┘
```

---

## 1. System Requirements

- **Operating System**: Windows 10 (64-bit), Windows 11 (64-bit), or Windows Server 2016+
- **Hardware**: Minimum 4 GB RAM (8 GB recommended), 2-core CPU, 10 GB free disk space
- **Software to Install**:
  1. PostgreSQL 16 for Windows (Official EnterpriseDB Installer)
  2. Node.js 20 LTS for Windows
  3. NSSM (Non-Sucking Service Manager) — for background service setup

---

## 2. Step-by-Step Installation

### Step 2.1: Install PostgreSQL for Windows

1. Download the official PostgreSQL 16 installer for Windows:
   - **Download Link**: [https://www.enterprisedb.com/downloads/postgres-postgresql-downloads](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads)
   - Select **PostgreSQL 16.x for Windows x86-64**.
2. Run the downloaded installer (`postgresql-16.x-x-windows-x64.exe`).
3. Follow the installation wizard:
   - **Installation Directory**: Keep default (`C:\Program Files\PostgreSQL\16`).
   - **Components**: Ensure *PostgreSQL Server*, *pgAdmin 4*, and *Command Line Tools* are selected.
   - **Data Directory**: Keep default (`C:\Program Files\PostgreSQL\16\data`).
   - **Password**: Enter a secure password for the `postgres` superuser (e.g. `password` or your chosen password). **Remember this password.**
   - **Port**: Keep `5432`.
   - **Advanced Options**: Keep default locale.
4. Click **Next** to complete the installation. Uncheck the "Stack Builder" prompt at the finish screen.
5. **Verify PostgreSQL is running**:
   Open **Command Prompt** and run:
   ```cmd
   sc query postgresql-x64-16
   ```
   You should see `STATE : 4 RUNNING`.

---

### Step 2.2: Create the Application Database & User

You can create the database using either the command line (`psql`) or the graphical tool (`pgAdmin 4`).

#### Method A: Using Command Prompt (`psql`)
1. Open Command Prompt and connect to PostgreSQL:
   ```cmd
   "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres
   ```
   Enter the password you created during PostgreSQL installation.
2. Run the following SQL commands:
   ```sql
   -- 1. Create user (replace 'password' with your desired password)
   CREATE USER "user" WITH PASSWORD 'password';

   -- 2. Create the application database
   CREATE DATABASE paperbiz OWNER "user";

   -- 3. Grant full privileges
   GRANT ALL PRIVILEGES ON DATABASE paperbiz TO "user";

   -- 4. Exit psql
   \q
   ```

> [!TIP]
> If you prefer using the default `postgres` superuser directly, you can simply run:
> `CREATE DATABASE paperbiz;`
> In that case, your connection string will be: `postgresql://postgres:YOUR_PASSWORD@localhost:5432/paperbiz?schema=public`

#### Method B: Using pgAdmin 4 (GUI)
1. Open **pgAdmin 4** from your Start menu.
2. Enter your master password to connect to **Servers** -> **PostgreSQL 16**.
3. Right-click **Login/Group Roles** -> **Create** -> **Login/Group Role...**
   - General tab: Name = `user`
   - Definition tab: Password = `password`
   - Privileges tab: Check *Can login?* -> Click **Save**.
4. Right-click **Databases** -> **Create** -> **Database...**
   - General tab: Database = `paperbiz`, Owner = `user` (or `postgres`)
   - Click **Save**.

---

### Step 2.3: Install Node.js 20 LTS for Windows

1. Download **Node.js LTS (v20+)**:
   - **Download Link**: [https://nodejs.org/](https://nodejs.org/) (Select Windows Installer `.msi`).
2. Run the `.msi` installer. Accept the license agreement, keep default paths, and ensure **"Add to PATH"** is enabled.
3. Finish the installation.
4. Verify Node.js in a new Command Prompt:
   ```cmd
   node -v
   npm -v
   ```

---

### Step 2.4: Deploy Application Files

1. Copy or extract the application folder to a dedicated location on your server machine, for example:
   `C:\PaperTrade`
2. Ensure the standalone build files and dependencies are in place:
   ```text
   C:\PaperTrade\
   ├── server.js              (Next.js standalone entrypoint)
   ├── .next\
   │   ├── static\            (Static assets copied from .next/static)
   ├── public\                (Public icons, images, and fonts)
   ├── prisma\                (schema.prisma, migrations\, seed.js)
   ├── node_modules\          (Dependencies bundle)
   ├── package.json
   ├── .env.example
   ├── start.bat
   ├── stop.bat
   └── scripts\
   ```
3. Open Command Prompt in `C:\PaperTrade` and create your production `.env` file:
   ```cmd
   cd /d C:\PaperTrade
   copy .env.example .env
   ```
4. Open `.env` in Notepad and update the configuration:
   ```ini
   # Database URL pointing to your native local PostgreSQL
   DATABASE_URL="postgresql://user:password@localhost:5432/paperbiz?schema=public"

   # Auth secrets (replace with random 32+ character strings)
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="replace-with-a-secure-random-string-at-least-32-chars"
   AUTH_SECRET="replace-with-a-secure-random-string-at-least-32-chars"

   # Business stationery headers
   BUSINESS_NAME="Paper Trade Co."
   BUSINESS_ADDRESS="Shop floor & Main Warehouse"
   BUSINESS_PHONE="+92 300 1234567"
   ```

---

### Step 2.5: Run Migrations & Initial Seed Data

In Command Prompt inside `C:\PaperTrade`, run the one-time migration and seed commands against the native PostgreSQL database:

```cmd
# 1. Apply database migrations to create all tables
npx prisma migrate deploy

# 2. Seed initial paper categories, qualities, and default owner account
npx prisma db seed
```

> **Default Seed Credentials**:
> - **Email**: `owner@example.com`
> - **Password**: `ChangeMe123!`
> *(You can modify these in `.env` before running the seed).*

---

## 3. Production Service Setup via NSSM (Recommended)

To run Paper Trade as a true Windows background service that:
- **Starts automatically when the computer boots up** (even before anyone logs in),
- **Restarts automatically if the application encounters an error or crashes**,
- **Runs completely headless in the background without keeping command prompt windows open**,

use **NSSM (Non-Sucking Service Manager)**:

### 3.1 Download NSSM
1. Download NSSM from: [https://nssm.cc/download](https://nssm.cc/download) (or direct zip: [nssm-2.24.zip](https://nssm.cc/release/nssm-2.24.zip)).
2. Open the downloaded zip archive, enter the `nssm-2.24\win64\` folder, and copy `nssm.exe`.
3. Paste `nssm.exe` into `C:\Windows\System32` (or keep it inside `C:\PaperTrade\`).

### 3.2 Register and Configure the Windows Service
Open **Command Prompt as Administrator** (Right-click Command Prompt -> *Run as administrator*), then execute:

```cmd
# 1. Register server.js as a Windows Service named "PaperTrade"
nssm install PaperTrade "C:\Program Files\nodejs\node.exe" "C:\PaperTrade\server.js"

# 2. Set the application working directory (CRITICAL for locating .env and assets)
nssm set PaperTrade AppDirectory "C:\PaperTrade"

# 3. Configure auto-restart delay (wait 5 seconds before restarting on failure)
nssm set PaperTrade AppRestartDelay 5000

# 4. Configure service log files for diagnostics
if not exist "C:\PaperTrade\logs" mkdir "C:\PaperTrade\logs"
nssm set PaperTrade AppStdout "C:\PaperTrade\logs\service-stdout.log"
nssm set PaperTrade AppStderr "C:\PaperTrade\logs\service-stderr.log"

# 5. Set a descriptive service title
nssm set PaperTrade Description "Paper Trade ERP Standalone Production Service"

# 6. Start the service
nssm start PaperTrade
```

### 3.3 Managing the NSSM Service
- **Check Status**: `nssm status PaperTrade` (should return `SERVICE_RUNNING`)
- **Stop Service**: `nssm stop PaperTrade` (or `net stop PaperTrade`)
- **Restart Service**: `nssm restart PaperTrade`
- **Edit Service Settings**: `nssm edit PaperTrade` (opens the GUI configuration editor)
- **Uninstall Service**: `nssm remove PaperTrade confirm`

---

## 4. Fallback Alternative: Task Scheduler & start.bat

If installing NSSM is not preferred, use this built-in Windows fallback to start the application automatically when a user logs in.

### 4.1 Manual / Shortcut Launch (`start.bat`)
- Double-clicking **`start.bat`** launches `node server.js` in a minimized background window, checks that `http://localhost:3000` is healthy, and automatically opens your default web browser to the login page.
- Double-clicking **`stop.bat`** terminates the process on port 3000 and cleanly shuts down the server.

### 4.2 Auto-Start at User Login via Task Scheduler (GUI Guide)
1. Press `Win + R`, type `taskschd.msc`, and press **Enter**.
2. In the right-hand panel, click **Create Task...** (do not click *Create Basic Task*).
3. **General Tab**:
   - **Name**: `Paper Trade ERP Server`
   - **Description**: `Starts Paper Trade standalone server at logon`
   - Select **Run only when user is logged on**
   - Check **Run with highest privileges**
4. **Triggers Tab**:
   - Click **New...**
   - **Begin the task**: Select **At log on**
   - Click **OK**
5. **Actions Tab**:
   - Click **New...**
   - **Action**: **Start a program**
   - **Program/script**: `C:\Program Files\nodejs\node.exe`
   - **Add arguments**: `server.js`
   - **Start in**: `C:\PaperTrade` *(CRITICAL: Must point to your project directory)*
   - Click **OK**
6. **Conditions Tab**:
   - Uncheck **Start the task only if the computer is on AC power** (so it starts on laptops running on battery).
7. **Settings Tab**:
   - Check **Allow task to be run on demand**
   - Check **If the running task does not end when requested, force it to stop**
   - Uncheck **Stop the task if it runs longer than 3 days**
8. Click **OK** to save the task.

---

## 5. Desktop Shortcuts & Daily Staff Workflow

To give staff a one-click launcher without touching command prompts:

1. Open File Explorer to `C:\PaperTrade`.
2. Right-click **`start.bat`** -> **Send to** -> **Desktop (create shortcut)**.
3. On your Desktop, right-click the shortcut and select **Properties**:
   - **Target**: `C:\PaperTrade\start.bat`
   - **Start in**: `C:\PaperTrade`
   - **Run**: Set to **Normal window**
   - **Change Icon**: Click *Change Icon...*, enter `%SystemRoot%\System32\shell32.dll`, and pick a suitable icon.
4. Rename the shortcut to **Paper Trade ERP**.
5. Repeat for **`stop.bat`** and name it **Stop Paper Trade**.

> **Note on NSSM**: If NSSM is used, the server is always running in the background. Clicking the **Paper Trade ERP** shortcut will instantly detect that port 3000 is active, skip startup, and immediately open the browser.

---

## 6. Local Area Network (LAN) Multi-PC Access

To allow billing counter PCs, warehouse laptops, and office workstations to access the system:

### 6.1 Allow Port 3000 in Windows Defender Firewall
Open **Command Prompt as Administrator** and run:
```cmd
netsh advfirewall firewall add rule name="PaperBusinessApp" dir=in action=allow protocol=TCP localport=3000
```

### 6.2 Find Server PC IPv4 Address
In Command Prompt:
```cmd
ipconfig
```
Look for **IPv4 Address** under your active Ethernet or Wi-Fi adapter (e.g. `192.168.1.50`).

> **Tip**: Configure a static IP on the Server PC or set a DHCP Reservation in your office router so the Server IP never changes.

### 6.3 Connect from Client Workstations
On any other PC, tablet, or phone on the same office network:
1. Open Google Chrome, Microsoft Edge, or Firefox.
2. Navigate to:
   ```text
   http://192.168.1.50:3000
   ```
   *(Replace with your Server PC's actual IPv4 address).*
3. Bookmark the URL for daily access.

---

## 7. Automated Database Backups

### Method 1: In-App Instant Backup & Restore
1. Log in as an **OWNER**.
2. Go to **Settings** -> **Database Backup & Restore**.
3. Click **"Backup Database Now (.sql)"** to instantly download a timestamped SQL snapshot. Save this file to a USB flash drive.

### Method 2: Scheduled Nightly Backups (Task Scheduler)
1. Press `Win + R`, type `taskschd.msc`, press **Enter**.
2. Click **Create Basic Task...**:
   - **Name**: `Paper Trade Nightly Backup`
   - **Trigger**: Daily at `20:00` (8:00 PM)
   - **Action**: Start a program
   - **Program/script**: `C:\PaperTrade\scripts\backup.bat`
   - **Start in**: `C:\PaperTrade`
3. Click **Finish**. Timestamped snapshots will be saved automatically to `C:\PaperTrade\backups\`.

---

## 8. Windows Troubleshooting Reference

| Symptom | Diagnostic Step | Fix |
| :--- | :--- | :--- |
| **PostgreSQL service not running** | Run: `sc query postgresql-x64-16` | Open **Services** (`services.msc`), right-click **postgresql-x64-16**, and select **Start**. Set Startup Type to **Automatic**. |
| **Node / NSSM service stopped** | Run: `nssm status PaperTrade` | Run `nssm start PaperTrade`. Inspect logs in `C:\PaperTrade\logs\service-stderr.log`. |
| **Port 3000 already in use** | Run: `netstat -ano \| findstr :3000` | Identify conflicting process PID in Task Manager and terminate it, or run `stop.bat`. |
| **Database authentication failed** | Check `.env` `DATABASE_URL` | Ensure username, password, port (5432), and database name (`paperbiz`) match PostgreSQL credentials. |
| **Client PC cannot connect over LAN** | Run `ping <SERVER-IP>` from client | Ensure both PCs are on the same subnet. Verify Windows Firewall rule (`netsh advfirewall...`). |
| **Pending schema migrations** | Run: `npx prisma migrate status` | In `C:\PaperTrade`, run: `npx prisma migrate deploy` followed by `npx prisma db seed`. |
| **Prisma query engine missing** | Check error in `service-stderr.log` | Run `npx prisma generate` inside `C:\PaperTrade`. |

