// ── The marketing site ────────────────────────────────────────────
// The application is a single-page React app: one index.html, everything
// else drawn by JavaScript. That is right for the app and wrong for the
// pages that are supposed to be found — a crawler that gets an empty <div>
// and a script tag indexes an empty page, and an article added inside the
// SPA is a route with no HTML of its own.
//
// So the public pages are generated here as plain HTML at build time, one
// file per URL, from Markdown under artifacts/whatsapp-blast/site/. No
// framework, no dependencies: a page is a template string and the Markdown
// parser is sixty lines, which is all these pages need. The server sends the
// generated home to anonymous visitors and the app shell to signed-in ones.
//
// Absolute URLs — canonical, og:url, the sitemap — need the site's domain,
// which is SITE_URL. Without it the pages still build, with relative links
// and no sitemap, and a warning says so; a sitemap with a made-up domain
// would be worse than none.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const SRC  = path.join(ROOT, "artifacts/whatsapp-blast/site");
const OUT  = path.join(ROOT, "artifacts/whatsapp-blast/dist/public");

const site = JSON.parse(fs.readFileSync(path.join(SRC, "site.json"), "utf8"));
const SITE_URL = (process.env.SITE_URL || readEnvFile("SITE_URL") || "").replace(/\/+$/, "");

function readEnvFile(key) {
  try {
    const m = new RegExp(`^${key}=(.*)$`, "m").exec(fs.readFileSync(path.join(ROOT, ".env"), "utf8"));
    return m?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  } catch { return ""; }
}

// ── Markdown, the parts these pages use ───────────────────────────
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
function markdown(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const flushPara = (buf) => { if (buf.length) out.push(`<p>${inline(buf.join(" "))}</p>`); };
  let para = [];
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { flushPara(para); para = []; i++; continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(l);
    if (h) { flushPara(para); para = []; const n = h[1].length + 1; out.push(`<h${n} id="${slugify(h[2])}">${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^---+$/.test(l.trim())) { flushPara(para); para = []; out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(l)) {
      flushPara(para); para = [];
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i].replace(/^>\s?/, "")), i++;
      out.push(`<blockquote><p>${inline(q.join(" "))}</p></blockquote>`); continue;
    }
    if (/^\s*[-•]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) {
      flushPara(para); para = [];
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items = [];
      while (i < lines.length && (/^\s*[-•]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-•]|\d+[.)])\s+/, "")); i++;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    para.push(l.trim()); i++;
  }
  flushPara(para);
  return out.join("\n");
}
function slugify(s) { return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60); }

// ── Front matter ──────────────────────────────────────────────────
function load(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${file}: no front matter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2] };
}

// ── The page ──────────────────────────────────────────────────────
const abs = (p) => (SITE_URL ? `${SITE_URL}${p}` : p);

function layout({ url, title, description, body, jsonld = [], hreflang = false, kind = "website", published, modified, section }) {
  const fullTitle = url === "/" ? `${site.name} — ${title}` : `${title} — ${site.name}`;
  const nav = site.nav.map((n) => `<a href="${n.href}"${n.href === url ? ' aria-current="page"' : ""}>${n.label}</a>`).join("");
  const alternates = hreflang && SITE_URL ? [
    `<link rel="alternate" hreflang="ar" href="${abs("/")}">`,
    `<link rel="alternate" hreflang="ar-AE" href="${abs("/uae/")}">`,
    `<link rel="alternate" hreflang="ar-SA" href="${abs("/saudi/")}">`,
    `<link rel="alternate" hreflang="x-default" href="${abs("/")}">`,
  ].join("\n    ") : "";
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(fullTitle)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="index, follow, max-image-preview:large">
    ${SITE_URL ? `<link rel="canonical" href="${abs(url)}">` : ""}
    ${alternates}
    <meta property="og:type" content="${kind === "article" ? "article" : "website"}">
    <meta property="og:site_name" content="${esc(site.name)}">
    <meta property="og:title" content="${esc(fullTitle)}">
    <meta property="og:description" content="${esc(description)}">
    ${SITE_URL ? `<meta property="og:url" content="${abs(url)}">` : ""}
    <meta property="og:image" content="${abs("/opengraph.jpg")}">
    <meta property="og:locale" content="ar_AE">
    ${published ? `<meta property="article:published_time" content="${published}">` : ""}
    ${modified ? `<meta property="article:modified_time" content="${modified}">` : ""}
    ${section ? `<meta property="article:section" content="${esc(section)}">` : ""}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(fullTitle)}">
    <meta name="twitter:description" content="${esc(description)}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/site.css">
    ${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n    ")}
</head>
<body>
  <header class="top">
    <div class="wrap">
      <a class="brand" href="/">${esc(site.name)}<span>™</span></a>
      <nav>${nav}</nav>
      <a class="cta" href="/login">دخول</a>
    </div>
  </header>
  <main class="wrap">
${body}
  </main>
  <footer>
    <div class="wrap">
      <div class="cols">
        <div><strong>${esc(site.name)}</strong><p>${esc(site.tagline)}</p></div>
        <div><p class="h">المنصة</p>${site.footer.platform.map((n) => `<a href="${n.href}">${n.label}</a>`).join("")}</div>
        <div><p class="h">الأسواق</p><a href="/uae/">الإمارات</a><a href="/saudi/">السعودية</a></div>
        <div><p class="h">تعلّم</p>${site.footer.learn.map((n) => `<a href="${n.href}">${n.label}</a>`).join("")}</div>
      </div>
      <p class="fine">© ${new Date().getFullYear()} ${esc(site.name)}. الإرسال الجماعي على واتساب مسؤوليتك تجاه من تراسلهم — المنصة تحمي رقمك ولا تُعفيك من موافقتهم.</p>
    </div>
  </footer>
</body>
</html>`;
}

const org = () => ({
  "@context": "https://schema.org", "@type": "Organization",
  name: site.name, url: abs("/"), logo: abs("/favicon.svg"),
  areaServed: ["AE", "SA"], availableLanguage: ["ar"],
});
const app = () => ({
  "@context": "https://schema.org", "@type": "SoftwareApplication",
  name: site.name, applicationCategory: "BusinessApplication", operatingSystem: "Web",
  description: site.description, url: abs("/"), inLanguage: "ar",
});
const breadcrumbs = (items) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(it.url) })),
});

// ── Build ─────────────────────────────────────────────────────────
const write = (url, html) => {
  const dir = path.join(OUT, url);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
};
const urls = [];

fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(SRC, "site.css"), path.join(OUT, "site.css"));

// Pages: home (served at / for anonymous visitors; written under /home/),
// markets, features.
for (const file of fs.readdirSync(path.join(SRC, "pages")).filter((f) => f.endsWith(".md")).sort()) {
  const { meta, body } = load(path.join(SRC, "pages", file));
  const url = meta.url;
  const faq = meta.faq ? JSON.parse(fs.readFileSync(path.join(SRC, meta.faq), "utf8")) : null;
  const jsonld = [org()];
  if (url === "/") jsonld.push(app());
  if (faq) jsonld.push({ "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faq.map((q) => ({ "@type": "Question", name: q.q, acceptedAnswer: { "@type": "Answer", text: q.a } })) });
  if (url !== "/") jsonld.push(breadcrumbs([{ name: "الرئيسية", url: "/" }, { name: meta.title, url }]));
  const faqHtml = faq ? `<section class="faq"><h2>أسئلة تُطرح كثيراً</h2>${faq.map((q) => `<details><summary>${esc(q.q)}</summary><p>${esc(q.a)}</p></details>`).join("")}</section>` : "";
  const html = layout({ url, title: meta.title, description: meta.description, hreflang: meta.hreflang === "true",
    body: `<article class="page">${markdown(body)}${faqHtml}</article>` , jsonld });
  write(url === "/" ? "/home" : url, html);
  urls.push({ url, priority: url === "/" ? "1.0" : "0.8", lastmod: meta.updated });
}

// Articles, and the blog index.
const posts = fs.readdirSync(path.join(SRC, "blog")).filter((f) => f.endsWith(".md")).map((f) => load(path.join(SRC, "blog", f)))
  .sort((a, b) => (a.meta.date < b.meta.date ? 1 : -1));
for (const { meta, body } of posts) {
  const url = `/blog/${meta.slug}/`;
  const words = body.split(/\s+/).length;
  const jsonld = [
    { "@context": "https://schema.org", "@type": "Article", headline: meta.title, description: meta.description,
      datePublished: meta.date, dateModified: meta.updated || meta.date, inLanguage: "ar", wordCount: words,
      author: { "@type": "Organization", name: site.name }, publisher: { "@type": "Organization", name: site.name, logo: { "@type": "ImageObject", url: abs("/favicon.svg") } },
      mainEntityOfPage: abs(url), articleSection: meta.section, keywords: meta.keywords },
    breadcrumbs([{ name: "الرئيسية", url: "/" }, { name: "المدونة", url: "/blog/" }, { name: meta.title, url }]),
  ];
  const related = posts.filter((p) => p.meta.slug !== meta.slug).slice(0, 3)
    .map((p) => `<li><a href="/blog/${p.meta.slug}/">${esc(p.meta.title)}</a></li>`).join("");
  const body2 = `<article class="post">
<p class="crumbs"><a href="/">الرئيسية</a> › <a href="/blog/">المدونة</a> › ${esc(meta.section)}</p>
<h1>${esc(meta.title)}</h1>
<p class="meta"><time datetime="${meta.date}">${meta.date}</time> · قراءة ${Math.max(2, Math.round(words / 180))} دقائق</p>
${markdown(body)}
<aside class="related"><h2>اقرأ أيضاً</h2><ul>${related}</ul></aside>
<aside class="cta-box"><p>${esc(site.ctaLine)}</p><a class="btn" href="/login">جرّب ${esc(site.name)}</a></aside>
</article>`;
  write(url, layout({ url, title: meta.title, description: meta.description, body: body2, jsonld, kind: "article",
    published: meta.date, modified: meta.updated || meta.date, section: meta.section }));
  urls.push({ url, priority: "0.7", lastmod: meta.updated || meta.date });
}
{
  const list = posts.map((p) => `<li><a href="/blog/${p.meta.slug}/"><strong>${esc(p.meta.title)}</strong></a><p>${esc(p.meta.description)}</p><small>${p.meta.section} · ${p.meta.date}</small></li>`).join("");
  write("/blog", layout({ url: "/blog/", title: "المدونة", description: site.blogDescription,
    body: `<article class="page"><h1>المدونة</h1><p class="lead">${esc(site.blogDescription)}</p><ul class="posts">${list}</ul></article>`,
    jsonld: [org(), breadcrumbs([{ name: "الرئيسية", url: "/" }, { name: "المدونة", url: "/blog/" }])] }));
  urls.push({ url: "/blog/", priority: "0.6" });
}

// Sitemap and robots.
if (SITE_URL) {
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${abs(u.url)}</loc><lastmod>${u.lastmod || today}</lastmod><priority>${u.priority}</priority></url>`).join("\n") +
    `\n</urlset>\n`);
  fs.writeFileSync(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${abs("/sitemap.xml")}\n`);
} else {
  fs.writeFileSync(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\n`);
  console.warn("⚠ SITE_URL is not set — pages built with relative links, no canonical tags and no sitemap. Set SITE_URL in .env (e.g. https://flowhub.example) and rebuild.");
}
console.log(`site: ${urls.length} pages → ${path.relative(ROOT, OUT)}${SITE_URL ? ` (canonical ${SITE_URL})` : ""}`);
