import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { NextRequest } from "next/server";

const handler = NextAuth(authOptions);

function stripCookieExpiry(res: Response): Response {
  let cookies: string[] = [];
  if (typeof (res.headers as any).getSetCookie === "function") {
    cookies = (res.headers as any).getSetCookie();
  } else {
    const raw = res.headers.get("set-cookie");
    if (raw) cookies = [raw];
  }

  if (!cookies || cookies.length === 0) {
    return res;
  }

  const modifiedCookies = cookies.map((cookieStr) => {
    // Only target NextAuth session token cookies (standard, secure, or chunked)
    if (!cookieStr.toLowerCase().includes("session-token")) {
      return cookieStr;
    }
    // If it's an explicit deletion/invalidation cookie (Max-Age=0 or Epoch 1970), preserve it for logout
    if (/max-age=0/i.test(cookieStr) || /1970/i.test(cookieStr)) {
      return cookieStr;
    }
    // Strip Expires and Max-Age so the cookie is strictly held in RAM as a session cookie
    return cookieStr
      .replace(/;\s*expires=[^;]+/gi, "")
      .replace(/;\s*max-age=[^;]+/gi, "");
  });

  res.headers.delete("set-cookie");
  for (const cookie of modifiedCookies) {
    res.headers.append("set-cookie", cookie);
  }

  return res;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  const res: Response = await (handler as any)(req, context);
  return stripCookieExpiry(res);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  const res: Response = await (handler as any)(req, context);
  return stripCookieExpiry(res);
}

