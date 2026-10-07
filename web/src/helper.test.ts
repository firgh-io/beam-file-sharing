import { expect, test } from 'bun:test';
import { MAX_FILE_SIZE } from '../../shared/limits';
import { validateExpiresOn, validateFile, validateMaxDownloadCount } from './helper';

const fileOfSize = (size: number) => ({ size }) as File;

test('accepts sizes from 1 byte up to and including MAX_FILE_SIZE', () => {
	expect(validateFile(fileOfSize(1)).ok).toBe(true);
	expect(validateFile(fileOfSize(MAX_FILE_SIZE)).ok).toBe(true);
});

test('rejects empty files and files over MAX_FILE_SIZE', () => {
	expect(validateFile(fileOfSize(0)).ok).toBe(false);
	expect(validateFile(fileOfSize(MAX_FILE_SIZE + 1)).ok).toBe(false);
});

test('max download count is optional but must be a whole number of at least 1', () => {
	expect(validateMaxDownloadCount(undefined).ok).toBe(true);
	expect(validateMaxDownloadCount(1).ok).toBe(true);
	expect(validateMaxDownloadCount(0).ok).toBe(false);
	expect(validateMaxDownloadCount(-1).ok).toBe(false);
	expect(validateMaxDownloadCount(1.5).ok).toBe(false);
});

test('expiry date must fall between today and MAX_EXPIRY_IN_DAYS from now', () => {
	const now = new Date(2026, 9, 28, 15, 0);

	expect(validateExpiresOn(undefined, now).ok).toBe(true);
	expect(validateExpiresOn('2026-10-28', now).ok).toBe(true);
	expect(validateExpiresOn('2026-11-04', now).ok).toBe(true);
	expect(validateExpiresOn('2026-10-27', now).ok).toBe(false);
	expect(validateExpiresOn('2026-11-05', now).ok).toBe(false);
});
