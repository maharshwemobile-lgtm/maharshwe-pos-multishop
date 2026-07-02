# ChatGPT VPS + GitHub Working Flow

This file documents the working style that should be used for Mahar Shwe POS development requests in ChatGPT, especially across new chats. It captures the flow used successfully in the conversation that produced PR #44 through PR #51 style work.

## Goal

When the user asks for Mahar Shwe POS code changes, VPS deployment help, GitHub PR work, Google Sheet sync work, or UI cleanup, respond with the same operational flow used in this chat:

1. Understand the requested change in Burmese.
2. Inspect the exact source first.
3. Give copy/paste ready commands.
4. Patch only the intended files.
5. Run build/checks.
6. Deploy to production when the user asks for a hotfix.
7. Ask the user to paste terminal output.
8. Commit, push, and open a draft PR after successful deploy.
9. Sync `mini-mart` after merge.
10. Keep explanations short and actionable.

## Language and response style

- Reply primarily in Burmese, with technical terms and code in English where natural.
- Prefer concise status summaries and copy/paste terminal commands.
- Use clear labels such as `OK`, `STOP`, `Backup`, `Build passed`, `API health OK`, and `PR created`.
- Use fenced `bash` blocks for commands.
- Avoid long theory unless the user asks why.
- Do not expose secrets, passwords, API keys, tokens, `.env` values, or full private credentials.
- If the user pastes terminal output, read it carefully and react to what actually happened.

## Repository and production defaults

Use these defaults unless the user says otherwise:

- Repository: `maharshwemobile-lgtm/maharshwe-pos`
- Base branch: `mini-mart`
- VPS project path: `/opt/maharshwe/maharshwe-pos`
- Frontend webroot: `/var/www/app.maharshwe.shop`
- Frontend URL: `https://app.maharshwe.shop`
- API health URL: `https://api.maharshwe.shop/health`
- PM2 process: `maharshwe-pos-api`
- Branch naming: `codex/<short-description>`
- PRs: open as draft by default

## Standard inspect-first pattern

For a new change, do not guess file locations. Start with an inspect command like this:

```bash
cd /opt/maharshwe/maharshwe-pos && \
git switch mini-mart && git pull origin mini-mart && \
git status -sb && \
test -z "$(git status --porcelain)" || (echo "STOP: working tree မရှင်းသေးပါ"; git status -sb; exit 1) && \
git branch -D codex/<feature-branch> 2>/dev/null || true && \
git switch -c codex/<feature-branch> && \
echo "== inspect source ==" && \
grep -RIn "<keywords>" src server prisma integrations 2>/dev/null | sed -n '1,320p' && \
echo "== current branch/status ==" && \
git branch --show-current && git status -sb
```

After the user pastes output, make the patch based on exact files and exact symbols found in the output.

## Standard patch + build + deploy pattern

When the user wants the fix applied to production, provide one copy/paste command that:

1. Confirms current branch and status.
2. Patches files using `python3` or heredoc.
3. Verifies source with `grep`.
4. Runs `git diff --stat` and `git diff --check`.
5. Runs `npm run build`.
6. Backs up the current webroot.
7. Copies `dist` to the webroot.
8. Reloads nginx.
9. Restarts PM2 only when backend files changed.
10. Checks app HTTP and API health.

Frontend-only deploy pattern:

```bash
cd /opt/maharshwe/maharshwe-pos && \
npm run build && \
WEBROOT="/var/www/app.maharshwe.shop" && TS=$(date +%Y%m%d%H%M%S) && \
tar -czf "/opt/maharshwe/backups/app-webroot-before-<name>-$TS.tar.gz" -C /var/www app.maharshwe.shop && \
rm -rf "$WEBROOT"/* && cp -a dist/. "$WEBROOT"/ && chown -R www-data:www-data "$WEBROOT" && \
nginx -t && systemctl reload nginx && \
curl -I https://app.maharshwe.shop && echo && \
curl -fsS https://api.maharshwe.shop/health && echo
```

Frontend + backend deploy pattern:

```bash
cd /opt/maharshwe/maharshwe-pos && \
npm run build && \
WEBROOT="/var/www/app.maharshwe.shop" && TS=$(date +%Y%m%d%H%M%S) && \
tar -czf "/opt/maharshwe/backups/app-webroot-before-<name>-$TS.tar.gz" -C /var/www app.maharshwe.shop && \
rm -rf "$WEBROOT"/* && cp -a dist/. "$WEBROOT"/ && chown -R www-data:www-data "$WEBROOT" && \
nginx -t && systemctl reload nginx && \
pm2 restart maharshwe-pos-api --update-env && sleep 3 && \
curl -I https://app.maharshwe.shop && echo && \
curl -fsS https://api.maharshwe.shop/health && echo
```

## Standard validation language

After successful output, summarize like this:

```text
Build passed ✅
Production deploy OK ✅
App HTTP/2 200 ✅
API health OK ✅
Backup saved: <backup-file>
```

Then tell the user to press `Ctrl + F5` or use Incognito if the UI still looks old.

## Commit and push pattern

After successful deploy, commit only intended files. Do not use `git add -A` if unrelated files may exist.

```bash
cd /opt/maharshwe/maharshwe-pos && \
git status -sb && \
git diff --stat && \
git add <intended-file-1> <intended-file-2> && \
git commit -m "<short commit message>" && \
git push -u origin $(git branch --show-current) && \
git log --oneline -6 && \
git status -sb
```

If `git diff --stat` shows files that were not committed, stop and ask the user to commit the remaining intended files before opening a PR.

## Draft PR pattern

Open a draft PR after the branch is pushed.

PR title pattern:

```text
[codex] <short description>
```

PR body should include:

- Summary
- Impact
- Validation
- Production deploy note when applicable

Example validation bullets:

```text
- `npm run build` passed.
- Production frontend deployed successfully.
- PM2 API restarted when backend changed.
- API health check returned OK.
```

After PR creation, reply with:

```text
PR #<number> create ပြီးပါပြီ ✅
Branch: <branch>
Base: mini-mart
Status: Draft
Production: already deployed ✅
```

Then give the PR link and say `merge လုပ်ပါ`.

## After merge pattern

When the user says `merge done`, reply with a sync command:

```bash
cd /opt/maharshwe/maharshwe-pos && \
git switch mini-mart && \
git pull origin mini-mart && \
git log --oneline -8 && \
git status -sb && \
curl -I https://app.maharshwe.shop && echo && \
curl -fsS https://api.maharshwe.shop/health && echo
```

If production was already hotfixed before the PR, say deploy is not needed again.

## Handling terminal output

When the user pastes output:

- Check the branch name.
- Check whether build passed or failed.
- Check whether PM2 is online.
- Check HTTP status and API health.
- Check if `git status -sb` is clean.
- Check whether all modified files were committed.
- If a warning is harmless, say so clearly. Example: Vite chunk-size warning is informational, not a failure.
- If there is an error, give a direct next command, not a long explanation.

## UI cleanup workflow

For UI cleanup requests:

1. Search for visible text, CSS classes, and component names.
2. Patch component source when possible.
3. Use CSS fallback only when the exact component wrapper is hard to remove safely.
4. Verify by grepping built `dist` when hiding visible text.
5. Ask the user to confirm after `Ctrl + F5`.

## Repair system workflow

For repair-related requests:

- Source files often include:
  - `src/RepairPlatformPage.jsx`
  - `src/RepairOperationsWorkspace.jsx`
  - `src/RepairSummaryBelowFinance.jsx`
  - `src/repair-platform.css`
  - `src/repair-operations-workspace.css`
  - `server/repair-platform-api.js`
  - `server/repair-finance-api.js`
- For status updates, inspect `/api/repair-platform/jobs/:id/status`.
- For repair finance, inspect `/api/repair-platform/jobs/:id/finance` and `/api/repair-platform/finance/weekly`.
- For IMEI or serial history, inspect `/api/repair-platform/device-history`.

## Google Sheet sync workflow

For Google Sheet sync tasks:

- Source files often include:
  - `src/settings/GoogleSheetIntegrationSettingsV23.jsx`
  - `server/google-sheet-project-settings-v23.js`
  - `server/google-sheet-project-export-api-v23.js`
  - `server/google-sheet-project-export-data-v23.js`
  - `integrations/google-apps-script/MaharShwePosSync.gs`
- Keep `POS_BASE_URL`, `POS_SHOP_SLUG`, and `POS_SYNC_SECRET` in Script Properties.
- Auto-fill shop slug from backend/session when possible.
- Never print real secrets in chat.

## Safety and quality rules

- Do not delete Codex notes or project documentation unless the user explicitly asks.
- Do not silently stage unrelated changes.
- Do not promise background work.
- Do not guess if an inspect command is needed.
- Prefer small PRs with one clear purpose.
- Keep rollback backups before production webroot replacement.
- Always preserve user data and credentials.

## Example reply shape

Use this shape for most code-change turns:

```text
နားလည်ပါပြီ။ ဒီ PR မှာ ဒီလိုပြင်မယ်—

1) <change one>
2) <change two>
3) <change three>

အရင် source နေရာတိတိကျကျစစ်ပါ—

```bash
<inspect command>
```

Output ပို့ပါ။ နောက် command မှာ patch + build + deploy ပေးမယ်။
```

For successful deploy:

```text
အောင်မြင်ပါပြီ ✅

Build passed ✅
Production deploy OK ✅
App HTTP/2 200 ✅
API health OK ✅

အခု commit + push လုပ်ပါ—

```bash
<commit command>
```
```

For PR created:

```text
PR #<number> create ပြီးပါပြီ ✅

ပါဝင်တာ—
- <summary>

PR link: <url>

merge လုပ်ပါ။
```
