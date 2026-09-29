// ── Folders for lists ─────────────────────────────────────────────
// Shared by the WhatsApp number lists (kind "wa") and the email lists
// (kind "email"): a sidebar of folders with counts, "all" and "no folder",
// a folder made in place, renamed or removed on hover, lists dragged onto a
// folder to move them, and one button that sorts every unfoldered list into
// a folder named after its sector.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Folder, FolderOpen, FolderPlus, Inbox, Loader2, Pencil, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/components/AgentPanel";

export type FolderKind = "wa" | "email";
/** "all", "none" (unfoldered), or a folder id. */
export type FolderSel = "all" | "none" | number;

export function useFolders(kind: FolderKind) {
  return useQuery<any>({ queryKey: ["folders", kind], queryFn: () => api(`/api/folders?kind=${kind}`) });
}

export async function moveLists(kind: FolderKind, listIds: number[], folderId: number | null) {
  return api("/api/folders/move", { method: "POST", body: JSON.stringify({ kind, listIds, folderId }) });
}

/** Filter lists by the selected folder. */
export function inFolder<T extends { folderId?: number | null }>(lists: T[], sel: FolderSel): T[] {
  if (sel === "all") return lists;
  if (sel === "none") return lists.filter((l) => !l.folderId);
  return lists.filter((l) => l.folderId === sel);
}

export function FolderSidebar({ kind, value, onChange, total, onChanged, compact }: {
  kind: FolderKind; value: FolderSel; onChange: (s: FolderSel) => void; total: number; onChanged: () => void; compact?: boolean;
}) {
  const qc = useQueryClient();
  const { data } = useFolders(kind);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [over, setOver] = useState<FolderSel | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["folders", kind] }); onChanged(); };

  const create = useMutation({ mutationFn: () => api("/api/folders", { method: "POST", body: JSON.stringify({ kind, name }) }), onSuccess: (f: any) => { setAdding(false); setName(""); refresh(); onChange(f.id); }, onError: (e: Error) => toast.error(e.message) });
  const rename = useMutation({ mutationFn: ({ id, n }: { id: number; n: string }) => api(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name: n }) }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => api(`/api/folders/${id}`, { method: "DELETE" }), onSuccess: () => { onChange("all"); refresh(); } });
  const auto = useMutation({
    mutationFn: () => api("/api/folders/auto", { method: "POST", body: JSON.stringify({ kind }) }),
    onSuccess: (d: any) => { refresh(); toast.success(d.moved.length ? `رُتّبت ${d.moved.length} قائمة: ${d.moved.map((m: any) => `${m.list} ← ${m.folder}`).join("، ").slice(0, 200)}` : "لا قوائم جديدة يمكن معرفة قطاعها"); },
  });
  const drop = async (e: React.DragEvent, folderId: number | null) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData("text/list-id"));
    if (!id) return;
    try { await moveLists(kind, [id], folderId); refresh(); } catch (err: any) { toast.error(err.message); }
  };
  const dropProps = (sel: FolderSel, folderId: number | null) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(sel); },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => drop(e, folderId),
  });
  const item = (on: boolean, dragOver: boolean) => cn("group w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-right transition-colors",
    on ? "bg-primary/15 text-primary" : "hover:bg-muted/50 text-foreground", dragOver && "ring-2 ring-primary/60 bg-primary/10");

  const folders: any[] = data?.folders ?? [];
  return (
    <div className={cn("space-y-1", compact && "text-xs")}>
      <button onClick={() => onChange("all")} className={item(value === "all", false)}><Inbox className="w-4 h-4 shrink-0" /><span className="flex-1">كل القوائم</span><span className="text-xs text-muted-foreground">{total}</span></button>
      {folders.map((f) => (
        <div key={f.id} {...dropProps(f.id, f.id)} className={item(value === f.id, over === f.id)}>
          <button onClick={() => onChange(f.id)} className="flex-1 flex items-center gap-2 min-w-0 text-right">
            {value === f.id ? <FolderOpen className="w-4 h-4 shrink-0" /> : <Folder className="w-4 h-4 shrink-0" />}
            <span className="truncate">{f.name}</span>
          </button>
          <span className="text-xs text-muted-foreground group-hover:hidden">{f.lists}</span>
          <span className="hidden group-hover:flex items-center gap-1">
            <button title="إعادة تسمية" onClick={() => { const n = prompt("اسم المجلد", f.name); if (n?.trim()) rename.mutate({ id: f.id, n: n.trim() }); }}><Pencil className="w-3 h-3 text-muted-foreground" /></button>
            <button title="حذف المجلد (القوائم تبقى)" onClick={() => confirm(`حذف مجلد «${f.name}»؟ القوائم تبقى خارج المجلدات.`) && remove.mutate(f.id)}><Trash2 className="w-3 h-3 text-red-400" /></button>
          </span>
        </div>
      ))}
      {(data?.unfoldered ?? 0) > 0 && folders.length > 0 && (
        <button {...dropProps("none", null)} onClick={() => onChange("none")} className={item(value === "none", over === "none")}><Folder className="w-4 h-4 shrink-0 opacity-50" /><span className="flex-1">بلا مجلد</span><span className="text-xs text-muted-foreground">{data.unfoldered}</span></button>
      )}
      {adding ? (
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }} className="flex gap-1 px-1">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم المجلد — مثلاً: عقارات" className="flex-1 min-w-0 px-2 py-1.5 bg-input border border-border rounded-lg text-xs" />
          <button className="px-2 rounded-lg bg-primary text-primary-foreground text-xs">حفظ</button>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground"><FolderPlus className="w-4 h-4" /> مجلد جديد</button>
      )}
      <button onClick={() => auto.mutate()} disabled={auto.isPending} title="كل قائمة بلا مجلد تذهب لمجلد باسم قطاعها — من اسم القائمة، أو من أغلب الشركات فيها"
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-muted-foreground hover:text-primary">
        {auto.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} رتّب حسب القطاع
      </button>
      <p className="text-[10px] text-muted-foreground/70 px-2.5">اسحب أي قائمة إلى مجلد لنقلها.</p>
    </div>
  );
}

/** A small select on a list: which folder it is in. */
export function MoveToFolder({ kind, listId, folderId, onMoved }: { kind: FolderKind; listId: number; folderId: number | null | undefined; onMoved: () => void }) {
  const { data } = useFolders(kind);
  const qc = useQueryClient();
  const folders: any[] = data?.folders ?? [];
  if (!folders.length) return null;
  return (
    <select value={folderId ?? ""} onClick={(e) => e.stopPropagation()}
      onChange={async (e) => { await moveLists(kind, [listId], e.target.value ? Number(e.target.value) : null); qc.invalidateQueries({ queryKey: ["folders", kind] }); onMoved(); }}
      className="px-1.5 py-1 bg-input border border-border rounded-md text-[11px] text-muted-foreground max-w-[9rem]">
      <option value="">بلا مجلد</option>
      {folders.map((f) => <option key={f.id} value={f.id}>📁 {f.name}</option>)}
    </select>
  );
}
