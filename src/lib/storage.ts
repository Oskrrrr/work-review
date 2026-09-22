import { createStore, del, entries, get, set } from 'idb-keyval';
import type { WorkDataset } from '../types';
import type { ImportedImage } from './workbook';

// Keep all records in one object store. Older builds created two stores in the
// same IndexedDB database, which can fail to upgrade when a browser already
// has the database open. A new DB name gives existing installs a safe migration
// path without touching the original workbook.
const appStore = createStore('work-review-v2', 'kv');
const legacyDataStore = createStore('work-review', 'data');
const DATASET_KEY = 'active-dataset';
const DATASET_PREFIX = 'dataset:';
const IMAGE_PREFIX = 'image:';

function datasetKey(datasetId: string) {
  return `${DATASET_PREFIX}${datasetId}`;
}

function datasetIdOf(dataset: WorkDataset) {
  return dataset.meta.datasetId || `${dataset.meta.year}-${dataset.meta.sourceName}`;
}

export async function loadDataset() {
  const current = await get<WorkDataset>(DATASET_KEY, appStore);
  return current ?? get<WorkDataset>(DATASET_KEY, legacyDataStore);
}

export async function loadDatasets() {
  const stored = await entries(appStore);
  const datasets = stored
    .filter(([key, value]) => String(key).startsWith(DATASET_PREFIX) && value && typeof value === 'object')
    .map(([, value]) => value as WorkDataset);
  const active = await loadDataset();
  if (active && !datasets.some(item => datasetIdOf(item) === datasetIdOf(active))) datasets.push(active);
  return datasets.sort((a, b) => b.meta.year - a.meta.year || b.meta.importedAt.localeCompare(a.meta.importedAt));
}

export async function saveDataset(dataset: WorkDataset) {
  const id = datasetIdOf(dataset);
  const saved = { ...dataset, meta: { ...dataset.meta, datasetId: id } };
  await set(DATASET_KEY, saved, appStore);
  return set(datasetKey(id), saved, appStore);
}

export async function saveImages(images: ImportedImage[], datasetId = 'legacy') {
  await Promise.all(images.map(image => set(`${IMAGE_PREFIX}${datasetId}:${image.id}`, { blob: image.blob, name: image.name }, appStore)));
}

export async function loadImage(id: string, datasetId = 'legacy') {
  return (await get<{ blob: Blob; name: string }>(`${IMAGE_PREFIX}${datasetId}:${id}`, appStore))
    ?? get<{ blob: Blob; name: string }>(`${IMAGE_PREFIX}${id}`, appStore);
}

export async function clearLocalData() {
  const stored = await entries(appStore);
  await Promise.all(stored.filter(([key]) => String(key) === DATASET_KEY || String(key).startsWith(DATASET_PREFIX) || String(key).startsWith(IMAGE_PREFIX)).map(([key]) => del(key, appStore)));
  const images = await entries(appStore);
  await Promise.all(images.filter(([key]) => String(key).startsWith(IMAGE_PREFIX)).map(([key]) => del(key, appStore)));
}
