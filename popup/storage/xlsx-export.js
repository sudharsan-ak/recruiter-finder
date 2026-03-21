function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function excelString(value) {
  return String(value ?? '').replace(/"/g, '""');
}

function toUtf8Bytes(text) {
  return new TextEncoder().encode(text);
}

function getZipDateParts(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

const _crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = _crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u16(value) {
  return [value & 0xFF, (value >>> 8) & 0xFF];
}

function u32(value) {
  return [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF];
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  chunks.forEach(chunk => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function zipStored(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = getZipDateParts();

  files.forEach(file => {
    const nameBytes = toUtf8Bytes(file.name);
    const dataBytes = typeof file.data === 'string' ? toUtf8Bytes(file.data) : file.data;
    const checksum = crc32(dataBytes);

    const localHeader = new Uint8Array([
      0x50, 0x4B, 0x03, 0x04,
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(checksum),
      ...u32(dataBytes.length),
      ...u32(dataBytes.length),
      ...u16(nameBytes.length),
      ...u16(0),
    ]);
    localParts.push(localHeader, nameBytes, dataBytes);

    const centralHeader = new Uint8Array([
      0x50, 0x4B, 0x01, 0x02,
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(checksum),
      ...u32(dataBytes.length),
      ...u32(dataBytes.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
    ]);
    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + dataBytes.length;
  });

  const centralDir = concatBytes(centralParts);
  const localDir = concatBytes(localParts);
  const endHeader = new Uint8Array([
    0x50, 0x4B, 0x05, 0x06,
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(centralDir.length),
    ...u32(localDir.length),
    ...u16(0),
  ]);

  return concatBytes([localDir, centralDir, endHeader]);
}

function columnRef(index) {
  let n = index;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode((n % 26) + 65) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function inlineCell(ref, value, style = 0) {
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function formulaCell(ref, formula, cachedValue, style = 0) {
  return `<c r="${ref}" t="str" s="${style}"><f>${xmlEscape(formula)}</f><v>${xmlEscape(cachedValue)}</v></c>`;
}

function buildRecruiterWorkbookXml(rows) {
  const header = ['Name', 'Company', 'Email', 'Role', 'LinkedIn URL'];
  const columnWidths = [40, 30, 30, 50, 50];
  const allRows = [header, ...rows];

  const rowXml = allRows.map((row, rowIndex) => {
    const cells = row.map((cell, colIndex) => {
      const ref = `${columnRef(colIndex)}${rowIndex + 1}`;
      if (rowIndex === 0) return inlineCell(ref, cell, 1);
      if ((colIndex === 1 || colIndex === 2 || colIndex === 4) && cell?.formula) {
        return formulaCell(ref, cell.formula, cell.display, 2);
      }
      return inlineCell(ref, typeof cell === 'object' ? cell.display : cell, 0);
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');

  const colsXml = columnWidths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  ).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colsXml}</cols>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A1:E${allRows.length}"/>
</worksheet>`;
}

function buildXlsxBlob(rows) {
  const sheetXml = buildRecruiterWorkbookXml(rows);
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Recruiters" sheetId="1" r:id="rId1"/>
  </sheets>
  <calcPr calcId="124519" fullCalcOnLoad="1"/>
</workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
    <font><u/><color rgb="FF0563C1"/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ];

  const zipBytes = zipStored(files);
  return new Blob([zipBytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function exportToXlsx() {
  const cache = await getCache();
  const keys = Object.keys(cache).sort((a, b) => cache[b].scannedAt - cache[a].scannedAt);

  if (keys.length === 0) {
    globalThis.setHistoryActionStatus?.('Nothing to export');
    exportXlsxBtn.textContent = '⚠️ Nothing to export';
    setTimeout(() => { exportXlsxBtn.textContent = 'XLSX'; }, 2000);
    return;
  }

  const rows = [];
  keys.forEach(slug => {
    const entry = cache[slug];
    const companyName = entry.displayName || slug.replace(/-/g, ' ');
    const companyLinkedIn = `https://www.linkedin.com/company/${slug}/`;
    const companyDisplay = companyName;
    const companyFormula = `HYPERLINK("${excelString(companyLinkedIn)}","${excelString(companyDisplay)}")`;

    const recruiters = entry.recruiters || [];
    if (!recruiters.length) {
      rows.push([
        '',
        { display: companyDisplay, formula: companyFormula },
        '',
        '',
        { display: '', formula: '' },
      ]);
      return;
    }

    recruiters.forEach(recruiter => {
      const profileUrl = recruiter.url || '';
      const profileFormula = profileUrl
        ? `HYPERLINK("${excelString(profileUrl)}","${excelString(profileUrl)}")`
        : '';
      const email = recruiter.email || '';
      const emailFormula = email
        ? `HYPERLINK("${excelString(`https://mail.google.com/mail/?view=cm&fs=1&to=${email}`)}","${excelString(email)}")`
        : '';
      rows.push([
        recruiter.name || '',
        { display: companyDisplay, formula: companyFormula },
        { display: email, formula: emailFormula },
        recruiter.title || '',
        { display: profileUrl, formula: profileFormula || '' },
      ]);
    });
  });

  const blob = buildXlsxBlob(rows);
  const blobUrl = URL.createObjectURL(blob);
  const date = new Date();
  const datePart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const filename = `linkedin-recruiters-${datePart}.xlsx`;

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);

  globalThis.setHistoryActionStatus?.('Export XLSX done');
  exportXlsxBtn.textContent = '✅ Exported!';
  setTimeout(() => { exportXlsxBtn.textContent = 'XLSX'; }, 2000);
}

exportXlsxBtn.addEventListener('click', exportToXlsx);


