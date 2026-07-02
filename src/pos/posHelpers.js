const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('en-US')} ကျပ်`;
}

export function productTitle(item) {
  return [item?.productName, item?.variantName].filter(Boolean).join(' — ');
}

export function buildReservedMap(cart = []) {
  return cart.reduce((map, line) => {
    map.set(line.id, (map.get(line.id) || 0) + Number(line.quantity || 0));
    return map;
  }, new Map());
}

export function priceState(line) {
  const price = Number(line?.unitPrice || 0);
  const standard = Number(line?.standardSellingPrice || 0);
  const minimum = Number(line?.minimumSellingPrice || 0);
  if (price < minimum) {
    return { type: 'invalid', label: `Min ${formatMoney(minimum)}` };
  }
  if (price > standard) {
    return { type: 'markup', label: `+${formatMoney(price - standard)}` };
  }
  if (price < standard) {
    return { type: 'discount', label: `-${formatMoney(standard - price)}` };
  }
  return { type: 'standard', label: 'Default Price' };
}

export function cashSuggestions(total) {
  const amount = Math.max(0, Number(total || 0));
  const round = (step) => Math.ceil(amount / step) * step;
  return [...new Set([amount, round(5000), round(10000), round(50000)].filter((value) => value >= amount))];
}

export function draftKey(session) {
  const identity = session?.user?.id || session?.user?.username || 'default';
  return `mahar_pos_sale_draft_v3:${identity}`;
}

export function loadSaleDraft(session) {
  try {
    const parsed = JSON.parse(localStorage.getItem(draftKey(session)) || 'null');
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(draftKey(session));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSaleDraft(session, payload) {
  try {
    localStorage.setItem(draftKey(session), JSON.stringify({ ...payload, savedAt: Date.now() }));
  } catch {
    // Ignore browser storage limits.
  }
}

export function clearSaleDraft(session) {
  localStorage.removeItem(draftKey(session));
}

let audioContext;
export function playAddBeep() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ||= new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(860, now);
    oscillator.frequency.exponentialRampToValueAtTime(1220, now + 0.065);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.17, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.11);
  } catch {
    // Audio is optional and may be blocked by browser policy.
  }
}
