// Publishes packages/sdk to npm as @volopay/workflow-builder.
// The workspace keeps its upstream name so `git merge upstream/main` stays conflict-free;
// only the packed tarball is renamed. Dry run by default, `--publish` to really publish.
//
// Usage: node tools/publish-volopay.mjs [--publish] [--version X.Y.Z] [--access public|restricted] [--skip-build]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDK_DIR = path.join(ROOT, 'packages/sdk');
const STAGING = path.join(ROOT, 'tmp/volopay-publish');
const UPSTREAM_NAME = '@workflowbuilder/sdk';
const PACKAGE_NAME = '@volopay/workflow-builder';
const REPOSITORY = 'https://github.com/supriya-volo/workflowbuilder';

const { values } = parseArgs({
  options: {
    publish: { type: 'boolean', default: false },
    version: { type: 'string' },
    access: { type: 'string' },
    'skip-build': { type: 'boolean', default: false },
  },
});

if (values.access && !['public', 'restricted'].includes(values.access)) {
  throw new Error(`--access must be "public" or "restricted", got "${values.access}"`);
}

const run = (command, arguments_, cwd = ROOT) => execFileSync(command, arguments_, { cwd, stdio: 'inherit' });

if (!values['skip-build']) run('pnpm', ['build:lib']);

rmSync(STAGING, { recursive: true, force: true });
mkdirSync(STAGING, { recursive: true });

// `pnpm pack` (not npm) resolves the `catalog:` and `workspace:` ranges into real versions.
run('pnpm', ['pack', '--pack-destination', STAGING], SDK_DIR);
const tarball = readdirSync(STAGING).find((file) => file.endsWith('.tgz'));
run('tar', ['-xzf', tarball], STAGING);
const packageDirectory = path.join(STAGING, 'package');

const manifestPath = path.join(packageDirectory, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const upstreamVersion = manifest.version;

manifest.name = PACKAGE_NAME;
manifest.version = values.version ?? upstreamVersion;
manifest.description = `Volopay build of Workflow Builder (${UPSTREAM_NAME}@${upstreamVersion}). ${manifest.description}`;
manifest.homepage = REPOSITORY;
manifest.repository = { type: 'git', url: `git+${REPOSITORY}.git`, directory: 'packages/sdk' };
manifest.bugs = { url: `${REPOSITORY}/issues` };
if (values.access) manifest.publishConfig = { ...manifest.publishConfig, access: values.access };
// The tarball is already built; don't let npm try to rebuild it outside the workspace.
delete manifest.scripts;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Apache-2.0 section 4(b): modified files must carry a notice that they were changed.
const readmePath = path.join(packageDirectory, 'README.md');
const readme = readFileSync(readmePath, 'utf8').replaceAll(UPSTREAM_NAME, PACKAGE_NAME);
const notice =
  `> **${PACKAGE_NAME}** is a modified build of [Workflow Builder](https://github.com/synergycodes/workflowbuilder) ` +
  `(\`${UPSTREAM_NAME}@${upstreamVersion}\`) by Synergy Codes, licensed under Apache-2.0. ` +
  `Changes: ${REPOSITORY}/commits/main\n\n`;
writeFileSync(readmePath, notice + readme);

console.log(`\n${manifest.name}@${manifest.version} staged in ${path.relative(ROOT, packageDirectory)}`);

const publishArguments = ['publish', packageDirectory];
if (!values.publish) publishArguments.push('--dry-run');
run('npm', publishArguments);

if (!values.publish) console.log('\nDry run only. Re-run with --publish to publish for real.');
