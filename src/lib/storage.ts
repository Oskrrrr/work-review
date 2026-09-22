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
const IMAGE_PREFIX = 'image:';

export async function loadDataset() {
  const current = await get<WorkDataset>(DATASET_KEY, appStore);
  return current ?? get<WorkDataset>(DATASET_KEY, legacyDataStore);
}

export async function saveDataset(dataset: WorkDataset) {
  return set(DATASET_KEY, dataset, appStore);
}

export async function saveImages(images: ImportedImage[]) {
  const existing = await entries(appStore);
  await Promise.all(existing.filter(([key]) => String(key).startsWith(IMAGE_PREFIX)).map(([key]) => del(key, appStore)));
  await Promise.all(images.map(image => set(`${IMAGE_PREFIX}${image.id}`, { blob: image.blob, name: image.name }, appStore)));
}

export async function loadImage(id: string) {
  return get<{ blob: Blob; name: string }>(`${IMAGE_PREFIX}${id}`, appStore);
}

export async function clearLocalData() {
  await del(DATASET_KEY, appStore);
  const images = await entries(appStore);
  await Promise.all(images.filter(([key]) => String(key).startsWith(IMAGE_PREFIX)).map(([key]) => del(key, appStore)));
}
