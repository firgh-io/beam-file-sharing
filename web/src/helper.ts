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
