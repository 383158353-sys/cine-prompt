// Minimal XLSX parser using only browser APIs (no external dependencies)
// Parses .xlsx files (ZIP+XML format) into a 2D array of cell values

async function decompressDeflateRaw(compressed) {
  const stream = new Response(compressed).body.pipeThrough(new DecompressionStream('deflate-raw'));
  const decompressed = await new Response(stream).arrayBuffer();
  return new Uint8Array(decompressed);
}

function findEocd(bytes) {
  const minEocdSize = 22;
  const searchStart = Math.max(0, bytes.length - minEocdSize - 65535);
  for (let i = bytes.length - minEocdSize; i >= searchStart; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

function parseZipEntries(bytes, view) {
  const eocdOffset = findEocd(bytes);
  if (eocdOffset === -1) throw new Error('Invalid XLSX: ZIP structure not found');
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdEntries = view.getUint16(eocdOffset + 10, true);
  const entries = {};
  let offset = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const fileCommentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileName = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));
    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraFieldLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
    entries[fileName] = { compressionMethod, compressedSize, dataOffset };
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return entries;
}

async function extractEntry(bytes, entry) {
  if (!entry) return null;
  const compressed = bytes.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return await decompressDeflateRaw(compressed);
  throw new Error('Unsupported compression: ' + entry.compressionMethod);
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return [];
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const sis = doc.getElementsByTagName('si');
  const strings = [];
  for (let i = 0; i < sis.length; i++) {
    let text = '';
    const ts = sis[i].getElementsByTagName('t');
    for (let j = 0; j < ts.length; j++) text += ts[j].textContent || '';
    strings.push(text);
  }
  return strings;
}

function colLetterToIndex(letters) {
  let index = 0;
  for (let i = 0; i < letters.length; i++) index = index * 26 + (letters.charCodeAt(i) - 64);
  return index - 1;
}

function parseWorksheet(xmlText, sharedStrings) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const rows = doc.getElementsByTagName('row');
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].getElementsByTagName('c');
    const rowData = [];
    for (let j = 0; j < cells.length; j++) {
      const cell = cells[j];
      const ref = cell.getAttribute('r') || '';
      const colLetters = ref.match(/[A-Z]+/);
      const colIndex = colLetters ? colLetterToIndex(colLetters[0]) : j;
      const type = cell.getAttribute('t');
      const v = cell.getElementsByTagName('v')[0];
      const is = cell.getElementsByTagName('is')[0];
      let value = '';
      if (type === 's' && v) {
        value = sharedStrings[parseInt(v.textContent)] || '';
      } else if (type === 'inlineStr' && is) {
        const ts = is.getElementsByTagName('t');
        for (let k = 0; k < ts.length; k++) value += ts[k].textContent || '';
      } else if (v) {
        value = v.textContent || '';
      }
      while (rowData.length < colIndex) rowData.push('');
      rowData[colIndex] = value;
    }
    result.push(rowData);
  }
  return result;
}

export async function parseXlsx(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const entries = parseZipEntries(bytes, view);
  const ssBytes = await extractEntry(bytes, entries['xl/sharedStrings.xml']);
  const sharedStrings = parseSharedStrings(ssBytes ? new TextDecoder().decode(ssBytes) : '');
  let wsEntry = entries['xl/worksheets/sheet1.xml'];
  if (!wsEntry) {
    for (const name in entries) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) { wsEntry = entries[name]; break; }
    }
  }
  if (!wsEntry) throw new Error('No worksheet found in XLSX');
  const wsBytes = await extractEntry(bytes, wsEntry);
  return parseWorksheet(new TextDecoder().decode(wsBytes), sharedStrings);
}