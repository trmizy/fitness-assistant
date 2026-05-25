import { DropboxSignProvider } from '../providers/dropboxSign.provider';
import { MockESignProvider } from '../providers/mockEsign.provider';
import { ESignProvider, ESignSendRequest } from '../types/esign.types';

function createProvider(): ESignProvider {
  const providerEnv = process.env.ESIGN_PROVIDER || 'DROPBOX_SIGN';
  if (providerEnv === 'MOCK') return new MockESignProvider();
  if (providerEnv === 'DROPBOX_SIGN') return new DropboxSignProvider();
  throw new Error(`Unknown ESIGN_PROVIDER: ${providerEnv}`);
}

export const eSignService = {
  send: (req: ESignSendRequest) => createProvider().send(req),
};
