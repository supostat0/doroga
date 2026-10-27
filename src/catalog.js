// Каталог архитектурных элементов: что игра умеет строить, откуда берёт и где код.
// Новый вид (заметили на панораме, а строить не умеем) — сначала запись сюда, потом код;
// перед этим — docs/LESSONS.md (на чём уже спотыкались), новые грабли — туда же.
// `npm run catalog` собирает из этого CATALOG.md со счётчиками по карте — журнал роста инструмента.
// count(map) — сколько найдено на текущей карте (null — не считается).

export const CATALOG = [
  // --- здания ---
  { id: 'arch_passage', title: 'Арка-проезд сквозь дом', since: '2026-10-23', status: 'есть',
    find: 'OSM: дорога или дорожка с tunnel=building_passage пересекает стену дома; размер по виду дороги (проезд 3.5 × 4.3 м, проход 2.4 × 3.4 м) или тегам width/maxheight',
    code: 'tools/elements.mjs (поиск, тест), src/buildings.js (вырез), src/passages.js (свод)',
    count: (m) => m.passages?.length ?? 0 },
  { id: 'arch_gate', title: 'Арка с воротами (решётка в проёме)', since: '2026-10-23', status: 'есть',
    find: 'OSM: barrier=gate точкой на контуре дома', code: 'tools/build-map.mjs, src/passages.js', count: (m) => (m.passages ?? []).filter((q) => q.gate).length },
  { id: 'arch_through', title: 'Сквозная арка во двор (двор виден насквозь)', since: '2026-10-23', status: 'есть',
    find: 'луч от арки на наружной стене внутрь дома выходит во двор этого дома в 25 м', code: 'tools/elements.mjs (throughPassages, тест), src/passages.js',
    count: (m) => (m.passages ?? []).filter((q) => q.open).length },
  { id: 'court_entry', title: 'Вход во двор, которого нет в OSM (пешеходная арка)', since: '2026-10-23', status: 'есть',
    find: 'двор без арок и ворот: стена к улице (до 30 м), где дом тоньше всего', code: 'tools/elements.mjs (throughPassages, тест)',
    count: (m) => (m.passages ?? []).filter((q) => q.auto).length },
  { id: 'door', title: 'Дверь: полотно, фрамуга, наличник, фонарик у парадной', since: '2026-10-23', status: 'есть',
    find: 'OSM: entrance=* точкой на стене дома (main, staircase, shop, service, home)', code: 'tools/elements.mjs (attachToWalls, тест), src/doors.js',
    count: (m) => m.doors?.length ?? 0 },
  { id: 'recessed_windows', title: 'Утопленные окна и витрины', since: '2026-10-23', status: 'есть',
    find: 'все обычные дома: стекло на 25 см (окна) и 35 см (витрины) глубже стены, откосы по взгляду',
    code: 'src/buildings.js (шейдер фасада)', count: null },
  { id: 'special_facade', title: 'Особый фасад (Гостиный двор, Зингер, Пассаж, Дума, вестибюль метро)', since: '2026-10-21', status: 'есть',
    find: 'вручную: data/overrides.json, поле facade', code: 'src/buildings.js (PRESETS_GLSL)',
    count: (m) => m.buildings.filter((b) => b.facade).length },
  { id: 'photo_facade', title: 'Фасад по фото', since: '2026-10-22', status: 'есть',
    find: 'разметка в tools/facade.html (снимки Mapillary, авторежим «Собрать фото по улицам»)',
    code: 'src/facadegen.js, src/photofacades.js → public/facades/index.json', count: null },
  { id: 'civic_facade', title: 'Фасад «казённое здание» (классицизм): руст и окна внизу, белые наличники, шаг окон 3 м', since: '2026-10-23', status: 'есть',
    find: 'вручную: data/overrides.json, facade: civic (Ассигнационный банк)', code: 'src/buildings.js (шейдер, preset 16)',
    count: (m) => m.buildings.filter((b) => b.facade === 'civic').length },
  { id: 'risalit', title: 'Ризалит с фронтоном и пилястрами', since: '2026-10-23', status: 'есть',
    find: 'вручную: data/elements.json (точка на стене, куда смотрит, ширина, высота) — прямой объём перед стеной, пилястры по шагу окон, фронтон',
    code: 'tools/elements.mjs (контур, тест), tools/build-map.mjs, src/elements.js', count: (m) => elems(m, 'risalit') },
  { id: 'colonnade', title: 'Колоннада по дуге', since: '2026-10-23', status: 'есть',
    find: 'дуги контура: подряд короткие рёбра с плавным поворотом, от 30 м; пока только Казанский собор',
    code: 'src/kazan.js', count: null },
  { id: 'portico', title: 'Портик с фронтоном', since: '2026-10-23', status: 'есть',
    find: 'Казанский: середина выступа, через который проходит луч от купола к Невскому',
    code: 'src/kazan.js', count: null },
  { id: 'arch_pavilion', title: 'Павильон с аркой проезда (торец крыла)', since: '2026-10-23', status: 'есть',
    find: 'Казанский: рёбра 4–12 м лицом к Невскому, ближе 75 м к нему', code: 'src/kazan.js', count: null },
  { id: 'pilasters', title: 'Пилястры', since: '2026-10-23', status: 'есть',
    find: 'Казанский: стены корпуса (шаг ~3.6 м) и барабан купола', code: 'src/kazan.js', count: null },
  // --- улица ---
  { id: 'bridge_statues', title: 'Скульптуры по концам моста (грифоны с позолоченными крыльями, тросы, фонари)', since: '2026-10-23', status: 'есть',
    find: 'вручную: data/elements.json, название моста из OSM — концы и ширина берутся по нему', code: 'src/elements.js', count: (m) => elems(m, 'bridge_statues') },
  { id: 'metro_entrance', title: 'Вход в метро (вывеска на фасаде или спуск в переход)', since: '2026-10-21', status: 'есть',
    find: 'OSM: railway=subway_entrance; фасад в 6 м — вывеска, иначе спуск', code: 'src/metro.js',
    count: (m) => m.metro?.length ?? 0 },
  { id: 'bus_stop', title: 'Остановка с павильоном', since: '2026-10-21', status: 'есть',
    find: 'OSM: highway=bus_stop', code: 'src/streetlife.js', count: (m) => m.stops?.length ?? 0 },
  { id: 'fence_lattice', title: 'Забор: чугунная решётка с пиками', since: '2026-10-23', status: 'есть',
    find: 'OSM: barrier=fence без вида', code: 'src/details.js', count: (m) => kind(m, 'fence') },
  { id: 'fence_concrete', title: 'Забор: бетонные плиты с ромбами', since: '2026-10-23', status: 'есть',
    find: 'OSM: fence_type/material=concrete или overrides fence_type: concrete', code: 'src/details.js', count: (m) => kind(m, 'concrete') },
  { id: 'fence_chain', title: 'Забор: сетка-рабица', since: '2026-10-23', status: 'есть',
    find: 'OSM: fence_type=chain_link', code: 'src/details.js', count: (m) => kind(m, 'chain') },
  { id: 'fence_arcade', title: 'Ограда-аркада: стена с арками и решётками-веерами (Ассигнационный банк)', since: '2026-10-23', status: 'есть',
    find: 'вручную: overrides fence_type: arcade', code: 'src/details.js', count: (m) => kind(m, 'arcade') },
  { id: 'fence_colonnade', title: 'Колоннада в ограде: гранитные колонны, антаблемент, решётка из пик, ворота на оси', since: '2026-10-23', status: 'есть',
    find: 'вручную: data/elements.json — вырезает свой участок из ограды', code: 'src/details.js', count: (m) => elems(m, 'fence_colonnade') },
  { id: 'wall', title: 'Стена (ограждение)', since: '2026-10-23', status: 'есть',
    find: 'OSM: barrier=wall', code: 'src/details.js', count: (m) => kind(m, 'wall') },
  { id: 'hedge', title: 'Живая изгородь', since: '2026-10-23', status: 'есть',
    find: 'OSM: barrier=hedge', code: 'src/details.js', count: (m) => kind(m, 'hedge') },
  { id: 'lawn_kerb', title: 'Гранитный бортик газона', since: '2026-10-23', status: 'есть',
    find: 'OSM: landuse=grass/flowerbed, leisure=park/garden и др. — по краю', code: 'src/details.js',
    count: (m) => m.snowAreas?.length ?? 0 },
  { id: 'bench', title: 'Скамейка (лицом к дорожке)', since: '2026-10-23', status: 'есть',
    find: 'OSM: amenity=bench', code: 'src/details.js', count: (m) => (m.furniture ?? []).filter((f) => f.kind === 'bench').length },
  { id: 'bin', title: 'Урна', since: '2026-10-23', status: 'есть',
    find: 'OSM: amenity=waste_basket', code: 'src/details.js', count: (m) => (m.furniture ?? []).filter((f) => f.kind === 'bin').length },
  { id: 'fountain', title: 'Фонтан (гранитная чаша)', since: '2026-10-23', status: 'есть',
    find: 'OSM: amenity=fountain; строится пока только у Казанского', code: 'src/kazan.js',
    count: (m) => (m.monuments ?? []).filter((x) => x.kind === 'fountain').length },
  { id: 'statue', title: 'Памятник на постаменте', since: '2026-10-23', status: 'есть',
    find: 'OSM: memorial=statue; строится пока только у Казанского', code: 'src/kazan.js',
    count: (m) => (m.monuments ?? []).filter((x) => x.kind === 'statue').length },
  { id: 'paving', title: 'Плитка: гранит на Невском, «кирпичик» в переулках', since: '2026-10-23', status: 'есть',
    find: 'по расстоянию до оси Невского; расчищенная полоса — где ходят пешеходы', code: 'src/ground.js', count: null },
  // --- в очереди ---
  { id: 'underpass', title: 'Подземный переход: спуск, лестница, свет снизу', since: null, status: 'план',
    find: 'OSM: highway=footway/steps с tunnel=yes или layer<0 (~50 на карте)', code: '', count: null },
  { id: 'covered', title: 'Крытый проход, галерея, навес', since: null, status: 'план',
    find: 'OSM: covered=yes (~65), building=roof', code: '', count: null },
];

function elems(m, t) {
  return (m.elements ?? []).filter((e) => e.type === t).length;
}

function kind(m, k) {
  return (m.barriers ?? []).filter((b) => b.kind === k).length;
}
