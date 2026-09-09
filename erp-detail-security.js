// ERP DEMO 4.3.0 — local trial detail/attachment safety helpers
export function safeAttachmentUrl(raw, kind='file') {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (/^blob:/i.test(value)) return value;
  if (/^https:\/\//i.test(value)) return value;
  if (kind === 'image' && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value)) return value;
  if (kind === 'pdf' && /^data:application\/pdf;base64,/i.test(value)) return value;
  return '';
}
export function safeAttachmentKind(type='') {
  return String(type).toLowerCase().startsWith('image/') ? 'image' : 'pdf';
}
