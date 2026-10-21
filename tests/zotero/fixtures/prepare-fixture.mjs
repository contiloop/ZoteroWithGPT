import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Produce an import file for this checkout without retaining a developer path.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pdf = new URL('./research-companion.pdf', import.meta.url);
  const output = path.resolve(process.argv[2] ?? '.cache/native-fixture/fixture.ris');
  const lines = [
    'TY  - JOUR',
    'TI  - Research Companion Native Integration Fixture',
    'AU  - Research Companion, Development',
    'PY  - 2026',
    'N1  - ZOTERO_AI_RESEARCH_COMPANION_OWNED_NATIVE_FIXTURE_V1',
    `L1  - ${pdf.href}`,
    'ER  - ',
    '',
  ];
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, lines.join('\n'), { flag: 'wx' });
  console.log(JSON.stringify({ importFile: output, pdf: fileURLToPath(pdf) }));
}
