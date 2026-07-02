import { printSaleReceipt } from '../printing/projectPrintUtils';

const DRAFT_TTL = 12 * 60 * 60 * 1000;

export function money(value) {
  return `${Number(value || 0).toLocaleString('en-US')} ကျပ်`;
}

export function shortMoney(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount % 1_000_000 ? 1 : 0)}M`;
  if (Math.abs(amount) >= 1_000) return `${Math.round(amount / 1_000)}K`;
  return String(amount);
}

export function productName(item) {
  return [item?.productName, item?.variantName].filter(Boolean).join(' · ') || 'Unnamed product';
}

export function reservedQuantity(cart = []) {
  return cart.reduce((map, line) => {
    map.set(line.id, (map.get(line.id) || 0) + Number(line.quantity || 0));
    return map;
  }, new Map());
}

function draftKey(session) {
  return `mahar_phase10_sale:${session?.user?.id || session?.user?.username || 'default'}`;
}

export function loadDraft(session) {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(session)) || 'null');
    if (!value?.savedAt || Date.now() - value.savedAt > DRAFT_TTL) {
      localStorage.removeItem(draftKey(session));
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function saveDraft(session, payload) {
  try {
    localStorage.setItem(draftKey(session), JSON.stringify({ ...payload, savedAt: Date.now() }));
  } catch {
    // Draft persistence is optional.
  }
}

export function clearDraft(session) {
  localStorage.removeItem(draftKey(session));
}

let audioContext;
export function playScanTone() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ||= new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(740, now);
    oscillator.frequency.exponentialRampToValueAtTime(1180, now + 0.075);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.13);
  } catch {
    // Browser audio can be blocked until the first user gesture.
  }
}

export function reprintReceipt(sale, targetWindow = null) {
  return printSaleReceipt(sale, targetWindow).catch((error) => {
    if (targetWindow && !targetWindow.closed) {
      targetWindow.document.open();
      targetWindow.document.write(`<!doctype html><html><body style="font-family:Arial;padding:30px;text-align:center"><h3>Receipt failed</h3><p>${String(error?.message || 'Settings could not be loaded')}</p></body></html>`);
      targetWindow.document.close();
    }
    return false;
  });
}
