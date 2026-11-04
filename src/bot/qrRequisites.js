const jsQR = require('jsqr');
const QRCode = require('qrcode');
const sharp = require('sharp');

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 24_000_000;
const CARD_WIDTH = 1200;
const CARD_HEIGHT = 1200;
const QR_SIZE = 1000;

async function decodeQr(imageBuffer) {
  const { data, info } = await sharp(imageBuffer, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const decoded = jsQR(pixels, info.width, info.height, { inversionAttempts: 'attemptBoth' });
  if (!decoded?.data) throw new Error('QR_NOT_FOUND');
  return decoded.data;
}

function cardSvg() {
  return Buffer.from(`
    <svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="1200" fill="#ffffff"/>
      <text x="54" y="132" fill="#10243a" font-family="Arial, sans-serif" font-size="120" font-style="italic" font-weight="900" letter-spacing="-3">SOMJET</text>
      <rect x="50" y="155" width="1100" height="1030" rx="26" fill="#ffffff" stroke="#e3e9f0" stroke-width="3"/>
    </svg>
  `);
}

async function makeStyledQr(payload) {
  const qrBuffer = await QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'H',
    margin: 4,
    width: QR_SIZE,
    color: { dark: '#05070b', light: '#ffffffff' },
  });

  const qrRaw = await sharp(qrBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const verified = jsQR(
    new Uint8ClampedArray(qrRaw.data.buffer, qrRaw.data.byteOffset, qrRaw.data.byteLength),
    qrRaw.info.width,
    qrRaw.info.height,
    { inversionAttempts: 'dontInvert' }
  );
  if (!verified || verified.data !== payload) throw new Error('QR_VERIFY_FAILED');

  return sharp(cardSvg())
    .composite([
      { input: qrBuffer, left: (CARD_WIDTH - QR_SIZE) / 2, top: 165 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function extractPaymentLinkFragment(decodedPayload) {
  const hashIndex = String(decodedPayload).indexOf('#');
  if (hashIndex < 0 || hashIndex === String(decodedPayload).length - 1) {
    throw new Error('QR_LINK_FRAGMENT_NOT_FOUND');
  }
  // Keep the original fragment byte-for-byte, including escapes such as %20.
  return String(decodedPayload).slice(hashIndex);
}

async function downloadTelegramPhoto(telegram, fileId) {
  const fileUrl = await telegram.getFileLink(fileId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetch(fileUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error('QR_DOWNLOAD_FAILED');

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_SOURCE_BYTES) throw new Error('QR_IMAGE_TOO_LARGE');
  const source = Buffer.from(await response.arrayBuffer());
  if (source.length > MAX_SOURCE_BYTES) throw new Error('QR_IMAGE_TOO_LARGE');
  return source;
}

async function readPaymentLinkFragmentFromTelegramPhoto(telegram, fileId) {
  const source = await downloadTelegramPhoto(telegram, fileId);
  return extractPaymentLinkFragment(await decodeQr(source));
}

async function createStyledQrFromTelegramPhoto(telegram, fileId) {
  const source = await downloadTelegramPhoto(telegram, fileId);
  const payload = await decodeQr(source);
  const paymentLinkFragment = extractPaymentLinkFragment(payload);
  return {
    image: await makeStyledQr(payload),
    paymentLinkFragment,
  };
}

module.exports = {
  createStyledQrFromTelegramPhoto,
  readPaymentLinkFragmentFromTelegramPhoto,
};
