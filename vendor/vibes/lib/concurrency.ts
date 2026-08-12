/**
 * A simple async semaphore for capping concurrent tool executions.
 *
 * Usage:
 * ```ts
 * const sem = new Semaphore(3);
 * const result = await sem.run(() => someAsyncWork());
 * ```
 */
export class Semaphore {
  private _permits: number;
  private _queue: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    if (maxConcurrency < 1) {
      throw new RangeError(
        `Semaphore maxConcurrency must be >= 1, got ${maxConcurrency}`,
      );
    }
    this._permits = maxConcurrency;
  }

  /** Acquire a permit, waiting if none are available. */
  private acquire(): Promise<void> {
    if (this._permits > 0) {
      this._permits--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  /** Release a permit, waking the next waiter if any. */
  private release(): void {
    const next = this._queue.shift();
    if (next !== undefined) {
      next();
    } else {
      this._permits++;
    }
  }

  /**
   * Run `fn` under the semaphore - waits for a permit, executes `fn`,
   * then releases the permit whether `fn` resolves or rejects.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// denoCacheMetadata={"headers":{"content-encoding":"identity","server":"cloudflare","cache-control":"public, max-age=31536000, immutable","cf-ray":"a0a0fcb86fe431aa-LHR","date":"Thu, 11 Jun 2026 13:33:23 GMT","content-security-policy":"default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox; form-action 'none';","x-content-type-options":"nosniff","report-to":"{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=bdF2jMT13ogruXiNDc2Tga%2FRxL1nAuH4hRDXbIWFirUljVmJI4lwoQpMe2V2iW5gPsR20mZV17t1kOVD1w%2Fjo7RdUPRFasOFN4l%2BbD5VQjJclHnpMdJvlME%3D\"}]}","x-jsr-backend":"modules","x-robots-tag":"noindex","content-type":"text/typescript","cross-origin-resource-policy":"cross-origin","alt-svc":"h3=\":443\"; ma=86400","access-control-allow-origin":"*","vary":"Origin","nel":"{\"report_to\":\"cf-nel\",\"success_fraction\":0.0,\"max_age\":604800}","etag":"\"57c0cf965add5e407332313ead580961\"","content-length":"1315","access-control-expose-headers":"*"},"url":"https://jsr.io/@vibesjs/sdk/1.0.13/lib/concurrency.ts","time":1781184802}