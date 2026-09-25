import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { NextRequest } from "next/server";

const handler = NextAuth(authOptions);

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  return (handler as any)(req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  return (handler as any)(req, context);
}
