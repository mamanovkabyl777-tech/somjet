const MAX_RECEIPT_IMAGE_BYTES = 15 * 1024 * 1024;

function isReceiptImageTooLarge(file) {
  return Number(file?.file_size) > MAX_RECEIPT_IMAGE_BYTES;
}

async function rejectOversizedReceiptImage(ctx) {
  await ctx.reply('Изображение слишком большое. Максимальный размер — 15 МБ. Отправьте изображение как файл, если у него высокое разрешение.');
}

module.exports = { MAX_RECEIPT_IMAGE_BYTES, isReceiptImageTooLarge, rejectOversizedReceiptImage };
