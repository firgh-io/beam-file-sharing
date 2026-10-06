import { expect, test } from 'bun:test';
import { MAX_FILE_SIZE } from '../../shared/limits';
import { validateFile, validateMaxDownloadCount } from './helper';

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
