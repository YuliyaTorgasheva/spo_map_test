// --- Инициализация карты ---
const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', // полностью бесплатный, без ключа
    center: [60, 55],
    zoom: 2
});



let collegesData = [];
let ugsData = [];
let territoryNeighbors = {};
let geoData = [];
let territoryUGSMap = {};

// --- Загружаем JSON ---
Promise.all([
    fetch('data/colleges.json').then(res => res.json()),
    fetch('data/ugs.json').then(res => res.json()),
    fetch('data/territory_neighbors.json').then(res => res.json()),
    fetch('data/municipalities.geojson').then(res => res.json())
]).then(([colleges, ugs, neighbors, geoJSON]) => {
    collegesData = colleges;
    ugsData = ugs;
    territoryNeighbors = neighbors;
    geoData = geoJSON;

    // --- Создаём lookup territory_id -> Set of UGS ---
    ugsData.forEach(u => {
        if (!u.org_id || !u.ugs_name || u.ugs_name === 'nan') return;
        if (!territoryUGSMap[u.territory_id]) territoryUGSMap[u.territory_id] = new Set();
        territoryUGSMap[u.territory_id].add(u.ugs_name);
    });

    // --- Контейнер под таблицу ---
    const tableContainer = document.createElement('div');
    tableContainer.id = 'neighbors-table';
    tableContainer.style.marginTop = '15px';
    tableContainer.style.backgroundColor = 'white';
    tableContainer.style.padding = '10px';
    tableContainer.style.borderRadius = '6px';
    tableContainer.style.fontFamily = 'Arial, sans-serif';
    tableContainer.style.fontSize = '13px';
    document.body.appendChild(tableContainer);

    // --- Генерация чекбоксов ---
    const ugsCheckboxesContainer = document.getElementById('ugs-checkboxes');

    // берем только УГС, которые есть у муниципалитетов с индекс > 0
    const territoryWithUGS = geoData.features
        .filter(f => f.properties.index && f.properties.index > 0)
        .map(f => f.properties.territory_id);

    const validUGSSet = new Set();

    // собираем все УГС из этих муниципалитетов и их соседей 0-50 км
    territoryWithUGS.forEach(tid => {
        const neighborsDataMun = territoryNeighbors[String(tid)] || {};
        const relevantTerritories = [tid, ...(neighborsDataMun['0-50'] || [])];
        relevantTerritories.forEach(rtid => {
            const ugsSet = territoryUGSMap[rtid];
            if (ugsSet) ugsSet.forEach(u => validUGSSet.add(u));
        });
    });

    const uniqueUGS = Array.from(validUGSSet).sort();

    uniqueUGS.forEach(name => {
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.marginBottom = '2px';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = name;

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + name));
        ugsCheckboxesContainer.appendChild(label);
    });

    // --- Фильтр по чекбоксам ---
    function filterMunicipalities() {
        const checkedUGS = Array.from(ugsCheckboxesContainer.querySelectorAll('input:checked')).map(c => c.value);
        if (checkedUGS.length === 0) {
            map.setFilter('mun-polygons', null);
            return;
        }

        const filterArray = ['any'];
        geoData.features.forEach(f => {
            const props = f.properties;
            const neighborsDataMun = territoryNeighbors[String(props.territory_id)] || {};
            const relevantTerritories = [props.territory_id, ...(neighborsDataMun['0-50'] || [])];

            const hasUGS = relevantTerritories.some(tid => {
                const ugsSet = territoryUGSMap[tid];
                return ugsSet && checkedUGS.some(ugs => ugsSet.has(ugs));
            });

            if (hasUGS) {
                filterArray.push(['==', ['get', 'territory_id'], props.territory_id]);
            }
        });

        map.setFilter('mun-polygons', filterArray);
    }

    // --- Кнопки ---
    document.getElementById('apply-filter').addEventListener('click', filterMunicipalities);
    document.getElementById('clear-filter').addEventListener('click', () => {
        ugsCheckboxesContainer.querySelectorAll('input').forEach(c => c.checked = false);
        map.setFilter('mun-polygons', null);
    });

    geoData.features.forEach(f => {
        const props = f.properties;
        const neighborsData = territoryNeighbors[String(props.territory_id)] || {};
        const neighbor50Ids = neighborsData['0-50'] || [];
        const relevantTerritories = [props.territory_id, ...neighbor50Ids];

        const foundUGSSet = new Set();
        relevantTerritories.forEach(tid => {
            const ugsSet = territoryUGSMap[tid];
            if (ugsSet) ugsSet.forEach(u => foundUGSSet.add(u));
        });

        props.ugsCount = foundUGSSet.size; // добавляем в свойства
    });

    // --- Загрузка карты и слоев ---
    map.on('load', () => {
        geoData.features.forEach((f, i) => { f.id = f.id || i; });
        map.addSource('municipalities', { type: 'geojson', data: geoData });

        map.addLayer({
            id: 'mun-polygons',
            type: 'fill',
            source: 'municipalities',
            paint: {
                'fill-color': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    '#FF7F0E',
                    ['step',
                        ['get', 'ugsCount'],
                        '#f7f7f7',  // 0
                        1, '#fff7bc', // 1–5
                        6, '#fee391', // 6–10
                        11, '#fec44f', // 11–20
                        21, '#a1d99b', // 21–30
                        31, '#31a354', // 31–37
                        38, '#006d2c' // >37
                    ]
                ],
                'fill-opacity': 0.45,
                'fill-outline-color': 'rgba(255, 255, 255, 0.8)'
            }
        });

        let hoveredMunId = null;
        let lastHoverState = null;

        map.on('mousemove', 'mun-polygons', (e) => {
            if (hoveredMunId !== null) map.setFeatureState({ source: 'municipalities', id: hoveredMunId }, { hover: false });
            if (e.features.length > 0) {
                hoveredMunId = e.features[0].id;
                map.setFeatureState({ source: 'municipalities', id: hoveredMunId }, { hover: true });
                lastHoverState = hoveredMunId;
            }
        });

        map.on('mouseleave', 'mun-polygons', () => {
            if (hoveredMunId !== null) map.setFeatureState({ source: 'municipalities', id: hoveredMunId }, { hover: false });
            hoveredMunId = null;
        });

        // --- Создаем lookup: territory_id -> Set of oktmo_short_spo ---
        const territoryToOktmoMap = {};

        geoData.features.forEach(f => {
            const p = f.properties;

            if (!p.territory_id) return;
            if (!p.oktmo_short_spo) return;

            if (!territoryToOktmoMap[p.territory_id]) {
                territoryToOktmoMap[p.territory_id] = new Set();
            }
            territoryToOktmoMap[p.territory_id].add(p.oktmo_short_spo);
        });

        // --- Клик (карточка + аккордеон) ---
        map.on('click', 'mun-polygons', (e) => {
            const props = e.features[0].properties;

            // --- Колледжи муниципалитета ---
            const munColleges = collegesData
                .filter(c => c.oktmo_short_spo === props.oktmo_short_spo)
                .map(c => c.spo_name)
                .filter(name => name && name.trim() !== '');

            const neighborsData = territoryNeighbors[String(props.territory_id)] || {};
            const neighbor50Ids = neighborsData['0-50'] || [];
            const neighbor51_100Ids = neighborsData['51-100'] || [];

            // --- Найденные УГС ---
            const foundUGSSet = new Set();
            [props.territory_id, ...neighbor50Ids].forEach(tid => {
                const ugsSet = territoryUGSMap[tid];
                if (ugsSet) ugsSet.forEach(u => foundUGSSet.add(u));
            });

            const allUGSNames = Array.from(new Set(ugsData.map(u => u.ugs_name)
                .filter(name => name && name.trim() !== '' && name !== 'nan'))).sort();

            let ugsPresenceHTML = `<h3>Наличие УГС (муниципалитет + соседи 0-50 км)</h3>
                <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:15px;">
                <thead><tr><th>УГС</th><th>Наличие</th></tr></thead><tbody>`;

            allUGSNames.forEach(ugsName => {
                const exists = foundUGSSet.has(ugsName);
                ugsPresenceHTML += `<tr><td>${ugsName}</td><td>${exists ? '✔' : '-'}</td></tr>`;
            });
            ugsPresenceHTML += `</tbody></table>`;

            const ugsCount = foundUGSSet.size;

            // --- Карточка ---
            let html = `
            <div class="municipality-card">
                <h2 class="card-title">${props.municipal_district_name_short}</h2>
                <p class="municipality-type">${props.municipal_district_type || '-'}</p>
                <div class="card-info">
                <p><strong>Регион:</strong> ${props.region_name || '-'}</p>
                <p><strong>territory_ud:</strong> ${props.territory_id}</p>
                <p><strong>Индекс доступности СПО (число доступных УГС):</strong> ${ugsCount}</p>
                <p><strong>Население 15–25:</strong> ${props.population_15_25 || '-'}</p>
                <p><strong>СПО, включая соседей до 50 км:</strong> ${props.unique_colleges_0_50 || 0}</p>
                <p><strong>Доступно УГС, включая соседей до 50 км:</strong> ${ugsCount}</p>
                </div>
                <div class="ugs-presence">${ugsPresenceHTML}</div>
            </div>
            `;


            // --- ТАБЛИЦА КОЛЛЕДЖЕЙ (ТОЛЬКО ЭТО, НИЧЕГО БОЛЬШЕ НЕ МЕНЯЮ) ---
            const allTids = [
                props.territory_id,
                ...neighbor50Ids,
                ...neighbor51_100Ids,
            ];

            // Сразу создаем lookup territory_id -> категория
            const tidCategoryMap = {};
            tidCategoryMap[props.territory_id] = 'Сам муниципалитет';
            neighbor50Ids.forEach(tid => { tidCategoryMap[tid] = 'Сосед 0-50 км'; });
            neighbor51_100Ids.forEach(tid => { tidCategoryMap[tid] = 'Сосед 51-100 км'; });

            
            // Собираем все oktmo_short_spo для этих территорий
            let oktmoList = [];
            allTids.forEach(tid => {
                if (territoryToOktmoMap[tid]) {
                    territoryToOktmoMap[tid].forEach(o => oktmoList.push(o));
                }
            });

            // Находим колледжи по oktmo_short_spo и сразу добавляем категорию и муниципалитет
            // Находим колледжи по oktmo_short_spo и сразу добавляем категорию и муниципалитет 
            // Находим колледжи по oktmo_short_spo и сразу добавляем категорию и муниципалитет
            const foundWithMeta = collegesData
                .filter(c => oktmoList.includes(c.oktmo_short_spo))  // фильтруем по oktmo
                .map(c => {
                    const tidStr = c.oktmo_short_spo;  // используем oktmo_short_spo колледжа

                    // Находим название муниципалитета из props по октмо
                    const muniName = geoData.features.find(f => f.properties.oktmo_short_spo === tidStr)?.properties.municipal_district_name_short ?? "-";

                    // Ищем категорию соседей
                    const neighborsData = territoryNeighbors[String(c.territory_id)] || {};  // соседи по territory_id колледжа
                    const neighbor50Ids = neighborsData['0-50'] || [];
                    const neighbor51_100Ids = neighborsData['51-100'] || [];

                    // Определяем категорию соседа на основе территорий
                    let category = 'Сам муниципалитет';  // по умолчанию
                    if (neighbor50Ids.includes(c.territory_id)) {
                        category = 'Сосед 0-50 км';
                    } else if (neighbor51_100Ids.includes(c.territory_id)) {
                        category = 'Сосед 51-100 км';
                    }

                    return {
                        ...c,
                        category: category,  // категория соседа
                        municipalName: muniName  // название муниципалитета
                    };
                });

            // Добавляем "свои" колледжи, которые находятся в выбранном муниципалитете (по oktmo)
            const ownColleges = collegesData
                .filter(c => c.oktmo_short_spo === props.oktmo_short_spo)  // фильтруем по oktmo для выбранного муниципалитета
                .map(c => {
                    return {
                        ...c,
                        category: 'Сам муниципалитет',  // Эти колледжи всегда будут в категории "Сам муниципалитет"
                        municipalName: props.municipal_district_name_short // Название муниципалитета
                    };
                });

            // Объединяем все колледжи в одну таблицу
            const allCollegesWithMeta = [...foundWithMeta, ...ownColleges];


            // 4. Строим HTML таблицы с подписями категорий соседей и ссылкой на сайт
            // --- Строим HTML таблицы ---
            let tableHTML = `
                <h3 style="margin-bottom:10px;">Колледжи (выбранный муниципалитет и соседи до 100 км)</h3>
                <table border="1" cellpadding="4" cellspacing="0"
                    style="border-collapse:collapse;width:100%;margin-bottom:20px;">
                    <thead>
                        <tr>
                            <th>Муниципалитет</th>
                            <th>Название колледжа</th>
                            <th>Адрес</th>
                            <th>Сайт</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            foundWithMeta.forEach(c => {
                tableHTML += `
                    <tr>
                        <td>${c.municipalName}</td>
                        <td>${c.spo_name ?? "-"}</td>
                        <td>${c.address ?? "-"}</td>
                        <td>${c["web-сайт"] ? `<a href="${c["web-сайт"]}" target="_blank">Перейти</a>` : "-"}</td>
                    </tr>
                `;
            });

            tableHTML += `</tbody></table>`;

            // Выводим таблицу под картой
            document.getElementById("colleges-table").innerHTML = tableHTML;

            document.getElementById('info').innerHTML = html;
        });

        // --- Легенда ---
        const legend = document.createElement('div');
        legend.id = 'map-legend';
        legend.style.position = 'absolute';
        legend.style.bottom = '30px';
        legend.style.left = '10px';
        legend.style.backgroundColor = 'white';
        legend.style.padding = '10px';
        legend.style.borderRadius = '6px';
        legend.style.fontFamily = 'Arial, sans-serif';
        legend.style.fontSize = '12px';
        legend.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';

        legend.innerHTML = `
            <h4 style="margin:0 0 5px 0;">Индекс доступности СПО</h4>
            <div style="display:flex;align-items:center;margin-bottom:2px;">
                <div style="width:20px;height:12px;background:#f7f7f7;margin-right:5px;"></div> <span>0</span>
            </div>
            <div style="display:flex;align-items:center;margin-bottom:2px;">
                <div style="width:20px;height:12px;background:#fff7bc;margin-right:5px;"></div> <span>1–5</span>
            </div>
            <div style="display:flex;align-items:center;margin-bottom:2px;">
                <div style="width:20px;height:12px;background:#fee391;margin-right:5px;"></div> <span>6–10</span>
            </div>
            <div style="display:flex;align-items:center;margin-bottom:2px;">
                <div style="width:20px;height:12px;background:#fec44f;margin-right:5px;"></div> <span>11–20</span>
            </div>
            <div style="display:flex;align-items:center;margin-bottom:2px;">
                <div style="width:20px;height:12px;background:#a1d99b;margin-right:5px;"></div> <span>21–30</span>
            </div>
            <div style="display:flex;align-items:center;margin-bottom:2px;">
                <div style="width:20px;height:12px;background:#31a354;margin-right:5px;"></div> <span>31–37</span>
            </div>
            <div style="display:flex;align-items:center;">
                <div style="width:20px;height:12px;background:#006d2c;margin-right:5px;"></div> <span>>37</span>
            </div>
        `;
        document.getElementById('map').appendChild(legend);

    });
});

// Выпадающее меню УГС
const dropdown = document.getElementById("ugs-dropdown");
const dropdownBtn = document.getElementById("ugs-dropdown-btn");

dropdownBtn.addEventListener("click", () => {
    dropdown.classList.toggle("show");
});

// Закрывать меню при клике вне его
document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target)) {
        dropdown.classList.remove("show");
    }
});

