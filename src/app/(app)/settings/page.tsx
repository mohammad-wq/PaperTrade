"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { canPerformAction } from "@/lib/auth/permissions";
import {
  Settings,
  Save,
  CheckCircle2,
  AlertCircle,
  Building2,
  Database,
  Download,
  UploadCloud,
  RefreshCw,
  FileCheck,
  AlertTriangle,
  Terminal,
  Cloud,
  HardDrive,
  Clock,
  Calendar,
  ShieldCheck,
  ShieldAlert,
  FolderSync,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSettingsAction, updateSettingsAction } from "@/actions/settings";
import {
  getDatabaseStatsAction,
  triggerManualBackupAction,
  getBackupLogsAction,
} from "@/actions/backup";
import type { BackupLogEntry, BackupExecutionResult } from "@/lib/backup-runner";
import { formatDateTime } from "@/lib/utils";

type DatabaseStats = {
  productsCount: number;
  partiesCount: number;
  salesCount: number;
  purchasesCount: number;
  ledgerCount: number;
  lastBackupAt: string | null;
};

export default function SettingsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";
  const canView = !session?.user ? true : canPerformAction(session.user.role, "settings", "view", (session.user as any).permissions);

  useEffect(() => {
    if (session?.user && !canView) {
      router.replace("/dashboard");
    }
  }, [session, canView, router]);

  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Database Stats state
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // In-app download & restore states
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Production Backup & Cloud Sync states
  const [isManualBackingUp, setIsManualBackingUp] = useState(false);
  const [manualBackupResult, setManualBackupResult] = useState<BackupExecutionResult | null>(null);
  const [manualBackupError, setManualBackupError] = useState<string | null>(null);
  const [backupLogs, setBackupLogs] = useState<BackupLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [settingsRes, statsRes, logsRes] = await Promise.all([
          getSettingsAction(),
          getDatabaseStatsAction(),
          getBackupLogsAction(15),
        ]);

        if (settingsRes.success && settingsRes.data) {
          setBusinessName(settingsRes.data.businessName);
          setBusinessAddress(settingsRes.data.businessAddress);
          setBusinessPhone(settingsRes.data.businessPhone);
          setBusinessEmail(settingsRes.data.businessEmail);
        }

        if (statsRes.success && statsRes.data) {
          setDbStats(statsRes.data);
        }

        if (logsRes.success && logsRes.data) {
          setBackupLogs(logsRes.data);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function reloadStats() {
    setStatsLoading(true);
    try {
      const statsRes = await getDatabaseStatsAction();
      if (statsRes.success && statsRes.data) {
        setDbStats(statsRes.data);
      }
    } finally {
      setStatsLoading(false);
    }
  }

  async function reloadLogs() {
    setLogsLoading(true);
    try {
      const logsRes = await getBackupLogsAction(20);
      if (logsRes.success && logsRes.data) {
        setBackupLogs(logsRes.data);
      }
    } finally {
      setLogsLoading(false);
    }
  }

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatusMessage(null);
    setSaving(true);

    try {
      const res = await updateSettingsAction({
        overdueDays: 14,
        businessName: businessName.trim(),
        businessAddress: businessAddress.trim(),
        businessPhone: businessPhone.trim(),
        businessEmail: businessEmail.trim(),
      });

      if (res.success) {
        setStatusMessage({ type: "success", text: "Business details saved successfully." });
      } else {
        setStatusMessage({ type: "error", text: res.error || "Failed to update settings." });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleManualBackupNow() {
    setIsManualBackingUp(true);
    setManualBackupResult(null);
    setManualBackupError(null);

    try {
      const res = await triggerManualBackupAction();

      if (!res.success) {
        setManualBackupError(res.error || "Manual backup failed to execute.");
      } else {
        setManualBackupResult(res.data || null);
      }

      await Promise.all([reloadStats(), reloadLogs()]);
    } catch (err) {
      setManualBackupError(err instanceof Error ? err.message : "An unexpected error occurred during backup.");
    } finally {
      setIsManualBackingUp(false);
    }
  }

  async function handleDownloadBackup() {
    setIsBackingUp(true);
    setBackupMessage(null);

    try {
      const response = await fetch("/api/backup");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Backup failed with HTTP ${response.status}`);
      }

      const disposition = response.headers.get("content-disposition");
      let filename = `papertrade-backup-${new Date().toISOString().slice(0, 10)}.sql`;
      if (disposition && disposition.includes("filename=")) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
        if (matches?.[1]) {
          filename = matches[1].replace(/['"]/g, "");
        }
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      a.remove();

      setBackupMessage({
        type: "success",
        text: `Database snapshot downloaded successfully as "${filename}".`,
      });

      await reloadStats();
    } catch (error) {
      setBackupMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to download database backup.",
      });
    } finally {
      setIsBackingUp(false);
    }
  }

  async function handleRestoreSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!restoreFile) {
      setBackupMessage({ type: "error", text: "Please select a .sql backup file to restore." });
      return;
    }

    if (!restoreConfirmed) {
      setBackupMessage({
        type: "error",
        text: "Please confirm that you understand this will overwrite current database records.",
      });
      return;
    }

    setIsRestoring(true);
    setBackupMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", restoreFile);

      const response = await fetch("/api/restore", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to restore database from file.");
      }

      setBackupMessage({
        type: "success",
        text: "Database restored successfully! Reloading data...",
      });

      setRestoreFile(null);
      setRestoreConfirmed(false);
      if (fileInputRef.current) fileInputRef.current.value = "";

      await reloadStats();
    } catch (error) {
      setBackupMessage({
        type: "error",
        text: error instanceof Error ? error.message : "An error occurred during restore.",
      });
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl pb-16">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-slate-800" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">System Settings & Data Backup</h1>
        </div>
        <p className="text-sm text-slate-600">
          Configure business metadata for PDF documents, manage local database backups, and monitor cloud synchronization.
        </p>
      </div>

      {statusMessage && (
        <div
          className={`rounded-lg p-3.5 text-xs flex items-center gap-2 border ${
            statusMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Business Profile */}
      <form onSubmit={handleProfileSubmit} className="space-y-6">
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-emerald-700" />
              Company Details (PDF & Document Headers)
            </CardTitle>
            <CardDescription className="text-xs">
              This information is printed at the top of all invoices, purchase orders, delivery orders, and statements.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-4 text-xs">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="bname" className="text-xs font-semibold">Business Name *</Label>
                <Input
                  id="bname"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Paper Trade Co."
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="bphone" className="text-xs font-semibold">Phone / WhatsApp *</Label>
                <Input
                  id="bphone"
                  value={businessPhone}
                  onChange={(e) => setBusinessPhone(e.target.value)}
                  placeholder="e.g. +92 300 1234567"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="bemail" className="text-xs font-semibold">Business Email</Label>
                <Input
                  id="bemail"
                  type="email"
                  value={businessEmail}
                  onChange={(e) => setBusinessEmail(e.target.value)}
                  placeholder="e.g. sales@papertrade.com"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="baddress" className="text-xs font-semibold">Address / Location</Label>
                <Input
                  id="baddress"
                  value={businessAddress}
                  onChange={(e) => setBusinessAddress(e.target.value)}
                  placeholder="e.g. Station Road, Paper Market"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={saving || loading}
                className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs shadow-sm"
              >
                <Save className="mr-1.5 h-4 w-4" />
                {saving ? "Saving Changes..." : "Save Company Details"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Production Backup & Safety Control Center (OWNER Only) */}
      <Card className="border-slate-200 bg-white shadow-xs">
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Database Backup & Safety Center
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Protection Active
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void reloadStats();
                  void reloadLogs();
                }}
                disabled={statsLoading || logsLoading}
                className="h-7 text-xs px-2 text-slate-600"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${statsLoading || logsLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs text-slate-500">
            Automated daily database backups scheduled everyday at 4:00 PM with 30-day retention and cloud sync.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-4 space-y-5 text-xs">
          {/* Schedule & Safety Summary Banner */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="p-3.5 rounded-xl border border-emerald-100 bg-emerald-50/40 flex items-start gap-3">
              <Clock className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] uppercase font-bold text-emerald-800 tracking-wider">
                  Automatic Daily Backup
                </div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  Everyday at 4:00 PM
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Runs silently in the background via Windows Task Scheduler.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-sky-100 bg-sky-50/40 flex items-start gap-3">
              <HardDrive className="h-5 w-5 text-sky-700 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] uppercase font-bold text-sky-800 tracking-wider">
                  Backup Storage
                </div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  C:\PaperTradeBackups
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Stored safely on local hard drive & synced to Google Drive.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-start gap-3">
              <Calendar className="h-5 w-5 text-slate-700 shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-700 tracking-wider">
                  Last Backup Created
                </div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  {dbStats?.lastBackupAt ? formatDateTime(dbStats.lastBackupAt) : "Recently Completed"}
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Keeps 30 days of history with automatic clean-up.
                </p>
              </div>
            </div>
          </div>

          {/* Business Data Snapshot */}
          <div className="p-3 bg-slate-50/80 border border-slate-200 rounded-xl">
            <div className="text-[11px] font-bold text-slate-700 mb-2 uppercase tracking-wide">
              Records Currently Protected in Database:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Products</span>
                <div className="text-base font-bold text-slate-800">{dbStats ? dbStats.productsCount : "—"}</div>
              </div>
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Parties</span>
                <div className="text-base font-bold text-slate-800">{dbStats ? dbStats.partiesCount : "—"}</div>
              </div>
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Sales Invoices</span>
                <div className="text-base font-bold text-slate-800">{dbStats ? dbStats.salesCount : "—"}</div>
              </div>
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Purchases</span>
                <div className="text-base font-bold text-slate-800">{dbStats ? dbStats.purchasesCount : "—"}</div>
              </div>
              <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs col-span-2 sm:col-span-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Ledger Entries</span>
                <div className="text-base font-bold text-slate-800">{dbStats ? dbStats.ledgerCount : "—"}</div>
              </div>
            </div>
          </div>

          {/* Section: One-Click Instant Backup Button */}
          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <Database className="h-4 w-4 text-emerald-700" />
                  Instant Backup
                </h3>
                <p className="text-slate-600 text-xs mt-0.5">
                  Want an immediate backup right now before making major changes or shutting down? Click below:
                </p>
              </div>

              <Button
                onClick={handleManualBackupNow}
                disabled={isManualBackingUp || !isOwner}
                className="bg-emerald-700 text-white hover:bg-emerald-800 text-xs shadow-sm font-bold whitespace-nowrap shrink-0 h-9 px-4"
              >
                <RefreshCw className={`mr-1.5 h-4 w-4 ${isManualBackingUp ? "animate-spin" : ""}`} />
                {isManualBackingUp ? "Backing Up Records..." : "Create Backup Now"}
              </Button>
            </div>

            {/* Visual Feedback on Manual Backup Result */}
            {manualBackupResult && (
              <div
                className={`rounded-lg p-3 text-xs border ${
                  manualBackupResult.success
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-rose-50 border-rose-200 text-rose-900"
                }`}
              >
                <div className="flex items-start gap-2">
                  {manualBackupResult.success ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <p className="font-bold text-xs">
                      {manualBackupResult.success
                        ? "Backup created and saved safely!"
                        : "Backup failed. See details below."}
                    </p>
                    {manualBackupResult.local && (
                      <p className="text-[11px] text-slate-700">
                        Saved file: <strong>{manualBackupResult.local.filename}</strong> ({manualBackupResult.local.fileSizeFormatted}) in <code>C:\PaperTradeBackups\local</code>
                      </p>
                    )}
                    {manualBackupResult.partial && (
                      <p className="text-[11px] text-amber-800">
                        Note: Local backup was saved successfully. Cloud sync will activate once Rclone is configured.
                      </p>
                    )}
                    {manualBackupResult.error && !manualBackupResult.success && (
                      <p className="text-[11px] text-rose-700 bg-rose-100/60 p-2 rounded mt-1 font-mono break-all">
                        {manualBackupResult.error}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {manualBackupError && (
              <div className="rounded-lg p-3 text-xs bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Backup Notice: </span>
                  <span>{manualBackupError}</span>
                </div>
              </div>
            )}
          </div>

          {/* Section: Friendly Recent Backup History */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCheck className="h-4 w-4 text-slate-700" />
                <h3 className="font-bold text-slate-900 text-xs">Recent Backup History</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={reloadLogs}
                disabled={logsLoading}
                className="h-6 text-[11px] text-slate-500 hover:text-slate-900 px-2"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${logsLoading ? "animate-spin" : ""}`} />
                Refresh History
              </Button>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-2xs">
              {backupLogs.length === 0 ? (
                <div className="p-4 text-center text-slate-500 text-xs">
                  No backup records found yet. Scheduled runs will appear here automatically.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                  {backupLogs.slice(0, 8).map((log, idx) => (
                    <div key={idx} className="p-2.5 hover:bg-slate-50 flex items-center justify-between text-xs gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            log.status === "SUCCESS"
                              ? "bg-emerald-500"
                              : log.status === "PARTIAL"
                              ? "bg-amber-500"
                              : "bg-rose-500"
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 truncate">
                            {log.tag === "LOCAL"
                              ? "Daily Scheduled Backup"
                              : log.tag === "CLOUD"
                              ? "Cloud Backup"
                              : "Manual Backup"}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">{log.message}</div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[11px] text-slate-400 block font-mono">
                          {log.timestamp}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded inline-block mt-0.5 ${
                            log.status === "SUCCESS"
                              ? "bg-emerald-100 text-emerald-800"
                              : log.status === "PARTIAL"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {log.status === "SUCCESS" ? "Completed" : log.status === "PARTIAL" ? "Notice" : "Failed"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Section: Secondary USB Download & Database Restore */}
          <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-slate-100">
            {/* Download ad-hoc snapshot */}
            <div className="space-y-2 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-slate-800" />
                <h3 className="font-bold text-slate-900 text-xs">Save Copy to Computer / USB</h3>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                Download a single file snapshot directly through your web browser to copy to a USB pen drive.
              </p>
              <div className="pt-1">
                <Button
                  onClick={handleDownloadBackup}
                  disabled={isBackingUp}
                  variant="outline"
                  className="w-full text-xs h-8"
                >
                  <Download className={`mr-2 h-3.5 w-3.5 ${isBackingUp ? "animate-bounce" : ""}`} />
                  {isBackingUp ? "Saving Copy..." : "Download File (.sql)"}
                </Button>
              </div>
            </div>

            {/* Restore from SQL file */}
            <form onSubmit={handleRestoreSubmit} className="space-y-2 p-3.5 rounded-xl border border-amber-200 bg-amber-50/30">
              <div className="flex items-center gap-2">
                <UploadCloud className="h-4 w-4 text-amber-800" />
                <h3 className="font-bold text-slate-900 text-xs">Restore Records from Backup File</h3>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                Upload a previously saved <code>.sql</code> file to restore data on this computer.
              </p>

              <div className="space-y-2 pt-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".sql"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setRestoreFile(file);
                    setRestoreConfirmed(false);
                  }}
                  className="block w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-amber-100 file:text-amber-900 hover:file:bg-amber-200 cursor-pointer"
                />

                {restoreFile && (
                  <div className="p-2 rounded-md border border-amber-200 bg-amber-100/50 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                      <FileCheck className="h-3.5 w-3.5" />
                      <span>{restoreFile.name} ({(restoreFile.size / 1024).toFixed(1)} KB)</span>
                    </div>

                    <label className="flex items-start gap-2 text-[11px] text-amber-950 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={restoreConfirmed}
                        onChange={(e) => setRestoreConfirmed(e.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                      />
                      <span>
                        <AlertTriangle className="inline h-3 w-3 text-amber-700 mr-1" />
                        I understand this will overwrite current records with the data in this file.
                      </span>
                    </label>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={!restoreFile || !restoreConfirmed || isRestoring}
                  className="w-full bg-amber-800 text-white hover:bg-amber-700 text-xs h-8 shadow-xs"
                >
                  <UploadCloud className="mr-2 h-3.5 w-3.5" />
                  {isRestoring ? "Restoring Records..." : "Confirm & Restore Records"}
                </Button>
              </div>
            </form>
          </div>

          {backupMessage && (
            <div
              className={`rounded-lg p-3 text-xs flex items-center gap-2 border ${
                backupMessage.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border-rose-200 text-rose-800"
              }`}
            >
              {backupMessage.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              )}
              <span>{backupMessage.text}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
