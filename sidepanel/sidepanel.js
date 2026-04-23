const STA_URL = 'https://api2.kme.si/v2/sta-articles?limit=25&page=1&query=&section=0';
const STA_REFRESH_MS = 30000;

const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const staStatus = document.getElementById('staStatus');
const staList = document.getElementById('staList');
const staSearchInput = document.getElementById('staSearchInput');

let activeTab = 'sta';
let staRefreshTimer = null;
let staLoading = false;
let staArticles = [];
let staSearchTerm = '';

const dateFormatter = new Intl.DateTimeFormat('sl-SI', {
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit'
});

function switchTab(tabName) {
	activeTab = tabName;

	tabButtons.forEach((button) => {
		const isActive = button.dataset.tab === tabName;
		button.classList.toggle('active', isActive);
		button.setAttribute('aria-selected', String(isActive));
	});

	tabPanels.forEach((panel) => {
		const isActive = panel.id === `tab-${tabName}`;
		panel.classList.toggle('active', isActive);
		panel.hidden = !isActive;
	});
}

function normalizeArticles(payload) {
	if (Array.isArray(payload)) {
		return payload;
	}

	if (!payload || typeof payload !== 'object') {
		return [];
	}

	const candidates = [
		payload.data,
		payload.items,
		payload.payload,
		payload.results,
		payload.articles
	];

	for (const candidate of candidates) {
		if (Array.isArray(candidate)) {
			return candidate;
		}
	}

	return [];
}

function pickField(item, fieldName) {
	if (!item || typeof item !== 'object') {
		return '';
	}

	if (item[fieldName] != null) {
		return item[fieldName];
	}

	if (item.source && item.source[fieldName] != null) {
		return item.source[fieldName];
	}

	if (item._source && item._source[fieldName] != null) {
		return item._source[fieldName];
	}

	return '';
}

function formatTags(tags) {
	if (Array.isArray(tags)) {
		return tags
			.map((tag) => {
				if (typeof tag === 'string') {
					return tag;
				}

				if (tag && typeof tag === 'object') {
					return tag.name || tag.title || tag.label || '';
				}

				return '';
			})
			.filter(Boolean)
			.join(', ');
	}

	if (typeof tags === 'string') {
		return tags;
	}

	return '';
}

function formatDate(value) {
	if (!value) {
		return 'Ni podatka';
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return String(value);
	}

	return dateFormatter.format(date);
}

function renderValue(value) {
	if (value == null || value === '') {
		return 'Ni podatka';
	}

	return String(value);
}

function createMetaRow(label, value) {
	const row = document.createElement('div');
	row.className = 'meta-row';

	const labelElement = document.createElement('div');
	labelElement.className = 'meta-label';
	labelElement.textContent = label;

	const valueElement = document.createElement('div');
	valueElement.className = 'meta-value';
	valueElement.textContent = value;

	row.append(labelElement, valueElement);
	return row;
}

function filterArticles(items, searchTerm) {
	const normalizedSearch = searchTerm.trim().toLowerCase();

	if (!normalizedSearch) {
		return items;
	}

	return items.filter((item) => {
		const fields = [
			pickField(item, 'title'),
			pickField(item, 'subtitle'),
			formatTags(pickField(item, 'tags')),
			pickField(item, 'location'),
			pickField(item, 'created')
		];

		return fields.some((value) =>
			String(value || '').toLowerCase().includes(normalizedSearch)
		);
	});
}

function renderArticles(items) {
	staList.innerHTML = '';

	if (!items.length) {
		staStatus.textContent = staSearchTerm ? 'No matching STA articles found.' : 'Ni zadetkov.';
		staStatus.classList.remove('hidden');
		return;
	}

	staStatus.classList.add('hidden');

	items.forEach((item) => {
		const title = renderValue(pickField(item, 'title'));
		const subtitle = renderValue(pickField(item, 'subtitle'));
		const tags = renderValue(formatTags(pickField(item, 'tags')));
		const location = renderValue(pickField(item, 'location'));
		const created = formatDate(pickField(item, 'created'));

		const article = document.createElement('article');
		article.className = 'article-item';

		const titleElement = document.createElement('h3');
		titleElement.className = 'article-title';
		titleElement.textContent = title;

		const subtitleElement = document.createElement('p');
		subtitleElement.className = 'article-subtitle';
		subtitleElement.textContent = subtitle;

		const metaGrid = document.createElement('div');
		metaGrid.className = 'meta-grid';
		metaGrid.append(
			createMetaRow('Tags', tags),
			createMetaRow('Location', location),
			createMetaRow('Created', created)
		);

		article.append(titleElement, subtitleElement, metaGrid);
		staList.appendChild(article);
	});
}

function updateStaList() {
	renderArticles(filterArticles(staArticles, staSearchTerm));
}

async function loadStaArticles() {
	if (staLoading) {
		return;
	}

	staLoading = true;
	staStatus.textContent = 'Nalagam STA članke...';
	staStatus.classList.remove('hidden');

	try {
		const response = await fetch(STA_URL, { cache: 'no-store' });

		if (!response.ok) {
			throw new Error(`Request failed with ${response.status}`);
		}

		const payload = await response.json();
		staArticles = normalizeArticles(payload);
		updateStaList();
	} catch (error) {
		console.error('Failed to load STA articles:', error);
		staStatus.textContent = 'Napaka pri nalaganju STA člankov.';
		staStatus.classList.remove('hidden');
	} finally {
		staLoading = false;
	}
}

function startStaRefresh() {
	if (staRefreshTimer) {
		clearInterval(staRefreshTimer);
	}

	staRefreshTimer = setInterval(() => {
		if (activeTab === 'sta' && document.visibilityState === 'visible') {
			loadStaArticles();
		}
	}, STA_REFRESH_MS);
}

tabButtons.forEach((button) => {
	button.addEventListener('click', () => {
		const tabName = button.dataset.tab;
		switchTab(tabName);

		if (tabName === 'sta') {
			loadStaArticles();
		}
	});
});

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible' && activeTab === 'sta') {
		loadStaArticles();
	}
});

staSearchInput.addEventListener('input', (event) => {
	staSearchTerm = event.target.value;
	updateStaList();
});

switchTab('sta');
loadStaArticles();
startStaRefresh();
