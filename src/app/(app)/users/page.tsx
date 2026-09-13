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
  Eye,
  EyeOff,
  Crown,
  Briefcase,
  User,
  Mail,
  Key,
  CheckCircle2,
  SlidersHorizontal,
  RotateCcw,
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

const MODULE_CATEGORIES = [
  {
    name: "Overview & Utilities",
    description: "Executive dashboards and calculation tools",
    keys: ["dashboard", "calculator"],
  },
  {
    name: "Master Directory",
    description: "Customer accounts, paper suppliers, and paper catalog",
    keys: ["products", "parties"],
  },
  {
    name: "Trading & Orders",
    description: "Invoicing, purchase orders, deliveries, and returns",
    keys: ["sales", "purchases", "purchase-orders", "delivery-orders", "returns"],
  },
  {
    name: "Inventory & Warehouses",
    description: "Real-time stock, tonnage tracking, and godown storage fees",
    keys: ["inventory", "stock-movements", "storage-charges"],
  },
  {
    name: "Finance & Accounting",
    description: "Party cash flows, operational expenses, party ledgers, and financial reports",
    keys: ["payments", "expenses", "ledger", "reports"],
  },
  {
    name: "System Administration",
    description: "User credentials, access control, and firm configuration",
    keys: ["users", "settings"],
  },
];

function getPresetPermissionsForRole(r: Role): UserPermissions {
  const result = normalizeUserPermissions();
  if (r === Role.OWNER) {
    return result;
  }
  if (r === Role.MANAGER) {
    for (const key of Object.keys(result)) {
      if (key === "users" || key === "settings") {
        result[key] = { view: false, create: false, update: false, delete: false };
      } else {
        result[key] = { view: true, create: true, update: true, delete: true };
      }
    }
    return result;
  }
  // STAFF
  for (const key of Object.keys(result)) {
    if (["users", "settings", "expenses"].includes(key)) {
      result[key] = { view: false, create: false, update: false, delete: false };
    } else if (["reports", "ledger"].includes(key)) {
      result[key] = { view: true, create: false, update: false, delete: false };
    } else {
      result[key] = { view: true, create: true, update: true, delete: false };
    }
  }
  return result;
}

function PermissionCheckbox({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all select-none cursor-pointer ${
        disabled
          ? "opacity-50 cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
          : checked
          ? "border-emerald-300 bg-emerald-50/80 text-emerald-900 shadow-xs hover:bg-emerald-100"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 accent-emerald-600"
      />
      <span>{label}</span>
    </label>
  );
}

function CategorizedPermissionEditor({
  value,
  onChange,
  onBatchChange,
}: {
  value: UserPermissions;
  onChange: (moduleKey: string, action: PermissionAction) => void;
  onBatchChange: (moduleKeys: string[], allowAll: boolean) => void;
}) {
  const moduleMap = new Map<string, (typeof MODULE_DEFINITIONS)[number]>(
    MODULE_DEFINITIONS.map((m) => [m.key, m]),
  );

  return (
    <div className="space-y-4">
      {MODULE_CATEGORIES.map((cat) => {
        const catModules = cat.keys
          .map((k) => moduleMap.get(k))
          .filter((m): m is NonNullable<typeof m> => !!m);

        const allViewEnabled = catModules.every((m) => value[m.key]?.view);

        return (
          <div
            key={cat.name}
            className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs transition-colors hover:border-slate-300"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 pb-2.5 mb-2.5 border-b border-slate-100">
              <div>
                <h4 className="text-xs font-bold text-slate-900">{cat.name}</h4>
                <p className="text-[10px] text-slate-500">{cat.description}</p>
              </div>
              <div className="flex items-center gap-1.5 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => onBatchChange(cat.keys, true)}
                  className="rounded px-2 py-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors border border-emerald-200"
                >
                  Enable All
                </button>
                <button
                  type="button"
                  onClick={() => onBatchChange(cat.keys, false)}
                  className="rounded px-2 py-0.5 text-[10px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors border border-slate-200"
                >
                  Disable All
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {catModules.map(({ key, label }) => {
                const perms = value[key] ?? { view: false, create: false, update: false, delete: false };
                const isViewActive = perms.view;

                return (
                  <div
                    key={key}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg p-2 transition-colors ${
                      isViewActive ? "bg-slate-50/70 border border-slate-100" : "bg-slate-50/30 border border-transparent opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-[130px]">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          isViewActive ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                      />
                      <span className="text-xs font-semibold text-slate-800">{label}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <PermissionCheckbox
                        label="View"
                        checked={perms.view}
                        onChange={() => onChange(key, "view")}
                      />
                      <PermissionCheckbox
                        label="Create"
                        checked={perms.create}
                        disabled={!isViewActive}
                        onChange={() => onChange(key, "create")}
                      />
                      <PermissionCheckbox
                        label="Update"
                        checked={perms.update}
                        disabled={!isViewActive}
                        onChange={() => onChange(key, "update")}
                      />
                      <PermissionCheckbox
                        label="Delete"
                        checked={perms.delete}
                        disabled={!isViewActive}
                        onChange={() => onChange(key, "delete")}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
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
  const [showPassword, setShowPassword] = useState(false);
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
    setShowPassword(false);
    setRole(Role.STAFF);
    setPermissionDraft(getPresetPermissionsForRole(Role.STAFF));
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
    setShowPassword(false);
    setRole(user.role);
    setPermissionDraft(normalizeUserPermissions(user.permissions));
    setFormError(null);
    setIsDialogOpen(true);
  }

  function handleRoleSelect(newRole: Role) {
    setRole(newRole);
    // Automatically apply recommended permission preset on new users, or notify
    if (!editingUser) {
      setPermissionDraft(getPresetPermissionsForRole(newRole));
    }
  }

  function applyPresetForCurrentRole() {
    setPermissionDraft(getPresetPermissionsForRole(role));
  }

  function updatePermission(moduleKey: string, action: PermissionAction) {
    setPermissionDraft((current) => {
      const existing = current[moduleKey] ?? { ...DEFAULT_PERMISSIONS[moduleKey] };
      const updatedValue = !existing[action];

      // If view is turned off, also turn off create, update, delete
      if (action === "view" && !updatedValue) {
        return {
          ...current,
          [moduleKey]: {
            view: false,
            create: false,
            update: false,
            delete: false,
          },
        };
      }

      // If action is create/update/delete and turning on, ensure view is also on
      if (action !== "view" && updatedValue) {
        return {
          ...current,
          [moduleKey]: {
            ...existing,
            view: true,
            [action]: true,
          },
        };
      }

      return {
        ...current,
        [moduleKey]: {
          ...existing,
          [action]: updatedValue,
        },
      };
    });
  }

  function batchUpdatePermissions(moduleKeys: string[], allowAll: boolean) {
    setPermissionDraft((current) => {
      const next = { ...current };
      for (const key of moduleKeys) {
        next[key] = {
          view: allowAll,
          create: allowAll,
          update: allowAll,
          delete: allowAll,
        };
      }
      return next;
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
      setFormError("Full name and email address are required.");
      return;
    }
    if (!editingUser && !password) {
      setFormError("Password is required for new accounts.");
      return;
    }
    if (!editingUser && password.length < 6) {
      setFormError("Password must be at least 6 characters long.");
      return;
    }

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
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900 border border-amber-300">
            <Crown className="h-3 w-3 text-amber-700" />
            OWNER
          </span>
        );
      case Role.MANAGER:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold text-sky-900 border border-sky-300">
            <Briefcase className="h-3 w-3 text-sky-700" />
            MANAGER
          </span>
        );
      case Role.STAFF:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-800 border border-slate-300">
            <User className="h-3 w-3 text-slate-600" />
            STAFF
          </span>
        );
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-emerald-800" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Staff & Users</h1>
          </div>
          <p className="text-sm text-slate-600">
            Manage owner, manager, and staff credentials with fine-grained role permissions.
          </p>
        </div>

        <Button
          onClick={openCreateDialog}
          className="bg-emerald-800 text-white hover:bg-emerald-700 shadow-sm"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add User Account
        </Button>
      </div>

      {/* User Directory Cards */}
      {loading ? (
        <Card className="border-slate-200">
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            Loading user accounts...
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {users.map((user) => (
            <Card
              key={user.id}
              className="border-slate-200 bg-white flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <CardHeader className="pb-3 border-b border-slate-100">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <CardTitle className="text-base font-bold text-slate-900">{user.name}</CardTitle>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <Mail className="h-3 w-3 text-slate-400" />
                      {user.email}
                    </p>
                  </div>
                  {getRoleBadge(user.role)}
                </div>
              </CardHeader>

              <CardContent className="py-3 space-y-3 text-xs">
                <div className="flex justify-between items-center text-slate-600">
                  <span>Account Status:</span>
                  <span
                    className={`inline-flex items-center gap-1 font-semibold ${
                      user.isActive ? "text-emerald-700" : "text-rose-600"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${user.isActive ? "bg-emerald-500" : "bg-rose-500"}`}
                    />
                    {user.isActive ? "Active Account" : "Deactivated"}
                  </span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>Registered:</span>
                  <span className="font-medium text-slate-800">
                    {format(new Date(user.createdAt), "dd/MM/yyyy")}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-700">Module Access</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openPermissionEditor(user)}
                      className="h-6 px-2 text-[10px] text-slate-700 hover:text-emerald-800"
                    >
                      <SlidersHorizontal className="mr-1 h-3 w-3" />
                      Configure
                    </Button>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {MODULE_DEFINITIONS.slice(0, 6).map(({ key, label }) => (
                      <span
                        key={key}
                        className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${
                          user.permissions[key]?.view
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-100 text-slate-400"
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                    {MODULE_DEFINITIONS.length > 6 && (
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-medium text-slate-500">
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
                  className="h-7 text-[11px] text-slate-700 hover:bg-white"
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Edit Profile
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleToggle(user.id)}
                  className={`h-7 text-[11px] ${
                    user.isActive
                      ? "text-rose-700 hover:bg-rose-50 border-rose-200"
                      : "text-emerald-700 hover:bg-emerald-50 border-emerald-200"
                  }`}
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

      {/* Create / Edit User Dialog */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs overflow-y-auto animate-in fade-in">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-800 border border-emerald-100">
                  {editingUser ? <Pencil className="h-5 w-5" /> : <User className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {editingUser ? "Edit User Profile" : "Create New User Account"}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {editingUser
                      ? `Update account details, security role, and module permissions for ${editingUser.name}`
                      : "Define account credentials, assign an organizational role, and customize module permissions."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDialogOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Error Banner */}
            {formError && (
              <div className="mx-6 mt-4 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Modal Body */}
            <form
              method="post"
              action="#"
              onSubmit={handleSubmit}
              className="flex flex-col flex-1 overflow-y-auto px-6 py-4 space-y-5 text-xs"
            >
              {/* Profile Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Basic Credentials
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="uname" className="text-xs font-semibold text-slate-700">
                      Full Name <span className="text-rose-500">*</span>
                    </Label>
                    <div className="relative">
                      <User className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="uname"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Tariq Mehmood"
                        className="pl-8 h-9 text-xs"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="uemail" className="text-xs font-semibold text-slate-700">
                      Email Address (Login ID) <span className="text-rose-500">*</span>
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="uemail"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="e.g. tariq@papertrade.com"
                        className="pl-8 h-9 text-xs"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="upass" className="text-xs font-semibold text-slate-700">
                      Password{" "}
                      {editingUser ? (
                        <span className="font-normal text-slate-500">(leave blank to keep current)</span>
                      ) : (
                        <span className="text-rose-500">*</span>
                      )}
                    </Label>
                    {!editingUser && (
                      <span className="text-[10px] text-slate-500">Minimum 6 characters</span>
                    )}
                  </div>
                  <div className="relative">
                    <Key className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="upass"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        editingUser
                          ? "Leave blank to keep current password"
                          : "Enter strong password (min 6 characters)"
                      }
                      className="pl-8 pr-9 h-9 text-xs"
                      required={!editingUser}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Role Selection Cards */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Organizational Role <span className="text-rose-500">*</span>
                    </h3>
                    <p className="text-[10px] text-slate-500">
                      Selecting a role applies recommended security defaults.
                    </p>
                  </div>
                  {editingUser && (
                    <button
                      type="button"
                      onClick={applyPresetForCurrentRole}
                      className="inline-flex items-center gap-1 text-[10px] text-emerald-700 hover:underline font-medium"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset to {role} Defaults
                    </button>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {/* OWNER CARD */}
                  <div
                    onClick={() => handleRoleSelect(Role.OWNER)}
                    className={`cursor-pointer rounded-xl border p-3 transition-all ${
                      role === Role.OWNER
                        ? "border-amber-400 bg-amber-50/70 shadow-xs ring-2 ring-amber-500/20"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="h-7 w-7 rounded-lg bg-amber-100 flex items-center justify-center text-amber-800">
                        <Crown className="h-4 w-4" />
                      </div>
                      {role === Role.OWNER && (
                        <CheckCircle2 className="h-4 w-4 text-amber-700 shrink-0" />
                      )}
                    </div>
                    <div className="font-bold text-slate-900 text-xs">Owner</div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                      Unrestricted access across all financial ledgers, settings, and audits.
                    </p>
                  </div>

                  {/* MANAGER CARD */}
                  <div
                    onClick={() => handleRoleSelect(Role.MANAGER)}
                    className={`cursor-pointer rounded-xl border p-3 transition-all ${
                      role === Role.MANAGER
                        ? "border-sky-400 bg-sky-50/70 shadow-xs ring-2 ring-sky-500/20"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="h-7 w-7 rounded-lg bg-sky-100 flex items-center justify-center text-sky-800">
                        <Briefcase className="h-4 w-4" />
                      </div>
                      {role === Role.MANAGER && (
                        <CheckCircle2 className="h-4 w-4 text-sky-700 shrink-0" />
                      )}
                    </div>
                    <div className="font-bold text-slate-900 text-xs">Manager</div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                      Operational oversight, sales, inventory management, reports, and purchase control.
                    </p>
                  </div>

                  {/* STAFF CARD */}
                  <div
                    onClick={() => handleRoleSelect(Role.STAFF)}
                    className={`cursor-pointer rounded-xl border p-3 transition-all ${
                      role === Role.STAFF
                        ? "border-emerald-400 bg-emerald-50/70 shadow-xs ring-2 ring-emerald-500/20"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="h-7 w-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-800">
                        <User className="h-4 w-4" />
                      </div>
                      {role === Role.STAFF && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                      )}
                    </div>
                    <div className="font-bold text-slate-900 text-xs">Staff</div>
                    <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                      Day-to-day order creation, customer deliveries, and stock updates.
                    </p>
                  </div>
                </div>
              </div>

              {/* Module Permissions Categorized Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Module Access & Permissions
                    </h3>
                    <p className="text-[10px] text-slate-500">
                      Fine-tune individual permissions for this account.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={applyPresetForCurrentRole}
                    className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-200"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    Reset to Role Defaults
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 max-h-72 overflow-y-auto pr-1">
                  <CategorizedPermissionEditor
                    value={permissionDraft}
                    onChange={updatePermission}
                    onBatchChange={batchUpdatePermissions}
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs px-5 shadow-sm"
                >
                  {editingUser
                    ? submitting
                      ? "Saving Changes..."
                      : "Save Changes"
                    : submitting
                    ? "Creating Account..."
                    : "Create User Account"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dedicated Configure Access Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs overflow-y-auto animate-in fade-in">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-800 border border-emerald-100">
                  <SlidersHorizontal className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Configure Permissions</h2>
                  <p className="text-xs text-slate-500">
                    Adjust access permissions for <span className="font-semibold text-slate-800">{selectedUser.name}</span> ({selectedUser.email})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {permissionError && (
              <div className="mx-6 mt-4 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{permissionError}</span>
              </div>
            )}

            <div className="flex flex-col flex-1 overflow-y-auto px-6 py-4 space-y-4 text-xs">
              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="text-slate-600 font-medium">Assigned Role:</span>
                  {getRoleBadge(selectedUser.role)}
                </div>
                <button
                  type="button"
                  onClick={() => setPermissionDraft(getPresetPermissionsForRole(selectedUser.role))}
                  className="inline-flex items-center gap-1 rounded bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-xs"
                >
                  <RotateCcw className="h-3 w-3 text-slate-500" />
                  Reset to Role Defaults
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 flex-1 overflow-y-auto">
                <CategorizedPermissionEditor
                  value={permissionDraft}
                  onChange={updatePermission}
                  onBatchChange={batchUpdatePermissions}
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedUser(null)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSavePermissions}
                  disabled={savingPermissions}
                  className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs px-5 shadow-sm"
                >
                  {savingPermissions ? "Saving..." : "Save Permissions"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
