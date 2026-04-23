// Non-interactive: refresh an access token from env, PUT the sitemap to GSC.
// Used from .github/workflows/post-deploy.yml after a successful GH Pages build.
//
// Required env vars:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
//
// To mint GOOGLE_REFRESH_TOKEN locally, run scripts/link-ga-gsc.ts once and
// read the `refresh_token` field out of ~/.google-oauth-token.ga-admin.

const SITE_URL = "https://taprun.dev/";
const SITEMAP_URL = "https://taprun.dev/sitemap.xml";

const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
if (!clientId || !clientSecret || !refreshToken) {
  console.error(
    "Missing one of: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN",
  );
  Deno.exit(1);
}

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});
if (!tokenRes.ok) {
  console.error(`token refresh failed: ${tokenRes.status} ${await tokenRes.text()}`);
  Deno.exit(1);
}
const { access_token } = await tokenRes.json();

const sitemapApi =
  `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/sitemaps/${encodeURIComponent(SITEMAP_URL)}`;

const putRes = await fetch(sitemapApi, {
  method: "PUT",
  headers: { Authorization: `Bearer ${access_token}` },
});
if (!putRes.ok) {
  console.error(`submit failed: ${putRes.status} ${await putRes.text()}`);
  Deno.exit(1);
}
console.log(`Sitemap submitted: ${SITEMAP_URL} (HTTP ${putRes.status})`);

const statusRes = await fetch(sitemapApi, {
  headers: { Authorization: `Bearer ${access_token}` },
});
if (statusRes.ok) {
  const s = await statusRes.json() as {
    lastSubmitted?: string;
    lastDownloaded?: string;
    warnings?: number;
    errors?: number;
    isPending?: boolean;
    contents?: Array<{ type: string; submitted?: string; indexed?: string }>;
  };
  console.log(`  lastSubmitted:  ${s.lastSubmitted ?? "-"}`);
  console.log(`  lastDownloaded: ${s.lastDownloaded ?? "-"}`);
  console.log(
    `  warnings: ${s.warnings ?? 0}  errors: ${s.errors ?? 0}  isPending: ${s.isPending ?? false}`,
  );
  for (const c of s.contents ?? []) {
    console.log(
      `  contents[${c.type}]: submitted=${c.submitted ?? "?"} indexed=${c.indexed ?? "?"}`,
    );
  }
}
