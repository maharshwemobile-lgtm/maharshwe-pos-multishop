import React from 'react';
import RepairPlatformPage from './RepairPlatformPage.jsx';
import './repair-operations-workspace.css';

// Was a wrapper that hung two tool panels under the repair page: a cost and
// profit form, and an IMEI history search. Both asked for a repair number or a
// serial the counter had just been looking at.
//
// The money is now written on the repair itself, at the moment the phone is
// handed back, and the history search is in the page header. What is left is
// the page.
export default function RepairOperationsWorkspace() {
  return (
    <div className="repair-operations-workspace">
      <RepairPlatformPage />
    </div>
  );
}
