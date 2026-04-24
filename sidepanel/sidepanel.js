const STA_URL = 'https://api2.kme.si/v2/sta-articles?limit=25&page=1&query=&section=0';
const RESOURCES_URL = 'https://api2.kme.si/v2/resources';
const PUBLISHED_URL = 'https://api.kme.si/v1/articles';
const STA_REFRESH_MS = 30000;
const SIDEBAR_STATE_KEY = 'articleOverviewSidebarState';
const PUBLISHED_RESOURCE_IDS = [
	106, 110, 33, 60, 47, 41,
	109, 100, 67, 120, 107,
	71, 11, 22, 118, 89
];

const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const staStatus = document.getElementById('staStatus');
const staList = document.getElementById('staList');
const staSearchInput = document.getElementById('staSearchInput');
const publishedStatus = document.getElementById('publishedStatus');
const publishedList = document.getElementById('publishedList');
const publishedSearchInput = document.getElementById('publishedSearchInput');
const publishedFilters = document.getElementById('publishedFilters');

let activeTab = 'sta';
let refreshTimer = null;
let staLoading = false;
let staArticles = [];
let staSearchTerm = '';
let publishedLoading = false;
let publishedArticles = [];
let publishedSearchTerm = '';
let publishedResourceFilters = [];
let resourceNameMap = new Map();

const defaultSidebarState = {
	activeTab: 'sta',
	staSearchTerm: '',
	publishedSearchTerm: '',
	publishedResourceFilters: []
};

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

async function loadSidebarState() {
	const result = await chrome.storage.local.get(SIDEBAR_STATE_KEY);
	return {
		...defaultSidebarState,
		...(result[SIDEBAR_STATE_KEY] || {})
	};
}

async function saveSidebarState(partialState) {
	const currentState = await loadSidebarState();
	const nextState = {
		...currentState,
		...partialState
	};

	await chrome.storage.local.set({ [SIDEBAR_STATE_KEY]: nextState });
	return nextState;
}

function applySidebarState(state) {
	activeTab = state.activeTab;
	staSearchTerm = state.staSearchTerm;
	publishedSearchTerm = state.publishedSearchTerm;
	publishedResourceFilters = normalizePublishedResourceFilters(
		state.publishedResourceFilters ?? state.publishedResourceFilter
	);

	staSearchInput.value = staSearchTerm;
	publishedSearchInput.value = publishedSearchTerm;
	switchTab(activeTab);
	updateStaList();
	updatePublishedList();
}

function normalizePublishedResourceFilters(value) {
	if (Array.isArray(value)) {
		return value
			.map((filterValue) => String(filterValue || '').trim())
			.filter((filterValue) => filterValue && filterValue !== 'all');
	}

	const normalizedValue = String(value || '').trim();

	if (!normalizedValue || normalizedValue === 'all') {
		return [];
	}

	return [normalizedValue];
}

function normalizeArticles(payload) {
	if (Array.isArray(payload)) {
		return payload;
	}

	if (!payload || typeof payload !== 'object') {
		return [];
	}

	if (payload.data && Array.isArray(payload.data.list)) {
		return payload.data.list;
	}

	const candidates = [
		payload.data,
		payload.list,
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
		return '/';
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return String(value);
	}

	return dateFormatter.format(date);
}

function renderValue(value) {
	if (value == null || value === '') {
		return '/';
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

function createMetaLinkRow(label, text, href) {
	const row = document.createElement('div');
	row.className = 'meta-row';

	const labelElement = document.createElement('div');
	labelElement.className = 'meta-label';
	labelElement.textContent = label;

	const valueElement = document.createElement('div');
	valueElement.className = 'meta-value';

	if (href) {
		const link = document.createElement('a');
		link.className = 'meta-link';
		link.href = href;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.textContent = text;
		valueElement.appendChild(link);
	} else {
		valueElement.textContent = '/';
	}

	row.append(labelElement, valueElement);
	return row;
}

function getPublishedAuthor(item) {
	return pickField(item, 'author') || pickField(item, 'real_author') || '';
}

function getResourceName(resourceId) {
	if (resourceId == null || resourceId === '') {
		return 'Ni podatka';
	}

	return resourceNameMap.get(String(resourceId)) || `Resource ${resourceId}`;
}

function getPublishedArticleUrl(item) {
	const resourceId = String(pickField(item, 'resource_id') || '');
	const fullUrl = pickField(item, 'full_url');
	const articleId = pickField(item, 'id');

	if (resourceId === '107') {
		return '';
	}

	if ((resourceId === '33' || resourceId === '100' || resourceId === '71') && fullUrl) {
		return String(fullUrl);
	}

	if (!articleId) {
		return '';
	}

	return `https://svet24.si/clanki/test-${articleId}`;
}

function getPublishedFilterOptions() {
	return [
		{ id: 'all', name: 'All' },
		...PUBLISHED_RESOURCE_IDS.map((resourceId) => ({
			id: String(resourceId),
			name: getResourceName(resourceId)
		}))
	];
}

function renderPublishedFilters() {
	publishedFilters.innerHTML = '';

	getPublishedFilterOptions().forEach((filterOption) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'published-filter-button';
		button.dataset.resourceId = filterOption.id;
		button.textContent = filterOption.name;
		const isAllButton = filterOption.id === 'all';
		const isActive = isAllButton
			? publishedResourceFilters.length === 0
			: publishedResourceFilters.includes(filterOption.id);
		button.classList.toggle('active', isActive);
		button.setAttribute('aria-pressed', String(isActive));

		button.addEventListener('click', () => {
			if (isAllButton) {
				publishedResourceFilters = [];
			} else if (publishedResourceFilters.includes(filterOption.id)) {
				publishedResourceFilters = publishedResourceFilters.filter(
					(resourceId) => resourceId !== filterOption.id
				);
			} else {
				publishedResourceFilters = [...publishedResourceFilters, filterOption.id];
			}

			void saveSidebarState({ publishedResourceFilters });
			renderPublishedFilters();
			updatePublishedList();
		});

		publishedFilters.appendChild(button);
	});
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

function filterPublishedArticles(items, searchTerm) {
	const normalizedSearch = searchTerm.trim().toLowerCase();

	return items.filter((item) => {
		const resourceId = String(pickField(item, 'resource_id') || '');
		const matchesEditorial =
			publishedResourceFilters.length === 0 || publishedResourceFilters.includes(resourceId);

		if (!matchesEditorial) {
			return false;
		}

		if (!normalizedSearch) {
			return true;
		}

		const publishedFrom = pickField(item, 'published_from');
		const fields = [
			pickField(item, 'title'),
			getResourceName(resourceId),
			getPublishedAuthor(item),
			publishedFrom,
			formatDate(publishedFrom)
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

function renderPublishedArticles(items) {
	publishedList.innerHTML = '';

	if (!items.length) {
		publishedStatus.textContent = publishedSearchTerm ? 'No matching published articles found.' : 'Ni zadetkov.';
		publishedStatus.classList.remove('hidden');
		return;
	}

	publishedStatus.classList.add('hidden');

	items.forEach((item) => {
		const title = renderValue(pickField(item, 'title'));
		const resourceName = renderValue(getResourceName(pickField(item, 'resource_id')));
		const author = renderValue(getPublishedAuthor(item));
		const publishedFrom = formatDate(pickField(item, 'published_from'));
		const articleUrl = getPublishedArticleUrl(item);

		const article = document.createElement('article');
		article.className = 'article-item';

		const titleElement = document.createElement('h3');
		titleElement.className = 'article-title';
		titleElement.textContent = title;

		const metaGrid = document.createElement('div');
		metaGrid.className = 'meta-grid';
		metaGrid.append(
			createMetaRow('Editorail', resourceName),
			createMetaRow('Author', author),
			createMetaRow('Published', publishedFrom),
			createMetaLinkRow('View article', 'Link', articleUrl)
		);

		article.append(titleElement, metaGrid);
		publishedList.appendChild(article);
	});
}

function updateStaList() {
	renderArticles(filterArticles(staArticles, staSearchTerm));
}

function updatePublishedList() {
	renderPublishedFilters();
	renderPublishedArticles(filterPublishedArticles(publishedArticles, publishedSearchTerm));
}

async function loadResourceNameMap() {
	if (resourceNameMap.size > 0) {
		return;
	}

	const response = await fetch(RESOURCES_URL, { cache: 'no-store' });

	if (!response.ok) {
		throw new Error(`Resources request failed with ${response.status}`);
	}

	const payload = await response.json();
	const resources = Array.isArray(payload?.data) ? payload.data : [];

	resourceNameMap = new Map(
		resources
			.filter((resource) => resource && resource.id != null)
			.map((resource) => [String(resource.id), resource.name || `Resource ${resource.id}`])
	);
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

async function loadPublishedArticles() {
	if (publishedLoading) {
		return;
	}

	publishedLoading = true;
	publishedStatus.textContent = 'Nalagam objavljene članke...';
	publishedStatus.classList.remove('hidden');

	try {
		await loadResourceNameMap();
		renderPublishedFilters();

		const responses = await Promise.allSettled(
			PUBLISHED_RESOURCE_IDS.map((resourceId) =>
				fetch(`${PUBLISHED_URL}?resource_id=${resourceId}&limit=25&page=1`, { cache: 'no-store' })
			)
		);

		const successfulResponses = responses.filter((result) => result.status === 'fulfilled');

		if (!successfulResponses.length) {
			throw new Error('No published article requests succeeded.');
		}

		const payloads = await Promise.all(
			successfulResponses.map(async (result) => {
				if (!result.value.ok) {
					throw new Error(`Published request failed with ${result.value.status}`);
				}

				return result.value.json();
			})
		);

		publishedArticles = payloads
			.flatMap((payload) => normalizeArticles(payload))
			.sort((left, right) => {
				const leftDate = new Date(pickField(left, 'published_from')).getTime();
				const rightDate = new Date(pickField(right, 'published_from')).getTime();

				return (Number.isNaN(rightDate) ? 0 : rightDate) - (Number.isNaN(leftDate) ? 0 : leftDate);
			});

		updatePublishedList();
	} catch (error) {
		console.error('Failed to load published articles:', error);
		publishedStatus.textContent = 'Napaka pri nalaganju objavljenih člankov.';
		publishedStatus.classList.remove('hidden');
	} finally {
		publishedLoading = false;
	}
}

function loadActiveTabArticles() {
	if (activeTab === 'sta') {
		loadStaArticles();
		return;
	}

	if (activeTab === 'objavljeni') {
		loadPublishedArticles();
	}
}

function startAutoRefresh() {
	if (refreshTimer) {
		clearInterval(refreshTimer);
	}

	refreshTimer = setInterval(() => {
		if (document.visibilityState === 'visible') {
			loadActiveTabArticles();
		}
	}, STA_REFRESH_MS);
}

tabButtons.forEach((button) => {
	button.addEventListener('click', () => {
		const tabName = button.dataset.tab;
		switchTab(tabName);
		void saveSidebarState({ activeTab });
		loadActiveTabArticles();
	});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'local' || !changes[SIDEBAR_STATE_KEY]) {
		return;
	}

	const nextState = {
		...defaultSidebarState,
		...(changes[SIDEBAR_STATE_KEY].newValue || {})
	};

	applySidebarState(nextState);
	loadActiveTabArticles();
});

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') {
		loadActiveTabArticles();
	}
});

staSearchInput.addEventListener('input', (event) => {
	staSearchTerm = event.target.value;
	void saveSidebarState({ staSearchTerm });
	updateStaList();
});

publishedSearchInput.addEventListener('input', (event) => {
	publishedSearchTerm = event.target.value;
	void saveSidebarState({ publishedSearchTerm });
	updatePublishedList();
});

async function initializeSidebar() {
	const savedState = await loadSidebarState();
	applySidebarState(savedState);
	loadActiveTabArticles();
	startAutoRefresh();
}

initializeSidebar().catch((error) => {
	console.error('Failed to initialize sidebar state:', error);
	switchTab(defaultSidebarState.activeTab);
	loadStaArticles();
	startAutoRefresh();
});
