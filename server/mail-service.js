const DEFAULT_APP_URL = "https://app.maharshwe.shop";
const DEFAULT_COMMUNITY_URL = "https://t.me/+2gc9ml7iMgk1ZThl";
const DEFAULT_SUPPORT_TELEGRAM = "https://t.me/Mylifemychoice68";
const DEFAULT_SUBJECT = "Mahar Mobile Shop POS Account Activated / အကောင့်ဖွင့်ပြီးပါပြီ";

function appUrl() {
  return String(process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

function resendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(
    process.env.RESEND_FROM
      || process.env.EMAIL_FROM
      || process.env.SMTP_FROM
      || "Mahar Mobile Shop POS <no-reply@maharshwe.shop>"
  ).trim();
  const replyTo = String(process.env.RESEND_REPLY_TO || process.env.EMAIL_REPLY_TO || "maharshwemobile@gmail.com").trim();
  return { ready: Boolean(apiKey && from), apiKey, from, replyTo };
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 14; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4, 9)}-${out.slice(9)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeMessage(error) {
  return String(error?.message || error || "EMAIL_SEND_FAILED")
    .replace(/re_[A-Za-z0-9_\-]+/g, "[redacted-resend-key]")
    .replace(/[A-Za-z0-9]{4}-[A-Za-z0-9]{5}-[A-Za-z0-9]{5}/g, "[redacted]");
}

function formatDate(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function buildWelcomeEmail(safe) {
  const communityUrl = String(process.env.POS_COMMUNITY_URL || DEFAULT_COMMUNITY_URL).trim();
  const supportTelegram = String(process.env.POS_SUPPORT_TELEGRAM || DEFAULT_SUPPORT_TELEGRAM).trim();
  const subject = String(process.env.POS_WELCOME_EMAIL_SUBJECT || DEFAULT_SUBJECT).trim();

  const text = [
    "Mahar Mobile Shop POS System သို့ ကြိုဆိုပါတယ် 🙏",
    "",
    "သင့်အကောင့်ကို အောင်မြင်စွာ ဖွင့်လှစ်ပြီးပါပြီ။ ဒီ account နဲ့ login ဝင်ပြီး စတင်အသုံးပြုနိုင်ပါပြီ။",
    "",
    "Account Details",
    `Owner: ${safe.name}`,
    `Shop Name: ${safe.shopName}`,
    `Shop ID: ${safe.tenantId}`,
    `Tenant: ${safe.shopSlug}`,
    `Email: ${safe.email}`,
    `Username: ${safe.username}`,
    `Temporary Password: ${safe.temporaryPassword}`,
    `Plan: ${safe.planLabel}`,
    `Expiry Date: ${safe.expiryDate}`,
    `Login URL: ${safe.loginUrl}`,
    "",
    "Next Step",
    "Login ဝင်ပြီး Password ကို ချက်ချင်းပြောင်းပေးပါ",
    "Google Login နဲ့လည်း ဆက်ဝင်နိုင်ပါတယ်",
    "System အသုံးပြုရန် အခက်အခဲရှိပါက Support Team ကို ဆက်သွယ်နိုင်ပါတယ်",
    "",
    `Telegram Group: ${communityUrl}`,
    `Support: ${supportTelegram}`,
    "",
    "Mahar Mobile Shop POS Team မှ ကြိုဆိုပါတယ်။",
    "သင့်လုပ်ငန်းကို Digital စနစ်နဲ့ အဆင့်မြှင့်တင်နိုင်ရန် ကျွန်တော်တို့ အမြဲကူညီပေးပါမယ်။",
    "",
    "If you need help, feel free to contact us anytime.",
    "",
    "Best regards,",
    "Mahar Mobile Shop POS Team",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,'Noto Sans Myanmar',sans-serif;line-height:1.65;color:#111827;max-width:720px;margin:auto;background:#ffffff">
      <div style="background:#0f172a;color:#fff;padding:22px;border-radius:16px 16px 0 0">
        <h2 style="margin:0">Mahar Mobile Shop POS Account Activated</h2>
        <div style="opacity:.85;margin-top:6px">အကောင့်ဖွင့်ပြီးပါပြီ</div>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:0;padding:22px;border-radius:0 0 16px 16px">
        <p><b>Mahar Mobile Shop POS System သို့ ကြိုဆိုပါတယ် 🙏</b></p>
        <p>သင့်အကောင့်ကို အောင်မြင်စွာ ဖွင့်လှစ်ပြီးပါပြီ။ ဒီ account နဲ့ login ဝင်ပြီး စတင်အသုံးပြုနိုင်ပါပြီ။</p>

        <h3>🧾 Account Details</h3>
        <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:12px;overflow:hidden">
          <tr><td><b>👤 Owner</b></td><td>${escapeHtml(safe.name)}</td></tr>
          <tr><td><b>🏪 Shop Name</b></td><td>${escapeHtml(safe.shopName)}</td></tr>
          <tr><td><b>🆔 Shop ID</b></td><td>${escapeHtml(safe.tenantId)}</td></tr>
          <tr><td><b>🏷️ Tenant</b></td><td>${escapeHtml(safe.shopSlug)}</td></tr>
          <tr><td><b>📧 Email</b></td><td>${escapeHtml(safe.email)}</td></tr>
          <tr><td><b>🔑 Username</b></td><td>${escapeHtml(safe.username)}</td></tr>
          <tr><td><b>🔐 Temporary Password</b></td><td><code style="font-size:16px;background:#fff3cd;padding:4px 8px;border-radius:6px">${escapeHtml(safe.temporaryPassword)}</code></td></tr>
          <tr><td><b>📌 Plan</b></td><td>${escapeHtml(safe.planLabel)}</td></tr>
          <tr><td><b>📅 Expiry Date</b></td><td>${escapeHtml(safe.expiryDate)}</td></tr>
          <tr><td><b>🔗 Login URL</b></td><td><a href="${escapeHtml(safe.loginUrl)}">${escapeHtml(safe.loginUrl)}</a></td></tr>
        </table>

        <h3>⚙️ Next Step</h3>
        <p>👉 Login ဝင်ပြီး Password ကို ချက်ချင်းပြောင်းပေးပါ<br/>👉 Google Login နဲ့လည်း ဆက်ဝင်နိုင်ပါတယ်<br/>👉 System အသုံးပြုရန် အခက်အခဲရှိပါက Support Team ကို ဆက်သွယ်နိုင်ပါတယ်</p>

        <h3>👥 For Community</h3>
        <p>Telegram Group ထဲ Join ပေးပါ:<br/><a href="${escapeHtml(communityUrl)}">${escapeHtml(communityUrl)}</a></p>

        <h3>📱 Support</h3>
        <p>Telegram: <a href="${escapeHtml(supportTelegram)}">${escapeHtml(supportTelegram)}</a></p>

        <p>Mahar Mobile Shop POS Team မှ ကြိုဆိုပါတယ်။<br/>သင့်လုပ်ငန်းကို Digital စနစ်နဲ့ အဆင့်မြှင့်တင်နိုင်ရန် ကျွန်တော်တို့ အမြဲကူညီပေးပါမယ်။</p>
        <p>If you need help, feel free to contact us anytime.</p>
        <p>Best regards,<br/><b>Mahar Mobile Shop POS Team</b></p>
      </div>
    </div>
  `;

  return { subject, text, html };
}

async function sendViaResend({ to, subject, text, html }) {
  const config = resendConfig();
  if (!config.ready || !to) return { skipped: true, reason: "RESEND_NOT_CONFIGURED" };
  if (typeof fetch !== "function") return { skipped: true, reason: "FETCH_NOT_AVAILABLE" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        from: config.from,
        to: [to],
        reply_to: config.replyTo,
        subject,
        text,
        html,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { skipped: true, reason: data?.message || `RESEND_${response.status}` };
    return { skipped: false, provider: "resend", messageId: data?.id || null, status: "sent" };
  } catch (error) {
    return { skipped: true, reason: safeMessage(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function sendGoogleTemporaryPasswordEmail({
  to,
  name,
  shopName,
  shopSlug,
  tenantId,
  username,
  temporaryPassword,
  planLabel,
  expiryDate,
}) {
  const safe = {
    name: name || username || to,
    shopName: shopName || "Your shop",
    shopSlug: shopSlug || "",
    tenantId: tenantId || "",
    email: to,
    username: username || to,
    temporaryPassword: temporaryPassword || "",
    planLabel: planLabel || process.env.POS_DEFAULT_PLAN_LABEL || "Trial",
    expiryDate: formatDate(expiryDate),
    loginUrl: appUrl(),
  };
  const { subject, text, html } = buildWelcomeEmail(safe);

  const resendResult = await sendViaResend({ to, subject, text, html });
  if (!resendResult.skipped) return resendResult;
  return { skipped: true, provider: "resend", reason: resendResult.reason || "RESEND_NOT_CONFIGURED" };
}

module.exports = {
  generateTemporaryPassword,
  sendGoogleTemporaryPasswordEmail,
};
