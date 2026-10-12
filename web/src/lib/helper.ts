import { MAX_EXPIRY_IN_DAYS, MAX_FILE_SIZE } from '#lib/limits.ts';
import type { MessageKey } from '#lib/messages.ts';

const GENERIC_FILE_TYPE_KEY = 'OTH';

const FILE_TYPE_MAP: Record<string, string> = {
	markdown: 'md',
	pdf: 'pdf',
	csv: 'csv',
	plain: 'txt',
	html: 'html',
	xml: 'xml',
	json: 'json',
	jpeg: 'jpg',
	png: 'png',
	gif: 'gif',
	webp: 'webp',
	'svg+xml': 'svg',
	msword: 'doc',
	'vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'vnd.ms-excel': 'xls',
	'vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
	'vnd.ms-powerpoint': 'ppt',
	'vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
};

export const getFileType = (file: File | null): string => {
	if (!file) return '';

	const mimeType = file.type.split('/').at(-1);

	return FILE_TYPE_MAP[mimeType ?? ''] ?? GENERIC_FILE_TYPE_KEY;
};

type Validation =
	{ ok: true } | { ok: false; messageKey: MessageKey; params?: Record<string, number> };

export const validateFile = (file: File): Validation => {
	if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
		return {
			ok: false,
			messageKey: 'send_error_file_size_invalid',
			params: { maxFileSize: MAX_FILE_SIZE / 1024 / 1024 }
		};
	}

	return { ok: true };
};

export const validateMaxDownloadCount = (count: number | undefined): Validation => {
	if (count === undefined || (Number.isInteger(count) && count >= 1)) {
		return { ok: true };
	}

	return { ok: false, messageKey: 'send_error_max_downloads_invalid' };
};

export const addDays = (date: Date, days: number): Date => {
	const result = new Date(date);
	result.setDate(result.getDate() + days);
	return result;
};

export const toDateInputValue = (date: Date): string => {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
};

export const formatDateInputValue = (value: string): string =>
	new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

// The backend rejects anything past its own now + MAX_EXPIRY_IN_DAYS; the margin absorbs latency and clock skew
const EXPIRY_MARGIN_MS = 60_000;

export const formatExpiryDate = (dateString: string, now = new Date()) => {
	const endOfDay = new Date(`${dateString}T23:59:59.999`).getTime();
	const latest = now.getTime() + MAX_EXPIRY_IN_DAYS * 86_400_000 - EXPIRY_MARGIN_MS;
	return new Date(Math.min(endOfDay, latest)).toISOString();
};

export const validateExpiresOn = (value: string | undefined, now: Date): Validation => {
	if (!value) return { ok: true };

	const earliest = toDateInputValue(now);
	const latest = toDateInputValue(addDays(now, MAX_EXPIRY_IN_DAYS));

	if (value < earliest || value > latest) {
		return {
			ok: false,
			messageKey: 'send_error_expires_on_invalid',
			params: { days: MAX_EXPIRY_IN_DAYS }
		};
	}

	return { ok: true };
};

export const formatFileSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;

	const units = ['kB', 'MB', 'GB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(1)} ${units[unit]}`;
};
