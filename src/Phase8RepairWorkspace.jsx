import React from 'react';
import RepairOperationsWorkspace from './RepairOperationsWorkspace.jsx';
import './phase11-repair-heading.css';

// The repair page is the list and the repair you opened from it, and nothing
// else.
//
// A slab of tool buttons used to sit underneath it -- voucher print, cost and
// profit, device history, customer portal, CSV export -- each opening a form
// that asked for a repair number the counter had just been looking at. Three of
// them now live on the repair itself: printing a voucher, recording the cost as
// the phone is handed back, and searching a device's history from the page
// header. A tool that repeats what the row in front of you already does is
// another place to look, not another thing you can do.
export default function Phase8RepairWorkspace() {
  return (
    <div className="phase11-repair-root" style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
      <RepairOperationsWorkspace />
    </div>
  );
}
