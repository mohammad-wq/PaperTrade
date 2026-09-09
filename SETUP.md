# Paper Trade Business Management System — Windows Deployment & Operations Manual

This guide covers the deployment, configuration, and day-to-day operation of the Paper Trade Management System on a **Windows Server PC**, including network configuration for multiple counter and office workstations.

---

## Architecture Overview

```
 [Office / Counter PC 2]              [Counter PC 3]
     (Web Browser)                        (Web Browser)
           │                                    │
           └──────────────┬─────────────────────┘
                          │ LAN Network Cable / Switch
                          ▼
            ┌───────────────────────────┐
            │   Windows Server PC       │
            │                           │
            │   ┌───────────────────┐   │
            │   │  Docker Desktop   │   │
            │   │  (WSL 2 Engine)   │   │
            │   │                   │   │
            │   │  ┌─────────────┐  │   │
            │   │  │ Next.js App │  │   │
            │   │  │ (Port 3000) │  │   │
            │   │  └──────┬──────┘  │   │
            │   │         │         │   │
            │   │  ┌──────┴──────┐  │   │
            │   │  │ PostgreSQL  │  │   │
            │   │  │ (Port 5432) │  │   │
            │   │  └─────────────┘  │   │
            │   └───────────────────┘   │
            └───────────────────────────┘
```

---

## 1. Server PC Prerequisites (Windows 10 / 11)

The **Server PC** is the main machine that hosts the Docker containers and database.

### 1.1 Enable Hardware Virtualization in BIOS/UEFI
- Ensure **Intel VT-x** or **AMD-V** is enabled in your computer's BIOS/UEFI settings. (In Windows, open **Task Manager** -> **Performance** tab -> **CPU** -> look for **Virtualization: Enabled**).

### 1.2 Install Docker Desktop for Windows
1. Download installer from: [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Run `Docker Desktop Installer.exe`.
3. Ensure the checkbox for WSL 2 engine is enabled.
4. Restart your computer when prompted.
5. Launch Docker Desktop and wait until the whale icon in the system tray shows **"Engine running"** (green light).

---

## 2. First-Time Application Setup

### 2.1 Extract Project Files
Place the project folder in a dedicated path on your Server PC, for example:
`C:\PaperTrade`

### 2.2 Configure Environment (.env)
1. Open **Command Prompt** in the project folder:
   ```cmd
   cd /d C:\PaperTrade
   copy .env.example .env
   ```
2. Open `.env` in Notepad to customize your stationery headers:
   - `BUSINESS_NAME="Paper Trade Co."`
   - `BUSINESS_PHONE="+92 300 1234567"`
   - `BUSINESS_ADDRESS="Main Paper Market, Karachi"`

### 2.3 Build and Launch Containers
In Command Prompt:
```cmd
docker compose build app
docker compose up -d
```
*Wait 2–3 minutes while the application container compiles and the database initializes.*

### 2.4 Run Database Migrations & Initial Seed Data
Run these two one-time commands to create the database tables and seed the default owner account:
```cmd
# 1. Apply schema migrations
docker compose exec app npx prisma migrate deploy

# 2. Seed initial paper categories, qualities, and owner credentials
docker compose exec app npx prisma db seed
```

### 2.5 Verify Local Access
Open your browser to:
**[http://localhost:3000](http://localhost:3000)**

Log in with:
- **Email:** `owner@example.com`
- **Password:** `ChangeMe123!`

---

## 3. Desktop Shortcut Creation (Windows)

To provide staff with a one-click launcher without touching command prompts:

1. Open File Explorer to `C:\PaperTrade`.
2. Right-click **`start.bat`** -> **Send to** -> **Desktop (create shortcut)**.
3. On your Desktop, right-click the shortcut and select **Properties**:
   - **Start in:** Verify it is set to `C:\PaperTrade` (required so Docker Compose finds configuration files).
   - **Run:** Ensure it is set to **Normal window** so system startup feedback is visible.
   - **Change Icon:** Click *Change Icon...*, enter `%SystemRoot%\System32\shell32.dll`, and choose a suitable icon.
4. Rename the shortcut to **Paper Trade**.
5. Repeat for **`stop.bat`** and name it **Stop Paper Trade** for clean end-of-day shutdowns.

---

## 4. Local Area Network (LAN) Multi-PC Setup

To allow other computers on your office network to access the system:

### 4.1 Allow Port 3000 through Windows Defender Firewall
Open **Command Prompt as Administrator** and execute:
```cmd
netsh advfirewall firewall add rule name="PaperBusinessApp" dir=in action=allow protocol=TCP localport=3000
```

### 4.2 Find Server PC's Local IPv4 Address
In Command Prompt:
```cmd
ipconfig
```
Look for **Ethernet adapter Ethernet** (or Wi-Fi adapter if on wireless):
- Note the **IPv4 Address** (e.g., `192.168.1.50`).

> **Recommendation**: Configure a static IP on the Server PC or set a DHCP Reservation in your office router so the Server IP never changes.

### 4.3 Connect from Counter / Client PCs
On any other PC connected to the office network:
1. Open Google Chrome or Microsoft Edge.
2. Enter:
   ```text
   http://192.168.1.50:3000
   ```
   *(Replace with your Server PC's IPv4 Address).*
3. Create a browser bookmark on each client workstation for quick access.

---

## 5. Daily Operations

### Morning Launch:
- Double-click the **Paper Trade** shortcut (or `start.bat`).
- The launcher verifies Docker Desktop is running, boots containers, waits for the web service to respond, and automatically opens your browser.

### Evening Shutdown:
- Double-click the **Stop Paper Trade** shortcut (or `stop.bat`).
- All containers stop gracefully, flushing all database transactions to persistent disk storage.

---

## 6. Automated Backup Strategy

### In-App Backups:
Any user with the **OWNER** role can navigate to **Settings** -> **Database Backup & Restore** and download a complete `.sql` snapshot at any time.

### Automated Nightly Backups (Windows Task Scheduler):
1. Press `Win + R`, type `taskschd.msc`, and press Enter.
2. Click **Create Basic Task...** in the right sidebar.
   - **Name:** `Paper Trade Nightly Backup`
   - **Trigger:** Daily at `20:00` (8:00 PM)
   - **Action:** Start a program
   - **Program/script:** `C:\PaperTrade\scripts\backup.bat`
   - **Start in:** `C:\PaperTrade`
3. Click **Finish**.
*Every day at 8:00 PM, a timestamped snapshot (`papertrade_backup_YYYYMMDD_HHMMSS.sql`) will be stored in `C:\PaperTrade\backups\`.*

---

## 7. Windows Troubleshooting Reference

| Symptom | Diagnostic Step | Fix |
| :--- | :--- | :--- |
| `start.bat` reports Docker is not running | Whale icon in system tray is grey or missing | Open Docker Desktop from Start menu. Wait for the green "Engine running" badge. |
| Port 3000 conflict | Run: `netstat -ano \| findstr :3000` | Identify the conflicting PID and terminate it in Task Manager. |
| Client PC displays "This site can't be reached" | Run: `ping 192.168.1.50` from client PC | Check physical LAN cable. Verify Windows Firewall rule (`netsh advfirewall ...`). |
| Database won't start | Check container logs: `docker compose logs db` | Verify adequate free disk space on `C:\`. |
| Container logs inspection | Run: `docker compose logs -f app` | Shows Next.js application output in real time. |
