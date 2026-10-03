# Paper Trade — Windows Installation & Setup Guide

A complete, simple, step-by-step manual for installing, configuring, and operating the **Paper Trade ERP & Accounting System** on a native Windows PC (Windows 10, 11, or Windows Server).

> [!NOTE]
> **Native Windows Execution**: This system runs 100% natively using **Node.js LTS** and a local **PostgreSQL Windows Service**. No Docker, WSL2, or virtualization is needed, saving 1–2 GB of RAM and keeping host PCs fast.

---

## Architecture at a Glance

```
  [Billing Counter PC]        [Warehouse Laptop]         [Manager Tablet]
     (Web Browser)              (Web Browser)              (Web Browser)
           │                          │                          │
           └──────────────────────────┼──────────────────────────┘
                                      │ Office LAN / Wi-Fi
                                      ▼
        ┌─────────────────────────────────────────────────────────────┐
        │                  Host Windows Server PC                     │
        │                                                             │
        │  ┌───────────────────────────────────────────────────────┐  │
        │  │  Paper Trade Web Application (Port 3000)              │  │
        │  │  - Launched via start.bat (or background service)     │  │
        │  └──────────────────────────┬────────────────────────────┘  │
        │                             │ Localhost:5432                │
        │                             ▼                               │
        │  ┌───────────────────────────────────────────────────────┐  │
        │  │  PostgreSQL Database Service                          │  │
        │  │  - Database: papertrade                               │  │
        │  └──────────────────────────┬────────────────────────────┘  │
        │                             │ Daily 4:00 PM Backup          │
        │                             ▼                               │
        │       Local: C:\PaperTradeBackups\local\ (3 newest)         │
        │       Cloud: Google Drive (papertrade_backup:PaperTradeBackup)
        └─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites Checklist

Before starting, ensure your host computer meets the following:
- **Operating System**: Windows 10 (64-bit), Windows 11 (64-bit), or Windows Server 2016+
- **Hardware**: Minimum 4 GB RAM (8 GB recommended), 10 GB free hard disk space
- **Software to Install**:
  1. **PostgreSQL** (version 16, 17, or 18)
  2. **Node.js LTS** (version 20 or higher)

---

## Step 1: Install PostgreSQL

1. **Download PostgreSQL for Windows**:
   - Official installer: [EnterpriseDB PostgreSQL Downloads](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads)
   - Select **Windows x86-64** for PostgreSQL 16 or 17.
2. **Run Installer**:
   - **Installation Directory**: Keep default (`C:\Program Files\PostgreSQL\<version>`).
   - **Components**: Check *PostgreSQL Server*, *pgAdmin 4*, and *Command Line Tools*.
   - **Password**: Enter a secure password for the `postgres` superuser (e.g. `postgres` or `admin123`). **Remember this password.**
   - **Port**: Keep `5432`.
   - **Locale**: Keep default.
3. Finish the wizard. Uncheck "Stack Builder" on the exit screen.
4. **Verify PostgreSQL is running**:
   Open Command Prompt and check:
   ```cmd
   sc query postgresql-x64-17
   ```
   *(Or check `sc query postgresql-x64-16`). It should show `STATE : 4 RUNNING`.*

---

## Step 2: Create the Database & User

Open **Command Prompt** and run:

1. Connect to PostgreSQL:
   ```cmd
   psql -U postgres
   ```
   *(Enter the password you created during PostgreSQL installation).*

2. Create the application user and database:
   ```sql
   CREATE USER papertrade WITH PASSWORD 'AdnanDhariWalasPersonalProject';
   CREATE DATABASE papertrade OWNER papertrade;
   GRANT ALL PRIVILEGES ON DATABASE papertrade TO papertrade;
   \q
   ```

> [!TIP]
> You can also use any password you prefer. Just make sure it matches what you set in your `.env` file in Step 4.

---

## Step 3: Install Node.js LTS

1. Download **Node.js LTS (v20+)** from [nodejs.org](https://nodejs.org/).
2. Run the `.msi` installer. Accept defaults and ensure **"Add to PATH"** is checked.
3. Verify in a new Command Prompt:
   ```cmd
   node -v
   npm -v
   ```

---

## Step 4: Configure the Environment File (`.env`)

In the project root folder (`PaperTrade`):

1. Copy the example environment file:
   ```cmd
   copy .env.example .env
   ```
2. Open `.env` in Notepad and verify your settings:
   ```ini
   # Database connection string
   DATABASE_URL="postgresql://papertrade:AdnanDhariWalasPersonalProject@localhost:5432/papertrade?schema=public"

   # Authentication secrets (can be any 32+ character strings)
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="generate-a-secure-random-string-at-least-32-chars-long"
   AUTH_SECRET="generate-a-secure-random-string-at-least-32-chars-long"

   # Business stationery details (printed on invoices & receipts)
   BUSINESS_NAME="Paper Trade Co."
   BUSINESS_ADDRESS="Shop floor & Main Warehouse"
   BUSINESS_PHONE="+92 300 1234567"
   BUSINESS_EMAIL="admin@admin.com"
   ```

---

## Step 5: Initialize the Database (One-Time Setup)

Inside the `PaperTrade` folder, run the migration and seeding commands:

```cmd
# 1. Create all database tables
npx prisma migrate deploy

# 2. Seed default categories, paper qualities, and admin account
npx prisma db seed
```

### Default Login Credentials
- **URL**: `http://localhost:3000`
- **Email**: `admin@admin.com`
- **Password**: `admin123!`

*(You can update your email and password at any time inside the app under Settings / User Management).*

---

## Step 6: Starting and Stopping Paper Trade

### To Start
- Double-click **`start.bat`** in the project folder.
- The launcher verifies PostgreSQL, launches the web server, and automatically opens your browser to `http://localhost:3000`.

### To Stop
- Double-click **`stop.bat`** to safely terminate background processes and free port 3000.

### Create Desktop Shortcuts for Staff
1. Right-click **`start.bat`** → **Send to** → **Desktop (create shortcut)**.
2. Rename the shortcut to **"Paper Trade"**.
3. (Optional) Right-click shortcut → Properties → Change Icon → choose an icon.
4. Repeat for **`stop.bat`** and name it **"Stop Paper Trade"**.

---

## Step 7: Office LAN / Multi-PC Access

To access Paper Trade from other computers, billing counters, or tablets on the same Wi-Fi / LAN network:

### 1. Allow Port 3000 in Windows Firewall
Open **Command Prompt as Administrator** on the host server PC:
```cmd
netsh advfirewall firewall add rule name="PaperTrade" dir=in action=allow protocol=TCP localport=3000
```

### 2. Find the Host PC's IP Address
In Command Prompt:
```cmd
ipconfig
```
Look for **IPv4 Address** (e.g. `192.168.1.50`).

> [!TIP]
> For best results, set a static IP or DHCP reservation on your router for the host server PC so its IP address never changes.

### 3. Connect from Workstations
Open Chrome, Edge, or Safari on any counter PC, laptop, or tablet and navigate to:
```
http://192.168.1.50:3000
```
*(Replace `192.168.1.50` with the actual IP address of your host PC).*

---

## Step 8: Automated Dual Backup System

Paper Trade protects your data with both local disk archives and cloud redundancy:

| Target | Location | Retention / Policy |
| :--- | :--- | :--- |
| **Local Disk** | `C:\PaperTradeBackups\local\` | Automatic 3-file rotation (keeps the 3 newest `.dump` files) |
| **Google Drive** | `papertrade_backup:PaperTradeBackup` | Synced via rclone (`daily_latest.dump`) |
| **Execution Log** | `C:\PaperTradeBackups\backup_execution.log` | Records timestamp, dump size, and cloud sync status |

### 1-Click Scheduled Backup Registration
To schedule backups every day at **4:00 PM**:
1. Right-click **`scripts\register-backup-task.bat`** → **Run as administrator**.
2. Done! A Windows Task Scheduler job named `\PaperTrade_Daily_Backup` is created.

### Setting Up Google Drive Cloud Sync (3 Minutes)
Cloud sync uses `rclone`. The executable is already included in `scripts\rclone.exe`.

1. Open Command Prompt and run:
   ```cmd
   scripts\rclone.exe config
   ```
2. Follow these prompts:
   - `n/s/q> ` Enter **`n`** (New remote)
   - `name> ` Enter **`papertrade_backup`**
   - `Storage> ` Enter **`drive`** (Google Drive)
   - `client_id> ` Press **Enter** (leave blank)
   - `client_secret> ` Press **Enter** (leave blank)
   - `scope> ` Enter **`1`** (Full access)
   - `service_account_file> ` Press **Enter** (leave blank)
   - `Edit advanced config?` Enter **`n`**
   - `Use web browser to automatically authenticate?` Enter **`y`**
3. A browser window opens. **Log in with the Business Owner's Google account** and grant permission.
4. Back in Command Prompt:
   - `Configure this as a Shared Drive?` Enter **`n`**
   - `Keep this "papertrade_backup" remote?` Enter **`y`**
   - `q> ` Enter **`q`** to exit.
5. Verify the connection:
   ```cmd
   scripts\rclone.exe lsd papertrade_backup:
   ```

### Manual Backup (On Demand)
- **From UI**: Go to **Settings** → click **"Backup Database Now (.dump)"**.
- **From Windows**: Double-click `scripts\run_backup.bat`.

---

## Step 9: Database Restoration (Disaster Recovery)

If you ever need to restore your database from a backup:

### Method A: Quick Drag & Drop
1. Locate your backup file in `C:\PaperTradeBackups\local\` (e.g. `papertrade_2026-10-03_1930.dump`).
2. **Drag and drop** the `.dump` file directly onto `scripts\restore.bat`.
3. Type `YES` to confirm when prompted.

### Method B: Command Line
```cmd
scripts\restore.bat C:\PaperTradeBackups\local\papertrade_2026-10-03_1930.dump
```

Or using native `pg_restore`:
```cmd
pg_restore -U papertrade -d papertrade --clean --if-exists -v -F c "C:\PaperTradeBackups\local\papertrade_2026-10-03_1930.dump"
```

---

## Troubleshooting Quick Reference

| Problem | Cause | How to Fix |
| :--- | :--- | :--- |
| **"Could not connect to server"** | PostgreSQL Windows service is stopped | Open Start → search **Services** → find **postgresql-x64-XX** → right-click **Start**. |
| **Port 3000 already in use** | A previous Node process is still running | Double-click **`stop.bat`**, or run `netstat -ano \| findstr :3000` to find the PID and kill it in Task Manager. |
| **Counter PC cannot open website** | Windows Defender Firewall blocking port 3000 | Run `netsh advfirewall firewall add rule name="PaperTrade" dir=in action=allow protocol=TCP localport=3000` as Administrator on host PC. |
| **Database login failed** | Wrong password in `.env` | Verify that the password in `DATABASE_URL` matches the password created in PostgreSQL. |
| **Rclone cloud sync skipped** | Rclone remote not configured | Run `scripts\rclone.exe config` and name the remote `papertrade_backup`. |
