import http from 'node:http';
import nodemailer from 'nodemailer';

const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'ADMIN_ALERT_EMAIL', 'SUPPORT_EMAIL', 'SMTP_RELAY_SECRET'];
for (const name of required) if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
if (process.env.SMTP_USER !== 'istmiyanotificaciones@gmail.com') throw new Error('SMTP_USER must be the notifications account');
const port = Number(process.env.SMTP_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be a valid port');
const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/send') { res.writeHead(404).end(); return; }
  if (req.headers.authorization !== `Bearer ${process.env.SMTP_RELAY_SECRET}`) { res.writeHead(401).end(); return; }
  let raw = ''; req.on('data', (chunk) => { raw += chunk; if (raw.length > 8192) req.destroy(); });
  req.on('end', async () => {
    try {
      const body = JSON.parse(raw);
      const allowed = new Set([process.env.ADMIN_ALERT_EMAIL, ...(process.env.ADMIN_ALERT_EMAIL_ALLOWLIST || '').split(',').map((x) => x.trim()).filter(Boolean)]);
      if (typeof body.to !== 'string' || !allowed.has(body.to) || typeof body.subject !== 'string' || typeof body.text !== 'string' || body.subject.length > 180 || body.text.length > 2000) { res.writeHead(400).end(); return; }
      await transport.sendMail({ from: `IstmiYa Notificaciones <${process.env.SMTP_USER}>`, to: body.to, subject: body.subject, text: body.text });
      res.writeHead(202, { 'content-type': 'application/json' }).end('{"accepted":true}');
    } catch { res.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"smtp_delivery_failed"}'); }
  });
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
