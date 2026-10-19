import { pathToFileURL } from 'node:url';
import { validateScopedPaperConfiguration, runScopedPaperCloseout } from './lib/scoped-paper-adapter.mjs';
import { validateOperationalConfiguration, loadOperationalInvocationFiles, assessOperationalControlEvidence } from './lib/scoped-paper-operational.mjs';

// Runtime authority and credential-loading transport are injected by the approved caller, never by an input artifact.
export async function main(argv = [], dependencies = {}) {
  if (Array.isArray(argv) && argv[0] === '--validate-operational' && argv.length === 5) {
    const safe = { actualBrokerMutationAttempted: false, actualStateWriteAttempted: false, sourceReadinessProven: false, executionAuthorized: false };
    try {
      const { config, approval, files } = await loadOperationalInvocationFiles({ configFile: { path: argv[1], sha256: argv[2] },
        approvalFile: { path: argv[3], sha256: argv[4] } });
      const controlEvidence = await assessOperationalControlEvidence({ config, files,
        clock: dependencies.clock ?? { now: () => new Date().toISOString() } });
      return { status: controlEvidence.status === 'BLOCKED' ? 'BLOCKED' : 'PINNED_INPUTS_VERIFIED_NOT_READY',
        ...safe, stableScopeSha256: approval.stableScopeSha256, controlEvidence, reasons: controlEvidence.reasons };
    } catch (error) {
      return { status: 'BLOCKED', ...safe, reasons: [/^SCOPED_(?:CLOSEOUT|ADAPTER)_[A-Z_]+$/.test(error?.message)
        ? error.message : 'SCOPED_CLOSEOUT_INPUT_FILE_INVALID'] };
    }
  }
  if (!Array.isArray(argv) || argv.length > 1 || (argv.length && !['--validate', '--execute'].includes(argv[0])))
    return { status: 'ARGUMENTS_INVALID', actualBrokerMutationAttempted: false, actualStateWriteAttempted: false };
  if (argv[0] !== '--execute') return dependencies.config ? (dependencies.config.schemaVersion === 'scoped-paper-operational-invocation-v1'
    ? validateOperationalConfiguration(dependencies.config) : validateScopedPaperConfiguration(dependencies.config))
    : { status: 'CONFIGURATION_REQUIRED', actualBrokerMutationAttempted: false, actualStateWriteAttempted: false };
  return runScopedPaperCloseout(dependencies);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!['PASS', 'COMPLETE', 'CONFIGURATION_REQUIRED', 'PINNED_INPUTS_VERIFIED_NOT_READY'].includes(result.status)) process.exitCode = 1;
}
