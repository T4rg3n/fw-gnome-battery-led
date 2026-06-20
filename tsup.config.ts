import { join } from 'node:path';
import { cp } from 'node:fs/promises';
import { defineConfig } from 'tsup';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export default defineConfig({
  entry: ['src/extension.ts', 'src/prefs.ts'],
  format: ['esm'],
  dts: false,
  minify: false,
  clean: true,
  async onSuccess() {
    const ROOT = import.meta.dirname;
    const BUILD_PATH = join(ROOT, 'dist');

    await cp(join(ROOT, 'metadata.json'), join(BUILD_PATH, 'metadata.json'));

    await cp(join(ROOT, 'src', 'schemas'), join(BUILD_PATH, 'schemas'), {
      recursive: true,
    });

    await cp(join(ROOT, 'src', 'icons'), join(BUILD_PATH, 'icons'), {
      recursive: true,
    });

    await cp(join(ROOT, 'src', 'stylesheet.css'), join(BUILD_PATH, 'stylesheet.css'));

    await execAsync(`glib-compile-schemas ${join(BUILD_PATH, 'schemas')}`);

    console.log('Build complete → dist/');
  },
});
