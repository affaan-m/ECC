// Runnable mirrors of the typescript-patterns SKILL.md examples.
// Must compile under strict + noUncheckedIndexedAccess (see tsconfig.json).
// Namespaced per example because the skill reuses names across snippets.

export namespace ConfigExample {
  export interface Config {
    timeout: number;
    retries: number;
  }

  export const DEFAULT_CONFIG: Config = { timeout: 30_000, retries: 3 };

  export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  export function toPositiveInt(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new TypeError(`Expected ${field} to be a positive integer`);
    }
    return value;
  }

  export function parseConfig(raw: unknown): Config {
    if (!isRecord(raw)) return { ...DEFAULT_CONFIG };
    return {
      timeout: raw['timeout'] === undefined ? DEFAULT_CONFIG.timeout : toPositiveInt(raw['timeout'], 'timeout'),
      retries: raw['retries'] === undefined ? DEFAULT_CONFIG.retries : toPositiveInt(raw['retries'], 'retries'),
    };
  }

  export function isConfig(value: unknown): value is Config {
    if (typeof value !== 'object' || value === null) return false;
    if (!('timeout' in value) || !('retries' in value)) return false;
    const { timeout, retries } = value;
    return (
      typeof timeout === 'number' && Number.isInteger(timeout) && timeout > 0 &&
      typeof retries === 'number' && Number.isInteger(retries) && retries > 0
    );
  }
}

export namespace AssertionExample {
  export function assertIsStringArray(value: unknown): asserts value is string[] {
    if (!Array.isArray(value)) {
      throw new TypeError('Expected an array of strings');
    }
    // Iteration visits sparse positions as undefined instead of skipping them.
    for (const item of value) {
      if (typeof item !== 'string') throw new TypeError('Expected an array of strings');
    }
  }
}

export namespace UserExample {
  export type User = { id: string; email: string };

  export function isUser(value: unknown): value is User {
    if (typeof value !== 'object' || value === null) return false;
    if (!('id' in value) || !('email' in value)) return false;
    const { id, email } = value;
    return (
      typeof id === 'string' && id.length > 0 &&
      typeof email === 'string' && email.includes('@')
    );
  }

  export function assertUserId(userId: string): void {
    if (typeof userId !== 'string' || userId.length === 0 || /[^A-Za-z0-9_-]/.test(userId)) {
      throw new TypeError('Expected a user ID using letters, digits, "_" or "-"');
    }
  }

  export async function loadUser(
    userId: string,
    fetchJson: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>,
  ): Promise<User> {
    assertUserId(userId);
    const response = await fetchJson(`/users/${userId}`);
    if (!response.ok) {
      throw new Error(`Failed to load user ${userId}: ${response.status}`);
    }
    const data: unknown = await response.json();
    if (!isUser(data)) {
      throw new TypeError(`Invalid user payload for ${userId}`);
    }
    return data;
  }
}

export namespace ConcurrencyExample {
  export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    mapper: (item: T) => Promise<R>,
  ): Promise<R[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`Expected concurrency limit to be a positive integer, got: ${limit}`);
    }
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        // Skip only genuine sparse-array holes, mirroring Array.prototype.map:
        // a present `undefined` element is a legitimate value and must still
        // reach the mapper.
        if (!Object.hasOwn(items, index)) continue;
        // Presence is proven above, so the indexed access is in-bounds and
        // filled — the non-null removal applies only to the compiler's
        // speculative undefined under noUncheckedIndexedAccess.
        results[index] = await mapper(items[index]!);
      }
    });

    await Promise.all(workers);
    return results;
  }
}

export namespace AsyncErrorsExample {
  export async function asyncFails(): Promise<never> {
    throw new Error('becomes a rejection, never a sync throw');
  }

  export function lazyFails(): Promise<never> {
    throw new Error('throws synchronously — needs try/catch AND .catch');
  }
}
