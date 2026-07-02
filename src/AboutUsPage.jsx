import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  ExternalLink,
  Globe2,
  HeartHandshake,
  MapPin,
  MessageCircle,
  QrCode,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import './about-us.css';

const supportLinks = [
  { label: 'TikTok', value: '@maharshwemobile', href: 'https://www.tiktok.com/@maharshwemobile' },
  { label: 'Telegram', value: '@Mylifemychoice68', href: 'https://t.me/Mylifemychoice68' },
  { label: 'Website', value: 'maharshwe.online', href: 'https://maharshwe.online/' },
];

const donationMethods = [
  {
    title: 'For Local KBZ Pay',
    subtitle: 'Myanmar local donation',
    name: 'Khun Myint Aung (*******4052)',
    payload: 'hQZLQlpQYXlhQE8C8FACEFECMTFXFgl3g5QFLSYGEBAfnwgEAQGfJAEwF519efdc3ff89=',
  },
  {
    title: 'For World Wide Crypto',
    subtitle: 'USDT Deposit · BNB Smart Chain (BEP20)',
    name: '0x63179f1c1b2e04c189b2fb0c8081904110d5d54a',
    payload: '0x63179f1c1b2e04c189b2fb0c8081904110d5d54a',
  },
  {
    title: 'For Thailand PromptPay',
    subtitle: 'Thai QR Payment',
    name: 'MR. KHUN MYINT AUNG',
    payload: '00020101021229370016A0000006770101110113006694407024653037645802TH6304DEAC',
  },
];

function DonationCard({ item }) {
  const [qr, setQr] = useState('');

  useEffect(() => {
    let mounted = true;
    QRCode.toDataURL(item.payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 520,
      color: { dark: '#111827', light: '#ffffff' },
    }).then((url) => {
      if (mounted) setQr(url);
    }).catch(() => {
      if (mounted) setQr('');
    });
    return () => { mounted = false; };
  }, [item.payload]);

  return (
    <article className="about-donation-card">
      <div className="about-donation-image about-generated-qr">
        {qr ? <img src={qr} alt={`${item.title} QR Code`} /> : <div className="about-donation-placeholder"><QrCode size={38} /><span>Generating QR</span></div>}
      </div>
      <div className="about-donation-body">
        <span>{item.subtitle}</span>
        <h3>{item.title}</h3>
        <p>{item.name}</p>
      </div>
    </article>
  );
}

export default function AboutUsPage() {
  return (
    <main className="about-page">
      <section className="about-hero">
        <div>
          <span className="about-eyebrow">ABOUT US</span>
          <h2>Mahar Shwe Mobile</h2>
          <p>Developed by Mahar Shwe Mobile in Hsisheng Township, Shan State, Taunggyi.</p>
          <div className="about-hero-badges">
            <b><MapPin size={16} /> Hsisheng Township</b>
            <b><ShieldCheck size={16} /> Shan State, Taunggyi</b>
          </div>
        </div>
        <HeartHandshake size={56} />
      </section>

      <section className="about-grid">
        <article className="about-card about-support-card">
          <header>
            <div>
              <span>FOR SUPPORT</span>
              <h3>Contact & Community</h3>
            </div>
            <MessageCircle size={24} />
          </header>
          <div className="about-link-list">
            {supportLinks.map((link) => (
              <a href={link.href} target="_blank" rel="noreferrer" key={link.label}>
                <span>{link.label}</span>
                <b>{link.value}</b>
                <ExternalLink size={16} />
              </a>
            ))}
          </div>
        </article>

        <article className="about-card about-live-card">
          <header>
            <div>
              <span>CUSTOMER LIVE</span>
              <h3>Show our customer live</h3>
            </div>
            <Smartphone size={24} />
          </header>
          <p>Latest updates, customer service, product information and support channels are available from Mahar Shwe Mobile online community.</p>
          <a className="about-primary-link" href="https://maharshwe.online/" target="_blank" rel="noreferrer">
            <Globe2 size={18} /> Open Website
          </a>
        </article>
      </section>

      <section className="about-donate-section">
        <header>
          <div>
            <span>PLEASE DONATE</span>
            <h3>Support Mahar Shwe Mobile</h3>
            <p>Choose local KBZ Pay, worldwide crypto, or Thailand PromptPay donation method.</p>
          </div>
          <HeartHandshake size={28} />
        </header>
        <div className="about-donation-grid">
          {donationMethods.map((item) => <DonationCard item={item} key={item.title} />)}
        </div>
      </section>
    </main>
  );
}
