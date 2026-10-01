import { Icon } from "@/components/ui";
import { t, useLang } from "@/lib/i18n";

export default function NotFound() {
  const lang = useLang();
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center text-center px-8">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}><Icon name="search" className="w-8 h-8" /></div>
      <h1 className="font-display text-2xl mt-5">{t("notFound", lang)}</h1>
      <p className="text-muted mt-2">{t("notFoundSub", lang)}</p>
    </div>
  );
}
