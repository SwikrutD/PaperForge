import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type {
  QpdfVerdict,
  RepairDiagnosis,
  RepairMethod,
  RepairOutcome,
} from '@shared/schemas/repair';
import { readSecuritySummary } from '@pdf/security/summary';
import { checkCrossReference } from '@pdf/structure/xrefCheck';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import type { Logger } from '../logging/logger';
import { QpdfExitError, type QpdfService } from '../qpdf/qpdfService';
import { publishDocument } from './publishDocument';

/** qpdf can say a great deal about a badly damaged file; the reader needs the start of it. */
const MAX_MESSAGES = 60;

/** Where the copies qpdf reads and writes go while a repair runs. */
const REPAIR_DIR_NAME = 'repair';

export interface DocumentRepairDeps {
  engine: PdfMutationEngine;
  qpdf: QpdfService;
  logger: Logger;
  /** The bytes of the revision the reader is looking at. */
  currentBytes: (sessionId: string) => Promise<Uint8Array>;
  /** The working directory PaperForge owns for a session. */
  workspaceDirectory: (sessionId: string) => string;
}

/**
 * Checking a document's structure and writing a repaired copy of it.
 *
 * qpdf is the stronger engine for this (CLAUDE.md section 27): it rebuilds a
 * broken cross-reference table and says what it found on the way. Without it,
 * PaperForge's own engine reads the file object by object and writes it out
 * whole, which mends the commonest damage. Either way the copy is a new file,
 * validated before it is published, and the file that was opened is never
 * replaced.
 */
export class DocumentRepair {
  constructor(private readonly deps: DocumentRepairDeps) {}

  async diagnose(sessionId: string): Promise<RepairDiagnosis> {
    const bytes = await this.deps.currentBytes(sessionId);
    const encrypted = readSecuritySummary(bytes).encrypted;
    const engine = await this.readWithEngine(bytes);
    const qpdf = await this.checkWithQpdf(sessionId, bytes);
    const index = checkCrossReference(bytes);

    return {
      qpdf,
      engine,
      index: index === null ? null : { ok: index.ok, problems: index.problems.slice(0, 20) },
      encrypted,
      sizeBytes: bytes.byteLength,
      // qpdf rebuilds what its check complains about, so with qpdf installed
      // a copy is always worth attempting; without it, the engine must read it.
      canRepair: engine.readable || qpdf.available,
    };
  }

  /** Writes a repaired copy at `destination`, which must not be the opened file. */
  async repair(sessionId: string, original: string, destination: string): Promise<RepairOutcome> {
    if (path.resolve(destination).toLowerCase() === path.resolve(original).toLowerCase()) {
      throw new AppError('io/write-failed', {
        message: 'A repaired copy never replaces the file that was opened.',
        details: 'Choose a different name for the copy.',
      });
    }

    const bytes = await this.deps.currentBytes(sessionId);
    const failures: string[] = [];

    if ((await this.deps.qpdf.resolve()) !== null) {
      try {
        const { output, messages } = await this.throughQpdf(sessionId, bytes);
        return await this.publish(output, destination, 'qpdf', messages);
      } catch (error) {
        const reason = AppError.serialize(error);
        failures.push(`qpdf: ${reason.message}${reason.details ? ` ${reason.details}` : ''}`);
        this.deps.logger.warn('qpdf could not repair a document.', reason.message);
      }
    }

    try {
      const rewritten = await this.deps.engine.rewrite(bytes);
      return await this.publish(rewritten.bytes, destination, 'rewrite', failures);
    } catch (error) {
      const reason = AppError.serialize(error);
      throw new AppError('pdf/malformed-content', {
        message: 'This document is too badly damaged to repair.',
        details: [...failures, `PaperForge: ${reason.message} ${reason.details ?? ''}`]
          .join('\n')
          .trim(),
        cause: error,
      });
    }
  }

  private async publish(
    bytes: Uint8Array,
    destination: string,
    method: RepairMethod,
    messages: string[],
  ): Promise<RepairOutcome> {
    // The same rule as every other file PaperForge writes: reopened, and
    // checked by qpdf when it is installed, before it exists under its name.
    await publishDocument({ engine: this.deps.engine, qpdf: this.deps.qpdf }, bytes, destination);
    const facts = await this.deps.engine.inspect(bytes);
    this.deps.logger.info('Wrote a repaired copy.', method, String(facts.pageCount));
    return {
      canceled: false,
      path: destination,
      method,
      pageCount: facts.pageCount,
      messages: messages.slice(0, MAX_MESSAGES),
    };
  }

  private async readWithEngine(bytes: Uint8Array): Promise<RepairDiagnosis['engine']> {
    try {
      const facts = await this.deps.engine.inspect(bytes);
      if (facts.encrypted) {
        return {
          readable: false,
          pageCount: 0,
          problem: 'The document is encrypted, which PaperForge’s own engine cannot read through.',
        };
      }
      return { readable: facts.pageCount > 0, pageCount: facts.pageCount, problem: null };
    } catch (error) {
      const reason = AppError.serialize(error);
      return { readable: false, pageCount: 0, problem: reason.details ?? reason.message };
    }
  }

  private async checkWithQpdf(
    sessionId: string,
    bytes: Uint8Array,
  ): Promise<RepairDiagnosis['qpdf']> {
    const status = await this.deps.qpdf.status();
    const none = {
      available: status.available,
      version: status.version,
      verdict: null,
      messages: status.problem === null || status.available ? [] : [status.problem],
      truncated: false,
    };
    if (!status.available) return none;

    return this.withScratch(sessionId, async (input) => {
      await fs.writeFile(input, bytes);
      let result;
      try {
        result = await this.deps.qpdf.check(input);
      } catch (error) {
        return { ...none, messages: [AppError.serialize(error).message] };
      }
      if (result === undefined) return none;

      const verdict: QpdfVerdict = result.ok
        ? 'clean'
        : result.readable
          ? 'warnings'
          : 'unreadable';
      // A clean check says nothing the verdict does not.
      const lines = verdict === 'clean' ? [] : messageLines(result.output, input);
      return {
        available: true,
        version: status.version,
        verdict,
        messages: lines.slice(0, MAX_MESSAGES),
        truncated: lines.length > MAX_MESSAGES,
      };
    });
  }

  /**
   * Has qpdf read the document and write it out again. qpdf rebuilds a broken
   * cross-reference table on its own; exit code 3 means it did so with
   * warnings, which is the expected outcome for a damaged file.
   */
  private async throughQpdf(
    sessionId: string,
    bytes: Uint8Array,
  ): Promise<{ output: Uint8Array; messages: string[] }> {
    return this.withScratch(sessionId, async (input, output) => {
      await fs.writeFile(input, bytes);
      let messages: string[];
      try {
        const result = await this.deps.qpdf.run([input, output]);
        messages = messageLines(`${result.stdout}\n${result.stderr}`, input);
      } catch (error) {
        if (!(error instanceof QpdfExitError) || error.exitCode !== 3) throw error;
        messages = messageLines(`${error.stdout}\n${error.stderr}`, input);
      }

      const written = await fs.readFile(output).catch(() => null);
      if (written === null || written.length === 0) {
        throw new AppError('io/write-failed', { message: 'qpdf produced nothing.' });
      }
      return { output: new Uint8Array(written), messages };
    });
  }

  private async withScratch<T>(
    sessionId: string,
    run: (input: string, output: string) => Promise<T>,
  ): Promise<T> {
    const directory = path.join(this.deps.workspaceDirectory(sessionId), REPAIR_DIR_NAME);
    await fs.mkdir(directory, { recursive: true });
    const stem = randomUUID();
    const input = path.join(directory, `${stem}-in.pdf`);
    const output = path.join(directory, `${stem}-out.pdf`);
    try {
      return await run(input, output);
    } finally {
      await fs.rm(input, { force: true }).catch(() => undefined);
      await fs.rm(output, { force: true }).catch(() => undefined);
    }
  }
}

/** What qpdf says about every file, damaged or not. */
const ROUTINE_LINE =
  /^(checking |PDF Version|File is not|File is linearized|No syntax or stream encoding errors|errors that qpdf cannot detect)/i;

/**
 * qpdf's report as lines worth showing: the working copy's name is replaced
 * by "the document", since the reader never saw that file, and the lines that
 * only say a check passed are dropped when there is anything else to say.
 */
export function messageLines(output: string, workingPath: string): string[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.split(workingPath).join('the document').trim())
    .filter((line) => line !== '');
  const findings = lines.filter((line) => !ROUTINE_LINE.test(line));
  return findings.length > 0 ? findings : lines;
}
