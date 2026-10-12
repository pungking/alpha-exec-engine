import { pathToFileURL } from 'node:url';
import { validateScopedPaperConfiguration, runScopedPaperCloseout } from './lib/scoped-paper-adapter.mjs';

// Runtime authority and credential-loading transport are injected by the approved caller, never by an input artifact.
export async function main(argv = [], dependencies = {}) {
  if (!Array.isArray(argv) || argv.length > 1 || (argv.length && !['--validate', '--execute'].includes(argv[0])))
    return { status: 'ARGUMENTS_INVALID', actualBrokerMutationAttempted: false, actualStateWriteAttempted: false };
  if (argv[0] !== '--execute') return dependencies.config ? validateScopedPaperConfiguration(dependencies.config)
    : { status: 'CONFIGURATION_REQUIRED', actualBrokerMutationAttempted: false, actualStateWriteAttempted: false };
  return runScopedPaperCloseout(dependencies);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!['PASS', 'COMPLETE', 'CONFIGURATION_REQUIRED'].includes(result.status)) process.exitCode = 1;
}
