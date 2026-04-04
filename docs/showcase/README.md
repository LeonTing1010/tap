# Tappy Showcase

10 real-world taps that demonstrate Tappy's power. Each was forged once with AI, and now runs forever at $0.

---

## 1. Hacker News Top Stories

**Command:** `tappy forge "scrape Hacker News front page stories with rank, title, URL, score, and comment count"`

**Run:** `tappy run hackernews hot`

**Output:** `hackernews/hot.tap.js`

**Description:** Fetches the top 30 stories from Hacker News using the official Algolia API. Returns structured data with rank, title, URL, score, author, and comment count.

**Execution Layer:** Layer 1 -- `tap.fetch` (direct API call, zero browser overhead)

**Cost Comparison:**
| Method | Cost per run |
|--------|-------------|
| Tappy | $0.00 |
| Zapier RSS | $0.01/task |
| Browser Use | ~$0.05 (AI tokens) |

---

## 2. GitHub Trending

**Command:** `tappy forge "get GitHub trending repositories with stars and descriptions"`

**Run:** `tappy run github trending`

**Output:** `github/trending.tap.js`

**Description:** Extracts trending repositories from GitHub's trending page. Uses DOM extraction since GitHub trending has no public API. Returns repo name, description, language, stars today, and total stars.

**Execution Layer:** Layer 2 -- `extract` (DOM parsing via `tap.eval`)

**Cost Comparison:**
| Method | Cost per run |
|--------|-------------|
| Tappy | $0.00 |
| GitHub API + Zapier | $0.02/task |
| Browser Use | ~$0.08 (AI tokens) |

---

## 3. 微博热搜 (Weibo Hot Search)

**Command:** `tappy forge "获取微博热搜榜前50条"`

**Run:** `tappy run weibo hot`

**Output:** `weibo/hot.tap.js`

**Description:** Fetches Weibo's real-time hot search rankings via the mobile API. Returns rank, keyword, hot value, and category tag for each trending topic.

**Execution Layer:** Layer 1 -- `tap.fetch` (mobile API endpoint)

**Cost Comparison:**
| Method | Cost per run |
|--------|-------------|
| Tappy | $0.00 |
| Custom scraper | Server costs |
| Browser Use | ~$0.06 (AI tokens) |

---

## 4. Reddit Monitor

**Command:** `tappy forge "monitor Reddit subreddit for new posts matching keywords"`

**Run:** `tappy run reddit monitor --subreddit programming --keyword "rust OR go"`

**Output:** `reddit/monitor.tap.js`

**Description:** Monitors any subreddit's new posts via Reddit's JSON API. Filters by keyword, returns title, author, score, comment count, and permalink. Perfect for trend watching.

**Execution Layer:** Layer 1 -- `tap.fetch` (Reddit JSON API, append `.json` to any listing)

**Cost Comparison:**
| Method | Cost per run |
|--------|-------------|
| Tappy | $0.00 |
| Zapier Reddit trigger | $0.01/task |
| IFTTT | $0.01/task |

---

## 5. 小红书搜索 (Xiaohongshu Search)

**Command:** `tappy forge "搜索小红书笔记并提取标题、点赞数、作者"`

**Run:** `tappy run xiaohongshu search --keyword "咖啡推荐"`

**Output:** `xiaohongshu/search.tap.js`

**Description:** Navigates to Xiaohongshu search, enters keywords, and extracts note cards from results. Handles the SPA with proper wait conditions. Returns title, author, likes, and cover image URL.

**Execution Layer:** Layer 3 -- `nav` + `eval` (requires full browser interaction, no public API)

**Cost Comparison:**
| Method | Cost per run |
|--------|-------------|
| Tappy | $0.00 |
| Manual browsing | ~10 min human time |
| Browser Use | ~$0.10 (AI tokens + navigation) |

---

## 6. YouTube Channel Stats

**Command:** `tappy forge "get latest videos from a YouTube channel with views and publish date"`

**Run:** `tappy run youtube channel --id "@firaborealisphotography"`

**Output:** `youtube/channel.tap.js`

**Description:** Fetches channel data via YouTube's innertube API. Returns video title, view count, publish date, duration, and thumbnail URL for the latest uploads. No API key required.

**Execution Layer:** Layer 1 -- `tap.fetch` (innertube API endpoint)

**Cost Comparison:**
| Method | Cost per run |
|--------|-------------|
| Tappy | $0.00 |
| YouTube Data API | Free tier limited |
| Browser Use | ~$0.07 (AI tokens) |

---

## 7. 百度热搜 (Baidu Hot Search)

**Command:** `tappy forge "获取百度热搜榜实时数据"`

**Run:** `tappy run baidu hot`

**Output:** `baidu/hot.tap.js`

**Description:** Fetches Baidu's real-time hot search rankings from the internal API. Returns rank, keyword, search volume, and trend tag (new/hot/rising).

**Execution Layer:** Layer 1 -- `tap.fetch` (internal API)

**Cost Comparison:**
| Method | Cost per run |
|--------|-------------|
| Tappy | $0.00 |
| Custom Python scraper | Server costs |
| Browser Use | ~$0.05 (AI tokens) |

---

## 8. Product Hunt Daily

**Command:** `tappy forge "get today's top products from Product Hunt with votes and description"`

**Run:** `tappy run producthunt daily`

**Output:** `producthunt/daily.tap.js`

**Description:** Fetches the daily top products via Product Hunt's GraphQL API. Returns product name, tagline, vote count, maker info, and topics. Sorted by votes.

**Execution Layer:** Layer 1 -- `tap.fetch` (GraphQL API)

**Cost Comparison:**
| Method | Cost per run |
|--------|-------------|
| Tappy | $0.00 |
| Zapier PH integration | $0.02/task |
| Browser Use | ~$0.06 (AI tokens) |

---

## 9. Bilibili热门 (Bilibili Trending)

**Command:** `tappy forge "获取B站热门视频排行榜"`

**Run:** `tappy run bilibili hot`

**Output:** `bilibili/hot.tap.js`

**Description:** Fetches Bilibili's popular video rankings from the public API. Returns title, author (UP主), view count, danmaku count, and video duration. Covers the top 100 trending videos.

**Execution Layer:** Layer 1 -- `tap.fetch` (Bilibili public API)

**Cost Comparison:**
| Method | Cost per run |
|--------|-------------|
| Tappy | $0.00 |
| Custom scraper | Server costs |
| Browser Use | ~$0.06 (AI tokens) |

---

## 10. LinkedIn Jobs

**Command:** `tappy forge "search LinkedIn jobs by title and location, extract company and salary"`

**Run:** `tappy run linkedin jobs --title "AI Engineer" --location "San Francisco"`

**Output:** `linkedin/jobs.tap.js`

**Description:** Navigates to LinkedIn job search, enters criteria, and extracts job listings. Handles pagination and dynamic loading. Returns job title, company, location, salary range (when available), and posting date.

**Execution Layer:** Layer 3 -- `nav` + `eval` (requires authenticated browser session, no public API for full data)

**Cost Comparison:**
| Method | Cost per run |
|--------|-------------|
| Tappy | $0.00 |
| LinkedIn Recruiter | $8,999/year |
| Browser Use | ~$0.12 (AI tokens + auth flow) |

---

## Execution Layers Explained

| Layer | Method | When to use | Example |
|-------|--------|-------------|---------|
| **Layer 1** | `tap.fetch` | Site has an API (public or discoverable) | Hacker News, Reddit, Bilibili |
| **Layer 2** | `extract` (DOM) | Static/SSR pages with no API | GitHub Trending |
| **Layer 3** | `nav` + `eval` | SPAs requiring full browser interaction | Xiaohongshu, LinkedIn |

**Layer 1 is always preferred.** `tap.fetch` is fastest, most reliable, and least likely to break. Tappy's forge pipeline automatically discovers APIs via network inspection before falling back to DOM extraction or browser automation.

---

## Total Cost: 10 Taps Running Daily for 1 Year

| Platform | Annual cost |
|----------|------------|
| **Tappy** | **$0.00** (after initial forge) |
| Zapier | ~$365 (10 zaps x $0.01 x 365) |
| Browser Use | ~$1,825 (10 tasks x $0.05 x 365) |
| Manual | ~2,400 hours of human time |

**Programs beat prompts.**
