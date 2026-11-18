import { coordinateReleaseWaveAsync } from '../../../features/release-waves/composition/coordinateReleaseWaveAsync.js';

/*** Deliver the authenticated release-wave composition through the CLI boundary. */
await coordinateReleaseWaveAsync(process.env);
