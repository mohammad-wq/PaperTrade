import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/db";
import { Role } from "@prisma/client";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";

function findPsqlPath(): string {
  if (process.platform === "win32") {
    const candidates = [
      "psql.exe",
      "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe",
      "C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe",
      "C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe",
      "C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe",
    ];
    for (const p of candidates) {
      if (p === "psql.exe" || existsSync(p)) return p;
    }
  }
  return "psql";
}

export async function POST(request: NextRequest) {
  // 1. Enforce Authentication and OWNER role
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== Role.OWNER) {
    return NextResponse.json({ success: false, error: "Unauthorized. Admin privileges required." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: "No SQL backup file provided." }, { status: 400 });
    }

    if (!file.name.endsWith(".sql")) {
      return NextResponse.json({ success: false, error: "Invalid file type. Please upload a .sql file." }, { status: 400 });
    }

    const sqlContent = await file.text();
    if (!sqlContent || sqlContent.trim().length < 20) {
      return NextResponse.json({ success: false, error: "Uploaded SQL file is empty or invalid." }, { status: 400 });
    }

    const dbUrl = process.env.DATABASE_URL;
    let restoredViaPsql = false;

    // 2. Try native psql execution via temp file if available
    if (dbUrl) {
      const tempPath = path.join(os.tmpdir(), `restore_${Date.now()}.sql`);
      try {
        await fs.writeFile(tempPath, sqlContent, "utf8");
        const psqlBin = findPsqlPath();
        await execAsync(`"${psqlBin}" "${dbUrl}" -f "${tempPath}"`, { timeout: 60000 });
        restoredViaPsql = true;
      } catch {
        // psql not available or failed; fallback to raw query execution below
      } finally {
        await fs.unlink(tempPath).catch(() => {});
      }
    }

    // 3. Fallback to executing statement-by-statement inside a Prisma transaction
    if (!restoredViaPsql) {
      const cleanSql = sqlContent
        .replace(/--.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

      const statements = cleanSql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => {
          if (!s) return false;
          const upper = s.toUpperCase();
          return upper !== "BEGIN" && upper !== "COMMIT";
        });

      await prisma.$transaction(
        async (tx) => {
          for (const statement of statements) {
            await tx.$executeRawUnsafe(statement);
          }
        },
        { timeout: 60000, maxWait: 10000 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Database restored successfully. Please refresh the application.",
    });
  } catch (error) {
    console.error("[Restore Error]:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "An error occurred while restoring the database.",
      },
      { status: 500 },
    );
  }
}

