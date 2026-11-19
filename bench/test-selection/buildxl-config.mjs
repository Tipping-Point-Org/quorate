// buildxl-config.mjs — writes candidate 9's BuildXL configuration into a sandbox (test-selection-exploration.md).
//
// One process pip per test file, `node --test <file>`, declaring only the test file: allowUndeclaredSourceReads lets
// each pip read anything in the source tree, and BuildXL OBSERVES those reads into the pip's fingerprint, which is how a
// change re-runs the pips that read it. The temp folder, the user profile and the system folders are untracked scopes:
// tup failed on exactly those writes. The SDK modules come from the downloaded package (Microsoft.BuildXL.win-x64).

import fs from 'node:fs';
import path from 'node:path';

export function writeBuildxlConfig({ repo, sample, sdk, nodeExe, untracked }) {
  const q = (p) => p.replaceAll('\\', '/');
  fs.writeFileSync(path.join(repo, 'config.dsc'), `config({
  resolvers: [{ kind: "DScript", modules: [
    f\`module.config.dsc\`,
    f\`${q(sdk)}/Sdk.Prelude/package.config.dsc\`,
    f\`${q(sdk)}/Sdk.Transformers/package.config.dsc\`,
  ] }],
});
`);
  fs.writeFileSync(path.join(repo, 'module.config.dsc'), `module({
  name: "TsSelection",
  nameResolutionSemantics: NameResolutionSemantics.implicitProjectReferences,
  projects: [f\`tests.dsc\`],
});
`);
  const pass = ['PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec',
    'PATHEXT', 'HOMEDRIVE', 'HOMEPATH', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'NUMBER_OF_PROCESSORS', 'OS',
    'PROCESSOR_ARCHITECTURE', 'COMPUTERNAME', 'USERNAME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN'];
  const pips = sample.map((t, i) => `export const t${i} = Transformer.execute({
  tool: nodeTool,
  workingDirectory: d\`.\`,
  description: "ts-test ${t}",
  arguments: [Cmd.rawArgument("--test"), Cmd.rawArgument("${t}")],
  dependencies: [f\`${t}\`],
  // Outputs may not go in the source tree ("under a non-writable mount"): a BuildXL-managed output folder per pip.
  consoleOutput: p\`\${Context.getNewOutputDirectory("ts-t${i}")}/out.txt\`,
  allowUndeclaredSourceReads: true,
  unsafe: { untrackedScopes: [${untracked.map((u) => `d\`${q(u)}\``).join(', ')}], passThroughEnvironmentVariables: ${JSON.stringify(pass)} },
});`).join('\n');
  fs.writeFileSync(path.join(repo, 'tests.dsc'), `import {Transformer, Cmd} from "Sdk.Transformers";

const nodeTool: Transformer.ToolDefinition = {
  exe: f\`${q(nodeExe)}\`,
  dependsOnWindowsDirectories: true,
  dependsOnAppDataDirectory: true,
  prepareTempDirectory: true,
  untrackedDirectoryScopes: [${untracked.map((u) => `d\`${q(u)}\``).join(', ')}],
};

${pips}
`);
}
