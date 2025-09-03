import { workspace, type ConfigurationChangeEvent, type Disposable, type WorkspaceConfiguration } from 'coc.nvim';
import * as child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import which from 'which';

interface IPythonSettings {
  pythonPath: string;
}

export class PythonSettings implements IPythonSettings {
  private workspaceRoot: string;
  private static pythonSettings: Map<string, PythonSettings> = new Map<string, PythonSettings>();

  private disposables: Disposable[] = [];
  private _pythonPath = '';

  constructor() {
    this.workspaceRoot = workspace.root ? workspace.root : __dirname;
    this.initialize();
  }

  public static getInstance(): PythonSettings {
    const workspaceFolder = workspace.workspaceFolders.length > 0 ? workspace.workspaceFolders[0] : undefined;
    const workspaceFolderKey = workspaceFolder ? workspaceFolder.name : 'unknown';

    if (!PythonSettings.pythonSettings.has(workspaceFolderKey)) {
      const settings = new PythonSettings();
      PythonSettings.pythonSettings.set(workspaceFolderKey, settings);
      return settings;
    }
    // biome-ignore lint/style/noNonNullAssertion: x
    return PythonSettings.pythonSettings.get(workspaceFolderKey)!;
  }

  public static dispose() {
    for (const item of PythonSettings.pythonSettings) {
      item[1].dispose();
    }
    PythonSettings.pythonSettings.clear();
  }

  public dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }

  private resolvePythonFromVENV(): string | undefined {
    function pythonBinFromPath(p: string): string | undefined {
      const fullPath =
        process.platform === 'win32' ? path.join(p, 'Scripts', 'python.exe') : path.join(p, 'bin', 'python');
      return fs.existsSync(fullPath) ? fullPath : undefined;
    }

    try {
      // virtualenv
      if (process.env.VIRTUAL_ENV && fs.existsSync(path.join(process.env.VIRTUAL_ENV, 'pyvenv.cfg'))) {
        return pythonBinFromPath(process.env.VIRTUAL_ENV);
      }

      // conda
      if (process.env.CONDA_PREFIX) {
        return pythonBinFromPath(process.env.CONDA_PREFIX);
      }

      // `pyenv local` creates `.python-version`, but not `PYENV_VERSION`
      let p = path.join(this.workspaceRoot, '.python-version');
      if (fs.existsSync(p)) {
        if (!process.env.PYENV_VERSION) {
          // pyenv local can special multiple Python, use first one only
          process.env.PYENV_VERSION = fs.readFileSync(p).toString().trim().split('\n')[0];
        }
        return;
      }

      // pipenv
      p = path.join(this.workspaceRoot, 'Pipfile');
      if (fs.existsSync(p)) {
        return child_process.spawnSync('pipenv', ['--py'], { encoding: 'utf8' }).stdout.trim();
      }

      // poetry
      p = path.join(this.workspaceRoot, 'poetry.lock');
      if (fs.existsSync(p)) {
        const list = child_process
          .spawnSync('poetry', ['env', 'list', '--full-path', '--no-ansi'], {
            encoding: 'utf8',
            cwd: this.workspaceRoot,
          })
          .stdout.trim();
        let info = '';
        for (const item of list.split('\n')) {
          if (item.includes('(Activated)')) {
            info = item.replace(/\(Activated\)/, '').trim();
            break;
          }
          info = item;
        }
        if (info) {
          return pythonBinFromPath(info);
        }
      }

      // pdm
      p = path.join(this.workspaceRoot, '.pdm-python');
      if (fs.existsSync(p)) {
        return child_process.spawnSync('pdm', ['info', '--python'], { encoding: 'utf8' }).stdout.trim();
      }

      // virtualenv in the workspace root
      const files = fs.readdirSync(this.workspaceRoot);
      for (const file of files) {
        const x = path.join(this.workspaceRoot, file);
        if (fs.existsSync(path.join(x, 'pyvenv.cfg'))) {
          return pythonBinFromPath(x);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  protected update(pythonSettings: WorkspaceConfiguration) {
    const vp = this.resolvePythonFromVENV();
    this.pythonPath = vp ? vp : pythonSettings.get<string>('pythonPath', 'python');
  }

  public get pythonPath(): string {
    return this._pythonPath;
  }

  public set pythonPath(value: string) {
    if (this._pythonPath === value) {
      return;
    }
    try {
      this._pythonPath = getPythonExecutable(value);
    } catch (_ex) {
      this._pythonPath = value;
    }
  }

  protected initialize(): void {
    this.disposables.push(
      workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
        if (event.affectsConfiguration('python')) {
          const currentConfig = workspace.getConfiguration('python', workspace.root);
          this.update(currentConfig);
        }
      }),
    );

    const initialConfig = workspace.getConfiguration('python', workspace.root);
    if (initialConfig) {
      this.update(initialConfig);
    }
  }
}

function getPythonExecutable(val: string): string {
  let pythonPath = workspace.expand(val);

  // If only 'python'.
  if (
    pythonPath === 'python' ||
    pythonPath.indexOf(path.sep) === -1 ||
    path.basename(pythonPath) === path.dirname(pythonPath)
  ) {
    const bin = which.sync(pythonPath, { nothrow: true });
    if (bin) {
      pythonPath = bin;
    }
  }

  if (isValidPythonPath(pythonPath)) {
    return pythonPath;
  }

  return pythonPath;
}

function isValidPythonPath(pythonPath: string): boolean {
  try {
    return child_process.spawnSync(pythonPath, ['-c', 'print(1234)'], { encoding: 'utf8' }).stdout.startsWith('1234');
  } catch (_ex) {
    return false;
  }
}
