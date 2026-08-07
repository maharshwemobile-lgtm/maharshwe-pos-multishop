// IMEI helpers.
//
// What an IMEI can and cannot tell you: the first 8 digits are the TAC (Type
// Allocation Code), which identifies the brand and model — but only if you have
// a TAC database to look it up in. The remaining digits are a serial and a Luhn
// check digit. Colour and storage are not encoded anywhere in an IMEI, so two
// identical phones in different colours share the same TAC.
//
// So the only colour/model knowledge available offline is what this shop has
// recorded before. tacKey() is the join key for that.

export const IMEI_LENGTH = 15;

export function cleanImei(value) {
  return String(value || '').replace(/\D/g, '').slice(0, IMEI_LENGTH);
}

export function tacKey(value) {
  const digits = cleanImei(value);
  return digits.length >= 8 ? digits.slice(0, 8) : '';
}

// Luhn check over the 15 digits — catches transposed and mistyped digits.
export function isValidImei(value) {
  const digits = cleanImei(value);
  if (digits.length !== IMEI_LENGTH) return false;
  let sum = 0;
  for (let index = 0; index < IMEI_LENGTH; index += 1) {
    let digit = Number(digits[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// '' while still typing, otherwise a short message for the field hint
export function imeiStatus(value) {
  const digits = cleanImei(value);
  if (!digits) return { state: 'empty', message: '' };
  if (digits.length < IMEI_LENGTH) {
    return { state: 'typing', message: `${digits.length}/${IMEI_LENGTH} ဂဏန်း` };
  }
  return isValidImei(digits)
    ? { state: 'valid', message: 'IMEI မှန်ကန်ပါသည်' }
    : { state: 'invalid', message: 'IMEI စစ်ဆေးမှု မအောင်မြင်ပါ — ဂဏန်း ပြန်စစ်ပါ' };
}
