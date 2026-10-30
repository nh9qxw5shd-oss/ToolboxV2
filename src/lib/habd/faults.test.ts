import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import * as H from "./faults.ts";
import { buildFormA, buildFormB } from "./forms.ts";
import { parseWallClock } from "./wallclock.ts";

const A = (id: string, extra: Partial<H.Asset> = {}): H.Asset => ({ ID: id, "Controlling SB": "EMCC", Location: `Site ${id}`, Line: "Up Main", Route: "LN3201", ELR: "SPC5", Mileage: "101.78", ...extra });
const ASSETS = [A("1", { "Controlling SB": "West Hampstead" }), A("7"), A("30", { Line: "Up Fast (WILD)" })];

test("WILD sites and the stored time shapes", () => {
  assert.equal(H.typeOf(ASSETS[2]), "WILD");
  assert.equal(H.typeOf(ASSETS[1]), "HABD");
  const d = H.parseWall("2026-10-30T14:05")!;
  assert.equal(H.fmt(d), "30/10/2026 14:05");
  assert.equal(H.toInput(H.parseWall("30/10/2026 14:05")!), "2026-10-30T14:05");
  assert.equal(H.parseWall("25/09"), null, "a part-typed date is not a time");
  assert.equal(H.daysBetween(H.parseWall("2026-10-28T23:00"), H.parseWall("2026-10-30T01:00")!), 2);
  assert.deepEqual(parseWallClock("2022-06-17 00:00:00"), { date: "17/06/2022", time: "00:00" });
});

test("out of use, undo, back in use, undo, edit: as the dashboard did, refusing stale changes", () => {
  const list: H.Fault[] = [{ FIN: "0064", ID: "1", FMS: "F1", "Failure Date": "2026-01-01T10:00", "Date in order": "02/01/2026 10:00" }];
  const out = H.reportOut(list, ASSETS[1], { fms: " 123456 ", failedAt: H.parseWall("2026-10-30T06:10")!, notes: " Hot box " });
  assert.deepEqual(out, { fin: "0065" });
  assert.deepEqual(list[0], { FIN: "0065", ID: "7", "Controlling SB": "EMCC", Location: "Site 7", Line: "Up Main", Route: "LN3201", ELR: "SPC5", Mileage: "101.78", FMS: "123456", "Failure Date": "2026-10-30T06:10", "Date in order": "", Notes: "Hot box" });
  assert.ok(H.isAbort(H.reportOut(list, ASSETS[1], { fms: "x", failedAt: new Date(), notes: "" })), "already out of use");
  const rows = H.statusRows(ASSETS, list);
  assert.deepEqual(H.summary(rows), { total: 3, off: 1, on: 2, habdOn: 1, habd: 2, wildOn: 1, wild: 1 });
  assert.deepEqual(H.boardGroups(rows, rows).map((g) => [g.box, g.total, g.off]), [["West Hampstead", 1, 0], ["EMCC", 2, 1]]);
  assert.equal(H.boardGroups(rows, rows)[1].rows[0].a.ID, "7", "out of use first");

  assert.deepEqual(H.undoOut(list, "0065"), { ok: true });
  assert.equal(list.length, 1);
  H.reportOut(list, ASSETS[1], { fms: "123456", failedAt: H.parseWall("2026-10-30T06:10")!, notes: "" });
  const back = H.returnToService(list, ASSETS[1], H.parseWall("2026-10-30T09:00")!);
  assert.deepEqual(back, { closed: ["0065"], stamp: "30/10/2026 09:00" });
  assert.equal(list[0]["Date in order"], "30/10/2026 09:00");
  assert.ok(H.isAbort(H.returnToService(list, ASSETS[1], new Date())), "already back in use");
  assert.deepEqual(H.undoIn(list, ["0065"], "30/10/2026 09:00"), { ok: true });
  assert.equal(list[0]["Date in order"], "");
  assert.ok(H.isAbort(H.editFault(list, "0065", false, { fms: "x", failedAt: new Date(), inOrderAt: new Date(), notes: "" })), "its state changed meanwhile");
  H.editFault(list, "0065", true, { fms: " 999 ", failedAt: H.parseWall("2026-10-30T06:00")!, inOrderAt: null, notes: "Corrected" });
  assert.deepEqual([list[0].FMS, list[0]["Failure Date"], list[0].Notes], ["999", "2026-10-30T06:00", "Corrected"]);
});

test("time checks, filters, history order and the CSV exports", () => {
  const now = H.parseWall("2026-10-30T10:00")!.getTime();
  assert.equal(H.checkTime(null), "Enter a date and time.");
  assert.equal(H.checkTime(new Date(now + 10 * 60_000), { now }), "This is in the future.");
  assert.match(H.checkTime(H.parseWall("2026-10-30T05:00"), { after: H.parseWall("2026-10-30T06:00"), afterLabel: "it went out of use", now }), /before it went out of use \(30\/10\/2026 06:00\)/);
  const list: H.Fault[] = [
    { FIN: "0001", ID: "1", FMS: "A", "Failure Date": "2026-01-01T10:00", "Date in order": "02/01/2026 10:00", Notes: 'Has "quotes"' },
    { FIN: "0002", ID: "7", FMS: "B", "Failure Date": "2026-02-01T10:00", "Date in order": "" },
  ];
  const byId = (id: string) => ASSETS.find((a) => a.ID === id) ?? null;
  assert.deepEqual(H.historyRows(list, byId, "all", "").map((f) => f.FIN), ["0002", "0001"], "open first");
  assert.deepEqual(H.historyRows(list, byId, "closed", "").map((f) => f.FIN), ["0001"]);
  assert.deepEqual(H.historyRows(list, byId, "all", "site 7").map((f) => f.FIN), ["0002"]);
  const rows = H.statusRows(ASSETS, list);
  assert.equal(rows.filter((r) => H.passFilter(r, "off")).length, 1);
  assert.equal(rows.filter((r) => H.passFilter(r, "wild")).length, 1);
  assert.ok(H.matchesBoard(rows[1], "B"), "matches the open fault's FMS");
  assert.match(H.faultsCsv(list, byId), /"Has ""quotes"""/);
  assert.match(H.statusCsv(rows, H.parseWall("2026-02-03T10:00")!).split("\r\n")[2], /"Out of use","0002","B","01\/02\/2026 10:00","2"/);
});

test("F3.21A and F3.21B fill the official blanks", async () => {
  const blankA = readFileSync(new URL("../../../public/forms/F3.21A blank.pdf", import.meta.url));
  const blankB = readFileSync(new URL("../../../public/forms/F3.21B blank.pdf", import.meta.url));
  const fault: H.Fault = { FIN: "0065", ID: "30", FMS: "123456", "Failure Date": "2026-10-30T06:10", "Date in order": "30/10/2026 09:00" };
  const a = await buildFormA(new Uint8Array(blankA), { fault, asset: ASSETS[2], signedBy: "EMCC Route Control", now: new Date("2026-10-30T07:00:00Z") });
  const b = await buildFormB(new Uint8Array(blankB), { fault, asset: ASSETS[2], signedBy: null, now: new Date("2026-10-30T09:05:00Z") });
  for (const [bytes, title] of [[a, "F3.21A – FIN 0065"], [b, "F3.21B – FIN 0065"]] as const) {
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    assert.equal(doc.getTitle(), title);
  }
  const resaved = async (blank: Buffer) => (await (await PDFDocument.load(new Uint8Array(blank))).save()).length;
  assert.ok(a.length > (await resaved(blankA)) && b.length > (await resaved(blankB)), "values written in");
});
