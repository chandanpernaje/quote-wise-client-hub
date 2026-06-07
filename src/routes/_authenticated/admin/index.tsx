import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AGENT, whatsappLink } from "@/lib/agent";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  ArrowUpDown,
  Calendar,
  ChevronRight,
  Loader2,
  Phone,
  Search,
  UserPlus,
  Upload,
  Users,
  ShieldCheck,
  Clock,
  ShieldOff,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/")(
  {
    component: CustomerList,
  }
);

type Customer = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  category: string;
  insurer: string | null;
  policy_number: string | null;
  vehicle_number: string | null;
  expiry_date: string;
  premium_amount: number | null;
};

function daysUntil(d: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(d).getTime() - today.getTime()) / 86400000);
}

type ExpiryFilter = "all" | "7" | "15" | "30" | "expired";

function CustomerList() {
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; failed: number; skipped: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, full_name, phone, email, category, insurer, policy_number, vehicle_number, expiry_date, premium_amount"
        )
        .order("expiry_date", { ascending: true });
      if (error) throw error;
      return data as Customer[];
    },
  });

  // Dashboard stats
  const stats = useMemo(() => {
    if (!data) return { total: 0, active: 0, expiringSoon: 0, expired: 0 };
    const total = data.length;
    const expired = data.filter((c) => daysUntil(c.expiry_date) < 0).length;
    const expiringSoon = data.filter((c) => {
      const d = daysUntil(c.expiry_date);
      return d >= 0 && d <= 30;
    }).length;
    const active = total - expired - expiringSoon;
    return { total, active, expiringSoon, expired };
  }, [data]);

  const customers = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let list = data;

    // Expiry filter
    if (expiryFilter !== "all") {
      if (expiryFilter === "expired") {
        list = list.filter((c) => daysUntil(c.expiry_date) < 0);
      } else {
        const days = parseInt(expiryFilter);
        list = list.filter((c) => {
          const d = daysUntil(c.expiry_date);
          return d >= 0 && d <= days;
        });
      }
    }

    if (q) {
      list = list.filter(
        (c) =>
          c.full_name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.policy_number ?? "").toLowerCase().includes(q) ||
          (c.vehicle_number ?? "").toLowerCase().includes(q) ||
          (c.insurer ?? "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const cmp =
        new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
      return sortAsc ? cmp : -cmp;
    });
  }, [data, search, sortAsc, expiryFilter]);

  const expiringSoonBanner = useMemo(
    () =>
      customers.filter(
        (c) => daysUntil(c.expiry_date) <= 30 && daysUntil(c.expiry_date) >= 0
      ),
    [customers]
  );

  // Excel / CSV import
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      // Get existing policy numbers to skip duplicates
      const { data: existingPolicies } = await supabase
        .from("customers")
        .select("policy_number")
        .not("policy_number", "is", null);
      const existingSet = new Set(
        (existingPolicies ?? []).map((r) => (r.policy_number ?? "").toLowerCase().trim())
      );

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      let imported = 0;
      let failed = 0;
      let skipped = 0;

      for (const row of rows) {
        try {
          const policyNum = String(row["policy_number"] ?? row["Policy Number"] ?? row["PolicyNumber"] ?? "").trim();
          if (policyNum && existingSet.has(policyNum.toLowerCase())) {
            skipped++;
            continue;
          }

          const toStr = (v: unknown) => (v == null ? "" : String(v).trim());
          const toDate = (v: unknown): string => {
            if (!v) return "";
            if (v instanceof Date) return v.toISOString().split("T")[0];
            const s = String(v).trim();
            // Try DD/MM/YYYY or similar
            const parts = s.split(/[\/\-\.]/);
            if (parts.length === 3) {
              const [a, b, c] = parts;
              if (c && c.length === 4) return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
            }
            return s;
          };

          const name = toStr(row["full_name"] ?? row["Full Name"] ?? row["Name"] ?? row["name"]);
          const phone = toStr(row["phone"] ?? row["Phone"] ?? row["Mobile"] ?? row["mobile"]);
          const expiry = toDate(row["expiry_date"] ?? row["Expiry Date"] ?? row["ExpiryDate"] ?? row["expiry"]);

          if (!name || !phone || !expiry) {
            failed++;
            continue;
          }

          const { error: insErr } = await supabase.from("customers").insert({
            full_name: name,
            phone,
            email: toStr(row["email"] ?? row["Email"]) || null,
            category: toStr(row["category"] ?? row["Category"]) || "Car",
            insurer: toStr(row["insurer"] ?? row["Insurer"]) || null,
            policy_number: policyNum || null,
            vehicle_number: toStr(row["vehicle_number"] ?? row["Vehicle Number"] ?? row["VehicleNumber"]) || null,
            premium_amount: row["premium_amount"] ?? row["Premium"] ?? row["premium"] ? Number(row["premium_amount"] ?? row["Premium"] ?? row["premium"]) : null,
            start_date: toDate(row["start_date"] ?? row["Start Date"] ?? row["StartDate"]) || null,
            expiry_date: expiry,
            notes: toStr(row["notes"] ?? row["Notes"]) || null,
            created_by: userId,
          });

          if (insErr) {
            failed++;
          } else {
            imported++;
            if (policyNum) existingSet.add(policyNum.toLowerCase());
          }
        } catch {
          failed++;
        }
      }

      setImportResult({ imported, failed, skipped });
      refetch();
    } catch (err) {
      alert("Could not parse file: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const filterButtons: { label: string; value: ExpiryFilter }[] = [
    { label: "All", value: "all" },
    { label: "7 days", value: "7" },
    { label: "15 days", value: "15" },
    { label: "30 days", value: "30" },
    { label: "Expired", value: "expired" },
  ];

  return (
    <div className="grid gap-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Users className="size-5 text-blue-500" />} label="Total Customers" value={stats.total} color="blue" />
        <StatCard icon={<ShieldCheck className="size-5 text-emerald-600" />} label="Active Policies" value={stats.active} color="emerald" />
        <StatCard icon={<Clock className="size-5 text-amber-600" />} label="Expiring Soon" value={stats.expiringSoon} color="amber" />
        <StatCard icon={<ShieldOff className="size-5 text-red-500" />} label="Expired" value={stats.expired} color="red" />
      </div>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-primary">Customers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {customers.length} shown · sorted by expiry date
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Import button */}
          <label className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border text-sm font-medium cursor-pointer hover:border-accent transition ${importing ? "opacity-60 pointer-events-none" : ""}`}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Import Excel
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleImport}
              disabled={importing}
            />
          </label>
          <Link
            to="/admin/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full gradient-emerald text-accent-foreground text-sm font-semibold shadow-emerald hover:translate-y-[-1px] transition"
          >
            <UserPlus className="size-4" /> Add customer
          </Link>
        </div>
      </div>

      {/* Import result */}
      {importResult && (
        <div className="rounded-2xl border border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/20 p-4 text-sm flex items-center justify-between">
          <span>
            ✅ <strong>{importResult.imported}</strong> imported
            {importResult.skipped > 0 && <> · <strong>{importResult.skipped}</strong> skipped (duplicate policy)</>}
            {importResult.failed > 0 && <> · <strong className="text-destructive">{importResult.failed}</strong> failed</>}
          </span>
          <button onClick={() => setImportResult(null)} className="text-muted-foreground hover:text-primary text-xs">Dismiss</button>
        </div>
      )}

      {/* Expiry filters */}
      <div className="flex gap-2 flex-wrap">
        {filterButtons.map((f) => (
          <button
            key={f.value}
            onClick={() => setExpiryFilter(f.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              expiryFilter === f.value
                ? "gradient-emerald text-accent-foreground shadow-emerald"
                : "border border-border text-muted-foreground hover:border-accent hover:text-primary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Expiring soon banner */}
      {expiryFilter === "all" && expiringSoonBanner.length > 0 && (
        <div className="rounded-2xl border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 p-5">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 grid place-items-center shrink-0">
              <AlertTriangle className="size-5 text-amber-700 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <div className="font-display text-lg text-primary">
                {expiringSoonBanner.length}{" "}
                {expiringSoonBanner.length === 1 ? "policy" : "policies"} expiring within 30 days
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Reach out to renew before they lapse.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {expiringSoonBanner.slice(0, 6).map((c) => (
                  <Link
                    key={c.id}
                    to="/admin/$id"
                    params={{ id: c.id }}
                    className="text-xs bg-white dark:bg-amber-950/40 border border-amber-300/50 rounded-full px-3 py-1.5 text-primary hover:bg-amber-100 transition"
                  >
                    {c.full_name} · {daysUntil(c.expiry_date)}d
                  </Link>
                ))}
                {expiringSoonBanner.length > 6 && (
                  <span className="text-xs text-muted-foreground self-center">
                    + {expiringSoonBanner.length - 6} more below
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search + sort */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="size-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, policy, vehicle, insurer"
            className="w-full pl-10 pr-4 py-2.5 rounded-full bg-card border border-border focus:border-accent focus:ring-4 focus:ring-accent/15 outline-none text-sm transition"
          />
        </div>
        <button
          onClick={() => setSortAsc((s) => !s)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-border text-sm text-primary hover:border-accent transition"
          title="Toggle sort"
        >
          <ArrowUpDown className="size-4" />
          Expiry {sortAsc ? "↑" : "↓"}
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="size-6 animate-spin text-accent" />
        </div>
      ) : error ? (
        <div className="text-destructive text-sm">
          Could not load customers: {(error as Error).message}
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border p-16 text-center">
          <p className="font-display text-xl text-primary">No customers found</p>
          <p className="text-sm text-muted-foreground mt-2">
            {search || expiryFilter !== "all"
              ? "Try adjusting your search or filter."
              : "Add your first customer to start tracking policies and renewals."}
          </p>
          {!search && expiryFilter === "all" && (
            <Link
              to="/admin/new"
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full gradient-emerald text-accent-foreground text-sm font-semibold shadow-emerald"
            >
              <UserPlus className="size-4" /> Add customer
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          {customers.map((c) => {
            const days = daysUntil(c.expiry_date);
            const urgent = days >= 0 && days <= 30;
            const expired = days < 0;
            return (
              <Link
                key={c.id}
                to="/admin/$id"
                params={{ id: c.id }}
                className="group bg-card border border-border rounded-2xl p-4 md:p-5 flex items-center gap-4 hover:border-accent hover:shadow-elegant transition"
              >
                <div
                  className={`size-12 rounded-xl grid place-items-center text-sm font-semibold shrink-0 ${
                    expired
                      ? "bg-destructive/10 text-destructive"
                      : urgent
                      ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
                      : "bg-secondary text-primary"
                  }`}
                >
                  {c.full_name
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-primary truncate">
                    {c.full_name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {c.category}
                    {c.insurer ? ` · ${c.insurer}` : ""}
                    {c.policy_number ? ` · #${c.policy_number}` : ""}
                    {c.vehicle_number ? ` · ${c.vehicle_number}` : ""}
                  </div>
                </div>
                <div className="hidden sm:flex flex-col items-end gap-1">
                  <div
                    className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                      expired
                        ? "bg-destructive/10 text-destructive"
                        : urgent
                        ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
                        : "bg-secondary text-primary"
                    }`}
                  >
                    <Calendar className="size-3" />
                    {expired
                      ? `Expired ${-days}d ago`
                      : urgent
                      ? `${days}d left`
                      : new Date(c.expiry_date).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                  </div>
                  <a
                    href={`https://wa.me/${c.phone.replace(/\D/g, "")}?text=${encodeURIComponent(
                      `Hi ${c.full_name}, this is ${AGENT.shortName}. Your ${c.category} policy is up for renewal on ${new Date(c.expiry_date).toLocaleDateString("en-IN")}. Shall I send you renewal options?`
                    )}`}
                    onClick={(e) => e.stopPropagation()}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-accent"
                  >
                    <Phone className="size-3" /> {c.phone}
                  </a>
                </div>
                <ChevronRight className="size-5 text-muted-foreground group-hover:text-accent transition" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 dark:bg-blue-950/20 border-blue-200/50",
    emerald: "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50",
    amber: "bg-amber-50 dark:bg-amber-950/20 border-amber-200/50",
    red: "bg-red-50 dark:bg-red-950/20 border-red-200/50",
  };
  return (
    <div className={`rounded-2xl border p-4 ${colorMap[color] ?? ""}`}>
      <div className="flex items-center gap-2 mb-2">{icon}</div>
      <div className="font-display text-3xl text-primary">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
