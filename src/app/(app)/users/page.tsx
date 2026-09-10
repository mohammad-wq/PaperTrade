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
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listUsersAction,
  createUserAction,
  updateUserAction,
  toggleUserActiveAction,
  updateUserPermissionsAction,
} from "@/actions/users";
import { MODULE_DEFINITIONS, normalizeUserPermissions, type UserPermissions } from "@/lib/auth/permissions";
import { Role } from "@prisma/client";
import { format } from "date-fns";

type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  permissions: UserPermissions;
  createdAt: Date;
};

const DEFAULT_PERMISSIONS = normalizeUserPermissions();

type PermissionAction = "view" | "create" | "update" | "delete";

function PermissionCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 shadow-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 rounded border-slate-300 text-amber-700 focus:ring-amber-600"
      />
      <span>{label}</span>
    </label>
  );
}

function PermissionEditor({
  value,
  onChange,
}: {
  value: UserPermissions;
  onChange: (moduleKey: string, action: PermissionAction) => void;
}) {
  return (
    <div className="space-y-2">
      {MODULE_DEFINITIONS.map(({ key, label }) => (
        <div key={key} className="rounded-xl border border-slate-200 bg-slate-50/50 p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-slate-800">{label}</p>
            <span className="rounded bg-white px-1.5 py-0.5 text-[9px] text-slate-500 border border-slate-200">
              {value[key]?.view ? "Visible" : "Hidden"}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <PermissionCheckbox
              label="View"
              checked={value[key]?.view ?? true}
              onChange={() => onChange(key, "view")}
            />
            <PermissionCheckbox
              label="Create"
              checked={value[key]?.create ?? true}
              onChange={() => onChange(key, "create")}
            />
            <PermissionCheckbox
              label="Update"
              checked={value[key]?.update ?? true}
              onChange={() => onChange(key, "update")}
            />
            <PermissionCheckbox
              label="Delete"
              checked={value[key]?.delete ?? true}
              onChange={() => onChange(key, "delete")}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(Role.STAFF);
  const [permissionDraft, setPermissionDraft] = useState<UserPermissions>(DEFAULT_PERMISSIONS);

  const [formError, setFormError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);

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

  function resetCreateForm() {
    setName("");
    setEmail("");
    setPassword("");
    setRole(Role.STAFF);
    setPermissionDraft(DEFAULT_PERMISSIONS);
  }

  function openCreateDialog() {
    setEditingUser(null);
    resetCreateForm();
    setFormError(null);
    setIsDialogOpen(true);
  }

  function openEditDialog(user: UserRecord) {
    setEditingUser(user);
    setName(user.name);
    setEmail(user.email);
    setPassword("");
    setRole(user.role);
    setPermissionDraft(normalizeUserPermissions(user.permissions));
    setFormError(null);
    setIsDialogOpen(true);
  }

  function updatePermission(moduleKey: string, action: PermissionAction) {
    setPermissionDraft((current) => {
      const existing = current[moduleKey] ?? { ...DEFAULT_PERMISSIONS[moduleKey] };
      return {
        ...current,
        [moduleKey]: {
          ...existing,
          [action]: !existing[action],
        },
      };
    });
  }

  function openPermissionEditor(user: UserRecord) {
    setSelectedUser(user);
    setPermissionDraft(normalizeUserPermissions(user.permissions));
    setPermissionError(null);
  }

  async function handleToggle(id: string) {
    if (!window.confirm("Are you sure you want to change this user's active status?")) return;
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

    if (!name.trim() || !email.trim()) {
      setFormError("Name and email are required.");
      return;
    }
    if (!editingUser && !password) {
      setFormError("Password is required for new accounts.");
      return;
    }

    const actionPrompt = editingUser
      ? `Confirm: update user account for ${name}?`
      : "Confirm: create this user account?";
    if (!window.confirm(actionPrompt)) return;

    setSubmitting(true);
    try {
      const res = editingUser
        ? await updateUserAction({
            id: editingUser.id,
            name: name.trim(),
            email: email.trim().toLowerCase(),
            role,
            isActive: editingUser.isActive,
            password: password.trim() ? password : undefined,
            permissions: permissionDraft,
          })
        : await createUserAction({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            password,
            role,
            isActive: true,
            permissions: permissionDraft,
          });

      if (!res.success) {
        setFormError(res.error || (editingUser ? "Failed to update user." : "Failed to create user."));
      } else {
        setIsDialogOpen(false);
        setEditingUser(null);
        resetCreateForm();
        await loadUsers();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSavePermissions() {
    if (!selectedUser) return;
    if (!window.confirm(`Save updated permissions for ${selectedUser.name}?`)) return;

    setPermissionError(null);
    setSavingPermissions(true);
    try {
      const res = await updateUserPermissionsAction({
        id: selectedUser.id,
        permissions: permissionDraft,
      });

      if (!res.success) {
        setPermissionError(res.error || "Failed to update permissions.");
        return;
      }

      setSelectedUser(null);
      await loadUsers();
    } finally {
      setSavingPermissions(false);
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
          onClick={openCreateDialog}
          className="bg-amber-800 text-white hover:bg-amber-700 shadow-sm"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add User Account
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">Loading users...</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

              <CardContent className="py-3 space-y-3 text-xs">
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

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-700">Access Summary</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openPermissionEditor(user)}
                      className="h-6 px-2 text-[10px]"
                    >
                      Configure
                    </Button>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {MODULE_DEFINITIONS.slice(0, 6).map(({ key, label }) => (
                      <span
                        key={key}
                        className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${user.permissions[key]?.view ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}
                      >
                        {label}
                      </span>
                    ))}
                    {MODULE_DEFINITIONS.length > 6 && (
                      <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                        +{MODULE_DEFINITIONS.length - 6} more
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>

              <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-2 rounded-b-xl">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openEditDialog(user)}
                  className="h-7 text-[11px] text-slate-700 hover:bg-slate-100"
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Edit
                </Button>
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

      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {editingUser ? "Edit User Account" : "Add User Account"}
                </h2>
                <p className="text-xs text-slate-500">
                  {editingUser
                    ? `Update profile, role, password or permissions for ${editingUser.name}`
                    : "Create staff or manager login credentials"}
                </p>
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
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="uname" className="text-xs font-semibold">
                    Full Name <span className="text-rose-500">*</span>
                  </Label>
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
                  <Label htmlFor="urole" className="text-xs font-semibold">
                    Account Role <span className="text-rose-500">*</span>
                  </Label>
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
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="uemail" className="text-xs font-semibold">
                    Email Address <span className="text-rose-500">*</span>
                  </Label>
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
                  <Label htmlFor="upass" className="text-xs font-semibold">
                    Password{" "}
                    {editingUser ? (
                      <span className="font-normal text-slate-500">(leave blank to keep current)</span>
                    ) : (
                      <span className="text-rose-500">*</span>
                    )}
                  </Label>
                  <Input
                    id="upass"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editingUser ? "Leave blank to keep current password" : "Minimum 6 characters"}
                    className="h-8 text-xs"
                    required={!editingUser}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold text-slate-800">Access Settings</p>
                    <p className="text-[10px] text-slate-500">Configure what this account can view and manage.</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    <Lock className="h-3 w-3" />
                    Restricted by role
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto pr-1">
                  <PermissionEditor value={permissionDraft} onChange={updatePermission} />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="bg-amber-800 text-white hover:bg-amber-700 text-xs">
                  {editingUser
                    ? submitting
                      ? "Saving..."
                      : "Save Changes"
                    : submitting
                    ? "Creating..."
                    : "Create Account"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Configure Access</h2>
                <p className="text-xs text-slate-500">Update permissions for {selectedUser.name}</p>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {permissionError && (
              <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{permissionError}</span>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold text-slate-800">Module Permissions</p>
                  <p className="text-[10px] text-slate-500">Toggle visibility and action rights for each module.</p>
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  {selectedUser.role}
                </div>
              </div>
              <div className="max-h-[62vh] overflow-y-auto pr-1">
                <PermissionEditor value={permissionDraft} onChange={updatePermission} />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button type="button" variant="outline" onClick={() => setSelectedUser(null)} className="text-xs">
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSavePermissions}
                disabled={savingPermissions}
                className="bg-amber-800 text-white hover:bg-amber-700 text-xs"
              >
                {savingPermissions ? "Saving..." : "Save Permissions"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
