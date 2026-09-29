import { UNENCRYPTED_SUMMARY, type SecuritySummary } from '@shared/schemas/protect';
import {
  describeAlgorithm,
  permissionsFromBits,
  readEncryptionDictionary,
} from './encryptionDictionary';
import { opensWithoutPassword } from './standardHandler';

/**
 * What a document's own bytes say about its security.
 *
 * This needs no sidecar and no password: the encryption dictionary is stored
 * in the clear, and whether an open password is needed is settled by checking
 * the empty one, which is what a reader does before it prompts.
 */
export function readSecuritySummary(bytes: Uint8Array): SecuritySummary {
  const dictionary = readEncryptionDictionary(bytes);
  if (dictionary === null) return UNENCRYPTED_SUMMARY;

  const bits = dictionary.permissionBits;
  const revision = dictionary.revision;
  const opensFreely = opensWithoutPassword(dictionary);

  return {
    encrypted: true,
    handler: dictionary.handler,
    algorithm: describeAlgorithm(dictionary),
    keyLengthBits: dictionary.keyLengthBits,
    version: dictionary.version,
    revision,
    encryptMetadata: dictionary.encryptMetadata,
    permissions: bits === null || revision === null ? null : permissionsFromBits(bits, revision),
    permissionBits: bits,
    openPasswordRequired: opensFreely === null ? null : !opensFreely,
  };
}
