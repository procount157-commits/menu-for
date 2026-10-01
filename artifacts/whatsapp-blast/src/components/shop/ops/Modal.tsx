// ── An RTL dialog and a side drawer ───────────────────────────────
// The shadcn dialog pins its close button to the right, which is where an
// Arabic title starts; these put it on the left and open the drawer from
// the start side.

import type { ReactNode } from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({ open, onOpenChange, title, description, children, className, wide }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode;
  children: ReactNode; className?: string; wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content dir="rtl"
          className={cn("fixed z-50 inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "w-full bg-popover border border-popover-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto",
            wide ? "sm:max-w-2xl" : "sm:max-w-md", "p-5 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4", className)}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <D.Title className="text-lg font-bold">{title}</D.Title>
              {description ? <D.Description className="text-sm text-muted-foreground mt-1">{description}</D.Description> : <D.Description className="sr-only">{typeof title === "string" ? title : ""}</D.Description>}
            </div>
            <D.Close className="w-9 h-9 -mt-1 -ms-1 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 shrink-0" aria-label="إغلاق">
              <X className="w-4 h-4" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Drawer({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; children: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content dir="rtl"
          className="fixed z-50 inset-y-0 left-0 w-full sm:max-w-lg bg-popover border-r border-popover-border shadow-2xl flex flex-col data-[state=open]:animate-in data-[state=open]:slide-in-from-left-8">
          <div className="flex items-center justify-between gap-3 px-5 h-14 border-b border-border shrink-0">
            <D.Title className="font-bold truncate">{title}</D.Title>
            <D.Description className="sr-only">التفاصيل</D.Description>
            <D.Close className="w-9 h-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60" aria-label="إغلاق">
              <X className="w-4 h-4" />
            </D.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
