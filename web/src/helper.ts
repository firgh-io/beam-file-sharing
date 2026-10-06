import { MAX_FILE_SIZE } from '#lib/limits.ts';
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
