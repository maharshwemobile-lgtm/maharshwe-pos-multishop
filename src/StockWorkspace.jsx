import React, { useState } from 'react';
import InventoryToolsPanel from './InventoryToolsPanel.jsx';
import InventoryImportReview from './InventoryImportReview.jsx';
import StockManagementPage from './StockManagementPage.jsx';

export default function StockWorkspace() {
  const [version, setVersion] = useState(0);
  const refreshInventory = () => setVersion((value) => value + 1);

  // The CSV importer used to be a panel of its own between the tools and the
  // stock list: an eyebrow, a heading, a sentence of explanation and a
  // full-width button, all to open one dialog. It goes in the tools strip as a
  // button, which is what it is. The dialog it opens still explains itself.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <InventoryToolsPanel
        onInventoryChanged={refreshInventory}
        extraActions={<InventoryImportReview onImported={refreshInventory} compact />}
      />
      <StockManagementPage key={version} />
    </div>
  );
}
