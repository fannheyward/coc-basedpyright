import {
  LanguageClient,
  TransportKind,
  Uri,
  commands,
  services,
  window,
  workspace,
  type DocumentSelector,
  type ExtensionContext,
  type LanguageClientOptions,
  type ServerOptions,
  type StaticFeature,
} from 'coc.nvim';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PythonSettings } from './configSettings';
import {
  configuration,
  handleDiagnostics,
  provideCompletionItem,
  provideHover,
  provideSignatureHelp,
  resolveCompletionItem,
} from './middleware';

const defaultHeapSize = 3072;

const method = 'workspace/executeCommand';
const documentSelector: DocumentSelector = [
  {
    scheme: 'file',
    language: 'python',
  },
];

class PyrightExtensionFeature implements StaticFeature {
  dispose(): void {}
  initialize() {}
  fillClientCapabilities(capabilities: any) {
    // Pyright set activeParameter = -1 when activeParameterSupport enabled
    // this will break signatureHelp
    capabilities.textDocument.signatureHelp.signatureInformation.activeParameterSupport = false;
  }
}

export async function activate(context: ExtensionContext): Promise<void> {
  const pyrightCfg = workspace.getConfiguration('basedpyright');
  const isEnable = pyrightCfg.get<boolean>('enable', true);
  if (!isEnable) return;

  const module = join(context.extensionPath, 'node_modules', 'basedpyright', 'langserver.index.js');
  if (!existsSync(module)) {
    window.showErrorMessage(`Basedpyright langserver doesn't exist, please reinstall coc-basedpyright`);
    return;
  }

  const runOptions = { execArgv: [`--max-old-space-size=${defaultHeapSize}`] };
  const debugOptions = {
    execArgv: ['--nolazy', '--inspect=6600', `--max-old-space-size=${defaultHeapSize}`],
  };

  const serverOptions: ServerOptions = {
    run: { module: module, transport: TransportKind.ipc, options: runOptions },
    debug: {
      module: module,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  const outputChannel = window.createOutputChannel('Basedpyright');
  const pythonSettings = PythonSettings.getInstance();
  outputChannel.appendLine(`Workspace: ${workspace.root}`);
  outputChannel.appendLine(`Using python from ${pythonSettings.pythonPath}\n`);
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {
      configurationSection: ['python', 'pyright', 'basedpyright'],
    },
    outputChannel,
    middleware: {
      workspace: {
        configuration,
      },
      provideHover,
      provideSignatureHelp,
      provideCompletionItem,
      handleDiagnostics,
      resolveCompletionItem,
    },
  };

  const client: LanguageClient = new LanguageClient(
    'basedpyright',
    'Basedpyright Server',
    serverOptions,
    clientOptions,
  );
  client.registerFeature(new PyrightExtensionFeature());
  context.subscriptions.push(services.registerLanguageClient(client));

  const textEditorCommands = ['basedpyright.organizeimports', 'basedpyright.addoptionalforparam'];
  for (const command of textEditorCommands) {
    context.subscriptions.push(
      commands.registerCommand(command, async (offset: number) => {
        const doc = await workspace.document;
        const cmd = {
          command,
          arguments: [doc.uri.toString(), offset],
        };

        await client.sendRequest(method, cmd);
      }),
    );
  }

  let command = 'basedpyright.restartserver';
  let disposable = commands.registerCommand(command, async () => {
    await client.sendRequest(method, { command });
  });
  context.subscriptions.push(disposable);

  command = 'basedpyright.createtypestub';
  disposable = commands.registerCommand(command, async (...args: unknown[]) => {
    if (!args.length) {
      window.showWarningMessage('Module name is missing');
      return;
    }
    const doc = await workspace.document;
    const filePath = Uri.parse(doc.uri).fsPath;
    if (args[args.length - 1] !== filePath) {
      // args from inner command   : [root, module, filePath]
      // args from CocCommand      : [module]
      args.unshift(workspace.root);
      args.push(filePath);
    }

    const cmd = {
      command,
      arguments: args,
    };
    await client.sendRequest(method, cmd);
  });
  context.subscriptions.push(disposable);

  disposable = commands.registerCommand('basedpyright.version', () => {
    const pyrightJSON = join(context.extensionPath, 'node_modules', 'basedpyright', 'package.json');
    const pyrightPackage = JSON.parse(readFileSync(pyrightJSON, 'utf8'));
    const cocPyrightJSON = join(context.extensionPath, 'package.json');
    const cocPyrightPackage = JSON.parse(readFileSync(cocPyrightJSON, 'utf8'));
    window.showInformationMessage(
      `coc-basedpyright ${cocPyrightPackage.version} with Basedpyright ${pyrightPackage.version}`,
    );
  });
  context.subscriptions.push(disposable);
}
