// Typed Error Classes (Shared across all services)


export class SandboxBuildError extends Error {
    constructor(message: string, public cause?: unknown) {
      super(message);
      this.name = 'SandboxBuildError';
    }
  }
  
  export class ContainerTimeoutError extends Error {
    constructor(message: string, public submissionId: string) {
      super(message);
      this.name = 'ContainerTimeoutError';
    }
  }
  
  export class TelemetryValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TelemetryValidationError';
    }
  }