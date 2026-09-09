"use client";

import { useEffect, useState, useRef } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSettingsAction, updateSettingsAction } from "@/actions/settings";
import { getDatabaseStatsAction } from "@/actions/backup";

type DatabaseStats = {
  productsCount: number;
  partiesCount: number;
  salesCount: number;
  purchasesCount: number;
  ledgerCount: number;
  lastBackupAt: string | null;
};

export default function SettingsPage() {
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Backup & Restore states
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [settingsRes, statsRes] = await Promise.all([
          getSettingsAction(),
          getDatabaseStatsAction(),
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

  async function handleDownloadBackup() {
    setIsBackingUp(true);
    setBackupMessage(null);

    try {
      const response = await fetch("/api/backup");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Backup failed with HTTP ${response.status}`);
      }

      // Extract filename from header or build timestamped name
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
        text: `Database backup downloaded successfully as "${filename}".`,
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
    <div className="space-y-6 max-w-4xl pb-12">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-slate-800" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">System Settings & Data Management</h1>
        </div>
        <p className="text-sm text-slate-600">
          Configure business metadata for PDF documents, manage local database backups, and restore data.
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

      {/* Database Backup & Restore Control Center */}
      <Card className="border-slate-200 bg-white shadow-xs">
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Database className="h-4 w-4 text-sky-700" />
              Database Backup & Restore (Local Storage)
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={reloadStats}
              disabled={statsLoading}
              className="h-7 text-xs px-2 text-slate-600"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${statsLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          <CardDescription className="text-xs">
            Export a full database snapshot (.sql) or restore an existing backup file. Running locally with PostgreSQL.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 space-y-6 text-xs">
          {backupMessage && (
            <div
              className={`rounded-lg p-3.5 text-xs flex items-center gap-2 border ${
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

          {/* Database Summary Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Products</div>
              <div className="text-lg font-bold text-slate-800 mt-0.5">
                {dbStats ? dbStats.productsCount : "—"}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Parties</div>
              <div className="text-lg font-bold text-slate-800 mt-0.5">
                {dbStats ? dbStats.partiesCount : "—"}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Sales Invoices</div>
              <div className="text-lg font-bold text-slate-800 mt-0.5">
                {dbStats ? dbStats.salesCount : "—"}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Purchases</div>
              <div className="text-lg font-bold text-slate-800 mt-0.5">
                {dbStats ? dbStats.purchasesCount : "—"}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center col-span-2 sm:col-span-1">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Ledger Records</div>
              <div className="text-lg font-bold text-slate-800 mt-0.5">
                {dbStats ? dbStats.ledgerCount : "—"}
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-500">
            <strong>Last Recorded Backup:</strong>{" "}
            {dbStats?.lastBackupAt ? new Date(dbStats.lastBackupAt).toLocaleString() : "No backup recorded yet"}
          </div>

          {/* Action Grid: Backup vs Restore */}
          <div className="grid gap-6 md:grid-cols-2 pt-2 border-t border-slate-100">
            {/* 1. Backup Section */}
            <div className="space-y-3 p-4 rounded-xl border border-sky-100 bg-sky-50/30">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-sky-800" />
                <h3 className="font-bold text-slate-900 text-sm">Download Database Backup</h3>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                Creates an immediate snapshot of all products, customers, suppliers, invoices, stock movements, and ledger balances. Save this file to a USB flash drive or external drive for safekeeping.
              </p>
              <div className="pt-2">
                <Button
                  onClick={handleDownloadBackup}
                  disabled={isBackingUp}
                  className="w-full bg-sky-800 text-white hover:bg-sky-700 text-xs shadow-xs"
                >
                  <Download className={`mr-2 h-4 w-4 ${isBackingUp ? "animate-bounce" : ""}`} />
                  {isBackingUp ? "Generating Backup (.sql)..." : "Backup Database Now (.sql)"}
                </Button>
              </div>
            </div>

            {/* 2. Restore Section */}
            <form onSubmit={handleRestoreSubmit} className="space-y-3 p-4 rounded-xl border border-amber-100 bg-amber-50/30">
              <div className="flex items-center gap-2">
                <UploadCloud className="h-4 w-4 text-amber-800" />
                <h3 className="font-bold text-slate-900 text-sm">Restore from Backup File</h3>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                Select a previously downloaded <code>.sql</code> backup file to restore all tables and records.
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
                  className="block w-full text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-amber-100 file:text-amber-900 hover:file:bg-amber-200 cursor-pointer"
                />

                {restoreFile && (
                  <div className="p-2.5 rounded-md border border-amber-200 bg-amber-100/50 space-y-2">
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
                        I understand that restoring will overwrite current database records with this file.
                      </span>
                    </label>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={!restoreFile || !restoreConfirmed || isRestoring}
                  className="w-full bg-amber-800 text-white hover:bg-amber-700 text-xs shadow-xs"
                >
                  <UploadCloud className="mr-2 h-4 w-4" />
                  {isRestoring ? "Restoring Database..." : "Confirm & Restore Database"}
                </Button>
              </div>
            </form>
          </div>

          {/* Automated / CLI Scripts Reference */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-slate-700" />
              <h4 className="text-xs font-bold text-slate-900">Command Line & Automated Backup Scripts</h4>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Included with the project are ready-to-use scripts to automate backups via Windows Task Scheduler or Linux cron:
            </p>
            <div className="grid gap-2 sm:grid-cols-2 text-[11px]">
              <div className="bg-slate-900 text-slate-100 p-2.5 rounded font-mono">
                <span className="text-slate-400 block text-[10px] uppercase">Windows</span>
                scripts\backup.bat
              </div>
              <div className="bg-slate-900 text-slate-100 p-2.5 rounded font-mono">
                <span className="text-slate-400 block text-[10px] uppercase">Linux / macOS</span>
                ./scripts/backup.sh
              </div>
            </div>
            <p className="text-[10px] text-slate-500">
              All backups generated by these scripts are saved automatically with date stamps into the <code>backups/</code> directory. See <code>SETUP.md</code> for schedule configuration instructions.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
