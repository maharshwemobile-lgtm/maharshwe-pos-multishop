import React, { useState } from 'react';
import InventoryToolsPanel from './InventoryToolsPanel.jsx';
import InventoryImportReview from './InventoryImportReview.jsx';
import StockManagementPage from './StockManagementPage.jsx';

export default function StockWorkspace() {
  const [version, setVersion] = useState(0);
  const refreshInventory = () => setVersion((value) => value + 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <InventoryToolsPanel onInventoryChanged={refreshInventory} />
      <InventoryImportReview onImported={refreshInventory} />
      <StockManagementPage key={version} />
    </div>
  );
}
