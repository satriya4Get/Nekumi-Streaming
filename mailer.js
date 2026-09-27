/**
 * Nekumi Streaming Platform - Email Service (Resend & Nodemailer)
 */

const { Resend } = require('resend');
const nodemailer = require('nodemailer');
require('dotenv').config();

let resendClient = null;
let smtpTransporter = null;

function getResendClient() {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!resendClient && key) {
    resendClient = new Resend(key);
  }
  return resendClient;
}

function getTransporter() {
  if (smtpTransporter) return smtpTransporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (host && user && pass) {
    smtpTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false
      }
    });
  }
  return smtpTransporter;
}

/**
 * Send 6-digit verification email for Registration
 */
async function sendRegisterVerificationEmail(toEmail, code) {
  const subject = `Kode Verifikasi Pendaftaran Nekumi: ${code}`;
  
  const html = `
    <div style="background-color: #050b14; color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 35px 20px; text-align: center;">
      <div style="max-width: 480px; margin: 0 auto; background: #0b1526; border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 16px; padding: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div style="margin-bottom: 20px;">
          <h2 style="color: #38bdf8; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px;">
            Nekumi<span style="color: #fff;">Stream</span>
          </h2>
          <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0 0;">Streaming Anime Subtitle Indonesia</p>
        </div>

        <div style="border-top: 1px solid rgba(255,255,255,0.08); border-bottom: 1px solid rgba(255,255,255,0.08); padding: 20px 0; margin: 20px 0;">
          <p style="font-size: 15px; margin: 0 0 16px 0; color: #cbd5e1;">Halo Otaku,</p>
          <p style="font-size: 14px; margin: 0 0 16px 0; color: #94a3b8;">
            Gunakan kode verifikasi 6 digit berikut untuk menyelesaikan pendaftaran akun Anda di <strong>Nekumi</strong>:
          </p>
          <div style="background: rgba(56, 189, 248, 0.1); border: 2px dashed #38bdf8; border-radius: 12px; padding: 16px 24px; display: inline-block; margin: 10px 0;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; font-family: monospace;">${code}</span>
          </div>
          <p style="font-size: 12px; color: #f59e0b; margin: 14px 0 0 0;">
            ⏳ Kode berlaku selama <strong>10 menit</strong>. Jangan bagikan kode ini kepada siapapun!
          </p>
        </div>

        <p style="font-size: 12px; color: #64748b; margin: 0;">
          Jika Anda tidak merasa mendaftar di Nekumi, abaikan saja email ini.
        </p>
      </div>
    </div>
  `;

  const text = `Halo Otaku,\n\nKode verifikasi pendaftaran akun Nekumi Anda adalah: ${code}\n\nKode ini berlaku selama 10 menit.\nJangan berikan kode ini kepada orang lain.`;

  return deliverMail(toEmail, subject, text, html, code, 'REGISTRATION');
}

/**
 * Send 6-digit verification email for Password Reset
 */
async function sendPasswordResetEmail(toEmail, code) {
  const subject = `Kode Reset Password Nekumi: ${code}`;

  const html = `
    <div style="background-color: #050b14; color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 35px 20px; text-align: center;">
      <div style="max-width: 480px; margin: 0 auto; background: #0b1526; border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 16px; padding: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div style="margin-bottom: 20px;">
          <h2 style="color: #38bdf8; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px;">
            Nekumi<span style="color: #fff;">Stream</span>
          </h2>
          <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0 0;">Pemulihan Akun Anime</p>
        </div>

        <div style="border-top: 1px solid rgba(255,255,255,0.08); border-bottom: 1px solid rgba(255,255,255,0.08); padding: 20px 0; margin: 20px 0;">
          <p style="font-size: 15px; margin: 0 0 16px 0; color: #cbd5e1;">Permintaan Reset Password</p>
          <p style="font-size: 14px; margin: 0 0 16px 0; color: #94a3b8;">
            Kami menerima permintaan untuk mereset kata sandi akun Nekumi Anda (${toEmail}). Gunakan kode 6 digit berikut:
          </p>
          <div style="background: rgba(245, 158, 11, 0.1); border: 2px dashed #f59e0b; border-radius: 12px; padding: 16px 24px; display: inline-block; margin: 10px 0;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #f59e0b; font-family: monospace;">${code}</span>
          </div>
          <p style="font-size: 12px; color: #f59e0b; margin: 14px 0 0 0;">
            ⏳ Kode reset ini berlaku selama <strong>10 menit</strong>.
          </p>
        </div>

        <p style="font-size: 12px; color: #64748b; margin: 0;">
          Jika Anda tidak meminta perubahan kata sandi, amankan akun Anda segera.
        </p>
      </div>
    </div>
  `;

  const text = `Permintaan Reset Password Nekumi\n\nKode reset Anda adalah: ${code}\n\nKode berlaku selama 10 menit.`;

  return deliverMail(toEmail, subject, text, html, code, 'PASSWORD_RESET');
}

/**
 * Deliver mail via Resend API or SMTP Transporter
 */
async function deliverMail(toEmail, subject, text, html, code, type) {
  let delivered = false;

  // 1. Resend API (Solusi No 3 - Cepat, Tanpa Password Google, Langsung Masuk Inbox)
  const resend = getResendClient();
  if (resend) {
    try {
      const from = process.env.RESEND_FROM || 'Nekumi Streaming <onboarding@resend.dev>';
      const resp = await resend.emails.send({
        from,
        to: [toEmail],
        subject,
        text,
        html
      });
      if (resp && (resp.data || !resp.error)) {
        delivered = true;
        console.log(`[RESEND API] Sent ${type} email successfully to: ${toEmail} (Email ID: ${resp.data?.id})`);
      } else if (resp && resp.error) {
        console.warn(`[RESEND API Error]: ${resp.error.message}`);
      }
    } catch (err) {
      console.warn(`[RESEND API Exception]: ${err.message}`);
    }
  }

  // 2. SMTP Transporter Fallback (Jika memakai Brevo atau SMTP custom)
  if (!delivered) {
    const mailer = getTransporter();
    if (mailer) {
      try {
        const from = process.env.SMTP_FROM || '"Nekumi Streaming" <nekumistreaming@gmail.com>';
        await mailer.sendMail({
          from,
          to: toEmail,
          subject,
          text,
          html
        });
        delivered = true;
        console.log(`[SMTP DISPATCH] Sent ${type} email successfully to: ${toEmail}`);
      } catch (err) {
        console.warn(`[SMTP DISPATCH] Delivery failed: ${err.message}`);
      }
    }
  }

  // 3. Terminal Log
  console.log('====================================================');
  console.log(`📨 [OUTGOING EMAIL - ${type}]`);
  console.log(`To: ${toEmail}`);
  console.log(`Subject: ${subject}`);
  console.log(`Verification Code (6-digit): ${code}`);
  console.log(`Status: ${delivered ? 'SENT TO INBOX (DELIVERED)' : 'LOGGED TO CONSOLE (Fill RESEND_API_KEY in .env for live inbox delivery)'}`);
  console.log('====================================================');

  return { delivered };
}

module.exports = {
  sendRegisterVerificationEmail,
  sendPasswordResetEmail
};
