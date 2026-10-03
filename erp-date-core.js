// ERP 4.3.1 Step 2A — Business-date core
// Pure/shared helpers for Thai Buddhist Era display while keeping storage/query years in CE.
// Keep this module DOM/storage independent so it can be regression-tested in Node.

const MODULE_NOW = new Date();

export function toCEYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return MODULE_NOW.getFullYear();
  return y >= 2400 ? y - 543 : y;
}

export function toBEYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return '';
  return y >= 2400 ? y : y + 543;
}

export function yearLabelBE(year) {
  return String(toBEYear(year));
}

// Kept as a separate API because existing UI code calls yearLabelDual().
// The project intentionally displays only พ.ศ. in the current customer-trial UI.
export function yearLabelDual(year) {
  return String(toBEYear(year));
}

export function parseFlexibleBusinessDate(value) {
  if (!value) return null;
  if (value?.toDate) {
    const d = value.toDate();
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (value?.seconds) {
    const d = new Date(Number(value.seconds) * 1000);
    return !Number.isNaN(d.getTime()) ? d : null;
  }

  const raw = String(value || '').trim();
  let m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const y = toCEYear(Number(m[1]));
    const d = new Date(y, Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Thai/Excel input: DD/MM/YYYY or DD-MM-YYYY, accepting both CE and BE years.
  m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s*\(ค\.ศ\.\s*(\d{4})\))?$/);
  if (m) {
    const y = toCEYear(Number(m[3]));
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isoDateCEFromValue(value) {
  const raw = String(value || '').trim();
  const d = parseFlexibleBusinessDate(raw);
  if (!d) return raw;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatThaiDate(value) {
  const d = parseFlexibleBusinessDate(value);
  if (!d) return value ? String(value) : '-';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${toBEYear(d.getFullYear())}`;
}

export function makeThaiCalendarMeta(
  dateValue,
  fallbackYear = MODULE_NOW.getFullYear(),
  fallbackMonth = MODULE_NOW.getMonth()
) {
  const d = parseFlexibleBusinessDate(dateValue);
  const year = d ? d.getFullYear() : toCEYear(fallbackYear);
  const month = d ? d.getMonth() : Number(fallbackMonth || 0);
  return {
    date: d ? isoDateCEFromValue(dateValue) : String(dateValue || ''),
    year,
    yearCE: year,
    yearBE: toBEYear(year),
    buddhistYear: toBEYear(year),
    month,
    monthIndex: month,
    monthNumber: month + 1,
    dateThai: d ? formatThaiDate(dateValue) : '',
    displayDate: d ? formatThaiDate(dateValue) : String(dateValue || '')
  };
}

export function withThaiCalendarMeta(record = {}, year, month) {
  const meta = makeThaiCalendarMeta(record.date, year, month);
  return { ...record, ...meta };
}
