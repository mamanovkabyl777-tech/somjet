const TIYIN_PER_SOM = 100;
const MIN_TOPUP_TIYIN = 40 * TIYIN_PER_SOM;
const MAX_TOPUP_TIYIN = 10000 * TIYIN_PER_SOM;

function parseSomAmount(value) {
  const input = String(value ?? '').trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(input)) return null;

  const [som, fraction = ''] = input.replace(',', '.').split('.');
  const amount = Number(som) * TIYIN_PER_SOM + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
}

function isValidTopupAmount(amountTiyin) {
  return Number.isSafeInteger(amountTiyin) && amountTiyin >= MIN_TOPUP_TIYIN && amountTiyin <= MAX_TOPUP_TIYIN;
}

function formatSom(amountTiyin) {
  return (Number(amountTiyin || 0) / TIYIN_PER_SOM).toFixed(2);
}

function formatSomLocalized(amountTiyin) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
    .format(Number(amountTiyin || 0) / TIYIN_PER_SOM);
}

module.exports = {
  TIYIN_PER_SOM,
  MIN_TOPUP_TIYIN,
  MAX_TOPUP_TIYIN,
  parseSomAmount,
  isValidTopupAmount,
  formatSom,
  formatSomLocalized,
};
