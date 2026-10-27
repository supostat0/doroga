// Собирает CATALOG.md из src/catalog.js: что игра умеет строить, с какого дня, сколько найдено на карте.
// Запуск: npm run catalog (после npm run map — счётчики по свежей карте).
import { readFileSync, writeFileSync } from 'node:fs';
import { CATALOG } from '../src/catalog.js';

const map = JSON.parse(readFileSync('public/map.json', 'utf8'));
const row = (e) => `| ${e.title} | ${e.since ?? '—'} | ${e.count ? e.count(map) : '—'} | ${e.find} | ${e.code ? '`' + e.code + '`' : ''} |`;
const head = '| Элемент | С какого дня | На карте | Откуда берётся | Код |\n|---|---|---|---|---|';
const has = CATALOG.filter((e) => e.status === 'есть'), plan = CATALOG.filter((e) => e.status !== 'есть');
writeFileSync('CATALOG.md', `# Каталог архитектурных элементов

Что игра умеет строить и откуда это берёт. Источник — \`src/catalog.js\`; этот файл собирается
командой \`npm run catalog\`, руками не править. Новый вид — сначала запись в каталог, потом код и тест;
перед этим — пробежать [грабли инструмента](docs/LESSONS.md).

## Умеем (${has.length})

${head}
${has.map(row).join('\n')}

## В очереди (${plan.length})

${head}
${plan.map(row).join('\n')}
`);
console.log(`CATALOG.md: умеем ${has.length}, в очереди ${plan.length}`);
