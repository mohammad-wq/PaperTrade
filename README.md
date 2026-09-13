# Paper Trade — Business Management System

A production-ready, local-first ERP and accounting platform designed specifically for paper merchants, paper converters, and warehouse distributors.

Built with **Next.js 14 App Router** (standalone multi-stage build), **PostgreSQL 16 Alpine**, **Prisma ORM 5.22.0**, and **Auth.js**.

The entire system is completely **airgapped** and runs 100% locally with zero external cloud dependencies. A single primary PC acts as the **Server Machine**, allowing multiple billing, counter, and warehouse workstations to connect simultaneously over a standard Local Area Network (LAN cable or Wi-Fi).

---

### Table of Contents
1. [Architecture & Deployment Models](#architecture--deployment-models)
2. [Quick Launch Procedure (Daily Operations)](#quick-launch-procedure-daily-operations)
   - [Windows Client Production (Daily Launch & Shutdown)](#windows-client-production-daily-launch--shutdown)
   - [Linux Developer Setup (Daily Launch & Shutdown)](#linux-developer-setup-daily-launch--shutdown)
3. [Setup Guides (First-Time Installation)](#setup-guides-first-time-installation)
   - [Path A: Client Production Setup (Native Windows — Recommended, No Docker)](#path-a-client-production-setup-native-windows--recommended-no-docker)
   - [Path B: Developer Local Setup (Docker Compose on Ubuntu / Linux)](#path-b-developer-local-setup-docker-compose-on-ubuntu--linux)
4. [Desktop Shortcut Setup](#desktop-shortcut-setup)
   - [Windows Desktop Shortcut](#windows-desktop-shortcut)
   - [Linux Application Launcher (.desktop)](#linux-application-launcher-desktop)
5. [Local Area Network (LAN) Multi-PC Access](#local-area-network-lan-multi-pc-access)
   - [Finding Server IP Address](#finding-server-ip-address)
   - [Configuring the Firewall](#configuring-the-firewall)
   - [Connecting from Client Workstations](#connecting-from-client-workstations)
6. [Database Backup & Restore Operations](#database-backup--restore-operations)
7. [Troubleshooting & Diagnostics (Native Windows & Linux)](#troubleshooting--diagnostics-native-windows--linux)
8. [Developer Conventions & Maintenance](#developer-conventions--maintenance)

---

## Architecture & Deployment Models

The system supports two distinct deployment models:

### 1. Client Production Setup: Native Windows (Zero Docker Overhead)
Designed for budget commercial Windows hardware. Running Docker Desktop on Windows requires WSL2 virtualization, consuming 1 to 2 GB of RAM at idle. The native setup runs **Node.js LTS** and a native **PostgreSQL 16 Windows Service** directly on the Windows OS with zero virtualization overhead.

```
 [Counter PC 1 / Cashier]             [Warehouse PC 2]              [Manager Laptop]
     (Web Browser)                        (Web Browser)                 (Web Browser)
           │                                    │                             │
           └────────────────────────┬───────────┴─────────────────────────────┘
                                    │ Local Office LAN (Cable / Wi-Fi)
                                    ▼
         ┌─────────────────────────────────────────────────────────────┐
         │             Windows Server PC (Client Machine)              │
         │                                                             │
         │  ┌───────────────────────────────────────────────────────┐  │
         │  │   Next.js 14 Standalone Server (Port 3000)            │  │
         │  │   - Managed by NSSM Windows Service (or start.bat)    │  │
         │  │   - Auto-starts on boot, auto-restarts on crash      │  │
         │  └──────────────────────────┬────────────────────────────┘  │
         │                             │ Native TCP localhost:5432     │
         │                             ▼                               │
         │  ┌───────────────────────────────────────────────────────┐  │
         │  │   PostgreSQL 16 Windows Service (Port 5432)           │  │
         │  │   - Database: paperbiz                                │  │
         │  │   - Zero WSL2 virtualization / 100% native disk I/O  │  │
         │  └──────────────────────────┬────────────────────────────┘  │
         │                             ▼                               │
         │                [C:\PaperTrade\backups\]                     │
         └─────────────────────────────────────────────────────────────┘
```

### 2. Developer Setup: Docker Compose Stack (Ubuntu / Linux)
Designed for local development and integration testing on Ubuntu/Linux using standard containers:
- **`papertrade-app`**: Next.js 14 standalone image
- **`papertrade-db`**: PostgreSQL 16 Alpine container

---

## Quick Launch Procedure (Daily Operations)

Once installed, day-to-day operations require no technical knowledge.

### Windows Client Production (Daily Launch & Shutdown)

#### With NSSM Background Service (Recommended):
- The application and database start **automatically on boot**.
- Staff can simply double-click the **Paper Trade ERP** desktop shortcut (`start.bat`).
- The launcher instantly detects that `http://localhost:3000` is active and opens the default browser immediately.

#### With Standalone Launcher (`start.bat` fallback):
1. Double-click **`start.bat`** (or desktop shortcut).
2. The launcher automatically:
   - Verifies Node.js and the PostgreSQL service (`postgresql-x64-16`) are running.
   - Starts `node server.js` in a minimized background window.
   - Actively polls `http://localhost:3000` until responsive.
   - Automatically opens your default web browser to `http://localhost:3000`.

#### To Stop:
1. Double-click **`stop.bat`** (or desktop shortcut).
2. The script stops the NSSM service or cleanly terminates any Node process on port 3000, ensuring all data is preserved and ports are released.

---

### Linux Developer Setup (Daily Launch & Shutdown)

#### To Start:
```bash
./start.sh
```
Starts the Docker Compose stack in detached mode, polls `http://localhost:3000`, and opens your default browser via `xdg-open`.

#### To Stop:
```bash
./stop.sh
```
Stops Compose containers cleanly.

---

## Setup Guides (First-Time Installation)

---

### Path A: Client Production Setup (Native Windows — Recommended, No Docker)

> [!IMPORTANT]
> **No Docker Desktop Required**: The client production PC does **not** need Docker Desktop or WSL2 installed.
> For the complete, detailed step-by-step installation manual, refer to [**SETUP.md**](SETUP.md).

#### Quick Setup Summary:

1. **Install PostgreSQL 16 for Windows**:
   - Download official installer: [EnterpriseDB PostgreSQL 16](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads).
   - Install on port `5432`, keep default data directory, set a master password for `postgres`.
   - Verify service is running: `sc query postgresql-x64-16`

2. **Create Database & User**:
   Open Command Prompt and run:
   ```cmd
   "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres
   CREATE USER "user" WITH PASSWORD 'password';
   CREATE DATABASE paperbiz OWNER "user";
   GRANT ALL PRIVILEGES ON DATABASE paperbiz TO "user";
   \q
   ```

3. **Install Node.js 20 LTS for Windows**:
   - Download and install `.msi` from [nodejs.org](https://nodejs.org/).

4. **Copy Application Standalone Build**:
   - Place project files in `C:\PaperTrade`.
   - Create `.env`:
     ```cmd
     cd /d C:\PaperTrade
     copy .env.example .env
     ```
   - In `.env`, ensure `DATABASE_URL` points to native local Postgres:
     ```ini
     DATABASE_URL="postgresql://user:password@localhost:5432/paperbiz?schema=public"
     ```

5. **Deploy Migrations & Seed Data**:
   ```cmd
   npx prisma migrate deploy
   npx prisma db seed
   ```

6. **Register Windows Service with NSSM (Recommended)**:
   - Download NSSM from [nssm.cc](https://nssm.cc/download) and place `nssm.exe` in `C:\Windows\System32`.
   - Run Command Prompt as Administrator:
     ```cmd
     nssm install PaperTrade "C:\Program Files\nodejs\node.exe" "C:\PaperTrade\server.js"
     nssm set PaperTrade AppDirectory "C:\PaperTrade"
     nssm set PaperTrade AppRestartDelay 5000
     nssm set PaperTrade AppStdout "C:\PaperTrade\logs\service-stdout.log"
     nssm set PaperTrade AppStderr "C:\PaperTrade\logs\service-stderr.log"
     nssm start PaperTrade
     ```
   *(Alternatively, configure Task Scheduler to run `server.js` at login as detailed in [SETUP.md](SETUP.md)).*

7. **Log In**:
   - Browse to: **`http://localhost:3000`**
   - **Email:** `owner@example.com`
   - **Password:** `ChangeMe123!`

---

### Path B: Developer Local Setup (Docker Compose on Ubuntu / Linux)

#### Step 1: Install Docker & Docker Compose
On Ubuntu / Debian:
```bash
# 1. Update package lists
sudo apt update

# 2. Install Docker and Compose plugin
sudo apt install -y docker.io docker-compose-v2 curl

# 3. Enable and start Docker daemon
sudo systemctl enable --now docker

# 4. Add your current user to the docker group (avoids needing sudo)
sudo usermod -aG docker $USER

# 5. Apply new group membership (or log out and log back in)
newgrp docker
```

On Fedora:
```bash
sudo dnf install -y docker docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

On Arch Linux:
```bash
sudo pacman -S docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

#### Step 2: Copy Project Files
Copy the project folder to your desired location, e.g.:
`~/PaperTrade`

#### Step 3: Configure Environment & Script Permissions
```bash
cd ~/PaperTrade
cp .env.example .env

# Ensure shell scripts have execute permissions
chmod +x start.sh stop.sh scripts/*.sh
```

#### Step 4: Build Application Image & Launch Containers
```bash
docker compose build app
docker compose up -d
```

#### Step 5: Initialize Database (Migrations & Seed Data)
```bash
# 1. Apply schema migrations
docker compose exec app npx prisma migrate deploy

# 2. Seed initial paper categories, qualities, and default owner account
docker compose exec app npx prisma db seed
```

#### Step 6: Log In
Open your browser to: **`http://localhost:3000`**
- **Email:** `owner@example.com`
- **Password:** `ChangeMe123!`

---

## Desktop Shortcut Setup

### Windows Desktop Shortcut

1. Open File Explorer and browse to your project folder (e.g. `C:\PaperTrade`).
2. Right-click **`start.bat`** -> select **Send to** -> **Desktop (create shortcut)**.
   *(On Windows 11, click **Show more options** first).*
3. Go to your Desktop, right-click the shortcut, and select **Properties**:
   - **Target:** `C:\PaperTrade\start.bat`
   - **Start in:** `C:\PaperTrade` *(CRITICAL: must point to project root folder).*
   - **Run:** Set to **Normal window** *(ensures status and startup messages are visible).*
   - **Change Icon:** Click **Change Icon...**, type `%SystemRoot%\System32\shell32.dll`, and pick a business icon.
4. Rename the shortcut to **Paper Trade ERP**.
5. Repeat for **`stop.bat`** and name it **Stop Paper Trade** for easy end-of-day shutdown.

---

### Linux Application Launcher (.desktop)

You can create a desktop launcher on Ubuntu or any Linux desktop environment:

1. Create a launcher file on your desktop:
   ```bash
   nano ~/Desktop/papertrade.desktop
   ```
2. Paste the following configuration (replace `/path/to/project` with your actual project directory path):
   ```ini
   [Desktop Entry]
   Version=1.0
   Type=Application
   Name=Paper Trade ERP
   Comment=Start Paper Trade Management System
   Exec=/path/to/project/start.sh
   Path=/path/to/project
   Icon=accessories-calculator
   Terminal=true
   Categories=Office;Finance;
   ```
3. Make the launcher executable:
   ```bash
   chmod +x ~/Desktop/papertrade.desktop
   ```
4. On Ubuntu/GNOME, right-click the desktop icon and select **"Allow Launching"**.

---

## Local Area Network (LAN) Multi-PC Access

Multiple client PCs (billing counters, warehouse operators, manager laptops) can access the system simultaneously without installing Docker or Node.js.

### Finding Server IP Address

#### On Windows Server PC:
1. Press `Win + R`, type `cmd`, and press Enter.
2. Type `ipconfig` and look for the **IPv4 Address** under **Ethernet adapter Ethernet** (e.g., `192.168.1.50`).

#### On Linux Server PC:
In your terminal, run:
```bash
hostname -I | awk '{print $1}'
# or
ip addr show | grep 'inet ' | grep -v '127.0.0.1'
```

> **Network Tip**: For a stable setup, assign a **Static IP** to the Server PC in your office router settings (DHCP Reservation) so the IP address remains constant every day.

---

### Configuring the Firewall

#### On Windows Server PC:
Windows Firewall may block incoming requests from other computers on the LAN. Allow port 3000 by opening **Command Prompt as Administrator** and running:
```cmd
netsh advfirewall firewall add rule name="PaperBusinessApp" dir=in action=allow protocol=TCP localport=3000
```

#### On Linux Server PC:
If UFW (Uncomplicated Firewall) is enabled, allow incoming traffic on port 3000:
```bash
sudo ufw allow 3000/tcp
```

---

### Connecting from Client Workstations

On any secondary PC, laptop, or tablet connected to the same office network (LAN cable or Wi-Fi):
1. Open Google Chrome, Microsoft Edge, or Mozilla Firefox.
2. In the URL address bar, enter:
   ```text
   http://192.168.1.50:3000
   ```
   *(Replace `192.168.1.50` with the actual IP address of the Server PC).*
3. The Paper Trade login screen will appear immediately. Staff can log in with their assigned accounts.

---

## Database Backup & Restore Operations

Protecting your customer balances, stock transactions, and ledger entries is essential.

### Method 1: Instant In-App Backup & Restore
1. Log into the application as an **OWNER**.
2. Navigate to **Settings** in the left sidebar.
3. Under **Database Backup & Restore**:
   - **To Backup:** Click **"Backup Database Now (.sql)"**. A timestamped `.sql` snapshot will immediately download through your browser. Copy this file onto a USB thumb drive.
   - **To Restore:** Select your `.sql` file in the restore section, check the confirmation box, and click **"Confirm & Restore Database"**.

### Method 2: Automated Nightly Backups

#### Windows Task Scheduler:
1. Press `Win + R`, type `taskschd.msc`, and press Enter.
2. Click **Create Basic Task...**
   - **Name:** `Paper Trade Nightly Backup`
   - **Trigger:** Daily at `20:00` (8:00 PM)
   - **Action:** Start a program
   - **Program/script:** `C:\PaperTrade\scripts\backup.bat`
   - **Start in:** `C:\PaperTrade`
3. Click **Finish**.

#### Linux Cron Job:
Open your user crontab:
```bash
crontab -e
```
Add the following line to back up daily at 8:00 PM:
```bash
0 20 * * * /path/to/project/scripts/backup.sh >> /path/to/project/backups/backup.log 2>&1
```

### Method 3: Manual Script Execution
- **Windows:** Run `scripts\backup.bat` to back up, or drag a `.dump` file onto `scripts\restore.bat`.
- **Linux:** Run `./scripts/backup.sh` to back up, or `./scripts/restore.sh backups/local/your_snapshot.dump` to restore.

---

## Troubleshooting & Diagnostics (Native Windows & Linux)

### Native Windows Production Diagnostics (Client Server PC)

> [!NOTE]
> The client production setup has **zero dependency on Docker Desktop**. All troubleshooting on the client machine involves native Windows services and processes.

| Symptom | Component | Diagnostic Step | Resolution |
| :--- | :--- | :--- | :--- |
| **PostgreSQL service is not running** | PostgreSQL | Run in CMD: `sc query postgresql-x64-16` | Open Windows **Services** (`services.msc`), find **postgresql-x64-16**, right-click and choose **Start**. Ensure Startup Type is set to **Automatic**. |
| **Node process or NSSM service is not running** | Application | Run in Admin CMD: `nssm status PaperTrade` | Run `nssm start PaperTrade`. If not using NSSM, check Task Manager for `node.exe` or re-run `start.bat`. Check error logs in `C:\PaperTrade\logs\service-stderr.log`. |
| **Port 3000 is already in use** | Network Port | Run: `netstat -ano \| findstr :3000` | Identify conflicting process PID in the rightmost column. Terminate it via Task Manager or run `stop.bat` (which automatically terminates processes bound to port 3000). |
| **Client PC cannot connect over LAN** | Firewall / LAN | Run: `ping <SERVER-IP>` from counter PC | Ensure both PCs are connected to the same subnet/router. Verify Windows Firewall rule was added: `netsh advfirewall firewall add rule name="PaperBusinessApp" dir=in action=allow protocol=TCP localport=3000`. |
| **Database authentication failure** | Configuration | Check `DATABASE_URL` in `.env` | Ensure credentials match: `postgresql://user:password@localhost:5432/paperbiz?schema=public`. Test login via `psql -U user -d paperbiz`. |
| **Database schema missing tables** | Prisma | Run: `npx prisma migrate status` | In `C:\PaperTrade`, run `npx prisma migrate deploy` followed by `npx prisma db seed`. |

### Developer Local Diagnostics (Docker Compose on Linux)

| Symptom | Operating System | Diagnostic Step | Solution |
| :--- | :--- | :--- | :--- |
| Docker daemon not running | **Linux** | `systemctl is-active docker` returns inactive. | Run `sudo systemctl start docker`. Ensure user is in docker group (`sudo usermod -aG docker $USER`). |
| Port 3000 is already in use | **Linux** | Run `sudo ss -tulpn \| grep 3000` | Identify PID using port 3000 and stop it (`kill <PID>`). |
| Standalone App won't start in Docker | **Linux** | Run `docker compose logs app` | Check for configuration errors in `.env`. Rebuild container with `docker compose build app`. |
| Database won't start in Docker | **Linux** | Run `docker compose logs db` | Check available disk space on server drive. Check volume permissions. |

---

## Developer Conventions & Maintenance

### Line Endings Policy (`.gitattributes`)
To prevent cross-platform script corruption:
- `*.bat` and `*.cmd` files are strictly enforced with **CRLF** line endings.
- `*.sh`, source code (`*.ts`, `*.tsx`, `*.js`), and config files are enforced with **LF** line endings.

### Useful Maintenance Commands
```bash
# Check container status and health
docker compose ps

# View real-time application logs
docker compose logs -f app

# View database logs
docker compose logs -f db

# Restart services
docker compose restart

# Clean shutdown
docker compose down
```

---

## License & Support
Paper Trade Management System is built for private commercial deployment. All rights reserved.
