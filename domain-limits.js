'use strict';
function customDomainLimit() {
  const raw = Number(process.env.CUSTOM_DOMAIN_LIMIT);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(50000, Math.floor(raw));
  return 5000;
}
module.exports = { customDomainLimit };
