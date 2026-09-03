import { apiFetch } from '../phase2Api';
import { printRepairVoucher } from './projectPrintUtils';

/**
 * Fetch a repair, mint its customer status link and print the voucher.
 *
 * Printing goes through a hidden iframe, so there is no popup to be blocked and
 * this works in the mobile web view as well as on the counter PC.
 *
 * The status URL is derived from the repair, so asking for it again returns the
 * same one: reprinting a voucher reprints the customer's existing QR rather
 * than replacing it.
 */
export async function printRepairVoucherById(repairId, notify) {
  const id = String(repairId || '').trim();
  if (!id) return false;

  try {
    const response = await apiFetch(`/api/repair-platform/jobs/${encodeURIComponent(id)}`);
    const access = await apiFetch(`/api/repair-platform/jobs/${encodeURIComponent(id)}/public-access`, { method: 'POST' })
      .catch(() => null);
    const printed = await printRepairVoucher(response.repair, null, access?.access?.url || '');
    if (!printed) {
      notify?.('error', 'Print window မဖွင့်နိုင်ပါ — browser က ပိတ်ထားခြင်း ရှိမရှိ စစ်ပါ။');
      return false;
    }
    if (!access) notify?.('error', 'Status QR link မထုတ်နိုင်ပါ — QR မပါဘဲ ထုတ်ပါမယ်။');
    return true;
  } catch (error) {
    notify?.('error', error.message || 'ဘောင်ချာ ထုတ်၍ မရပါ');
    return false;
  }
}
