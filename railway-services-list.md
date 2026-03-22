# Railway Services — רשימת יצירה ידנית

**איך יוצרים Service ב-Railway:**
1. Railway Dashboard → New Service → GitHub Repo → `sallysale/Sallysale-bots`
2. Service Name: כמו בעמודה "שם Service"
3. Settings → Source → Root Directory: כמו בעמודה "Root Directory"
4. Variables → הוסף את המשתנים הנ"ל + תמיד `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
5. Deploy

**משתנים קבועים לכל בוט (הוסף תמיד):**
```
SUPABASE_URL         = https://jmfstybgwslpvpemdbrk.supabase.co
SUPABASE_SERVICE_KEY = eyJ... (service role key)
```

---

## קבוצה 1 — SUPABASE בלבד
> 34 Services — רק `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-08-rss-aggregator | bots/bot-08-rss-aggregator | `0 * * * *` |
| 2 | bot-13-google-trends | bots/bot-13-google-trends | `0 */12 * * *` |
| 3 | bot-15-seasonal-intel | bots/bot-15-seasonal-intel | `0 6 * * *` |
| 4 | bot-17-price-validator | bots/bot-17-price-validator | `0 * * * *` |
| 5 | bot-18-price-history | bots/bot-18-price-history | `0 6 * * *` |
| 6 | bot-19-link-validator | bots/bot-19-link-validator | `0 */6 * * *` |
| 7 | bot-20-expiry-detector | bots/bot-20-expiry-detector | `0 */2 * * *` |
| 8 | bot-23-deal-scorer | bots/bot-23-deal-scorer | `0 */4 * * *` |
| 9 | bot-26-currency-bot | bots/bot-26-currency-bot | `0 * * * *` |
| 10 | bot-27-geo-pricing | bots/bot-27-geo-pricing | `0 */6 * * *` |
| 11 | bot-28-variant-matcher | bots/bot-28-variant-matcher | `0 */12 * * *` |
| 12 | bot-30-anti-abuse | bots/bot-30-anti-abuse | `0 * * * *` |
| 13 | bot-33-instagram-bot | bots/bot-33-instagram-bot | `0 */4 * * *` |
| 14 | bot-34-seo-bot | bots/bot-34-seo-bot | `0 2 * * *` |
| 15 | bot-37-rate-limiter | bots/bot-37-rate-limiter | `0 3 * * *` |
| 16 | bot-38-click-fraud | bots/bot-38-click-fraud | `0 * * * *` |
| 17 | bot-39-backup-bot | bots/bot-39-backup-bot | `0 1 * * 0` |
| 18 | bot-41-sally-points | bots/bot-41-sally-points | on-demand |
| 19 | bot-42-leaderboard | bots/bot-42-leaderboard | `0 0 * * *` |
| 20 | bot-43-wishlist-scanner | bots/bot-43-wishlist-scanner | `0 */4 * * *` |
| 21 | bot-45-demand-tracker | bots/bot-45-demand-tracker | `0 */6 * * *` |
| 22 | bot-47-price-history-chart | bots/bot-47-price-history-chart | `0 6 * * *` |
| 23 | bot-50-personalization | bots/bot-50-personalization | `0 */6 * * *` |
| 24 | bot-52-coverage-tracker | bots/bot-52-coverage-tracker | `0 5 * * *` |
| 25 | bot-53-flash-sale-detector | bots/bot-53-flash-sale-detector | `*/30 * * * *` |
| 26 | bot-54-stock-monitor | bots/bot-54-stock-monitor | `0 */2 * * *` |
| 27 | bot-55-coupon-validator | bots/bot-55-coupon-validator | `0 */4 * * *` |
| 28 | bot-56-bundle-detector | bots/bot-56-bundle-detector | `0 */12 * * *` |
| 29 | bot-57-data-cleaner | bots/bot-57-data-cleaner | `0 3 * * *` |
| 30 | bot-59-social-proof | bots/bot-59-social-proof | `*/30 * * * *` |
| 31 | bot-61-legal-validator | bots/bot-61-legal-validator | `0 4 * * *` |
| 32 | bot-62-gdpr-manager | bots/bot-62-gdpr-manager | `0 2 * * *` |
| 33 | bot-63-cashback-detector | bots/bot-63-cashback-detector | `0 */6 * * *` |
| 34 | bot-64-returns-policy | bots/bot-64-returns-policy | `0 5 * * 0` |
| 35 | bot-66-ab-test | bots/bot-66-ab-test | `0 0 * * *` |
| 36 | bot-69-affiliate-link-tester | bots/bot-69-affiliate-link-tester | `0 5 * * *` |
| 37 | bot-70-deal-quality-feedback | bots/bot-70-deal-quality-feedback | `0 */2 * * *` |
| 38 | bot-coordinator | bots/bot-coordinator | on-demand |
| 39 | bot-failover | bots/bot-failover | on-demand |

---

## קבוצה 2 — SUPABASE + SCRAPERAPI_KEY
> 6 Services — הוסף גם `SCRAPERAPI_KEY`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-11-amazon-direct | bots/bot-11-amazon-direct | `0 */2 * * *` |
| 2 | bot-12-google-shopping | bots/bot-12-google-shopping | `0 8 * * *` |
| 3 | bot-16-competitor-monitor | bots/bot-16-competitor-monitor | `0 */3 * * *` |
| 4 | bot-21-image-validator | bots/bot-21-image-validator | `0 0 * * *` |
| 5 | bot-48-review-aggregator | bots/bot-48-review-aggregator | `0 3 * * *` |
| 6 | bot-49-visual-search | bots/bot-49-visual-search | `0 4 * * *` |

---

## קבוצה 3 — SUPABASE + SCRAPERAPI_KEY + OPENAI_API_KEY
> 2 Services — הוסף גם `SCRAPERAPI_KEY` + `OPENAI_API_KEY`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-09-scraping-tier1 | bots/bot-09-scraping-tier1 | `0 */6 * * *` |
| 2 | bot-10-scraping-tier2 | bots/bot-10-scraping-tier2 | `0 */12 * * *` |

---

## קבוצה 4 — SUPABASE + TELEGRAM
> 5 Services — הוסף גם `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID`

| # | שם Service | Root Directory | Cron | משתנים נוספים |
|---|-----------|----------------|------|--------------|
| 1 | bot-40-health-monitor | bots/bot-40-health-monitor | `*/5 * * * *` | `SITE_URL` |
| 2 | bot-67-bot-block-detector | bots/bot-67-bot-block-detector | `0 * * * *` | — |
| 3 | bot-68-bot-health-auditor | bots/bot-68-bot-health-auditor | `0 7 * * *` | — |
| 4 | bot-71-dependency-scanner | bots/bot-71-dependency-scanner | `0 0 * * *` | — |
| 5 | bot-72-daily-report | bots/bot-72-daily-report | `0 8 * * *` | — |
| 6 | bot-watchdog | bots/bot-watchdog | `*/5 * * * *` | — |

---

## קבוצה 5 — SUPABASE + TELEGRAM + TELEGRAM_CHANNEL_ID
> 1 Service — הוסף גם `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID` + `TELEGRAM_CHANNEL_ID`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-31-telegram-bot | bots/bot-31-telegram-bot | `0 * * * *` |

---

## קבוצה 6 — SUPABASE + RESEND
> 4 Services — הוסף גם `RESEND_API_KEY` + `FROM_EMAIL` + `SITE_URL`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-36-daily-digest | bots/bot-36-daily-digest | `0 8 * * *` |
| 2 | bot-44-alert-sender | bots/bot-44-alert-sender | `0 */2 * * *` |
| 3 | bot-46-abandonment-bot | bots/bot-46-abandonment-bot | `0 */2 * * *` |
| 4 | bot-65-email-digest | bots/bot-65-email-digest | `0 9 * * 1` |

---

## קבוצה 7 — SUPABASE + VAPID
> 1 Service — הוסף גם `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_EMAIL`

```bash
# צור VAPID keys אם עוד אין:
npx web-push generate-vapid-keys
```

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-35-push-notifications | bots/bot-35-push-notifications | `0 */2 * * *` |

---

## קבוצה 8 — SUPABASE + IMPACT
> 1 Service — הוסף גם `IMPACT_ACCOUNT_SID` + `IMPACT_AUTH_TOKEN`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-03-impact-api | bots/bot-03-impact-api | `0 */4 * * *` |

---

## קבוצה 9 — SUPABASE + AWIN
> 1 Service — הוסף גם `AWIN_PUBLISHER_ID`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-04-awin-api | bots/bot-04-awin-api | `0 */4 * * *` |

---

## קבוצה 10 — SUPABASE + EBAY
> 1 Service — הוסף גם `EBAY_APP_ID` + `EBAY_CAMPAIGN_ID`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-07-ebay-epn | bots/bot-07-ebay-epn | `0 * * * *` |

---

## קבוצה 11 — SUPABASE + OPENAI
> 1 Service — הוסף גם `OPENAI_API_KEY`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-22-dedup-engine | bots/bot-22-dedup-engine | `0 */12 * * *` |
| 2 | bot-24-auto-categorizer | bots/bot-24-auto-categorizer | `0 */2 * * *` |

---

## קבוצה 12 — SUPABASE + DEEPL
> 1 Service — הוסף גם `DEEPL_API_KEY`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-25-auto-translator | bots/bot-25-auto-translator | `0 */4 * * *` |

---

## קבוצה 13 — SUPABASE + מרובה (Affiliate)
> 1 Service — הוסף גם `TRADEDOUBLER_TOKEN` + `CJ_WEBSITE_ID` + `AWIN_PUBLISHER_ID` + `EBAY_CAMPAIGN_ID`

| # | שם Service | Root Directory | Cron |
|---|-----------|----------------|------|
| 1 | bot-29-affiliate-sorter | bots/bot-29-affiliate-sorter | `0 */4 * * *` |

---

## סיכום — כמה לעשות ביום

| יום | קבוצה | Services | זמן משוער |
|-----|-------|---------|-----------|
| יום 1 | קבוצה 1, שורות 1-15 | 15 | ~30 דקות |
| יום 2 | קבוצה 1, שורות 16-39 | 24 | ~45 דקות |
| יום 3 | קבוצות 2-5 | 14 | ~25 דקות |
| יום 4 | קבוצות 6-13 | 11 | ~20 דקות |
| **סה"כ** | | **64 Services** | **~2 שעות** |

---

## ✅ כבר קיימים ב-Railway (לא ליצור מחדש)
- bot-17-price-validator ← כבר פעיל, רק לוודא Root Directory
- bot-18-price-history
- bot-19-link-validator
- bot-20-expiry-detector
- bot-23-deal-scorer
- bot-26-currency-bot
