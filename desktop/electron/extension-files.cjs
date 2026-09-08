const fs = require('node:fs/promises');
const path = require('node:path');

async function readExtensionFile(projectRoot, filename, kind) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error('Expected an absolute project file path');
  const root = await fs.realpath(projectRoot);
  const resolved = await fs.realpath(filename);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Extension files must be inside this project');
  }
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  const mime = types[path.extname(resolved).toLowerCase()];
  if (kind === 'skill' ? path.basename(resolved).toLowerCase() !== 'skill.md' : kind !== 'image' || !mime) {
    throw new Error('Unsupported extension file');
  }
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size > (kind === 'skill' ? 512 * 1024 : 2 * 1024 * 1024)) throw new Error('Extension file is too large');
  const data = await fs.readFile(resolved);
  return kind === 'skill' ? data.toString('utf8') : `data:${mime};base64,${data.toString('base64')}`;
}

module.exports = { readExtensionFile };
