const {
  ACTIVE_SALE_STATUSES,
  PAYMENT_METHODS,
  number,
  round,
  pctChange,
  isoDay,
  dateSeries,
} = require('./report-utils');

function buildTrend(from, to, activeSales, salePayments, repairPayments) {
  const map = new Map(dateSeries(from, to).map((date) => [date, {
    date,
    revenue: 0,
    profit: 0,
    received: 0,
    repairReceived: 0,
    invoices: 0,
  }]));
  for (const sale of activeSales) {
    const row = map.get(isoDay(sale.soldAt));
    if (!row) continue;
    row.revenue += number(sale.total);
    row.profit += number(sale.profitTotal);
    row.invoices += 1;
  }
  for (const payment of salePayments) {
    const row = map.get(isoDay(payment.paidAt));
    if (row) row.received += number(payment.amount);
  }
  for (const payment of repairPayments) {
    const row = map.get(isoDay(payment.paidAt));
    if (row) {
      row.received += number(payment.amount);
      row.repairReceived += number(payment.amount);
    }
  }
  return [...map.values()].map((row) => ({
    ...row,
    revenue: round(row.revenue),
    profit: round(row.profit),
    received: round(row.received),
    repairReceived: round(row.repairReceived),
  }));
}

function buildPaymentMix(salePayments, repairPayments) {
  const map = new Map(PAYMENT_METHODS.map((method) => [method, 0]));
  for (const payment of [...salePayments, ...repairPayments]) {
    map.set(payment.method, number(map.get(payment.method)) + number(payment.amount));
  }
  return [...map.entries()]
    .map(([method, amount]) => ({ method, amount: round(amount) }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

function buildProductReports(activeSales) {
  const products = new Map();
  const categories = new Map();
  for (const sale of activeSales) {
    for (const item of sale.items || []) {
      const productKey = `${item.productNameSnapshot}||${item.variantNameSnapshot || ''}`;
      const row = products.get(productKey) || {
        name: item.productNameSnapshot,
        variant: item.variantNameSnapshot || '',
        category: item.categoryNameSnapshot || 'Uncategorized',
        quantity: 0,
        revenue: 0,
        profit: 0,
      };
      row.quantity += Number(item.quantity || 0);
      row.revenue += number(item.actualSoldPrice) * Number(item.quantity || 0) - number(item.discount);
      row.profit += number(item.profit);
      products.set(productKey, row);

      const category = item.categoryNameSnapshot || 'Uncategorized';
      const categoryRow = categories.get(category) || { name: category, quantity: 0, revenue: 0, profit: 0 };
      categoryRow.quantity += Number(item.quantity || 0);
      categoryRow.revenue += number(item.actualSoldPrice) * Number(item.quantity || 0) - number(item.discount);
      categoryRow.profit += number(item.profit);
      categories.set(category, categoryRow);
    }
  }
  return {
    topProducts: [...products.values()]
      .map((row) => ({ ...row, revenue: round(row.revenue), profit: round(row.profit) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15),
    categories: [...categories.values()]
      .map((row) => ({ ...row, revenue: round(row.revenue), profit: round(row.profit) }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

function buildStaff(activeSales) {
  const map = new Map();
  for (const sale of activeSales) {
    const id = sale.user?.id || 'unknown';
    const row = map.get(id) || {
      id,
      name: sale.user?.name || sale.user?.username || 'Unknown',
      invoices: 0,
      units: 0,
      revenue: 0,
      profit: 0,
    };
    row.invoices += 1;
    row.units += (sale.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    row.revenue += number(sale.total);
    row.profit += number(sale.profitTotal);
    map.set(id, row);
  }
  return [...map.values()]
    .map((row) => ({ ...row, revenue: round(row.revenue), profit: round(row.profit) }))
    .sort((a, b) => b.revenue - a.revenue);
}

function buildRepairReports(repairs) {
  const statusMap = new Map();
  const technicianMap = new Map();
  for (const repair of repairs) {
    statusMap.set(repair.status, (statusMap.get(repair.status) || 0) + 1);
    const id = repair.technician?.id || 'unassigned';
    const row = technicianMap.get(id) || {
      id,
      name: repair.technician?.name || repair.technician?.username || 'Unassigned',
      jobs: 0,
      completed: 0,
      delivered: 0,
      finalValue: 0,
    };
    row.jobs += 1;
    if (['COMPLETED', 'DELIVERED'].includes(repair.status)) row.completed += 1;
    if (repair.status === 'DELIVERED') row.delivered += 1;
    row.finalValue += number(repair.finalCost || repair.estimatedCost);
    technicianMap.set(id, row);
  }
  return {
    repairStatuses: [...statusMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    technicians: [...technicianMap.values()]
      .map((row) => ({ ...row, finalValue: round(row.finalValue) }))
      .sort((a, b) => b.jobs - a.jobs),
  };
}

function buildSummary({ sales, previousSales, salePayments, repairPayments, repairs, customers, inventory, serviceTransactions }) {
  const activeSales = sales.filter((sale) => ACTIVE_SALE_STATUSES.includes(sale.status));
  const revenue = activeSales.reduce((sum, sale) => sum + number(sale.total), 0);
  const salesProfit = activeSales.reduce((sum, sale) => sum + number(sale.profitTotal), 0);
  const previousRevenue = previousSales.reduce((sum, sale) => sum + number(sale.total), 0);
  const previousProfit = previousSales.reduce((sum, sale) => sum + number(sale.profitTotal), 0);
  const saleReceived = salePayments.reduce((sum, row) => sum + number(row.amount), 0);
  const repairReceived = repairPayments.reduce((sum, row) => sum + number(row.amount), 0);
  const receivable = customers.reduce((sum, row) => sum + Math.max(0, number(row.balance)), 0);
  const inventoryCostValue = inventory.reduce((sum, row) => sum + Number(row.quantity || 0) * number(row.productVariant.costPrice), 0);
  const inventoryRetailValue = inventory.reduce((sum, row) => sum + Number(row.quantity || 0) * number(row.productVariant.standardSellingPrice), 0);
  return {
    activeSales,
    summary: {
      revenue: round(revenue),
      salesCost: round(activeSales.reduce((sum, sale) => sum + number(sale.costTotal), 0)),
      salesProfit: round(salesProfit),
      serviceProfit: round(serviceTransactions.reduce((sum, row) => sum + number(row.serviceProfit), 0)),
      discount: round(activeSales.reduce((sum, sale) => sum + number(sale.discount), 0)),
      invoices: activeSales.length,
      unitsSold: activeSales.reduce((sum, sale) => sum + (sale.items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0),
      averageTicket: activeSales.length ? round(revenue / activeSales.length) : 0,
      saleReceived: round(saleReceived),
      repairReceived: round(repairReceived),
      totalReceived: round(saleReceived + repairReceived),
      receivable: round(receivable),
      inventoryCostValue: round(inventoryCostValue),
      inventoryRetailValue: round(inventoryRetailValue),
      lowStockCount: inventory.filter((row) => row.quantity <= row.minAlertQuantity).length,
      outOfStockCount: inventory.filter((row) => row.quantity <= 0).length,
      totalCustomers: customers.length,
      owingCustomers: customers.filter((row) => number(row.balance) > 0).length,
      repairs: repairs.length,
      completedRepairs: repairs.filter((row) => ['COMPLETED', 'DELIVERED'].includes(row.status)).length,
      voidedSales: sales.filter((row) => row.status === 'VOIDED').length,
      returnedSales: sales.filter((row) => ['RETURNED', 'PARTIAL_RETURN'].includes(row.status)).length,
      revenueChange: pctChange(revenue, previousRevenue),
      profitChange: pctChange(salesProfit, previousProfit),
    },
  };
}

module.exports = {
  buildTrend,
  buildPaymentMix,
  buildProductReports,
  buildStaff,
  buildRepairReports,
  buildSummary,
};
