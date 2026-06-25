---
layout: default
title: "Done-for-you bank statement retrieval for bookkeepers | Taprun"
description: "We pull your clients' bank & credit-card statements every month — the ones QuickBooks won't fetch — on your own machine. Credentials never leave your computer. No AI. Free pilot, then $99/month flat."
permalink: /done-for-you/bookkeeping-bank-statements/
---

# We pull your client bank statements — so you never log into 20 bank portals at month-end

Every close, you log into client bank and credit-card portals by hand to pull the
statement PDFs QuickBooks won't fetch. And it isn't just the tiny banks — even when the
feed *connects*, it grabs the **transactions** but not the actual **statement PDF** you
need to close the reconciliation, so someone still logs into Citi, Amex, or WF every
month *just for the rec PDF*. Add the small banks and credit unions Plaid can't connect at
all, and twenty clients across thirty institutions is thirty separate logins, every single
month. It's the real job nobody bills for: *document logistics, not accounting.*

"Just get read-only bank access" is the usual advice — when it works. Half the time the
bank offers no view-only role, it's hours on the phone with the client and the treasury
desk, or the client simply freezes at *"give my accountant access to my bank."* This skips
all of that: it rides the login you already use.

**We automate that one step for you, on your own computer.** Not in our cloud. Not with
your client passwords on our servers. The automation runs inside *your* own Chrome,
riding the login session you already have — and there's **no AI** anywhere in it.

## How it works

1. **Tell us the banks.** Email us which client portals you pull from and what you
   download (e.g. "monthly checking + credit-card PDF from First Citizens and the local CU").
2. **One setup call.** On a 30-minute screen share, we record each login → download on
   *your* machine, in *your* browser. You watch every step. You stay logged in — we never
   see, store, or transmit a password.
3. **It runs on schedule.** On the 1st of each month the statements land in your
   QuickBooks / Hubdoc / Drive folder automatically. Zero clicks.
4. **When a bank changes its site, we fix it.** Portals redesign, sessions expire. Fixing
   the recording is included — that's the point of the retainer.

## Pricing

| | Pilot | Retainer |
|---|---|---|
| **Price** | **Free** | **$99/month, flat** |
| Institutions | 2 | up to 10 (more: ask) |
| Duration | 2 weeks | monthly, **cancel anytime** |
| Setup | screen-share call | included |
| Breakage fixes | included | included, 48h response |

No contract, no per-statement fees, no surprise usage billing. The automation files are
plain JSON on your machine — yours forever, even if you cancel.

## Why this is different from cloud "statement pullers"

Tools like Hubdoc, LedgerDocs Bank Fetching, or other cloud fetchers do something
similar — **by storing your clients' bank passwords on their servers and logging in from
their cloud.** Banks are actively killing that: credentials in a datacenter, behind a
clean datacenter IP, is exactly the pattern their bot-detection now device-blocks, and
it's often a terms-of-service problem.

Taprun is built the other way around. The automation runs **on your machine, in your
browser, with your own login** — so to the bank it looks like you, the returning human,
because it is. **Credentials never leave your computer — that's architecture, not a
policy promise.** And the replay is **deterministic** (a fixed, auditable program — *not*
AI improvising clicks on a live bank account), fully logged, so you have a clean record
for your E&O file.

> You already pay $47–93/month for cyber liability cover *because* you hold client bank
> logins. Keeping those logins on your own machine — never in anyone's cloud — is the
> point.

## Why no AI

For statements you need the **same result every month**, traceable line by line — not a
model that might quietly mis-key a number or "decide" something. Taprun doesn't fetch by
guessing transcripts or reading the screen with AI; it replays the exact recorded steps.
Nothing learns, nothing trains on your client data, nothing improvises on a bank account.

## Who this is for

- **Solo bookkeepers & small firms** doing monthly reconciliations for small-business clients (under ~$500k topline)
- Anyone whose **QuickBooks feed pulls the transactions but not the statement PDF** — Citi, Amex and others — and still logs in monthly *just for the rec PDF*
- Anyone whose clients bank at **small banks or credit unions QuickBooks / Plaid can't connect**
- Bookkeepers tired of the month-end statement chase — who'd rather buy the outcome than build the tool

## Start the free pilot

Email **[hello@taprun.dev](mailto:hello@taprun.dev?subject=Bookkeeping%20bank-statement%20pilot)**
with two client banks you'd like off your plate at month-end. We'll reply within 24 hours
with a setup-call link.

<small>Prefer to build it yourself? Taprun's engine is free and the spec is MIT — see the
[homepage](/) and the general [done-for-you portal pulls](/done-for-you/) page. The
service is for people who'd rather buy the outcome than the tool.</small>

## FAQ

**How do I get client bank statements QuickBooks won't fetch?**
QuickBooks' bank feed only connects ~3,000 US institutions through Plaid/Finicity; small
banks and credit unions on cores without an API simply aren't covered, so QuickBooks tells
you to upload them manually. The remaining options are: ask the client every month (slow),
log into each portal yourself (tedious), or have the login-and-download step automated on
your own machine — which is what this service does.

**Is it safe to give a cloud tool my client's bank login?**
Storing a client's bank password on a third-party server is a security and
terms-of-service risk, and it's the exact pattern banks are now blocking. The safer
pattern is to keep the login on your own machine and automate locally — the credential
never crosses to anyone's cloud.

**Can I download bank statements into QuickBooks automatically without AI?**
Yes. This is a deterministic recorded automation — it replays the same login → download
steps every month, fully logged, with no AI model reading the screen or making decisions.

**What about small banks and credit unions Plaid can't connect?**
Those are exactly the institutions this is built for. If a human can log in and download
the statement, the automation can replay that on your machine — no API required.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How do I get client bank statements QuickBooks won't fetch?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "QuickBooks' bank feed only connects about 3,000 US institutions through Plaid/Finicity; small banks and credit unions without an API aren't covered, so QuickBooks routes you to manual upload. The options are to ask the client monthly, log into each portal yourself, or have the login-and-download step automated on your own machine."
      }
    },
    {
      "@type": "Question",
      "name": "Is it safe to give a cloud tool my client's bank login?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Storing a client's bank password on a third-party server is a security and terms-of-service risk and is the pattern banks are now blocking. Keeping the login on your own machine and automating locally means the credential never crosses to anyone's cloud."
      }
    },
    {
      "@type": "Question",
      "name": "Can I download bank statements into QuickBooks automatically without AI?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. It is a deterministic recorded automation that replays the same login and download steps every month, fully logged, with no AI model reading the screen or making decisions."
      }
    },
    {
      "@type": "Question",
      "name": "What about small banks and credit unions Plaid can't connect?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Those institutions are exactly what this is built for. If a human can log in and download the statement, the automation can replay that on your own machine with no API required."
      }
    }
  ]
}
</script>
