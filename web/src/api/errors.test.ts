import { expect, it } from 'vitest';
import { ApiError } from './errors';

it('is an Error that carries kind, status and errorMsg', () => {
  const cause = new Error('inner');
  const err = new ApiError('http', 'HTTP 400: bad', { status: 400, errorMsg: 'bad', cause });
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('ApiError');
  expect(err.message).toBe('HTTP 400: bad');
  expect([err.kind, err.status, err.errorMsg, err.cause]).toEqual(['http', 400, 'bad', cause]);
});

it('leaves status and errorMsg undefined when not given', () => {
  const err = new ApiError('network', 'offline');
  expect(err.status).toBeUndefined();
  expect(err.errorMsg).toBeUndefined();
});
