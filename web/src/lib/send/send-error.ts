import { Step, type SendFailure } from './send-file';
import type { MessageKey } from '../messages';

export const sendErrorKey = (failure: SendFailure): MessageKey => {
	switch (failure.step) {
		case Step.Hashing:
			return failure.error.kind === 'unsupported'
				? 'send_error_insecure_context'
				: 'send_error_read_file';
		case Step.Initializing: {
			const { error } = failure;
			if (error.kind === 'network') return 'send_error_network';

			switch (error.body?._tag) {
				case 'UploadRequestQuotaExceeded':
					return 'send_error_quota';
				case 'UploadRequestRateLimited':
					return 'send_error_rate_limited';
				case 'UploadRequestPayloadInvalid':
					return 'send_error_settings_rejected';
				default:
					return 'send_error_generic';
			}
		}
		case Step.Uploading:
		case Step.Completing:
			return failure.error.kind === 'network' ? 'send_error_network' : 'send_error_generic';
	}
};
