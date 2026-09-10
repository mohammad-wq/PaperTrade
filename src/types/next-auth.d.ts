import { NextAuthOptions, DefaultSession } from "next-auth";
import { Role } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      loginAt?: number;
      lastActive?: number;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    loginAt?: number;
    lastActive?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    loginAt?: number;
    lastActive?: number;
  }
}

export type AuthOptions = NextAuthOptions;
