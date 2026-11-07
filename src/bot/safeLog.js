function safeErrorSummary(error) {
  const name = /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(String(error?.name || '')) ? error.name : 'Error';
  const codeValue = error?.response?.error_code ?? error?.response?.statusCode ?? error?.code;
  const code = /^(?:\d{3,4}|[A-Z0-9_-]{1,24})$/.test(String(codeValue || '')) ? String(codeValue) : '';
  return code ? `${name} code=${code}` : name;
}

function safeTelegramErrorSummary(error) {
  const codeValue = error?.response?.error_code ?? error?.response?.statusCode;
  const code = /^(?:\d{3,4})$/.test(String(codeValue || '')) ? String(codeValue) : 'unknown';
  const description = String(error?.response?.description || error?.description || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\b\d{7,}:\w{20,}\b/g, '[redacted-token]')
    .slice(0, 300);
  return description ? `Telegram API ${code}: ${description}` : safeErrorSummary(error);
}

module.exports = { safeErrorSummary, safeTelegramErrorSummary };
