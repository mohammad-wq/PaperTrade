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

## 7. Production Backup & Disaster Recovery System

Paper Trade includes an automated, multi-tiered backup and disaster recovery architecture designed for 100% native Windows deployment:
1. **Daily Automated Local Backups**: Runs `pg_dump` in compressed custom format (`-F c`), stores dumps at `C:\PaperTradeBackups\local\`, enforces 30-day automatic retention, and logs each run to `C:\PaperTradeBackups\backup-log.txt`.
2. **Weekly Automated Cloud Sync (Google Drive)**: Uses `rclone` to copy backups to `papertrade_backup:PaperTradeBackup/`, maintaining `papertrade_latest.dump` and a rolling 3-week archive (`papertrade_weekly_1.dump`, `papertrade_weekly_2.dump`, `papertrade_weekly_3.dump`).
3. **In-App Manual "Backup Now" Admin Button**: Accessible to the `OWNER` on the Settings page to trigger an immediate local dump and cloud upload with real-time UI status and logs.
4. **Disaster Recovery (`pg_restore`)**: Standard custom-format restoration procedures with throwaway verification testing.

---

### 7.1 Component 1: Daily Local Backups (`backup-local.bat`)

- **Script Location**: `C:\PaperTrade\scripts\backup-local.bat`
- **Output Directory**: `C:\PaperTradeBackups\local\`
- **File Naming Pattern**: `papertrade_YYYY-MM-DD_HHMM.dump` (e.g. `papertrade_2026-09-10_2100.dump`)
- **Format**: PostgreSQL Custom Format (`-F c` with `-b` large objects and gzip compression).
- **Credentials**: Dynamically parsed from `DATABASE_URL` in `.env` and injected into the child process environment via `PGPASSWORD`. Database passwords are never hardcoded or exposed in command arguments.
- **Retention**: After each run, files older than **30 days** in `C:\PaperTradeBackups\local\` are automatically deleted to prevent disk overflow.
- **Logging**: Each run appends a structured entry to `C:\PaperTradeBackups\backup-log.txt`:
  ```text
  [2026-09-10 21:00:00] [LOCAL] SUCCESS: papertrade_2026-09-10_2100.dump (2.45 MB) created - Retention: no old files to purge
  ```

---

### 7.2 Component 2: Google Drive Cloud Sync Setup (via Rclone)

Rclone is a fast, secure command-line tool that syncs files to Google Drive without requiring the heavy Google Drive desktop sync app.

#### Step 1: Download & Install Rclone on Windows
1. Download the official 64-bit Windows ZIP from: [https://rclone.org/downloads/](https://rclone.org/downloads/)
2. Extract the archive (e.g., to `C:\rclone\`).
3. Add `C:\rclone` to your Windows System `PATH`:
   - Open Start -> Search **"Environment Variables"** -> Click **Edit the system environment variables**.
   - Click **Environment Variables...** -> Under **System variables**, select **Path** -> Click **Edit...**.
   - Click **New** -> Enter `C:\rclone` -> Click **OK** on all dialogs.
4. Verify in a new Command Prompt:
   ```cmd
   rclone version
   ```

#### Step 2: Configure the Google Drive Remote (`rclone config`)

> [!CAUTION]
> **CRITICAL DATA OWNERSHIP REQUIREMENT**:
> When running `rclone config` to link Google Drive, the interactive OAuth browser authentication **must be completed using the business owner's Google account**, NOT the developer's personal account.
> This guarantees that:
> 1. All database archives are stored in the client's own cloud quota.
> 2. The client has direct, independent access to their backups in Google Drive.
> 3. Backups do not consume developer storage or breach client confidentiality.

The app is configured to use the remote name `papertrade_backup` by default, so the simplest setup is to name the remote exactly `papertrade_backup`.

- If you keep the default behavior, the script will target: `papertrade_backup:PaperTradeBackup`
- If you use a different remote name, set this in your environment: `RCLONE_REMOTE=your_remote_name:PaperTradeBackup`

1. Open Command Prompt and run:
   ```cmd
   rclone config
   ```
2. Follow these exact interactive prompts:
   - `n/s/q> ` Enter **`n`** (New remote)
   - `name> ` Enter **`papertrade_backup`** *(recommended and matches the app default)*
   - `Type of storage to configure> ` Enter **`drive`** (Google Drive)
   - `client_id> ` Press **Enter** (leave blank to use default)
   - `client_secret> ` Press **Enter** (leave blank to use default)
   - `scope> ` Enter **`1`** (Full access to files)
   - `service_account_file> ` Press **Enter** (leave blank)
   - `Edit advanced config?` Enter **`n`**
   - `Use web browser to automatically authenticate?` Enter **`y`**
3. A web browser will automatically open. **Log in with the Business Owner's Google Account** and click **Allow**.
4. Return to Command Prompt:
   - `Configure this as a Shared Drive (Team Drive)?` Enter **`n`**
   - `Keep this "papertrade_backup" remote?` Enter **`y`**
   - `e/n/d/r/c/s/q> ` Enter **`q`** (Quit config)
5. **Verify the connection**:
   ```cmd
   rclone lsd papertrade_backup:
   ```
   *(Should list your existing Google Drive folders without errors).*

#### Step 3: Rolling 3-Week Cloud Archive Mechanism
The cloud backup script (`scripts\backup-cloud.bat`) automatically maintains the following structure inside Google Drive folder `papertrade_backup:PaperTradeBackup/`:
- **`papertrade_latest.dump`**: Overwritten each week with the newest snapshot.
- **`papertrade_weekly_1.dump`**: 1 week old backup.
- **`papertrade_weekly_2.dump`**: 2 weeks old backup.
- **`papertrade_weekly_3.dump`**: 3 weeks old backup (oldest retained archive).
- When a new weekly backup runs:
  - Week 2 moves to Week 3 (replacing old Week 3).
  - Week 1 moves to Week 2.
  - Latest moves to Week 1.
  - New dump is uploaded as `papertrade_latest.dump`.
- Reuses the existing local dump from today (if under 24 hours old) to avoid unnecessary duplicate database dumping.
- Logs outcome with `[CLOUD]` tag to `C:\PaperTradeBackups\backup-log.txt`.

---

### 7.3 Component 3: Windows Task Scheduler Setup

Set up two non-interactive background tasks using **Task Scheduler**:

#### Task A: Daily Local Backup (Everyday at 4:00 PM)

> **Quick 1-Click Setup**: You can run `scripts\register-backup-task.bat` to automatically register this task in Task Scheduler for 4:00 PM daily with zero manual configuration.

Or configure manually via Windows Task Scheduler:
1. Press `Win + R`, type `taskschd.msc`, and press **Enter**.
2. In the right panel, click **Create Task...** (do NOT choose *Create Basic Task*).
3. **General Tab**:
   - **Name**: `PaperTrade_Daily_Local_Backup`
   - **Description**: `Creates daily compressed PostgreSQL dump with 30-day retention at 4:00 PM`
   - Select **Run whether user is logged on or not**
   - Check **Run with highest privileges**
   - Configure for: **Windows 10 / Windows 11 / Windows Server**
4. **Triggers Tab**:
   - Click **New...**
   - **Begin the task**: `On a schedule`
   - Select **Daily**, recur every `1` days
   - **Start time**: `16:00:00` (4:00 PM)
   - Click **OK**
5. **Actions Tab**:
   - Click **New...**
   - **Action**: `Start a program`
   - **Program/script**: `C:\Users\dell\Desktop\PaperTrade\scripts\backup-local.bat`
   - **Start in (optional)**: `C:\Users\dell\Desktop\PaperTrade` *(CRITICAL: Must point to project root)*
   - Click **OK**
6. **Conditions Tab**:
   - Uncheck **Start the task only if the computer is on AC power**
7. **Settings Tab**:
   - Check **Allow task to be run on demand**
   - Check **Run task as soon as possible after a scheduled start is missed**
   - Check **If the running task does not end when requested, force it to stop**
8. Click **OK**. Enter the Windows administrator password when prompted.

#### Task B: Weekly Cloud Backup to Google Drive (Every Sunday at 10:00 PM)
1. In Task Scheduler, click **Create Task...**.
2. **General Tab**:
   - **Name**: `PaperTrade_Weekly_Cloud_Backup`
   - **Description**: `Uploads weekly database archive to Google Drive via Rclone`
   - Select **Run whether user is logged on or not**
   - Check **Run with highest privileges**
3. **Triggers Tab**:
   - Click **New...**
   - Select **Weekly**
   - Check **Sunday**
   - **Start time**: `22:00:00` (10:00 PM)
   - Click **OK**
4. **Actions Tab**:
   - Click **New...**
   - **Action**: `Start a program`
   - **Program/script**: `C:\PaperTrade\scripts\backup-cloud.bat`
   - **Start in (optional)**: `C:\PaperTrade`
   - Click **OK**
5. **Conditions Tab**:
   - Uncheck **Start the task only if the computer is on AC power**
6. **Settings Tab**:
   - Check **Allow task to be run on demand**
   - Check **Run task as soon as possible after a scheduled start is missed**
7. Click **OK** and enter your Windows administrator credentials.

---

### 7.4 Component 4: In-App Manual "Backup Now" Trigger

1. Log into Paper Trade as an **Owner** (`Role.OWNER`).
2. Navigate to **Settings** (`/settings`).
3. In the **Automated & Manual Backup Control Center**, click **"Backup Now"**.
4. The system executes the shared runner:
   - Takes a fresh local `.dump` snapshot.
   - Syncs the dump to Google Drive.
   - Updates the last backup timestamp in the database.
   - Appends a `[MANUAL]` entry to `backup-log.txt`.
   - Displays real-time file size, filename, and Google Drive confirmation in the UI.
   - If cloud sync fails (e.g. Rclone unconfigured), displays a helpful warning while confirming the local backup succeeded.

---

### 7.5 Component 5: Database Restoration Guide (`pg_restore`)

If you ever need to restore your database after hardware failure, data corruption, or server migration:

#### Why Custom Format (`.dump`) Instead of Plain Text (`.sql`)?
The Paper Trade backup architecture deliberately uses PostgreSQL Custom Format (`-F c`), outputting compressed `.dump` files instead of raw `.sql` files:
- **Smaller File Size (Compression)**: Dumps are automatically compressed with zlib on the fly, reducing storage space by 75–85% and significantly accelerating cloud uploads to Google Drive.
- **Faster Restores**: `pg_restore` streams binary data via high-performance COPY blocks and supports multi-threaded parallel restoration (`-j`).
- **Selective & Out-of-Order Restores**: Custom format includes an internal table of contents allowing individual tables or schemas to be selectively restored or reordered to resolve foreign key constraints cleanly.
- **Tooling Requirement**: Because `.dump` is a binary format, it **cannot** be parsed by plain `psql` (which would throw syntax errors). It **must** be restored using `pg_restore`.

---

#### The Exact Working Restoration Command
```cmd
pg_restore -U paperbiz_app -d paperbiz --clean --if-exists "<path-to-dump-file>"
```
*(Replace `paperbiz_app` and `paperbiz` with the username and database configured in your `.env` `DATABASE_URL`, e.g. `papertrade`).*

---

#### Restoration Scenarios: Fresh Database vs. Existing Database

##### Scenario A: Restoring into a Fresh Empty Database
When restoring to a newly created, empty database (such as setting up a new server or recovering onto a fresh database created via `createdb`):
```cmd
pg_restore -U paperbiz_app -d paperbiz -v -F c "C:\PaperTradeBackups\local\papertrade_YYYY-MM-DD_HHMM.dump"
```
- **Why no `--clean --if-exists`?** Since the database is completely empty, there are no preexisting tables, sequences, or constraints to collide with. All objects and schemas are cleanly instantiated directly from the backup archive.

##### Scenario B: Restoring Over an Existing Database
When restoring over an active database that already contains tables, views, sequences, or partial records (e.g. disaster recovery, rollback of erroneous data entry):
```cmd
pg_restore -U paperbiz_app -d paperbiz --clean --if-exists -v -F c "C:\PaperTradeBackups\local\papertrade_YYYY-MM-DD_HHMM.dump"
```
- **Why `--clean --if-exists` is mandatory?**
  - `--clean`: Drops preexisting database objects (tables, sequences, constraints) immediately prior to recreating them. This prevents duplicate key violations, schema collision errors, and foreign key conflicts.
  - `--if-exists`: Appends `IF EXISTS` to all drop statements, gracefully skipping drops for any table that might not exist yet without halting the restore script.

---

#### Safe Best Practice: Test in a Throwaway Database First
Before restoring over your live production database, always verify the `.dump` file in a temporary test database:

```cmd
# 1. Create a temporary throwaway database
"C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres papertrade_test_restore

# 2. Restore into the test database (custom format -F c)
"C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -U postgres -d papertrade_test_restore -v --clean --if-exists -F c "C:\PaperTradeBackups\local\papertrade_YYYY-MM-DD_HHMM.dump"

# 3. Check tables and counts via psql
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d papertrade_test_restore -c "SELECT count(*) FROM \"SaleInvoice\";"

# 4. Once verified, drop the temporary database
"C:\Program Files\PostgreSQL\16\bin\dropdb.exe" -U postgres papertrade_test_restore
```

---

#### Full Production Database Restore Procedure
To restore directly into the production `paperbiz` (or `papertrade`) database:

1. **Stop the Paper Trade Application Service**:
   ```cmd
   nssm stop PaperTrade
   ```
   *(Or close the running server process to disconnect all client database sessions).*

2. **Run `pg_restore`**:
   Open Command Prompt as Administrator:
   ```cmd
   set PGPASSWORD=your_database_password
   "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -U paperbiz_app -d paperbiz --clean --if-exists -v -F c "C:\PaperTradeBackups\local\papertrade_YYYY-MM-DD_HHMM.dump"
   ```

   **Explanation of Flags**:
   - `-U paperbiz_app`: PostgreSQL database user.
   - `-d paperbiz`: Target database name.
   - `--clean`: Drops database objects prior to recreating them (avoids table collision).
   - `--if-exists`: Adds `IF EXISTS` to suppress errors for objects that do not exist.
   - `-F c`: Specifies Custom format (matching `pg_dump -F c`).
   - `-v`: Verbose progress reporting.

3. **Restart the Paper Trade Service**:
   ```cmd
   nssm start PaperTrade
   ```
4. Log into the system and verify data integrity on the Dashboard and Ledger.

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

