import { readFile } from 'node:fs';
import { promisify } from 'node:util';

async function diff() {
  const text = await promisify(readFile)('./package.json');
  const config = JSON.parse(text.toString());
  const overrides =
    config.contributes.configuration.properties['basedpyright.analysis.diagnosticSeverityOverrides'].properties;

  const resp = await fetch(
    'https://raw.githubusercontent.com/DetachHead/basedpyright/main/packages/vscode-pyright/schemas/pyrightconfig.schema.json',
  );
  const schema = await resp.json();
  for (const [key, val] of Object.entries(schema.properties)) {
    if (val.$ref === '#/definitions/diagnostic') {
      if (!overrides[key]) {
        console.error('missing:', key);
      } else {
        const obj = overrides[key];
        if (obj.default !== val.default) {
          console.error(`${key}, package.json value: ${obj.default}, schema value: ${val.default}`);
        }
      }
    }
  }
}

await diff();
