// COMPLIANT: camelCase vars, PascalCase types, correct import order, JSDoc on exports, semicolons
import * as path from 'node:path';
import * as fs from 'node:fs';

import { z } from 'zod';

import { appConfig } from '@app/config';
import type { Logger } from '@app/logging';

import { formatOutput } from './utils';
import type { DataRow } from './types';

const MAX_BATCH_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 5000;

interface ProcessingResult {
  totalRecords: number;
  successCount: number;
  failureCount: number;
}

interface BatchOptions {
  batchSize?: number;
  timeoutMs?: number;
}

type StatusCode = 'ok' | 'error' | 'partial';

/** Processes a batch of data rows and returns aggregated results. */
export function processBatch(
  rows: DataRow[],
  options: BatchOptions = {}
): ProcessingResult {
  if (!rows?.length) {
    return { totalRecords: 0, successCount: 0, failureCount: 0 };
  }

  const batchSize = options.batchSize ?? MAX_BATCH_SIZE;
  let successCount = 0;
  let failureCount = 0;

  for (const row of rows.slice(0, batchSize)) {
    const isValid = validateRow(row);
    if (isValid) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  return { totalRecords: rows.length, successCount, failureCount };
}

/** Reads a data file and parses its contents into rows. */
export function loadDataFile(filePath: string): DataRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Determines the status code based on processing results. */
export function getStatusCode(result: ProcessingResult): StatusCode {
  if (result.failureCount === 0) {
    return 'ok';
  }

  if (result.successCount === 0) {
    return 'error';
  }

  return 'partial';
}

function validateRow(row: DataRow): boolean {
  return row?.id !== undefined && row?.value !== undefined;
}
