// Parse comma-separated records, including escaped quotes and multiline fields.
export function parseCsv(text) {
  text = String(text).replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw new Error('CSV contains binary NUL');
  const records = [];
  let row = [], field = '', state = 'start', touched = false;
  function endField() { row.push(field); field = ''; state = 'start'; }
  function endRow() {
    endField();
    if (touched || row.length > 1 || row[0].trim() !== '') records.push(row);
    row = []; touched = false;
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else field += c;
      continue;
    }
    if (c === ',') { touched = true; endField(); continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow(); continue;
    }
    if (state === 'closed') throw new Error('Invalid CSV: unexpected text after closing quote');
    if (c === '"') {
      if (state !== 'start') throw new Error('Invalid CSV: quote inside unquoted field');
      state = 'quoted'; touched = true; continue;
    }
    field += c; state = 'unquoted';
  }
  if (state === 'quoted') throw new Error('Invalid CSV: unterminated quoted field');
  if (touched || row.length || field.length || state === 'closed') endRow();
  if (records.length < 2) throw new Error('CSV must contain at least a header + 1 row');
  const header = records[0].map(h => h.trim());
  if (header.some(h => !h) || new Set(header).size !== header.length) throw new Error('CSV has empty or duplicate headers');
  const rows = records.slice(1);
  if (rows.some(r => r.length !== header.length)) throw new Error('CSV row has wrong number of fields');
  return { header, rows };
}
export function parseNumericCell(cell) {
  const text = String(cell ?? '').trim();
  if (!text || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
