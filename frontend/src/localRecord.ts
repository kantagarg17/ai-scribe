// Client-side store for visits captured in the browser.
//
// The hosted backend (Netlify Function) is stateless — it generates a visit
// summary but doesn't persist it. So we keep captured visits here, in
// localStorage, and merge them into the record timeline. This makes captures
// show up on the Record home page immediately and survive reloads, without
// needing a stateful backend. Deletions of local items are honored too.

import type { DocumentItem, VisitSummary } from "./api";

const KEY = "aiscribe.localVisits.v1";

export interface LocalVisit {
  document: DocumentItem;
  summary: VisitSummary;
}

function read(): LocalVisit[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function write(items: LocalVisit[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* ignore quota/availability errors */
  }
}

/** Negative ids avoid colliding with backend ids and are easy to spot. */
function nextLocalId(existing: LocalVisit[]): number {
  const min = existing.reduce((m, v) => Math.min(m, v.document.id), 0);
  return min <= 0 ? min - 1 : -1;
}

/** Save a freshly captured visit summary as a local visit note. Returns the id. */
export function addLocalVisit(summary: VisitSummary, transcript: string): number {
  const items = read();
  const id = nextLocalId(items);
  const document: DocumentItem = {
    id,
    kind: "visit_note",
    title: summary.title || "Clinic visit",
    doc_date: summary.doc_date,
    content: transcript,
    created_at: new Date().toISOString(),
  };
  const stored: LocalVisit = { document, summary: { ...summary, document_id: id } };
  write([stored, ...items]);
  return id;
}

export function getLocalDocuments(): DocumentItem[] {
  return read().map((v) => v.document);
}

export function getLocalVisitSummaries(): VisitSummary[] {
  return read().map((v) => v.summary);
}

export function removeLocalDocument(id: number): void {
  write(read().filter((v) => v.document.id !== id));
}

export function isLocalId(id: number): boolean {
  return id <= 0;
}
