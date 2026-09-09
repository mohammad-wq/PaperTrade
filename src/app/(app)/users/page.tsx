"use client";

import { useEffect, useState } from "react";
import {
  ShieldAlert,
  Plus,
  UserCheck,
  UserX,
  AlertCircle,
  X,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listUsersAction, createUserAction, toggleUserActiveAction } from "@/actions/users";
import { Role } from "@prisma/client";
import { format } from "date-fns";

type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(Role.STAFF);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await listUsersAction();
      if (res.success && res.data) {
        setUsers(res.data as UserRecord[]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleToggle(id: string) {
    const res = await toggleUserActiveAction({ id });
    if (res.success) {
      await loadUsers();
    } else {
      alert(res.error || "Failed to toggle user status.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!name.trim() || !email.trim() || !password) {
      setFormError("All fields are required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createUserAction({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        isActive: true,
      });

      if (!res.success) {
        setFormError(res.error || "Failed to create user.");
      } else {
        setIsDialogOpen(false);
        setName("");
        setEmail("");
        setPassword("");
        setRole(Role.STAFF);
        await loadUsers();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function getRoleBadge(r: Role) {
    switch (r) {
      case Role.OWNER:
        return <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 border border-amber-300">OWNER</span>;
      case Role.MANAGER:
        return <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-900 border border-sky-300">MANAGER</span>;
      case Role.STAFF:
        return <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-800 border border-slate-300">STAFF</span>;
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-800" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Staff & Users</h1>
          </div>
          <p className="text-sm text-slate-600">
            Manage owner, manager, and staff accounts with role-based access permissions.
          </p>
        </div>

        <Button
          onClick={() => setIsDialogOpen(true)}
          className="bg-amber-800 text-white hover:bg-amber-700 shadow-sm"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add User Account
        </Button>
      </div>

      {/* Users List */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">Loading users...</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {users.map((user) => (
            <Card key={user.id} className="border-slate-200 bg-white flex flex-col justify-between hover:shadow-md transition-shadow">
              <CardHeader className="pb-3 border-b border-slate-100">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">{user.name}</CardTitle>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                  {getRoleBadge(user.role)}
                </div>
              </CardHeader>

              <CardContent className="py-3 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Status:</span>
                  <span className={`font-semibold ${user.isActive ? "text-emerald-700" : "text-rose-600"}`}>
                    {user.isActive ? "Active Account" : "Deactivated"}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Created:</span>
                  <span>{format(new Date(user.createdAt), "dd MMM yyyy")}</span>
                </div>
              </CardContent>

              <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end rounded-b-xl">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleToggle(user.id)}
                  className={`h-7 text-[11px] ${user.isActive ? "text-rose-700 hover:bg-rose-50" : "text-emerald-700 hover:bg-emerald-50"}`}
                >
                  {user.isActive ? (
                    <>
                      <UserX className="mr-1 h-3.5 w-3.5" />
                      Deactivate
                    </>
                  ) : (
                    <>
                      <UserCheck className="mr-1 h-3.5 w-3.5" />
                      Activate
                    </>
                  )}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add User Modal */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Add User Account</h2>
                <p className="text-xs text-slate-500">Create staff or manager login credentials</p>
              </div>
              <button
                onClick={() => setIsDialogOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
              <div className="space-y-1">
                <Label htmlFor="uname" className="text-xs font-semibold">Full Name *</Label>
                <Input
                  id="uname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Tariq Mehmood"
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="uemail" className="text-xs font-semibold">Email Address *</Label>
                <Input
                  id="uemail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. tariq@papertrade.com"
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="upass" className="text-xs font-semibold">Password *</Label>
                <Input
                  id="upass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="urole" className="text-xs font-semibold">Account Role *</Label>
                <select
                  id="urole"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
                >
                  <option value={Role.STAFF}>Staff (Data Entry & Orders)</option>
                  <option value={Role.MANAGER}>Manager (Operational Control)</option>
                  <option value={Role.OWNER}>Owner (Full Unrestricted Access)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="bg-amber-800 text-white hover:bg-amber-700 text-xs">
                  {submitting ? "Creating..." : "Create Account"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
