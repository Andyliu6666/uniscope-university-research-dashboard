import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('native Node runtime exports', () => {
  it('loads shared schemas without a TypeScript development loader', () => {
    const entry = new URL('../../../packages/shared/src/index.ts', import.meta.url).href;
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { ibQuerySchema } = await import(${JSON.stringify(entry)}); console.log(ibQuerySchema.parse({}).page);`,
      ],
      { encoding: 'utf8' },
    );
    expect(output.trim()).toBe('1');
  });
});
