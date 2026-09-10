import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { NextRequest } from "next/server";

const nextAuthHandler = NextAuth(authOptions);

function convertToSessionCookies(response: Response): Response {
  const getSetCookieFn = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  let rawCookies: string[] = [];

  if (typeof getSetCookieFn === "function") {
    rawCookies = getSetCookieFn.call(response.headers);
  } else {
    const single = response.headers.get("set-cookie");
    if (single) {
      rawCookies = [single];
    }
  }

  if (!rawCookies || rawCookies.length === 0) {
    return response;
  }

  const isTargetCookie = (cookieStr: string) => cookieStr.includes("next-auth.session-token");
  if (!rawCookies.some(isTargetCookie)) {
    return response;
  }

  const newHeaders = new Headers(response.headers);
  newHeaders.delete("set-cookie");

  for (const cookieStr of rawCookies) {
    if (isTargetCookie(cookieStr)) {
      const isDeletion =
        /Max-Age=0/i.test(cookieStr) ||
        /Expires=[^;]*1970/i.test(cookieStr) ||
        /=\s*;/i.test(cookieStr);

      if (!isDeletion) {
        // Strip Expires and Max-Age so it acts as a browser-session-only cookie
        const sessionCookie = cookieStr
          .replace(/Expires=[^;]+;?\s*/gi, "")
          .replace(/Max-Age=[^;]+;?\s*/gi, "")
          .replace(/;\s*;/g, ";")
          .trim()
          .replace(/;$/, "");
        newHeaders.append("set-cookie", sessionCookie);
        continue;
      }
    }
    newHeaders.append("set-cookie", cookieStr);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

async function handler(req: NextRequest, ctx: { params: { nextauth: string[] } }) {
  const response = await nextAuthHandler(req, ctx);
  return convertToSessionCookies(response);
}

export { handler as GET, handler as POST };
