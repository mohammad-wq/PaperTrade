import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logServerError } from "@/lib/errors";
import { checkRateLimit, clearRateLimit } from "@/lib/rate-limit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Dummy hash used for constant-time comparison when email is not found,
// preventing user enumeration attacks via timing analysis.
const DUMMY_HASH = "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4h/4J6YV4y";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 2 * 60 * 60, // 2 hours maximum session lifetime
  },
  jwt: {
    maxAge: 2 * 60 * 60, // Keep JWT lifetime aligned with the session cookie
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials, req) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        // Rate limiting: allow 15 attempts per 15 minutes to avoid locking legitimate users
        const normalizedEmail = parsed.data.email.toLowerCase().trim();
        const rateKey = `login:email:${normalizedEmail}`;
        const emailRateLimit = checkRateLimit(rateKey, 15, 15 * 60 * 1000);
        if (!emailRateLimit.success) {
          logServerError({
            scope: "auth.rate_limit",
            error: new Error(`Too many login attempts for email: ${normalizedEmail}. Account temporarily throttled.`),
          });
          return null;
        }

        try {
          const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
          });

          if (!user || !user.isActive) {
            // Mitigate timing attack: run bcrypt compare even if user does not exist
            await compare(parsed.data.password, DUMMY_HASH);
            return null;
          }

          const valid = await compare(parsed.data.password, user.passwordHash);
          if (!valid) {
            return null;
          }

          // Clear rate limit counter immediately on valid credentials
          clearRateLimit(rateKey);

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            permissions: (user.permissions ?? undefined) as any,
          };
        } catch (error) {
          logServerError({ scope: "auth.authorize", error });
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      const now = Math.floor(Date.now() / 1000);
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.permissions = user.permissions;
        token.loginAt = now;
        token.lastActive = now;
      }
      if (trigger === "update") {
        token.lastActive = now;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role;
        session.user.permissions = token.permissions as any;
        session.user.loginAt = token.loginAt;
        session.user.lastActive = token.lastActive;
      }
      return session;
    },
  },
};
