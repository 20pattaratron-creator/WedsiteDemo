const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function transformModuleSource(source, file, loadDependency, context, loaded) {
  const aliasLines = [];
  const importRe = /^\s*import\s*\{([^}]+)\}\s*from\s*['"](\.\.?\/[^'"]+)['"]\s*;?\s*$/gm;
  source = source.replace(importRe, (_whole, bindings, ref) => {
    const dep = path.resolve(path.dirname(file), ref);
    loadDependency(dep, context, loaded);
    for (const part of bindings.split(',')) {
      const token = part.trim();
      if (!token) continue;
      const match = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(token);
      if (match && match[1] !== match[2]) aliasLines.push(`const ${match[2]} = ${match[1]};`);
    }
    return '';
  });

  // The ERP browser modules use named exports only. Convert them into ordinary
  // declarations so the legacy vm-based business tests can share one lexical
  // context without pretending that browser modules are classic scripts.
  source = source
    .replace(/^\s*export\s+(?=(?:const|let|var|function|class)\b)/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');

  return `${aliasLines.join('\n')}\n${source}`;
}

function loadEsmLike(file, context, loaded = new Set()) {
  const abs = path.resolve(file);
  if (loaded.has(abs)) return;
  loaded.add(abs);
  let source = fs.readFileSync(abs, 'utf8');
  source = transformModuleSource(source, abs, loadEsmLike, context, loaded);
  vm.runInContext(source, context, { filename: abs });
}

module.exports = { loadEsmLike, transformModuleSource };
