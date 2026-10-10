import { expect, test } from 'bun:test';
import { Step } from './upload';
import { sendErrorKey } from './send-error';

test('maps the initialize rejection reason to a specific message, anything else to a generic one', () => {
	const rejected = (_tag: string) =>
		({
			ok: false,
			step: Step.Initializing,
			error: { kind: 'rejected', status: 400, body: { _tag } }
		}) as never;

	expect(sendErrorKey(rejected('UploadRequestQuotaExceeded'))).toBe('send_error_quota');
	expect(sendErrorKey(rejected('UploadRequestRateLimited'))).toBe('send_error_rate_limited');
	expect(sendErrorKey(rejected('UploadRequestPayloadInvalid'))).toBe(
		'send_error_settings_rejected'
	);
	expect(sendErrorKey(rejected('Unknown'))).toBe('send_error_generic');
});

test('network failures read the same at every step', () => {
	for (const step of [Step.Initializing, Step.Uploading, Step.Completing]) {
		const failure = { ok: false, step, error: { kind: 'network' } } as never;
		expect(sendErrorKey(failure)).toBe('send_error_network');
	}
});
