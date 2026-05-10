/**
 * Typed error classes for the bootstrap subsystem.
 *
 * Every layer above this can match on `error.code` instead of message regex.
 * `cause` chain preserved for diagnostics.
 */

export type BootstrapErrorCode =
  | 'SPEC_INVALID'
  | 'MANIFEST_INVALID'
  | 'INTEGRATION_NOT_FOUND'
  | 'INTEGRATION_CONFLICT'
  | 'SECRET_MISSING'
  | 'SECRET_STORE_FAILURE'
  | 'FILE_HASH_CONFLICT'
  | 'FILE_FENCE_NOT_FOUND'
  | 'JOURNAL_CORRUPT'
  | 'SHELL_TIMEOUT'
  | 'SHELL_FAILED'
  | 'GIT_OP_FAILED'
  | 'PRECONDITION_FAILED';

export class BootstrapError extends Error {
  public readonly code: BootstrapErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: BootstrapErrorCode,
    message: string,
    options?: { details?: Record<string, unknown>; cause?: unknown }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'BootstrapError';
    this.code = code;
    if (options?.details) {
      this.details = options.details;
    }
    Object.setPrototypeOf(this, BootstrapError.prototype);
  }
}

export class SpecInvalidError extends BootstrapError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('SPEC_INVALID', message, { ...(details ? { details } : {}) });
    this.name = 'SpecInvalidError';
  }
}

export class IntegrationConflictError extends BootstrapError {
  constructor(
    public readonly conflictingFile: string,
    public readonly owners: string[],
    message?: string
  ) {
    super(
      'INTEGRATION_CONFLICT',
      message ??
        `File "${conflictingFile}" is claimed by multiple integrations: ${owners.join(', ')}`,
      { details: { conflictingFile, owners } }
    );
    this.name = 'IntegrationConflictError';
  }
}

export class FileHashConflictError extends BootstrapError {
  constructor(
    public readonly path: string,
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(
      'FILE_HASH_CONFLICT',
      `File "${path}" was modified outside the bootstrap (expected sha256 ${expected.slice(0, 12)}, got ${actual.slice(0, 12)})`,
      { details: { path, expected, actual } }
    );
    this.name = 'FileHashConflictError';
  }
}

export class ShellFailedError extends BootstrapError {
  constructor(
    public readonly command: string,
    public readonly exitCode: number | null,
    public readonly stderr: string
  ) {
    super(
      exitCode === null ? 'SHELL_TIMEOUT' : 'SHELL_FAILED',
      exitCode === null
        ? `Command timed out: ${command}`
        : `Command failed (exit ${exitCode}): ${command}\n${stderr}`,
      { details: { command, exitCode, stderr } }
    );
    this.name = 'ShellFailedError';
  }
}

export function isBootstrapError(err: unknown): err is BootstrapError {
  return err instanceof BootstrapError;
}
