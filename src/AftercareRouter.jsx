import React from 'react';
import ConnectedWorkspace from './ConnectedWorkspace.jsx';

const meta = {
  'Sales History': {
    title: 'Sales History & Aftercare',
    description: 'Invoice detail, receipt reprint, void and sale follow-up ကို ဒီနေရာကနေ စီမံပါ။',
  },
  Customers: {
    title: 'Customers & Credit',
    description: 'Customer profile၊ အကြွေးလက်ကျန်နဲ့ အရောင်းမှတ်တမ်းတွေကို ဆက်စပ်ကြည့်ရှုပါ။',
  },
  Accounting: {
    title: 'Payments & Accounts',
    description: 'Cash၊ KPay၊ Wave၊ Credit နဲ့ ဝင်ငွေ/အသုံးစရိတ်တွေကို ဆက်စပ်စီမံပါ။',
  },
  Reports: {
    title: 'Business Reports',
    description: 'Sales၊ Receivable၊ Payable၊ Expense နဲ့ Profit summary တွေကို တစ်နေရာထဲကြည့်ပါ။',
  },
};

export default function AftercareRouter({ page, setPage, children }) {
  const current = meta[page] || meta['Sales History'];
  return (
    <>
      <ConnectedWorkspace
        active={page}
        title={current.title}
        description={current.description}
        onNavigate={setPage}
      />
      {children}
    </>
  );
}
