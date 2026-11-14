// Read-only candidate inventory, NOT a trusted Admission baseline generator.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { builtinModules } from 'node:module';
import { canonical, sha256, parseWorkflow } from './check-paper-workflow-admission.mjs';

const baseline = JSON.parse(fs.readFileSync('config/paper-workflow-admission-baseline.json','utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const inventoryPath = 'docs/issue-91-r4b-candidate-inventory.json';
const edges = [], files = new Map(), producers = [], commands = new Set();
const builtins = new Set(builtinModules.flatMap(n => [n, 'node:'+n]));
const edge = (from, to, kind, line = null) => edges.push({from,to,kind,line});
function source(file) {
  const mapped = file.replace(/^dist\//,'').replace(/\.js$/,'.ts');
  return fs.existsSync(file) && !file.startsWith('dist/') ? file : fs.existsSync(mapped) ? mapped : null;
}
function visitFile(file) {
  const resolved = source(file);
  if (!resolved) { edge(file, null, 'UNVERIFIED_MISSING_OR_GENERATED_SOURCE'); return; }
  if (resolved !== file) edge(file,resolved,'BUILD_OUTPUT_TO_TYPESCRIPT_SOURCE_NOT_BINARY_ATTESTATION');
  if (files.has(resolved)) return;
  const bytes = fs.readFileSync(resolved), observedSha256 = sha256(bytes);
  const trustedSha256 = baseline.evidenceSha256[resolved] ?? null;
  files.set(resolved,{file:resolved,observedSha256,trustedSha256,
    pin:trustedSha256 === null?'UNPINNED':trustedSha256===observedSha256?'PIN_MATCH':'PIN_DRIFT'});
  if (/\.(mjs|cjs|js|ts)$/.test(resolved)) scanJS(resolved,bytes.toString());
  else if (resolved.endsWith('.sh')) scanShell(resolved,bytes.toString());
}
function dependency(from, target, kind, line) {
  if (target === null) { edge(from,null,'UNVERIFIED_DYNAMIC_'+kind,line); return; }
  if (builtins.has(target)) { edge(from,target,'NODE_BUILTIN_'+kind,line); return; }
  if (target.startsWith('.')) {
    const file = path.posix.normalize(path.posix.join(path.posix.dirname(from.split('#')[0]),target));
    edge(from,file,kind,line); visitFile(file);
  } else edge(from,target,'PACKAGE_OR_UNVERIFIED_'+kind,line);
}
function scanJS(from, text) {
  const ast = ts.createSourceFile(from,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert.equal(ast.parseDiagnostics.length,0,`parse ${from}`);
  const literal = n => n && ts.isStringLiteralLike(n) ? n.text : null;
  const processNames = new Set(), processNamespaces = new Set();
  for (const n of ast.statements) if (ts.isImportDeclaration(n) &&
    ['node:child_process','child_process'].includes(literal(n.moduleSpecifier))) {
    const bindings = n.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const b of bindings.elements) processNames.add(b.name.text);
    if (bindings && ts.isNamespaceImport(bindings)) processNamespaces.add(bindings.name.text);
    if (n.importClause?.name) processNamespaces.add(n.importClause.name.text);
  }
  function walk(n) {
    const line = ast.getLineAndCharacterOfPosition(n.getStart(ast)).line+1;
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
      if (n.moduleSpecifier) dependency(from,literal(n.moduleSpecifier),'STATIC_IMPORT_OR_EXPORT',line);
    }
    if (ts.isCallExpression(n)) {
      const name = n.expression.getText(ast);
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require')
        dependency(from,literal(n.arguments[0]),'DYNAMIC_IMPORT_OR_REQUIRE',line);
      if (processNames.has(name) || processNamespaces.has(name.split('.')[0])) {
        edge(from,literal(n.arguments[0]),'PROCESS_CALL_'+(literal(n.arguments[0])===null?'UNVERIFIED_DYNAMIC':'LITERAL'),line);
        // Record complete argument expression by hash, not arbitrary literal content.
        edge(from,sha256(n.getText(ast)),'PROCESS_EXPRESSION_SHA256',line);
        if (n.arguments[1] && ts.isArrayLiteralExpression(n.arguments[1])) {
          for (const arg of n.arguments[1].elements) {
            const value = literal(arg);
            if (value && /^(scripts|dist|src)\/[\w./-]+\.(mjs|cjs|js|ts|sh)$/.test(value)) {
              edge(from,value,'PROCESS_LITERAL_ARGUMENT',line); visitFile(value);
            }
          }
        }
      }
      if (from === 'scripts/test-ownership-recovery-safety-gates.mjs' && name === 'runNode') {
        const value = literal(n.arguments[0]);
        assert.ok(value?.startsWith('scripts/'));
        edge(from,value,'REVIEWED_RUNNODE_TO_PROCESS_EXECPATH',line); visitFile(value);
      }
      if (['eval','Function'].includes(name)) edge(from,null,'UNVERIFIED_EVAL',line);
    }
    if (ts.isNewExpression(n) && n.expression.getText(ast)==='URL') {
      const value = literal(n.arguments?.[0]);
      if (value?.startsWith('.') && /\.(mjs|js|ts)$/.test(value)) dependency(from,value,'URL_CODE_REFERENCE',line);
    }
    ts.forEachChild(n,walk);
  }
  walk(ast);
}
function scanShell(from,text) {
  // Shell is NOT parsed as JavaScript. Enumerate literal entrypoints and retain
  // a full producer hash; arbitrary expansion/eval remains explicitly UNVERIFIED.
  for (const match of text.matchAll(/\bnode\s+(?:--[\w=-]+\s+)*(scripts\/[\w./-]+|dist\/[\w./-]+)\.(mjs|js|cjs)\b/g)) {
    const file=match[1]+'.'+match[2]; edge(from,file,'SHELL_LITERAL_NODE'); visitFile(file);
  }
  for (const match of text.matchAll(/\bnpm run ([\w:-]+)/g)) {
    const name=match[1]; assert.equal(typeof pkg.scripts[name],'string');
    edge(from,'package.json#'+name,'NPM_SCRIPT');
    if (!commands.has(name)) {
      commands.add(name); scanShell('package.json#'+name,pkg.scripts[name]);
      for (const lifecycle of ['pre'+name,'post'+name]) if (pkg.scripts[lifecycle]) {
        edge('package.json#'+name,'package.json#'+lifecycle,'NPM_LIFECYCLE'); scanShell('package.json#'+lifecycle,pkg.scripts[lifecycle]);
      }
    }
  }
  for (const match of text.matchAll(/<<'NODE'\n([\s\S]*?)\nNODE(?:\n|$)/g)) scanJS(from+'#inline-node',match[1]);
  edge(from,null,'UNVERIFIED_SHELL_EXPANSION_PATH_BUILTINS_AND_HOST_TOOLS');
}
visitFile('scripts/run-private-sidecar-step.sh');
edge('scripts/run-private-sidecar-step.sh','scripts/paper-runtime-private-binding.mjs','REVIEWED_LITERAL_BINDING_BEGIN_FINISH');
edge('scripts/run-private-sidecar-step.sh','scripts/probe-private-sidecar-diagnostic.mjs','REVIEWED_LITERAL_FAILURE_PREVIEW');
edge('scripts/probe-private-sidecar-diagnostic.mjs','scripts/classify-private-sidecar-failure.mjs','REVIEWED_PROCESS_EXECPATH_AND_URL_ARGUMENT');
visitFile('scripts/paper-runtime-private-binding.mjs');
visitFile('scripts/probe-private-sidecar-diagnostic.mjs');
const workflows = baseline.workflows.map(record => {
  const file='.github/workflows/'+record.file, bytes=fs.readFileSync(file), w=parseWorkflow(bytes.toString());
  assert.equal(sha256(canonical(w)),record.definitionSha256);
  for (const [job,j] of Object.entries(w.jobs)) for (const [index,step] of j.steps.entries()) {
    const shell = step.shell ?? j.defaults?.run?.shell ?? w.defaults?.run?.shell;
    if (!step.run || !shell?.includes('scripts/run-private-sidecar-step.sh')) continue;
    const from=`${file}#${job}/step-${index+1}`;
    producers.push({from,runSha256:sha256(step.run),workflowDefinitionPinned:true,
      phase:step.env?.PAPER_EVIDENCE_PHASE??null,ifSha256:sha256(step.if??''),
      argvSource:'GITHUB_RUNNER_TEMP_SCRIPT_UNATTESTED'});
    edge('scripts/run-private-sidecar-step.sh',from,'WORKFLOW_SUPPLIED_ARGV1_PRODUCER');
    scanShell(from,step.run);
  }
  return {file,observedSha256:sha256(bytes),definitionSha256:record.definitionSha256,
    jobs:record.jobs.map(j=>({id:j.id,classification:j.classification,operationalEligible:j.operationalEligible,
      writerClaimVerified:j.writerClaimVerified,blockers:j.blockers})),
    actions:Object.values(w.jobs).flatMap(j=>j.steps.filter(s=>s.uses).map(s=>s.uses)),
    runners:Object.values(w.jobs).map(j=>j['runs-on'])};
});
const protectedFiles=Object.entries(baseline.evidenceSha256).map(([file,trustedSha256])=>({file,trustedSha256,
  observedSha256:sha256(fs.readFileSync(file))}));
assert.equal(protectedFiles.length,140); assert.equal(workflows.length,17);
assert.equal(workflows.reduce((n,w)=>n+w.jobs.length,0),21);
assert.equal(baseline.blockers.length,10); assert.ok(baseline.blockers.every(b=>b.status==='OPEN'));
assert.equal(baseline.reviewBy,'2026-12-11T00:00:00Z'); assert.equal(baseline.operationalHold,true);
assert.equal(sha256(canonical(baseline)),'419fbfae411d8e4e772b5dc7175b665fda3608660418eff5389cf0aae82f434b');
assert.deepEqual(protectedFiles.filter(p=>p.observedSha256!==p.trustedSha256).map(p=>p.file),['scripts/run-private-sidecar-step.sh']);
const inventory={schemaVersion:'r4b-candidate-evidence-v1',candidateOnly:true,operationalHold:true,
  r4aHead:'37e2134e0471960d84a3c5abe0251d21fca35cfa',mainObserved:'73984070264f6e47cc8ab212b4ea4db0e09d7c20',
  baselineCanonicalSha256:sha256(canonical(baseline)),reviewBy:baseline.reviewBy,
  protectedFiles,workflows,blockers:baseline.blockers,producers,
  reachableFiles:[...files.values()].sort((a,b)=>a.file.localeCompare(b.file)),
  edges:edges.sort((a,b)=>canonical(a).localeCompare(canonical(b))),
  npmScripts:[...commands].sort().map(name=>({name,sha256:sha256(pkg.scripts[name])})),
  packageLock:{sha256:sha256(fs.readFileSync('package-lock.json')),baselinePinned:false,
    packages:Object.entries(lock.packages).map(([name,p])=>({name,version:p.version,integrity:p.integrity??null,hasInstallScript:p.hasInstallScript??false}))},
  buildInputs:['package.json','tsconfig.json'].map(file=>({file,sha256:sha256(fs.readFileSync(file)),baselinePinned:false})),
  hostBoundaries:{node:'UNVERIFIED_BINARY_PROVENANCE; setup-node major selection is not a binary digest',
    gnu:'UNVERIFIED timeout/env/head/wc binaries resolved through PATH',
    shell:'UNVERIFIED bash/mktemp and runner-supplied argv1 bytes; literal shell scan not a shell interpreter',
    runner:'UNVERIFIED ubuntu-latest image and tag-based actions',
    build:'INFERRED dist JS mapped to TypeScript; tsc/package-lock/tsconfig are separate build inputs',
    packages:'LOCK_INTEGRITY_RECORDED_NOT_HOST_OR_SUPPLY_CHAIN_ATTESTATION',
    dynamic:'UNVERIFIED nonliteral imports/process calls and alias/eval indirection; no universal closure claim'},
  executionAuthorized:false,historicRootCauseVerified:false};
if (process.argv.includes('--print-candidate')) {
  // One inspectable record per line; never writes trusted control files.
  process.stdout.write('{\n'+Object.entries(inventory).map(([k,v]) => '  '+JSON.stringify(k)+': '+
    (Array.isArray(v)?'[\n'+v.map(row=>'    '+JSON.stringify(row)).join(',\n')+'\n  ]':JSON.stringify(v))).join(',\n')+'\n}\n');
}
else {
  assert.deepEqual(JSON.parse(fs.readFileSync(inventoryPath,'utf8')),inventory,'candidate snapshot drift; review, do not regenerate trusted controls');
  console.log(JSON.stringify({status:'R4B_CANDIDATE_INVENTORY_MATCH',protectedHashes:140,workflows:17,jobs:21,openBlockers:10,
    reachableFiles:files.size,producerScripts:producers.length,edges:edges.length,completeExecutionClosure:'UNVERIFIED',operationalHold:true}));
}
