const STA_URL = 'https://api2.kme.si/v2/sta-articles?limit=25&page=1&query=&section=0';
const RESOURCES_URL = 'https://api2.kme.si/v2/resources';
const PUBLISHED_URL = 'https://api.kme.si/v1/articles';
const READY_TO_PUBLISH_BASE_URL = 'https://api.kme.si/backend/v1/articles';
const STA_REFRESH_MS = 30000;
const SIDEBAR_STATE_KEY = 'articleOverviewSidebarState';
const SIDEPANEL_AUTH_CONTEXT_KEY = 'sidepanelAuthContext';
const OVERVIEW_SOURCE_FILTERS_STATE_VERSION = 2;
const PUBLISHED_RESOURCE_IDS = [
	106, 110, 33, 60, 47, 41,
	109, 100, 67, 120, 107,
	71, 11, 22, 118, 89
];

const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const tabsContainer = document.querySelector('.tabs');
const overviewCard = document.querySelector('.overview-card');
const unauthenticatedStatus = document.getElementById('unauthenticatedStatus');
const overviewStatus = document.getElementById('overviewStatus');
const overviewList = document.getElementById('overviewList');
const overviewSearchInput = document.getElementById('overviewSearchInput');
const overviewSourceFiltersContainer = document.getElementById('overviewSourceFilters');
const publishedEditorialFiltersBlock = document.getElementById('publishedEditorialFiltersBlock');
const publishedFilters = document.getElementById('publishedFilters');
const readyToPublishFilters = document.getElementById('readyToPublishFilters');
const readyToPublishStatus = document.getElementById('readyToPublishStatus');
const readyToPublishList = document.getElementById('readyToPublishList');
const readyToPublishSearchInput = document.getElementById('readyToPublishSearchInput');

let activeTab = 'overview';
let refreshTimer = null;
let staLoading = false;
let staArticles = [];
let publishedLoading = false;
let publishedArticles = [];
let overviewSearchTerm = '';
let overviewSourceFilters = ['sta', 'sta-used', 'published'];
let publishedResourceFilters = [];
let readyToPublishLoading = false;
let readyToPublishArticles = [];
let readyToPublishSearchTerm = '';
let readyToPublishResourceFilters = [];
let resourceNameMap = new Map();
let sidebarStateCache = null;
let publishedArticleToEditorialNameMap = new Map();
let publishedArticleIdsUsedBySta = new Set();
const readyToPublishTimestampCache = new WeakMap();

const SEARCH_STATE_SAVE_DEBOUNCE_MS = 250;

const defaultSidebarState = {
	activeTab: 'overview',
	overviewSearchTerm: '',
	overviewSourceFilters: ['sta', 'sta-used', 'published'],
	overviewSourceFiltersVersion: OVERVIEW_SOURCE_FILTERS_STATE_VERSION,
	publishedResourceFilters: [],
	readyToPublishResourceFilters: [],
	readyToPublishSearchTerm: ''
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
	sidebarStateCache = {
		...defaultSidebarState,
		...(result[SIDEBAR_STATE_KEY] || {})
	};

	return sidebarStateCache;
}

async function saveSidebarState(partialState) {
	const currentState = sidebarStateCache || await loadSidebarState();
	const nextState = {
		...currentState,
		...partialState
	};

	sidebarStateCache = nextState;
	await chrome.storage.local.set({ [SIDEBAR_STATE_KEY]: nextState });
	return nextState;
}

function createDebounced(fn, delayMs) {
	let timerId = null;

	return (...args) => {
		if (timerId != null) {
			clearTimeout(timerId);
		}

		timerId = setTimeout(() => {
			timerId = null;
			fn(...args);
		}, delayMs);
	};
}

function applySidebarState(state) {
	activeTab = (state.activeTab === 'nacrtovani') ? 'nacrtovani' : 'overview';
	overviewSearchTerm = state.overviewSearchTerm || state.publishedSearchTerm || state.staSearchTerm || '';
	overviewSourceFilters = normalizeSourceFilters(state.overviewSourceFilters);
	const sourceFilterStateVersion = Number(state.overviewSourceFiltersVersion || 1);
	if (sourceFilterStateVersion < OVERVIEW_SOURCE_FILTERS_STATE_VERSION) {
		if (overviewSourceFilters.includes('sta') && !overviewSourceFilters.includes('sta-used')) {
			overviewSourceFilters = [...overviewSourceFilters, 'sta-used'];
		}
	}
	publishedResourceFilters = normalizeResourceFilters(
		state.publishedResourceFilters ?? state.publishedResourceFilter
	);
	readyToPublishResourceFilters = normalizeResourceFilters(
		state.readyToPublishResourceFilters ?? state.readyToPublishResourceFilter
	);
	const synchronizedEditorialFilters = Array.from(
		new Set([...publishedResourceFilters, ...readyToPublishResourceFilters])
	);
	publishedResourceFilters = synchronizedEditorialFilters;
	readyToPublishResourceFilters = [...synchronizedEditorialFilters];
	readyToPublishSearchTerm = state.readyToPublishSearchTerm || '';

	overviewSearchInput.value = overviewSearchTerm;
	if (readyToPublishSearchInput) {
		readyToPublishSearchInput.value = readyToPublishSearchTerm;
	}
	switchTab(activeTab);
	updateOverviewList();
	updateReadyToPublishList();
}

function normalizeSourceFilters(value) {
	if (!Array.isArray(value) || !value.length) {
		return ['sta', 'sta-used', 'published'];
	}

	const allowed = new Set(['sta', 'sta-used', 'published']);
	const normalized = value
		.map((filterValue) => String(filterValue || '').trim().toLowerCase())
		.filter((filterValue) => allowed.has(filterValue));

	return normalized.length ? Array.from(new Set(normalized)) : ['sta', 'sta-used', 'published'];
}

function normalizeResourceFilters(value) {
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

function getSynchronizedEditorialFilters(nextFilters) {
	return Array.from(
		new Set(
			(nextFilters || [])
				.map((filterValue) => String(filterValue || '').trim())
				.filter((filterValue) => filterValue && filterValue !== 'all')
		)
	);
}

async function setSharedEditorialFilters(nextFilters) {
	const synchronizedFilters = getSynchronizedEditorialFilters(nextFilters);
	publishedResourceFilters = synchronizedFilters;
	readyToPublishResourceFilters = [...synchronizedFilters];

	await saveSidebarState({
		publishedResourceFilters: synchronizedFilters,
		readyToPublishResourceFilters: synchronizedFilters
	});

	updateOverviewList();
	updateReadyToPublishList();
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

function getEditorialFilterOptions() {
	return [
		{ id: 'all', name: 'All' },
		...PUBLISHED_RESOURCE_IDS.map((resourceId) => ({
			id: String(resourceId),
			name: getResourceName(resourceId)
		}))
	];
}

function toggleResourceFilter(activeFilters, filterOptionId) {
	const isAllButton = filterOptionId === 'all';

	if (isAllButton) {
		return [];
	}

	if (activeFilters.includes(filterOptionId)) {
		return activeFilters.filter((resourceId) => resourceId !== filterOptionId);
	}

	return [...activeFilters, filterOptionId];
}

function renderEditorialFilters(container, activeFilters) {
	if (!container) {
		return;
	}

	container.innerHTML = '';

	getEditorialFilterOptions().forEach((filterOption) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'published-filter-button';
		button.dataset.resourceId = filterOption.id;
		button.textContent = filterOption.name;

		const isAllButton = filterOption.id === 'all';
		const isActive = isAllButton
			? activeFilters.length === 0
			: activeFilters.includes(filterOption.id);

		button.classList.toggle('active', isActive);
		button.setAttribute('aria-pressed', String(isActive));

		button.addEventListener('click', () => {
			const nextFilters = toggleResourceFilter(activeFilters, filterOption.id);
			void setSharedEditorialFilters(nextFilters);
		});

		container.appendChild(button);
	});
}

function renderPublishedFilters() {
	renderEditorialFilters(publishedFilters, publishedResourceFilters);
}

function getOverviewSourceFilterOptions() {
	return [
		{ id: 'sta', name: 'STA' },
		{ id: 'sta-used', name: 'STA (USED)' },
		{ id: 'published', name: 'Published' }
	];
}

function renderOverviewSourceFilters() {
	if (!overviewSourceFiltersContainer) {
		return;
	}

	overviewSourceFiltersContainer.innerHTML = '';

	getOverviewSourceFilterOptions().forEach((filterOption) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'source-filter-button';
		button.dataset.sourceType = filterOption.id;
		button.textContent = filterOption.name;

		const isActive = overviewSourceFilters.includes(filterOption.id);
		button.classList.toggle('active', isActive);
		button.setAttribute('aria-pressed', String(isActive));

		button.addEventListener('click', () => {
			const isCurrentlyActive = overviewSourceFilters.includes(filterOption.id);

			if (isCurrentlyActive && overviewSourceFilters.length === 1) {
				return;
			}

			if (overviewSourceFilters.includes(filterOption.id)) {
				overviewSourceFilters = overviewSourceFilters.filter((value) => value !== filterOption.id);
			} else {
				overviewSourceFilters = [...overviewSourceFilters, filterOption.id];
			}

			void saveSidebarState({
				overviewSourceFilters,
				overviewSourceFiltersVersion: OVERVIEW_SOURCE_FILTERS_STATE_VERSION
			});
			renderOverviewSourceFilters();
			updateOverviewList();
		});

		overviewSourceFiltersContainer.appendChild(button);
	});
}

function syncPublishedEditorialFiltersVisibility() {
	if (!publishedEditorialFiltersBlock) {
		return;
	}

	const shouldShow = overviewSourceFilters.includes('published');
	publishedEditorialFiltersBlock.classList.toggle('hidden', !shouldShow);
}

function renderReadyToPublishFilters() {
	renderEditorialFilters(readyToPublishFilters, readyToPublishResourceFilters);
}

function getOverviewTimestampMs(entry) {
	const rawValue = entry.source === 'sta'
		? pickField(entry.item, 'created')
		: pickField(entry.item, 'published_from');
	const parsed = new Date(rawValue).getTime();
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function getOverviewItems() {
	const staEntries = staArticles.map((item) => ({ source: 'sta', item }));
	const publishedEntries = publishedArticles.map((item) => ({ source: 'published', item }));

	return [...staEntries, ...publishedEntries].sort(
		(left, right) => getOverviewTimestampMs(right) - getOverviewTimestampMs(left)
	);
}

function matchesOverviewSearch(entry, normalizedSearch) {
	if (!normalizedSearch) {
		return true;
	}

	if (entry.source === 'sta') {
		const fields = [
			pickField(entry.item, 'title'),
			pickField(entry.item, 'subtitle'),
			formatTags(pickField(entry.item, 'tags')),
			pickField(entry.item, 'location'),
			pickField(entry.item, 'created')
		];

		return fields.some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
	}

	const resourceId = String(pickField(entry.item, 'resource_id') || '');
	const publishedFrom = pickField(entry.item, 'published_from');
	const fields = [
		pickField(entry.item, 'title'),
		getResourceName(resourceId),
		getPublishedAuthor(entry.item),
		publishedFrom,
		formatDate(publishedFrom)
	];

	return fields.some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
}

function filterOverviewItems(items, searchTerm) {
	const normalizedSearch = searchTerm.trim().toLowerCase();

	return items.filter((entry) => {
		if (entry.source === 'sta') {
			const isUsed = hasStaUsedFor(entry.item);
			const matchesStaUnused = overviewSourceFilters.includes('sta') && !isUsed;
			const matchesStaUsed = overviewSourceFilters.includes('sta-used') && isUsed;

			if (!matchesStaUnused && !matchesStaUsed) {
				return false;
			}
		} else if (!overviewSourceFilters.includes(entry.source)) {
			return false;
		}

		if (entry.source === 'published') {
			const resourceId = String(pickField(entry.item, 'resource_id') || '');
			const matchesEditorial =
				publishedResourceFilters.length === 0 || publishedResourceFilters.includes(resourceId);

			if (!matchesEditorial) {
				return false;
			}
		}

		return matchesOverviewSearch(entry, normalizedSearch);
	});
}

function hasStaUsedFor(item) {
	const usedFor = pickField(item, 'used_for');

	if (usedFor == null) {
		return false;
	}

	if (Array.isArray(usedFor)) {
		return usedFor.length > 0;
	}

	const normalized = String(usedFor).trim().toLowerCase();
	return normalized !== '' && normalized !== 'null';
}

function getStaUsedForIds(item) {
	const usedFor = pickField(item, 'used_for');

	if (usedFor == null) {
		return [];
	}

	const rawValues = Array.isArray(usedFor) ? usedFor : [usedFor];

	return Array.from(
		new Set(
			rawValues
				.flatMap((value) => {
					if (value == null) {
						return [];
					}

					if (typeof value === 'object') {
						const candidate = value.id ?? value.article_id ?? value.value;
						return candidate == null ? [] : [candidate];
					}

					return String(value).split(',');
				})
				.map((value) => String(value || '').trim())
				.filter((value) => value && value.toLowerCase() !== 'null')
		)
	);
}

function getStaUsedEditorialName(item) {
	const usedIds = getStaUsedForIds(item);

	if (!usedIds.length) {
		return '';
	}

	for (const usedId of usedIds) {
		const editorialName = publishedArticleToEditorialNameMap.get(usedId);
		if (editorialName) {
			return editorialName;
		}
	}

	return '';
}

function rebuildPublishedIdsUsedByStaSet() {
	publishedArticleIdsUsedBySta = new Set(
		staArticles
			.flatMap((staItem) => getStaUsedForIds(staItem))
			.map((value) => String(value || '').trim())
			.filter(Boolean)
	);
}

function isPublishedArticleUsedBySta(item) {
	const publishedId = String(pickField(item, 'id') || '').trim();
	return publishedId !== '' && publishedArticleIdsUsedBySta.has(publishedId);
}

function createSourceTag(sourceType, item) {
	const tag = document.createElement('span');
	tag.className = `source-tag source-tag--${sourceType}`;

	if (sourceType === 'sta') {
		const usedEditorialName = getStaUsedEditorialName(item);

		if (usedEditorialName) {
			tag.innerHTML = `STA <span class="source-tag-used">(Uporabljeno: ${usedEditorialName})</span>`;
		} else if (hasStaUsedFor(item)) {
			tag.innerHTML = 'STA <span class="source-tag-used">(Uporabljeno)</span>';
		} else {
			tag.textContent = 'STA';
		}
	} else {
		if (isPublishedArticleUsedBySta(item)) {
			tag.innerHTML = 'Published <span class="source-tag-used">(STA)</span>';
		} else {
			tag.textContent = 'Published';
		}
	}

	return tag;
}

function renderOverviewArticles(items) {
	overviewList.innerHTML = '';

	if (!items.length) {
		overviewStatus.textContent = overviewSearchTerm
			? 'No matching overview articles found.'
			: 'Ni zadetkov.';
		overviewStatus.classList.remove('hidden');
		return;
	}

	overviewStatus.classList.add('hidden');
	const fragment = document.createDocumentFragment();

	items.forEach((entry) => {
		const article = document.createElement('article');
		article.className = `article-item article-item--${entry.source}`;

		const titleElement = document.createElement('h3');
		titleElement.className = 'article-title';
		titleElement.textContent = renderValue(pickField(entry.item, 'title'));

		article.append(createSourceTag(entry.source, entry.item), titleElement);

		if (entry.source === 'sta') {
			const subtitle = pickField(entry.item, 'subtitle');
			if (subtitle) {
				const subtitleElement = document.createElement('p');
				subtitleElement.className = 'article-subtitle';
				subtitleElement.textContent = String(subtitle);
				article.appendChild(subtitleElement);
			}

			const metaGrid = document.createElement('div');
			metaGrid.className = 'meta-grid';
			metaGrid.append(
				createMetaRow('Tags', renderValue(formatTags(pickField(entry.item, 'tags')))),
				createMetaRow('Location', renderValue(pickField(entry.item, 'location'))),
				createMetaRow('Created', formatDate(pickField(entry.item, 'created')))
			);
			article.appendChild(metaGrid);
		} else {
			const resourceName = renderValue(getResourceName(pickField(entry.item, 'resource_id')));
			const author = renderValue(getPublishedAuthor(entry.item));
			const publishedFrom = formatDate(pickField(entry.item, 'published_from'));
			const articleUrl = getPublishedArticleUrl(entry.item);

			const metaGrid = document.createElement('div');
			metaGrid.className = 'meta-grid';
			metaGrid.append(
				createMetaRow('Editorial', resourceName),
				createMetaRow('Author', author),
				createMetaRow('Published', publishedFrom),
				createMetaLinkRow('Article', 'View ->', articleUrl)
			);
			article.appendChild(metaGrid);
		}

		fragment.appendChild(article);
	});

	overviewList.appendChild(fragment);
}

function getReadyToPublishTimestamp(item) {
	return pickField(item, 'published_from') || '';
}

function getReadyToPublishTimestampMs(item) {
	if (readyToPublishTimestampCache.has(item)) {
		return readyToPublishTimestampCache.get(item);
	}

	const timestamp = String(getReadyToPublishTimestamp(item) || '').trim();
	if (!timestamp) {
		readyToPublishTimestampCache.set(item, null);
		return null;
	}

	const parsedTimestamp = new Date(timestamp).getTime();
	const normalizedTimestamp = Number.isNaN(parsedTimestamp) ? null : parsedTimestamp;
	readyToPublishTimestampCache.set(item, normalizedTimestamp);
	return normalizedTimestamp;
}

function getReadyToPublishResourceIds(item) {
	const rawIds = Array.isArray(item?.resource_ids)
		? item.resource_ids
		: [pickField(item, 'resource_id')];

	return Array.from(
		new Set(
			rawIds
				.map((id) => String(id || '').trim())
				.filter(Boolean)
		)
	);
}

function getReadyToPublishEditorialNames(item) {
	const names = getReadyToPublishResourceIds(item).map((id) => getResourceName(id));
	return names.length ? names.join(', ') : 'Ni podatka';
}

function getReadyToPublishDedupKey(item) {
	const id = String(pickField(item, 'id') || '').trim();
	if (id) {
		return `id:${id}`;
	}

	const title = String(pickField(item, 'title') || '').trim().toLowerCase();
	const subtitle = String(pickField(item, 'subtitle') || '').trim().toLowerCase();
	const timestamp = String(getReadyToPublishTimestamp(item) || '').trim();
	return `fallback:${title}|${subtitle}|${timestamp}`;
}

function filterReadyToPublishArticles(items, searchTerm) {
	const normalizedSearch = searchTerm.trim().toLowerCase();

	return items.filter((item) => {
		const resourceIds = getReadyToPublishResourceIds(item);
		const matchesEditorial =
			readyToPublishResourceFilters.length === 0 ||
			resourceIds.some((id) => readyToPublishResourceFilters.includes(id));

		if (!matchesEditorial) {
			return false;
		}

		if (!normalizedSearch) {
			return true;
		}

		const publishedFrom = getReadyToPublishTimestamp(item);
		const editorialNames = getReadyToPublishEditorialNames(item);
		const fields = [
			pickField(item, 'title'),
			pickField(item, 'subtitle'),
			getPublishedAuthor(item),
			resourceIds.join(', '),
			editorialNames,
			publishedFrom,
			formatDate(publishedFrom)
		];

		return fields.some((value) =>
			String(value || '').toLowerCase().includes(normalizedSearch)
		);
	});
}

function renderReadyToPublishArticles(items) {
	readyToPublishList.innerHTML = '';

	if (!items.length) {
		readyToPublishStatus.textContent = readyToPublishSearchTerm
			? 'No matching ready-to-publish articles found.'
			: 'Ni zadetkov.';
		readyToPublishStatus.classList.remove('hidden');
		return;
	}

	readyToPublishStatus.classList.add('hidden');
	const fragment = document.createDocumentFragment();

	items.forEach((item) => {
		const title = renderValue(pickField(item, 'title'));
		const resourceName = renderValue(getReadyToPublishEditorialNames(item));
		const author = renderValue(getPublishedAuthor(item));
		const publishedFrom = formatDate(getReadyToPublishTimestamp(item));

		const article = document.createElement('article');
		article.className = 'article-item';

		const titleElement = document.createElement('h3');
		titleElement.className = 'article-title';
		titleElement.textContent = title;

		const subtitleValue = pickField(item, 'subtitle');
		if (subtitleValue) {
			const subtitleElement = document.createElement('p');
			subtitleElement.className = 'article-subtitle';
			subtitleElement.textContent = String(subtitleValue);
			article.appendChild(subtitleElement);
		}

		const metaGrid = document.createElement('div');
		metaGrid.className = 'meta-grid';
		metaGrid.append(
			createMetaRow('Editorial', resourceName),
			createMetaRow('Author', author),
			createMetaRow('Publish from', publishedFrom)
		);

		article.prepend(titleElement);
		article.append(metaGrid);
		fragment.appendChild(article);
	});

	readyToPublishList.appendChild(fragment);
}


function updateOverviewList() {
	syncPublishedEditorialFiltersVisibility();
	renderOverviewSourceFilters();
	renderPublishedFilters();
	renderOverviewArticles(filterOverviewItems(getOverviewItems(), overviewSearchTerm));
}

function updateReadyToPublishList() {
	renderReadyToPublishFilters();
	renderReadyToPublishArticles(
		filterReadyToPublishArticles(readyToPublishArticles, readyToPublishSearchTerm)
	);
}

function buildReadyToPublishUrl(resourceId, publishedFrom, publishedTill) {

	const params = new URLSearchParams({
		resource_id: String(resourceId),
		hide_unactive: '0',
		limit: '25',
		page: '1',
		order: 'asc',
		published_from: String(publishedFrom),
		published_till: String(publishedTill)
	});

	return `${READY_TO_PUBLISH_BASE_URL}?${params.toString()}`;
}

async function getSidepanelAuthContext() {
	const result = await chrome.storage.local.get(SIDEPANEL_AUTH_CONTEXT_KEY);
	return result[SIDEPANEL_AUTH_CONTEXT_KEY] || null;
}

async function setSidepanelAuthContext(context) {
	await chrome.storage.local.set({ [SIDEPANEL_AUTH_CONTEXT_KEY]: context });
}

async function clearSidepanelAuthContext() {
	await chrome.storage.local.remove(SIDEPANEL_AUTH_CONTEXT_KEY);
}

function rebuildPublishedArticleLookupMap() {
	publishedArticleToEditorialNameMap = new Map(
		publishedArticles
			.map((publishedItem) => {
				const publishedId = String(pickField(publishedItem, 'id') || '').trim();
				if (!publishedId) {
					return null;
				}

				return [publishedId, getResourceName(pickField(publishedItem, 'resource_id'))];
			})
			.filter(Boolean)
	);
}

function clearReadyToPublishData() {
	readyToPublishArticles = [];
	updateReadyToPublishList();
}

function clearStaData() {
	staArticles = [];
	publishedArticleIdsUsedBySta = new Set();
	updateOverviewList();
}

function clearPublishedData() {
	publishedArticles = [];
	publishedArticleToEditorialNameMap = new Map();
	updateOverviewList();
}

function showUnauthenticatedView(message) {
	if (tabsContainer) {
		tabsContainer.classList.add('hidden');
	}

	if (overviewCard) {
		overviewCard.classList.add('hidden');
	}

	if (unauthenticatedStatus) {
		unauthenticatedStatus.textContent = message;
		unauthenticatedStatus.classList.remove('hidden');
	}
}

function hideUnauthenticatedView() {
	if (tabsContainer) {
		tabsContainer.classList.remove('hidden');
	}

	if (overviewCard) {
		overviewCard.classList.remove('hidden');
	}

	if (unauthenticatedStatus) {
		unauthenticatedStatus.classList.add('hidden');
	}
}

async function getActiveTabId(preferredTabId) {
	if (Number.isInteger(preferredTabId)) {
		return preferredTabId;
	}

	const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return activeTab?.id ?? null;
}

async function reacquireAuthTokenFromTab(preferredTabId) {
	try {
		const candidateTabIds = [];
		if (Number.isInteger(preferredTabId)) {
			candidateTabIds.push(preferredTabId);
		}

		const activeTabId = await getActiveTabId();
		if (Number.isInteger(activeTabId) && !candidateTabIds.includes(activeTabId)) {
			candidateTabIds.push(activeTabId);
		}

		for (const tabId of candidateTabIds) {
			try {
				const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' });
				if (response?.isAuthenticated && response?.authToken) {
					return response.authToken;
				}
			} catch (error) {
				continue;
			}
		}

		return null;
	} catch (error) {
		console.error('Failed to reacquire auth token from tab:', error);
		return null;
	}
}

async function fetchReadyToPublishPayload(resourceId, token, publishedFrom, publishedTill) {
	const response = await fetch(buildReadyToPublishUrl(resourceId, publishedFrom, publishedTill), {
		method: 'GET',
		cache: 'no-store',
		headers: {
			Accept: 'application/json, text/plain, */*',
			Authorization: `X-AUTH-TOKEN ${token}`
		}
	});

	let payload = null;
	try {
		payload = await response.json();
	} catch (error) {
		payload = null;
	}

	const isAuthExpired = response.status === 403 || payload?.code === 403;
	if (isAuthExpired) {
		return { isAuthExpired: true, payload, resourceId };
	}

	if (!response.ok) {
		throw new Error(`Ready to publish request failed with ${response.status}`);
	}

	return { isAuthExpired: false, payload, resourceId };
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
	overviewStatus.textContent = 'Loading...';
	overviewStatus.classList.remove('hidden');

	try {
		const response = await fetch(STA_URL, { cache: 'no-store' });

		if (!response.ok) {
			throw new Error(`Request failed with ${response.status}`);
		}

		const payload = await response.json();
		staArticles = normalizeArticles(payload);
		rebuildPublishedIdsUsedByStaSet();
		updateOverviewList();
	} catch (error) {
		console.error('Failed to load STA articles:', error);
		overviewStatus.textContent = 'Failed to load.';
		overviewStatus.classList.remove('hidden');
	} finally {
		staLoading = false;
	}
}

async function loadPublishedArticles() {
	if (publishedLoading) {
		return;
	}

	publishedLoading = true;
	overviewStatus.textContent = 'Loading...';
	overviewStatus.classList.remove('hidden');

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

		rebuildPublishedArticleLookupMap();

		updateOverviewList();
	} catch (error) {
		console.error('Failed to load published articles:', error);
		overviewStatus.textContent = 'Failed to load overview articles.';
		overviewStatus.classList.remove('hidden');
	} finally {
		publishedLoading = false;
	}
}

async function loadOverviewArticles() {
	overviewStatus.textContent = 'Loading overview articles...';
	overviewStatus.classList.remove('hidden');

	await Promise.allSettled([
		loadStaArticles(),
		loadPublishedArticles()
	]);

	updateOverviewList();
}

async function loadReadyToPublishArticles() {
	if (readyToPublishLoading) {
		return;
	}

	readyToPublishLoading = true;
	readyToPublishStatus.textContent = 'Loading...';
	readyToPublishStatus.classList.remove('hidden');

	try {
		await loadResourceNameMap();
		renderReadyToPublishFilters();

		let context = await getSidepanelAuthContext();
		let token = context?.authToken || null;

		if (!token) {
			throw new Error('AUTH_MISSING');
		}

		const runBatch = (authToken) =>
			Promise.allSettled(
				PUBLISHED_RESOURCE_IDS.map((resourceId) =>
					fetchReadyToPublishPayload(resourceId, authToken, windowStart, windowEnd)
				)
			);

		const windowStart = Date.now();
		const windowEnd = windowStart + 2 * 24 * 60 * 60 * 1000;

		let responses = await runBatch(token);
		const hasAuthExpired = responses.some(
			(result) => result.status === 'fulfilled' && result.value.isAuthExpired
		);

		if (hasAuthExpired) {
			const refreshedToken = await reacquireAuthTokenFromTab(context?.tabId);
			if (!refreshedToken) {
				await clearSidepanelAuthContext();
				throw new Error('AUTH_EXPIRED');
			}

			context = {
				...(context || {}),
				authToken: refreshedToken,
				timestamp: Date.now()
			};
			await setSidepanelAuthContext(context);

			responses = await runBatch(refreshedToken);
			const retryHasAuthExpired = responses.some(
				(result) => result.status === 'fulfilled' && result.value.isAuthExpired
			);

			if (retryHasAuthExpired) {
				await clearSidepanelAuthContext();
				throw new Error('AUTH_EXPIRED');
			}
		}

		const successfulPayloads = responses
			.filter((result) => result.status === 'fulfilled' && !result.value.isAuthExpired)
			.map((result) => result.value)
			.filter((result) => result.payload != null);

		if (!successfulPayloads.length) {
			throw new Error('No ready-to-publish requests succeeded.');
		}

		const isInReadyWindow = (item) => {
			const timestampMs = getReadyToPublishTimestampMs(item);
			return timestampMs != null && timestampMs >= windowStart && timestampMs <= windowEnd;
		};

		const mergedReadyItems = successfulPayloads
			.flatMap((result) =>
				normalizeArticles(result.payload).map((item) => {
					const existingResourceId = pickField(item, 'resource_id');
					const normalizedResourceId = String(existingResourceId || result.resourceId || '').trim();
					const resourceIds = Array.from(
						new Set(
							[
								...(Array.isArray(item.resource_ids) ? item.resource_ids : []),
								normalizedResourceId
							]
								.map((id) => String(id || '').trim())
								.filter(Boolean)
						)
					);

					return {
						...item,
						resource_id: normalizedResourceId || existingResourceId || '',
						resource_ids: resourceIds
					};
				})
			);

		const dedupedReadyItemsByKey = new Map();
		mergedReadyItems.forEach((item) => {
			const dedupKey = getReadyToPublishDedupKey(item);
			const existingItem = dedupedReadyItemsByKey.get(dedupKey);

			if (!existingItem) {
				dedupedReadyItemsByKey.set(dedupKey, item);
				return;
			}

			const mergedResourceIds = Array.from(
				new Set([
					...getReadyToPublishResourceIds(existingItem),
					...getReadyToPublishResourceIds(item)
				])
			);

			dedupedReadyItemsByKey.set(dedupKey, {
				...(isInReadyWindow(item) && !isInReadyWindow(existingItem) ? item : existingItem),
				resource_ids: mergedResourceIds,
				resource_id:
					(isInReadyWindow(item) && !isInReadyWindow(existingItem)
						? item.resource_id
						: existingItem.resource_id) ||
					item.resource_id ||
					existingItem.resource_id ||
					mergedResourceIds[0] ||
					''
			});
		});

		readyToPublishArticles = Array.from(dedupedReadyItemsByKey.values())
			.filter((item) => {
				const timestampMs = getReadyToPublishTimestampMs(item);
				return timestampMs != null && timestampMs >= windowStart && timestampMs <= windowEnd;
			})
			.sort((left, right) => {
				const leftTimestampMs = getReadyToPublishTimestampMs(left);
				const rightTimestampMs = getReadyToPublishTimestampMs(right);

				const safeLeft = leftTimestampMs == null ? Number.MAX_SAFE_INTEGER : leftTimestampMs;
				const safeRight = rightTimestampMs == null ? Number.MAX_SAFE_INTEGER : rightTimestampMs;
				return safeLeft - safeRight;
			});

		updateReadyToPublishList();
	} catch (error) {
		console.error('Failed to load ready-to-publish articles:', error);
		clearReadyToPublishData();
		if (error.message === 'AUTH_MISSING') {
			await clearSidepanelAuthContext();
			readyToPublishStatus.textContent = 'Authentication token is missing. Open from popup on an authenticated page.';
		} else if (error.message === 'AUTH_EXPIRED') {
			await clearSidepanelAuthContext();
			readyToPublishStatus.textContent = 'Authentication expired. Reopen from popup on an authenticated page.';
		} else {
			readyToPublishStatus.textContent = 'Error loading ready-to-publish articles.';
		}
		readyToPublishStatus.classList.remove('hidden');
	} finally {
		readyToPublishLoading = false;
	}
}

async function loadActiveTabArticles() {
	const context = await getSidepanelAuthContext();
	const refreshedToken = await reacquireAuthTokenFromTab(context?.tabId);

	if (!refreshedToken) {
		await clearSidepanelAuthContext();
		clearStaData();
		clearPublishedData();
		clearReadyToPublishData();
		showUnauthenticatedView('Not authenticated. Please log in to use editor tools');
		return;
	}

	hideUnauthenticatedView();

	const activeTabId = await getActiveTabId(context?.tabId);
	if (context?.authToken !== refreshedToken || context?.tabId !== activeTabId) {
		await setSidepanelAuthContext({
			...(context || {}),
			tabId: activeTabId,
			authToken: refreshedToken,
			timestamp: Date.now()
		});
	}

	if (activeTab === 'overview') {
		void loadOverviewArticles();
		return;
	}

	if (activeTab === 'nacrtovani') {
		loadReadyToPublishArticles();
	}
}

function startAutoRefresh() {
	if (refreshTimer) {
		clearInterval(refreshTimer);
	}

	refreshTimer = setInterval(() => {
		if (document.visibilityState === 'visible') {
			void loadActiveTabArticles();
		}
	}, STA_REFRESH_MS);
}

const debouncedSaveOverviewSearchTerm = createDebounced((value) => {
	void saveSidebarState({ overviewSearchTerm: value });
}, SEARCH_STATE_SAVE_DEBOUNCE_MS);

const debouncedSaveReadyToPublishSearchTerm = createDebounced((value) => {
	void saveSidebarState({ readyToPublishSearchTerm: value });
}, SEARCH_STATE_SAVE_DEBOUNCE_MS);

tabButtons.forEach((button) => {
	button.addEventListener('click', () => {
		const tabName = button.dataset.tab;
		switchTab(tabName);
		void saveSidebarState({ activeTab });
		void loadActiveTabArticles();
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

	sidebarStateCache = nextState;
	applySidebarState(nextState);
	void loadActiveTabArticles();
});

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') {
		void loadActiveTabArticles();
	}
});

overviewSearchInput.addEventListener('input', (event) => {
	overviewSearchTerm = event.target.value;
	debouncedSaveOverviewSearchTerm(overviewSearchTerm);
	updateOverviewList();
});

if (readyToPublishSearchInput) {
	readyToPublishSearchInput.addEventListener('input', (event) => {
		readyToPublishSearchTerm = event.target.value;
		debouncedSaveReadyToPublishSearchTerm(readyToPublishSearchTerm);
		updateReadyToPublishList();
	});
}

async function initializeSidebar() {
	const savedState = await loadSidebarState();
	applySidebarState(savedState);
	void loadActiveTabArticles();
	startAutoRefresh();
}

initializeSidebar().catch((error) => {
	console.error('Failed to initialize sidebar state:', error);
	switchTab(defaultSidebarState.activeTab);
	void loadOverviewArticles();
	startAutoRefresh();
});
