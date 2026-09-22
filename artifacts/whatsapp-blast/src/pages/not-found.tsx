import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
      <p className="text-4xl font-bold text-muted-foreground">404</p>
      <p className="text-foreground font-medium">الصفحة غير موجودة</p>
      <Link href="/">
        <a className="text-sm text-primary hover:underline">العودة للرئيسية</a>
      </Link>
    </div>
  );
}
