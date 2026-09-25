// F3.21A / F3.21B: fills the official blank NOP forms (stored in the habd-forms bucket) by
// writing values into the form's own cells, so the issued PDF is the official form itself.
//
// Cell boxes below are measured from the blank PDFs (A4, 595.32 x 841.92 pt), given top-down
// as [x0, y0, x1, y1] to match how the forms read; pdf-lib's origin is bottom-left.

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import { Asset, Fault, isWild, locationOf, londonNow, Parts, parseWallClock } from "./shared.ts";

type Box = [number, number, number, number];

const PAGE_H = 841.92;
const SIZE = 11; // body text on the form is 11pt Arial; Helvetica has the same metrics
const PAD = 6;

const A = {
  uniq: [285.8, 167.6, 424.0, 179.9] as Box, // the dotted line after "Unique reference No:"
  xHabd: [250.1, 227.5, 334.5, 264.9] as Box,
  xWild: [443.7, 227.5, 538.2, 264.9] as Box,
  time: [146.4, 290.6, 538.2, 315.2] as Box,
  date: [146.4, 315.6, 538.2, 340.4] as Box,
  route: [146.9, 366.6, 538.2, 391.2] as Box,
  elr: [146.9, 391.7, 538.2, 416.4] as Box,
  location: [146.9, 416.9, 538.2, 441.5] as Box,
  line: [146.9, 442.0, 538.2, 466.8] as Box,
  miles: [146.9, 467.2, 538.2, 491.9] as Box,
  signed: [125.2, 632.0, 378.1, 668.7] as Box,
  signedDate: [430.1, 632.0, 538.2, 668.7] as Box,
};

const B = {
  uniq: [292.7, 167.6, 416.8, 179.9] as Box,
  fromTime: [160.2, 243.6, 538.2, 268.4] as Box,
  fromDate: [160.2, 268.8, 538.2, 293.5] as Box,
  toTime: [160.2, 345.0, 538.2, 369.8] as Box,
  toDate: [160.2, 370.2, 538.2, 394.8] as Box,
  route: [160.6, 421.1, 538.2, 445.9] as Box,
  elr: [160.6, 446.3, 538.2, 470.9] as Box,
  location: [160.6, 471.4, 538.2, 496.1] as Box,
  line: [160.6, 496.6, 538.2, 521.3] as Box,
  miles: [160.6, 521.8, 538.2, 546.4] as Box,
  signed: [125.2, 711.9, 378.1, 748.5] as Box,
  signedDate: [430.1, 711.9, 538.2, 748.5] as Box,
};

type Fonts = { reg: PDFFont; bold: PDFFont };

// Shrinks to fit rather than overflow into the next cell.
function fit(text: string, font: PDFFont, size: number, width: number): number {
  let s = size;
  while (s > 6 && font.widthOfTextAtSize(text, s) > width) s -= 0.5;
  return s;
}

function put(page: PDFPage, f: Fonts, box: Box, value: string, opts: { center?: boolean; bold?: boolean } = {}) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return;
  const font = opts.bold ? f.bold : f.reg;
  const [x0, y0, x1, y1] = box;
  const size = fit(text, font, SIZE, x1 - x0 - 2 * PAD);
  const w = font.widthOfTextAtSize(text, size);
  const x = opts.center ? x0 + (x1 - x0 - w) / 2 : x0 + PAD;
  const baseline = (y0 + y1) / 2 + size * 0.35;
  page.drawText(text, { x, y: PAGE_H - baseline, size, font, color: rgb(0, 0, 0) });
}

// The reference sits on a printed dotted line; blank the dots and write over them.
function putReference(page: PDFPage, f: Fonts, box: Box, value: string) {
  const [x0, y0, x1, y1] = box;
  page.drawRectangle({ x: x0 - 1, y: PAGE_H - y1 - 1, width: x1 - x0 + 2, height: y1 - y0 + 2, color: rgb(1, 1, 1) });
  const text = String(value ?? "").trim();
  if (!text) return;
  const size = fit(text, f.bold, SIZE, x1 - x0);
  page.drawText(text, { x: x0 + 2, y: PAGE_H - (y0 + 10), size, font: f.bold, color: rgb(0, 0, 0) });
}

async function open(blank: Uint8Array, title: string) {
  const doc = await PDFDocument.load(blank);
  const fonts = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  doc.setTitle(title);
  doc.setProducer("HABD/WILD EM");
  doc.setCreator("HABD/WILD EM");
  return { doc, page: doc.getPage(0), fonts };
}

export type FormInput = { fault: Fault; asset: Asset | null; signedBy?: string | null; now?: Date };

// F3.21A — advice of outage. TIME / DATE is the time of issue.
export async function buildFormA(blank: Uint8Array, { fault, asset, signedBy, now }: FormInput): Promise<Uint8Array> {
  const { doc, page, fonts } = await open(blank, `F3.21A – FIN ${fault.FIN}`);
  const loc = locationOf(asset, fault);
  const issued = londonNow(now);
  const wild = isWild(asset);

  putReference(page, fonts, A.uniq, fault.FMS ?? "");
  put(page, fonts, wild ? A.xWild : A.xHabd, "X", { center: true, bold: true });
  put(page, fonts, A.time, issued.time);
  put(page, fonts, A.date, issued.date);
  put(page, fonts, A.route, loc.route);
  put(page, fonts, A.elr, loc.elr);
  put(page, fonts, A.location, loc.location);
  put(page, fonts, A.line, loc.line);
  put(page, fonts, A.miles, loc.mileage);
  put(page, fonts, A.signed, signedBy ?? "");
  put(page, fonts, A.signedDate, issued.date);
  return await doc.save();
}

// F3.21B — advice of reinstatement. "Out of use from" is the booked failure time; "reinstated"
// is the Date in order recorded on the fault.
export async function buildFormB(blank: Uint8Array, { fault, asset, signedBy, now }: FormInput): Promise<Uint8Array> {
  const { doc, page, fonts } = await open(blank, `F3.21B – FIN ${fault.FIN}`);
  const loc = locationOf(asset, fault);
  const issued = londonNow(now);
  const from: Parts = parseWallClock(fault["Failure Date"]) ?? { date: "", time: "" };
  const back: Parts = parseWallClock(fault["Date in order"]) ?? issued;

  putReference(page, fonts, B.uniq, fault.FMS ?? "");
  put(page, fonts, B.fromTime, from.time);
  put(page, fonts, B.fromDate, from.date);
  put(page, fonts, B.toTime, back.time);
  put(page, fonts, B.toDate, back.date);
  put(page, fonts, B.route, loc.route);
  put(page, fonts, B.elr, loc.elr);
  put(page, fonts, B.location, loc.location);
  put(page, fonts, B.line, loc.line);
  put(page, fonts, B.miles, loc.mileage);
  put(page, fonts, B.signed, signedBy ?? "");
  put(page, fonts, B.signedDate, issued.date);
  return await doc.save();
}
