import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AGENT } from "@/lib/agent";
import {
  ArrowLeft,
  Calendar,
  FileText,
  Loader2,
  MessageCircle,
  Phone,
  Trash2,
  Download,
  Pencil,
  Save,
  X,
  Upload,
  FileCheck2,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/admin/$id")({
  component: CustomerDetail,
});

const docFields = [
  { key: "aadhaar_front_path", label: "Aadhaar — Front" },
  { key: "aadhaar_back_path", label: "Aadhaar — Back" },
  { key: "pan_front_path", label: "PAN — Front" },
  { key: "pan_back_path", label: "PAN — Back" },
  { key: "rc_path", label: "Vehicle RC" },
  { key: "old_policy_path", label: "Old Policy Copy" },
] as const;

type DocKey = (typeof docFields)[number]["key"];

const categories = ["Health", "Car", "Bike", "Commercial"] as const;

const editSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[0-9+\-\s]{7,15}$/, "Enter a valid phone"),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  category: z.enum(categories),
  insurer: z.string().trim().max(120).optional().or(z.literal("")),
  policy_number: z.string().trim().max(80).optional().or(z.literal("")),
  vehicle_number: z.string().trim().max(40).optional().or(z.literal("")),
  premium_amount: z.string().trim().optional().or(z.literal("")),
  start_date: z.string().optional().or(z.literal("")),
  expiry_date: z.string().min(1, "Expiry date is required"),
  notes: z.string().max(800).optional().or(z.literal("")),
});

function CustomerDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [newFiles, setNewFiles] = useState<Partial<Record<string, File>>>({});

  const {
    data: c,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  function startEdit() {
    if (!c) return;
    setEditForm({
      full_name: c.full_name,
      phone: c.phone,
      email: c.email ?? "",
      category: c.category,
      insurer: c.insurer ?? "",
      policy_number: c.policy_number ?? "",
      vehicle_number: c.vehicle_number ?? "",
      premium_amount: c.premium_amount != null ? String(c.premium_amount) : "",
      start_date: c.start_date ?? "",
      expiry_date: c.expiry_date,
      notes: c.notes ?? "",
    });
    setEditErrors({});
    setServerError(null);
    setNewFiles({});
    setEditing(true);
  }

  async function saveEdit() {
    const parsed = editSchema.safeParse(editForm);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => (errs[String(i.path[0])] = i.message));
      setEditErrors(errs);
      return;
    }
    setEditErrors({});
    setSaving(true);
    setServerError(null);
    try {
      const uploads: Record<string, string> = {};
      for (const d of docFields) {
        const file = newFiles[d.key];
        if (!file) continue;
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${id}/${d.key}.${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("kyc-docs")
          .upload(path, file, { upsert: false });
        if (upErr) throw new Error(`${d.label}: ${upErr.message}`);
        uploads[d.key] = path;
      }

      const { error: updErr } = await supabase
        .from("customers")
        .update({
          full_name: parsed.data.full_name,
          phone: parsed.data.phone,
          email: parsed.data.email || null,
          category: parsed.data.category,
          insurer: parsed.data.insurer || null,
          policy_number: parsed.data.policy_number || null,
          vehicle_number: parsed.data.vehicle_number || null,
          premium_amount: parsed.data.premium_amount
            ? Number(parsed.data.premium_amount)
            : null,
          start_date: parsed.data.start_date || null,
          expiry_date: parsed.data.expiry_date,
          notes: parsed.data.notes || null,
          ...uploads,
        })
        .eq("id", id);

      if (updErr) throw new Error(updErr.message);

      queryClient.invalidateQueries({ queryKey: ["customer", id] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setEditing(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function openDoc(path: string) {
    const { data, error } = await supabase.storage
      .from("kyc-docs")
      .createSignedUrl(path, 300);
    if (error) {
      alert(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function remove() {
    if (!c) return;
    if (!confirm(`Delete ${c.full_name}? This cannot be undone.`)) return;
    setDeleting(true);
    const paths = docFields
      .map((d) => c[d.key as keyof typeof c])
      .filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from("kyc-docs").remove(paths);
    const { error } = await supabase.from("customers").delete().eq("id", id);
    setDeleting(false);
    if (error) {
      alert(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    navigate({ to: "/admin" });
  }

  if (isLoading) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="size-6 animate-spin text-accent" />
      </div>
    );
  }
  if (error)
    return <p className="text-destructive">{(error as Error).message}</p>;
  if (!c)
    return (
      <p>
        Not found. <Link to="/admin">Back</Link>
      </p>
    );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil(
    (new Date(c.expiry_date).getTime() - today.getTime()) / 86400000
  );
  const expired = days < 0;
  const urgent = days >= 0 && days <= 30;

  const renewMsg = `Hi ${c.full_name}, this is ${AGENT.shortName}. Your ${c.category} policy${c.insurer ? ` with ${c.insurer}` : ""} is up for renewal on ${new Date(c.expiry_date).toLocaleDateString("en-IN")}. Shall I share renewal options?`;

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        to="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" /> Back to customers
      </Link>

      <div className="mt-4 bg-card border border-border rounded-3xl p-6 md:p-8 shadow-elegant">
        {!editing ? (
          <>
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <h1 className="font-display text-3xl text-primary">
                  {c.full_name}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {c.category}
                  {c.insurer ? ` · ${c.insurer}` : ""}
                  {c.policy_number ? ` · #${c.policy_number}` : ""}
                </p>
              </div>
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium self-start ${
                  expired
                    ? "bg-destructive/10 text-destructive"
                    : urgent
                    ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
                    : "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                }`}
              >
                <Calendar className="size-4" />
                {expired
                  ? `Expired ${-days}d ago`
                  : urgent
                  ? `Expires in ${days}d`
                  : `Valid · expires ${new Date(c.expiry_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
              </div>
            </div>

            <div className="mt-6 grid sm:grid-cols-2 gap-4 text-sm">
              <Info
                label="Phone"
                value={
                  <a href={`tel:${c.phone}`} className="text-primary hover:text-accent">
                    {c.phone}
                  </a>
                }
              />
              <Info label="Email" value={c.email || "—"} />
              <Info label="Vehicle number" value={c.vehicle_number || "—"} />
              <Info
                label="Premium"
                value={
                  c.premium_amount
                    ? `₹ ${Number(c.premium_amount).toLocaleString("en-IN")}`
                    : "—"
                }
              />
              <Info
                label="Start date"
                value={
                  c.start_date
                    ? new Date(c.start_date).toLocaleDateString("en-IN")
                    : "—"
                }
              />
              <Info
                label="Expiry date"
                value={new Date(c.expiry_date).toLocaleDateString("en-IN")}
              />
            </div>

            {c.notes && (
              <div className="mt-5 p-4 rounded-2xl bg-secondary text-sm text-primary whitespace-pre-wrap">
                {c.notes}
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              <a
                href={`tel:${c.phone}`}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                <Phone className="size-4" /> Call
              </a>
              <a
                href={`https://wa.me/${c.phone.replace(/\D/g, "")}?text=${encodeURIComponent(renewMsg)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full gradient-emerald text-accent-foreground text-sm font-semibold shadow-emerald"
              >
                <MessageCircle className="size-4" /> WhatsApp renewal
              </a>
              <button
                onClick={startEdit}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-border text-sm text-primary hover:border-accent transition"
              >
                <Pencil className="size-4" /> Edit
              </button>
              <button
                onClick={remove}
                disabled={deleting}
                className="ml-auto inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-destructive/40 text-destructive text-sm hover:bg-destructive/10 disabled:opacity-50 transition"
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}{" "}
                Delete
              </button>
            </div>
          </>
        ) : (
          /* Edit form */
          <div className="grid gap-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-primary">Edit Customer</h2>
              <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-primary">
                <X className="size-5" />
              </button>
            </div>

            <EditSection title="Personal">
              <div className="grid md:grid-cols-2 gap-4">
                <EditField label="Full name *" error={editErrors.full_name}>
                  <input className="ip" value={editForm.full_name ?? ""} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
                </EditField>
                <EditField label="Mobile *" error={editErrors.phone}>
                  <input className="ip" value={editForm.phone ?? ""} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                </EditField>
                <EditField label="Email" error={editErrors.email}>
                  <input className="ip" type="email" value={editForm.email ?? ""} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                </EditField>
                <EditField label="Category *">
                  <select className="ip" value={editForm.category ?? "Car"} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </EditField>
              </div>
            </EditSection>

            <EditSection title="Policy">
              <div className="grid md:grid-cols-2 gap-4">
                <EditField label="Insurer">
                  <input className="ip" value={editForm.insurer ?? ""} onChange={(e) => setEditForm({ ...editForm, insurer: e.target.value })} />
                </EditField>
                <EditField label="Policy number">
                  <input className="ip" value={editForm.policy_number ?? ""} onChange={(e) => setEditForm({ ...editForm, policy_number: e.target.value })} />
                </EditField>
                <EditField label="Vehicle number">
                  <input className="ip" value={editForm.vehicle_number ?? ""} onChange={(e) => setEditForm({ ...editForm, vehicle_number: e.target.value.toUpperCase() })} />
                </EditField>
                <EditField label="Premium (₹)">
                  <input className="ip" type="number" min="0" value={editForm.premium_amount ?? ""} onChange={(e) => setEditForm({ ...editForm, premium_amount: e.target.value })} />
                </EditField>
                <EditField label="Start date">
                  <input className="ip" type="date" value={editForm.start_date ?? ""} onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })} />
                </EditField>
                <EditField label="Expiry date *" error={editErrors.expiry_date}>
                  <input className="ip" type="date" value={editForm.expiry_date ?? ""} onChange={(e) => setEditForm({ ...editForm, expiry_date: e.target.value })} />
                </EditField>
              </div>
              <EditField label="Notes">
                <textarea className="ip resize-none" rows={3} value={editForm.notes ?? ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </EditField>
            </EditSection>

            {/* Replace KYC docs */}
            <EditSection title="Replace KYC Documents">
              <p className="text-xs text-muted-foreground -mt-2">Upload to replace existing documents. Leave empty to keep current files.</p>
              <div className="grid md:grid-cols-2 gap-3">
                {docFields.map((d) => (
                  <label key={d.key} className={`block rounded-2xl border-2 border-dashed p-3 cursor-pointer transition ${newFiles[d.key] ? "border-accent bg-accent/5" : "border-border hover:border-accent/60"}`}>
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-xl bg-secondary grid place-items-center text-primary shrink-0">
                        {newFiles[d.key] ? <FileCheck2 className="size-4 text-accent" /> : <Upload className="size-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-primary">{d.label}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {newFiles[d.key] ? newFiles[d.key]!.name : (c[d.key as keyof typeof c] ? "Uploaded — tap to replace" : "Tap to upload")}
                        </div>
                      </div>
                    </div>
                    <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setNewFiles((p) => ({ ...p, [d.key]: f }));
                    }} />
                  </label>
                ))}
              </div>
            </EditSection>

            {serverError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
                {serverError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(false)} className="px-5 py-2.5 rounded-full border border-border text-sm text-primary hover:border-primary transition">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={saving} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full gradient-emerald text-accent-foreground text-sm font-semibold shadow-emerald disabled:opacity-50 transition">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save changes
              </button>
            </div>
          </div>
        )}

        <style>{`
          .ip { width:100%; padding:.7rem .9rem; border-radius:.85rem; background:var(--color-background); border:1px solid var(--color-border); color:var(--color-foreground); font-size:.9rem; outline:none; transition:border-color .15s, box-shadow .15s; }
          .ip:focus { border-color:var(--color-accent); box-shadow:0 0 0 4px color-mix(in oklab, var(--color-accent) 18%, transparent); }
        `}</style>
      </div>

      {/* Documents */}
      {!editing && (
        <div className="mt-6 bg-card border border-border rounded-3xl p-6 md:p-8 shadow-elegant">
          <h2 className="font-display text-xl text-primary">KYC Documents</h2>
          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            {docFields.map((d) => {
              const path = c[d.key as keyof typeof c] as string | null;
              return (
                <div
                  key={d.key}
                  className={`rounded-2xl border p-4 flex items-center gap-3 ${path ? "border-border bg-background" : "border-dashed border-border/60 bg-muted/30"}`}
                >
                  <div
                    className={`size-10 rounded-xl grid place-items-center shrink-0 ${path ? "bg-accent/10 text-accent" : "bg-secondary text-muted-foreground"}`}
                  >
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-primary">
                      {d.label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {path ? "Uploaded" : "Not uploaded"}
                    </div>
                  </div>
                  {path && (
                    <button
                      onClick={() => openDoc(path)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-glow"
                    >
                      <Download className="size-3.5" /> View
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <div className="text-primary mt-0.5">{value}</div>
    </div>
  );
}

function EditSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-4">
      <h3 className="font-display text-lg text-primary border-b border-border pb-2">{title}</h3>
      {children}
    </div>
  );
}

function EditField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{label}</span>
      {children}
      {error && <span className="block mt-1 text-xs text-destructive">{error}</span>}
    </label>
  );
}
