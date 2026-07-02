let audioContext;

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext ||= new AudioContextClass();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function playTone(context, frequency, start, duration, volume = 0.12, endFrequency = null) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration * 0.7);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
}

export function playPosAddSound() {
  try {
    const context = getAudioContext();
    if (!context) return;
    playTone(context, 740, context.currentTime, 0.12, 0.12, 1180);
  } catch {
    // Audio is optional when the browser blocks sound.
  }
}

export function playPaymentSuccessSound() {
  try {
    const context = getAudioContext();
    if (!context) return;
    const now = context.currentTime;
    playTone(context, 523.25, now, 0.14, 0.11);
    playTone(context, 659.25, now + 0.13, 0.16, 0.12);
    playTone(context, 783.99, now + 0.27, 0.22, 0.13);
  } catch {
    // Audio is optional when the browser blocks sound.
  }
}
