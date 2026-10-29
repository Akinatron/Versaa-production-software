import { cache } from "react";
import { db } from "@/db/client";
import { sauceColorMaps } from "@/db/catalog";
import { traceBatch, traceForward } from "@/db/trace";

/*
 * Data that several parts of one page ask for. Wrapped in React's cache(),
 * so while a page is being drawn each is read once, however many parts ask:
 * the trace of a lot for its page and its diagram, the sauce colours for
 * every plan block. The next visit reads them fresh.
 */

export const sauceColors = cache(() => sauceColorMaps(db()));
export const lotTrace = cache((lotId: string) => traceForward(db(), lotId));
export const batchTrace = cache((batchId: string) => traceBatch(db(), batchId));
