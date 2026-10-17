export type HashError = { kind: 'unreadable' } | { kind: 'unsupported' };
type HashResult = { ok: true; data: string } | { ok: false; error: HashError };

const calculateFileSHA256 = async (file: File | Blob): Promise<string> => {
	const arrayBuffer = await file.arrayBuffer();

	const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');

	return hashHex;
};

export const hashFile = async (file: File): Promise<HashResult> => {
	// crypto.subtle only exists in secure contexts (https or localhost)
	if (!globalThis.crypto?.subtle) return { ok: false, error: { kind: 'unsupported' } };

	try {
		return { ok: true, data: await calculateFileSHA256(file) };
	} catch {
		return { ok: false, error: { kind: 'unreadable' } };
	}
};
