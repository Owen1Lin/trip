# Private import worker

The existing public repository uses a standard `ubuntu-latest` GitHub Actions
runner. It polls the private queue approximately every 15 minutes; GitHub may
delay or skip scheduled starts. It is not a continuously running host. See
[GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
and [OIDC](https://docs.github.com/en/actions/reference/security/oidc).

There is no new paid host, GPU, or long-lived worker secret. The workflow obtains
a short-lived GitHub OIDC token; the Edge function verifies its RSA signature,
fixed issuer/audience, repository/owner, main ref, workflow, subject and allowed
event. Pull-request tokens are rejected. Only then may the function use its
server-side Supabase service credential for queue RPCs. User JWTs and model keys
never enter the workflow. Members cannot call worker RPCs.

## Processing

- `yt-dlp` reads public metadata and captions first, preferring human captions.
- Without readable captions, bounded public audio is transcribed with
  `faster-whisper` tiny, CPU INT8. Names and numbers remain unverified.
- Only if the user requests it, up to three video frames are sampled for
  Tesseract OCR. This is not complete visual understanding of the video.
- Ordinary articles use Trafilatura when Edge extraction cannot read them.
- Source restrictions, login pages, absent speech, unreadable files and limits
  produce an explicit failed task; they never count as successful summaries.
- Each file is limited to 50 MiB, videos to ten minutes, active processing to
  eight minutes and the complete workflow to fifteen minutes. Source text is
  bounded to 12,000 characters with an explicit truncation warning when needed.

All media resides in a temporary directory, removed after success or failure.
Nothing private is uploaded as an Actions artifact or written to logs. The
workflow logs only fixed diagnostic results, dependency installation and task
status. Results are stored in the owner's RLS-protected Supabase row.

## Egress

`public_proxy.py` binds only to loopback. Every HTTPS CONNECT resolves all
addresses, rejects non-public/literal-IP/local destinations, and pins the TCP
connection to the checked public IP. TLS remains end-to-end with ordinary
certificate/hostname verification. Redirects must remain HTTPS; HTTP is also
routed to the refusing gateway. `NO_PROXY` is removed only inside this isolated
runner's gateway scope and restored afterward. An already configured upstream
proxy makes processing fail closed; this worker must not bypass a managed
executor's network policy. FFmpeg reads local files with `file,pipe` protocols.

## Deployment

Apply `supabase/import-jobs.sql` without changing the existing itinerary tables.
Deploy both functions with `NODE_USE_ENV_PROXY=1 node scripts/deploy-import.mjs`
using the already configured management credential. Do not print credentials.

The configuration starts disabled. Deploy the main workflow, verify its real
OIDC diagnostic, and then enable its queue through the existing administrator
SQL connection:

```sql
update public.trip_import_worker_config set enabled=true where id;
```

A heartbeat older than twenty minutes makes new enqueue requests fail clearly.
Owners can reopen, inspect, retry at most twice, or delete their tasks. Each
owner is limited to two active jobs and five submissions/retries per ten
minutes. Rate receipts survive task deletion. Expired leases reject stale
completion. No automatic model call occurs after a background task: the member
chooses to summarize its verified result.

`workflow_dispatch` with `self_test=true`, or a trusted main push changing worker
files, runs real OIDC, fabricated speech/menu transcription/OCR, and bounded
fixed public-source checks. It never creates a member task. A refused public
source is reported as unavailable, not as a successful extraction.

## Versions and licenses

Pinned Python tools: yt-dlp 2026.8.19 (Unlicense), faster-whisper 1.2.1 (MIT),
Trafilatura 2.3.1 (Apache-2.0), Pillow 11.3.0 (HPND). FFmpeg and native Tesseract
use the runner's Ubuntu packages; their exact versions are recorded by the
workflow setup. FFmpeg build licensing depends on the Ubuntu configuration.
Tesseract is Apache-2.0. No PaddleOCR/GPU stack was installed: browser Tesseract
keeps uploaded originals on the user's device and fits this application better.

Official references: [yt-dlp](https://github.com/yt-dlp/yt-dlp),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[Trafilatura](https://github.com/adbar/trafilatura),
[Tesseract.js](https://github.com/naptha/tesseract.js),
[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR).
