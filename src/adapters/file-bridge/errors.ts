export class FileBridgeSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileBridgeSecurityError";
  }
}

export class FileBridgeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileBridgeConfigurationError";
  }
}

export class FileBridgeTooLargeError extends Error {
  readonly limit: number;

  constructor(message: string, limit: number) {
    super(message);
    this.name = "FileBridgeTooLargeError";
    this.limit = limit;
  }
}
