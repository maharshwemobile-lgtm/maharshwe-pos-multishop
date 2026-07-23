# Mahar POS Multishop Deploy SOP

## 1. Core Rule

- Code ကို အရင် Local မှာရေးမယ်
- GitHub ကို ချက်ချင်းမတင်ဘူး
- VPS ပေါ် test deploy အရင်တင်မယ်
- VPS မှာ OK ဖြစ်မှ GitHub update လုပ်မယ်
- `main` = source branch
- `deploy/live` = VPS confirmed working branch
- `codex/...` = local feature/fix branches

## 2. Start New Work

Local မှာ အမြဲ `origin/main` ကနေ branch အသစ်ဖြတ်မယ်။

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b codex/fix-google-sheet-ui
```

## 3. Local Development

Local မှာ:

- code change
- build/test
- basic smoke check

```bash
npm install
npm run db:generate
npm run build
```

လိုအပ်ရင် extra checks:

```bash
npm run check:phase23
npm run check:phase11
```

## 4. VPS Test Deploy

GitHub မတင်ခင် VPS ကို temp deploy တင်မယ်။

သဘောတရား:

- current branch code ကို VPS repo ထဲ sync
- build
- PM2 restart
- health check
- browser test

VPS test deploy OK ဖြစ်ရမယ့် checklist:

- app opens
- login works
- target feature works
- no console-breaking UI issue
- API health OK
- DB migration/data issue မရှိ
- important flows မပျက်

### Frontend deploy target rule

- nginx live root = `/var/www/app.maharshwe.shop`
- deploy target က `dist/` folder မဟုတ်ဘူး
- `dist` build output ကို webroot root-level ထဲ sync လုပ်ရမယ်
- old root-level files နဲ့ `dist/` နှစ်နေရာခွဲမထားရ

Recommended command on VPS:

```bash
cd /opt/maharshwe/maharshwe-pos
npm run build
npm run deploy:webroot
```

Backend files ပါပြောင်းရင်:

```bash
cd /opt/maharshwe/maharshwe-pos
npm run build
npm run deploy:webroot:api
```

## 5. If VPS Test Fails

- GitHub update မလုပ်သေး
- local မှာပြန်ပြင်
- VPS ပေါ် retest
- success မရမချင်း repeat

## 6. If VPS Test Success

အဲဒီအချိန်မှ GitHub update လုပ်မယ်။

Recommended flow:

- local branch commit
- push branch
- if needed merge to `main`
- VPS confirmed version ကို `deploy/live` update

## 7. GitHub Branch Policy

### `main`

- stable source code
- reviewed / accepted code

### `deploy/live`

- VPS မှာ run တဲ့ verified code
- production-like reference branch

### `codex/...`

- in-progress work
- feature/fix/testing branches

## 8. Deploy / Release Rule

အမြဲတမ်း:

- Local → VPS Test → GitHub Update

မလုပ်ရ:

- Local → GitHub → VPS test later

လုပ်ရ:

- Local → VPS test first → success → GitHub

## 9. Backup Rule

Any risky change မတိုင်ခင်:

- DB backup
- VPS app snapshot if needed

Especially:

- DB restore
- auth changes
- payment changes
- tenant isolation changes
- settings changes

## 10. Emergency Rollback Rule

တစ်ခုခုပျက်ရင်:

- DB only issue → DB restore
- code only issue → `deploy/live` known-good version ပြန်တင်
- full issue → client-version backup / `deploy/live` branch ကနေ rollback

## 11. Logo / Brand / UI Rule

- official logo source = one place only
- duplicate asset names မပွားစေ
- local UI change ပြီးရင် VPS browser hard refresh / service worker cache check လုပ်

## 12. Google Sheet / Integration Rule

Any integration change လုပ်ရင်:

- local code check
- VPS save/test flow check
- actual webhook response check
- then GitHub update

## 13. Mail / Notification Rule

Any mail or push change လုပ်ရင်:

- secrets GitHub မတင်ရ
- VPS env only
- test send on VPS
- success မှ GitHub update

## 14. Daily Working Example

နေ့စဉ်လုပ်ပုံ:

- `main` pull
- branch create
- local code
- local build/test
- VPS temp deploy
- browser/API test
- OK
- commit/push
- update `deploy/live`

## 15. Simple Team Rule

> GitHub မှာ တင်ထားတဲ့ code က VPS စမ်းပြီး OK ဖြစ်တဲ့ code ပဲဖြစ်ရမယ်

## Recommended Command Pattern

### Local start

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b codex/your-task-name
```

### Local verify

```bash
npm install
npm run db:generate
npm run build
```

### After VPS success

```bash
git add .
git commit -m "your change"
git push origin codex/your-task-name
```

### If making live reference update later

```bash
git checkout deploy/live
git merge codex/your-task-name
git push origin deploy/live
```

## Final Short SOP

- Local မှာရေး
- VPS ပေါ်စမ်း
- OK ဖြစ်မှ GitHub တင်
- `main` = source
- `deploy/live` = VPS verified
- DB/secrets ကို VPS မှာပဲထိန်း
