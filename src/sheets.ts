import { google } from "googleapis";
import { columnToLetter } from "./checklist";

// Member color palette (soft, professional colors)
const MEMBER_COLORS = [
  { red: 0.85, green: 0.92, blue: 0.98 }, // Light blue
  { red: 0.98, green: 0.91, blue: 0.85 }, // Light orange
  { red: 0.88, green: 0.94, blue: 0.88 }, // Light green
  { red: 0.95, green: 0.88, blue: 0.95 }, // Light purple
  { red: 0.98, green: 0.95, blue: 0.85 }, // Light yellow
  { red: 0.92, green: 0.88, blue: 0.95 }, // Light indigo
];

const HEADER_COLOR = { red: 0.95, green: 0.95, blue: 0.95 }; // Light gray

/**
 * Create a new sheet tab and write values with styling
 */
export async function appendToSheet(
  sheetId: string,
  rangeStart: string,
  values: (string | boolean)[][],
  keyB64: string,
  memberCount: number
): Promise<{ sheetTitle: string; createdSheetId: number | undefined }> {
  const keyJson = Buffer.from(keyB64, "base64").toString("utf8");
  const creds = JSON.parse(keyJson);

  const client = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth: client });

  // Generate unique sheet title based on date
  const dateTitle = new Date().toISOString().slice(0, 10);
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existingTitles =
    spreadsheet.data.sheets
      ?.map((s) => s.properties?.title)
      .filter((title): title is string => !!title) || [];

  let sheetTitle = dateTitle;
  let suffix = 1;
  while (existingTitles.includes(sheetTitle)) {
    suffix += 1;
    sheetTitle = `${dateTitle}-${suffix}`;
  }

  // Create new sheet
  const addSheetResponse = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: sheetTitle },
          },
        },
      ],
    },
  });

  const createdSheetId =
    addSheetResponse.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;

  // Write values
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetTitle}!${rangeStart}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  // Apply styling
  if (createdSheetId != null && values.length > 0) {
    const requests = buildFormattingRequests(createdSheetId, values, memberCount);

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests },
      });
    }
  }

  return { sheetTitle, createdSheetId };
}

/**
 * Build all formatting requests for the spreadsheet
 */
function buildFormattingRequests(
  sheetId: number,
  values: (string | boolean)[][],
  memberCount: number
): object[] {
  const totalColumns = memberCount * 4;
  const totalRows = values.length;
  const dataRowCount = Math.max(0, values.length - 2);
  const requests: object[] = [];

  // 1. Freeze header rows
  requests.push(buildFreezeRowsRequest(sheetId));

  // 2. Style member name row and add conditional formatting
  for (let memberIndex = 0; memberIndex < memberCount; memberIndex++) {
    const color = MEMBER_COLORS[memberIndex % MEMBER_COLORS.length];
    const startCol = memberIndex * 4;

    requests.push(buildMemberHeaderRequest(sheetId, startCol, color));

    if (dataRowCount > 0) {
      requests.push(buildCompletionConditionalFormat(sheetId, startCol, dataRowCount));
    }
  }

  // 3. Style column header row
  requests.push(buildColumnHeaderRequest(sheetId, totalColumns));

  // 4. Style data rows
  if (dataRowCount > 0) {
    requests.push(buildDataRowsAlignmentRequest(sheetId, totalRows, totalColumns));

    for (let memberIndex = 0; memberIndex < memberCount; memberIndex++) {
      const columnIndex = memberIndex * 4;
      requests.push(buildCheckboxRequest(sheetId, dataRowCount, columnIndex));
      requests.push(buildCheckboxAlignmentRequest(sheetId, totalRows, columnIndex));
    }
  }

  // 5. Add borders
  for (let memberIndex = 0; memberIndex < memberCount; memberIndex++) {
    requests.push(buildBorderRequest(sheetId, totalRows, memberIndex * 4));
  }

  // 6. Set column widths
  for (let memberIndex = 0; memberIndex < memberCount; memberIndex++) {
    requests.push(...buildColumnWidthRequests(sheetId, memberIndex * 4));
  }

  // 7. Set header row height
  requests.push(buildHeaderRowHeightRequest(sheetId));

  return requests;
}

function buildFreezeRowsRequest(sheetId: number): object {
  return {
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 2 },
      },
      fields: "gridProperties.frozenRowCount",
    },
  };
}

function buildMemberHeaderRequest(
  sheetId: number,
  startCol: number,
  color: { red: number; green: number; blue: number }
): object {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: startCol,
        endColumnIndex: startCol + 4,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: color,
          textFormat: { bold: true, fontSize: 11 },
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
          padding: { left: 8 },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)",
    },
  };
}

function buildCompletionConditionalFormat(
  sheetId: number,
  startCol: number,
  dataRowCount: number
): object {
  const checkboxCol = columnToLetter(startCol);
  const dataStartRow = 3;
  const dataEndRow = dataStartRow + dataRowCount - 1;

  return {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: startCol,
            endColumnIndex: startCol + 4,
          },
        ],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [
              {
                userEnteredValue: `=COUNTIF(${checkboxCol}${dataStartRow}:${checkboxCol}${dataEndRow},TRUE)=${dataRowCount}`,
              },
            ],
          },
          format: {
            backgroundColor: { red: 0.72, green: 0.88, blue: 0.72 },
            textFormat: { bold: true, foregroundColor: { red: 0.15, green: 0.5, blue: 0.15 } },
          },
        },
      },
      index: 0,
    },
  };
}

function buildColumnHeaderRequest(sheetId: number, totalColumns: number): object {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 0,
        endColumnIndex: totalColumns,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_COLOR,
          textFormat: { bold: true, fontSize: 10 },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  };
}

function buildDataRowsAlignmentRequest(
  sheetId: number,
  totalRows: number,
  totalColumns: number
): object {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 2,
        endRowIndex: totalRows,
        startColumnIndex: 0,
        endColumnIndex: totalColumns,
      },
      cell: {
        userEnteredFormat: { verticalAlignment: "MIDDLE" },
      },
      fields: "userEnteredFormat(verticalAlignment)",
    },
  };
}

function buildCheckboxRequest(
  sheetId: number,
  dataRowCount: number,
  columnIndex: number
): object {
  return {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 2,
        endRowIndex: 2 + dataRowCount,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      rule: {
        condition: { type: "BOOLEAN" },
        showCustomUi: true,
      },
    },
  };
}

function buildCheckboxAlignmentRequest(
  sheetId: number,
  totalRows: number,
  columnIndex: number
): object {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 2,
        endRowIndex: totalRows,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      cell: {
        userEnteredFormat: { horizontalAlignment: "CENTER" },
      },
      fields: "userEnteredFormat(horizontalAlignment)",
    },
  };
}

function buildBorderRequest(sheetId: number, totalRows: number, startCol: number): object {
  const borderStyle = {
    style: "SOLID",
    width: 1,
    color: { red: 0.8, green: 0.8, blue: 0.8 },
  };
  const thickBorder = {
    style: "SOLID_MEDIUM",
    width: 2,
    color: { red: 0.6, green: 0.6, blue: 0.6 },
  };

  return {
    updateBorders: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: totalRows,
        startColumnIndex: startCol,
        endColumnIndex: startCol + 4,
      },
      top: thickBorder,
      bottom: thickBorder,
      left: thickBorder,
      right: thickBorder,
      innerHorizontal: borderStyle,
      innerVertical: borderStyle,
    },
  };
}

function buildColumnWidthRequests(sheetId: number, startCol: number): object[] {
  const widths = [120, 100, 100, 300]; // checkbox, PR, owner, description

  return widths.map((pixelSize, index) => ({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: startCol + index,
        endIndex: startCol + index + 1,
      },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  }));
}

function buildHeaderRowHeightRequest(sheetId: number): object {
  return {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: 0,
        endIndex: 2,
      },
      properties: { pixelSize: 32 },
      fields: "pixelSize",
    },
  };
}
