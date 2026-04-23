// Push all sitemap URLs to IndexNow so Bing, Yandex, Seznam, Naver et al.
// crawl within minutes instead of waiting to rediscover via sitemap polling.
// Google does NOT participate in IndexNow — GSC sitemap ping handles that.
//
// The key file is already published at https://taprun.dev/<KEY>.txt.
// Run with:
//   deno run --allow-net scripts/indexnow-ping.ts

const HOST = "taprun.dev";
const KEY = "e9ea3504983ec21b5c929ae5018ac153";

const smRes = await fetch(`https://${HOST}/sitemap.xml`);
if (!smRes.ok) {
  console.error(`sitemap fetch: ${smRes.status}`);
  Deno.exit(1);
}
const sm = await smRes.text();
const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (urls.length === 0) {
  console.error("sitemap returned no URLs");
  Deno.exit(1);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList: urls,
  }),
});

console.log(`IndexNow POST ${urls.length} URLs → HTTP ${res.status}`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  Deno.exit(1);
}
