import { apiFetch } from '../phase2Api';
import { printRepairVoucher } from './projectPrintUtils';

/**
 * Fetch a repair, mint its customer status link and print the voucher.
 *
 * The popup is opened first, before any await. A browser only lets a page open
 * a window while it is still handling the click, and every one of these calls
 * has to wait on the network before it has anything to print.
 *
 * The share key is stored hashed, so a printable status URL can only be made by
 * minting a new one — which retires the QR on any voucher printed earlier.
 */
export async function printRepairVoucherById(repairId, notify) {
  const id = String(repairId || '').trim();
  if (!id) return false;

  const popup = window.open('', '_blank', 'width=430,height=760');
  if (!popup) {
    notify?.('error', 'Browser popup blocked. Popups ကို Allow လုပ်ပါ။');
    return false;
  }
  popup.document.write('<!doctype html><html><body style="font-family:Arial;padding:30px;text-align:center">ဘောင်ချာ ပြင်ဆင်နေသည်…</body></html>');
  popup.document.close();

  try {
    const response = await apiFetch(`/api/repair-platform/jobs/${encodeURIComponent(id)}`);
    const access = await apiFetch(`/api/repair-platform/jobs/${encodeURIComponent(id)}/public-access`, { method: 'POST' })
      .catch(() => null);
    await printRepairVoucher(response.repair, popup, access?.access?.url || '');
    if (!access) notify?.('error', 'Status QR link မထုတ်နိုင်ပါ — QR မပါဘဲ ထုတ်ပါမယ်။');
    return true;
  } catch (error) {
    popup.close();
    notify?.('error', error.message || 'ဘောင်ချာ ထုတ်၍ မရပါ');
    return false;
  }
}
