import {
  putObject, objectExists, statObject, getObjectBuffer,
  objectNameFromUrl, contentTypeForName, storageDriver, MEDIA_ROOT, MEDIA_URL_PREFIX,
} from "../storage";
import fsp from "fs/promises";
import path from "path";

let pass = 0, total = 0;
function check(name: string, cond: boolean, detail = "") {
  total++; if (cond) pass++;
  console.log(`${cond ? "✅" : "❌"} ${name.padEnd(54)} ${detail}`);
}

console.log(`driver: ${storageDriver()} | root: ${MEDIA_ROOT}\n`);

const NAME = `media-uploads/__test-${Date.now()}.png`;
const BODY = Buffer.from("89504e470d0a1a0a-not-a-real-png-but-fine", "utf8");

await putObject(NAME, BODY, "image/png");
check("putObject then objectExists", await objectExists(NAME));

const buf = await getObjectBuffer(NAME);
check("getObjectBuffer round-trips the bytes", buf.equals(BODY), `${buf.length} bytes`);

const meta = await statObject(NAME);
check("statObject reports type and size", meta?.contentType === "image/png" && meta?.size === BODY.length, `${meta?.contentType} ${meta?.size}B`);

// The bug this whole layer exists to prevent: a URL that was handed out but
// never backed by a stored object must report missing, not valid.
check("objectExists false for a never-stored object", !(await objectExists("media-uploads/does-not-exist.png")));

let threw = false;
try { await getObjectBuffer("media-uploads/does-not-exist.png"); } catch (e: any) {
  threw = /MEDIA_NOT_FOUND/.test(String(e?.message));
}
check("getObjectBuffer throws MEDIA_NOT_FOUND when absent", threw);
check("statObject null when absent", (await statObject("media-uploads/nope.png")) === null);

// URL parsing
check("objectNameFromUrl decodes the stored path",
  objectNameFromUrl(`${MEDIA_URL_PREFIX}${encodeURIComponent(NAME)}`) === NAME);
check("objectNameFromUrl null for an external URL",
  objectNameFromUrl("https://example.com/a.png") === null);
check("objectNameFromUrl null for a bare filesystem path",
  objectNameFromUrl("/var/data/a.png") === null);

// Names arrive from URL params — they must not escape the media root.
let blocked = false;
try { await getObjectBuffer("../../../../etc/passwd"); } catch (e: any) {
  blocked = /MEDIA_CONFIG_ERR|MEDIA_NOT_FOUND/.test(String(e?.message));
}
check("traversal outside the media root is refused", blocked);
check("objectExists false for a traversal attempt", !(await objectExists("../../../../etc/passwd")));

check("content type inferred from extension",
  contentTypeForName("a/b.mp4") === "video/mp4" && contentTypeForName("a/b.webp") === "image/webp");

await fsp.rm(path.join(MEDIA_ROOT, NAME), { force: true });
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
