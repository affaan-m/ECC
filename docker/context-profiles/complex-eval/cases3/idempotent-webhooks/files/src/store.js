'use strict';

// Shared infrastructure. Every applied payment is appended to paymentLog;
// orders and processedEvents track receiver state. Keep the `store` export.
const store = {
  orders: new Map([
    ['o1', { id: 'o1', amountCents: 5000, status: 'pending', paidAt: null, paymentsApplied: 0 }],
    ['o2', { id: 'o2', amountCents: 12500, status: 'pending', paidAt: null, paymentsApplied: 0 }],
    ['o3', { id: 'o3', amountCents: 800, status: 'pending', paidAt: null, paymentsApplied: 0 }],
    ['o4', { id: 'o4', amountCents: 9999, status: 'pending', paidAt: null, paymentsApplied: 0 }],
    ['o5', { id: 'o5', amountCents: 250, status: 'pending', paidAt: null, paymentsApplied: 0 }],
    ['o6', { id: 'o6', amountCents: 7300, status: 'pending', paidAt: null, paymentsApplied: 0 }],
  ]),
  paymentLog: [],
  processedEvents: new Set(),
};

module.exports = { store };
