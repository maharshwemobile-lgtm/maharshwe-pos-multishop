import React from 'react';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Mahar POS UI error:', error, info);
  }

  async clearAndReload() {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const appRegistrations = registrations.filter((registration) => {
          const scriptUrl = registration.active?.scriptURL
            || registration.waiting?.scriptURL
            || registration.installing?.scriptURL
            || '';
          return scriptUrl && !/firebase-messaging-sw\.js/i.test(scriptUrl);
        });
        await Promise.all(appRegistrations.map((registration) => registration.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys
          .filter((key) => !/firebase|fcm|messaging/i.test(key))
          .map((key) => caches.delete(key)));
      }
    } finally {
      window.location.reload();
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f8fafc', fontFamily: 'Arial, sans-serif' }}>
        <section style={{ width: 'min(520px, 100%)', padding: 24, border: '1px solid #fecaca', borderRadius: 16, background: '#fff', boxShadow: '0 18px 45px rgba(15,23,42,.12)', textAlign: 'center' }}>
          <h1 style={{ margin: 0, color: '#b91c1c', fontSize: 22 }}>Mahar POS UI Error</h1>
          <p style={{ color: '#64748b', lineHeight: 1.7 }}>Blank page အစား ဒီ recovery screen ကို ပြထားပါတယ်။ Browser cache သို့မဟုတ် runtime error ဖြစ်နိုင်ပါတယ်။</p>
          <pre style={{ maxHeight: 180, overflow: 'auto', padding: 12, borderRadius: 10, background: '#0f172a', color: '#e2e8f0', textAlign: 'left', fontSize: 11, whiteSpace: 'pre-wrap' }}>{String(this.state.error?.message || this.state.error)}</pre>
          <button type="button" onClick={() => this.clearAndReload()} style={{ marginTop: 14, minHeight: 42, padding: '0 18px', border: 0, borderRadius: 10, background: '#16a34a', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Clear Cache & Reload</button>
        </section>
      </main>
    );
  }
}
