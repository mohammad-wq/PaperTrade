import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { canAccessPath } from "@/lib/auth/permissions";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    if (!token) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    const role = token.role as Role;
    if (!canAccessPath(role, pathname)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => {
        if (!token) return false;
        const now = Math.floor(Date.now() / 1000);
        if (typeof token.exp === "number" && token.exp < now) {
          return false;
        }
        return true;
      },
    },
    pages: {
      signIn: "/login",
    },
  },
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/products/:path*",
    "/parties/:path*",
    "/inventory/:path*",
    "/purchase-orders/:path*",
    "/purchases/:path*",
    "/delivery-orders/:path*",
    "/sales/:path*",
    "/returns/:path*",
    "/payments/:path*",
    "/reports/:path*",
    "/financial-reports/:path*",
    "/calculator/:path*",
    "/stock-movements/:path*",
    "/ledger/:path*",
    "/storage-charges/:path*",
    "/settings/:path*",
    "/users/:path*",
  ],
};
