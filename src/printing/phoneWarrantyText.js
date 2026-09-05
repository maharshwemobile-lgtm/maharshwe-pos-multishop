/**
 * The two warranty notices a phone can be sold under, and the rule for picking
 * one off a sale.
 *
 * The shop's own wording, kept verbatim. It prints only for lines that are
 * actually phones — a customer buying a charging cable does not need a page
 * about FRP locks — and both blocks print, each under its own heading, when a
 * single sale carries a new phone and a second-hand one.
 */

export const WARRANTY_SECOND_HAND = {
  title: '【 Second-hand ဖုန်း အာမခံချက်နှင့် သတိပြုရန် စည်းကမ်းချက်များ 】',
  sections: [
    {
      heading: '၁။ ၁၄ ရက် အလုံးတူ / တန်ဖိုးတူ လဲလှယ်ခွင့်',
      lines: [
        'ဝယ်ယူပြီး (၁၄) ရက်အတွင်း စက်ပိုင်းဆိုင်ရာ Hardware Error တက်ပါက အလုံးတူ (သို့မဟုတ်) တန်ဖိုးတူ ဖုန်းတစ်လုံးဖြင့် ပြန်လည် လဲလှယ်ပေးပါမည်။',
      ],
    },
    {
      heading: '၂။ ၁ လအတွင်း ပြန်လည်ရောင်းချခြင်း (Error မရှိဘဲ ပြန်ရောင်းပါက)',
      lines: [
        'အသုံးပြုသူဘက်မှ Error မရှိဘဲ ပြန်လည်ရောင်းချလိုပါက ဝယ်ယူသည့်နေ့မှ (၁) လအတွင်း ဝယ်ယူထားသည့် တန်ဖိုး၏ 30% ကောက်ခံ၍ ပြန်လည် ဝယ်ယူပေးပါမည်။',
      ],
    },
    {
      heading: '၃။ အာမခံ မအကျုံးဝင်သည့် အချက်များ (Void Conditions)',
      lines: [
        'ရေဝင်ခြင်း၊ ပြုတ်ကျခြင်း၊ ဖိမိခြင်း သို့မဟုတ် Screen/LCD Touch မှန် ပျက်စီးခြင်း။',
        'Google Account (FRP), Mi Account Lock ကျခြင်း သို့မဟုတ် စက်မီးမလာတော့သည့် Error များ (User Error)။',
        'Unofficial Software/Firmware တင်ခြင်း၊ Root လုပ်ခြင်း သို့မဟုတ် ဆိုင်၏ အာမခံ စတိကာ (Warranty Sticker) ပျက်စီး/ကွာကျနေခြင်း။',
      ],
    },
  ],
};

export const WARRANTY_BRAND_NEW = {
  title: '【 Brand New ဖုန်း အာမခံချက်နှင့် သတိပေးချက် 】',
  sections: [
    {
      heading: '၁။ Official Warranty',
      lines: ['စက်ရုံထုတ် တရားဝင် အာမခံ (၁) နှစ် ပါဝင်ပါသည်။'],
    },
    {
      heading: '၂။ 7-Day Replacement',
      lines: [
        'ဝယ်ယူပြီး (၇) ရက်အတွင်း စက်ရုံထုတ် Factory Hardware Defect ပါဝင်ပါက အသစ်တစ်လုံး အစားထိုး လဲလှယ်ပေးပါသည်။',
      ],
    },
    {
      heading: '၃။ အာမခံ မအကျုံးဝင်သည့် အချက်များ',
      lines: [
        'ရေဝင်ခြင်း၊ ပြုတ်ကျခြင်း၊ ဖိမိခြင်း သို့မဟုတ် ရုပ်ပိုင်းဆိုင်ရာ ထိခိုက်ပျက်စီးခြင်း။',
        'LCD Display မှန်ကွဲခြင်း / မှန်စင်းကျခြင်း။',
        'Unofficial System Software တင်ခြင်းနှင့် အာမခံ စတိကာ ပျက်စီးခြင်း။',
      ],
    },
  ],
};

// A phone is the thing that carries an IMEI. Serial-tracked stock and the Phone
// category both say so; either is enough, because a shop that files a handset
// under a category of its own still records the IMEI against it.
function isPhoneLine(item) {
  if (String(item?.imeiSerial || '').trim()) return true;
  return /phone|ဖုန်း/i.test(String(item?.categoryName || ''));
}

function isSecondHand(item) {
  return String(item?.condition || '').toUpperCase() === 'SECOND_HAND';
}

/**
 * Which warranty blocks belong on this sale's slip, in the order they print.
 * An empty array means the sale had no phone in it and the notice is left off.
 */
export function warrantyBlocksForSale(sale) {
  const phones = (sale?.itemRows || sale?.items || []).filter(isPhoneLine);
  if (!phones.length) return [];
  const blocks = [];
  if (phones.some(isSecondHand)) blocks.push(WARRANTY_SECOND_HAND);
  if (phones.some((item) => !isSecondHand(item))) blocks.push(WARRANTY_BRAND_NEW);
  return blocks;
}
