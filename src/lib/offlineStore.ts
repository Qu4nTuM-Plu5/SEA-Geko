import { Course, DownloadState, SyncQueueItem } from "../types";

const DB_NAME = 'nexus-offline-db';
const DB_VERSION = 1;
const SNAPSHOT_STORE = 'course_snapshots';
const DOWNLOAD_STORE = 'downloads';
const QUEUE_STORE = 'sync_queue';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE);
      if (!db.objectStoreNames.contains(DOWNLOAD_STORE)) db.createObjectStore(DOWNLOAD_STORE);
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

async function putValue<T>(store: string, key: string, value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value as any, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Write failed'));
  });
  db.close();
}

async function getValue<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  const value = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T) || null);
    req.onerror = () => reject(req.error || new Error('Read failed'));
  });
  db.close();
  return value;
}

async function deleteValue(store: string, key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Delete failed'));
  });
  db.close();
}

async function getAllValues<T>(store: string): Promise<T[]> {
  const db = await openDb();
  const values = await new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error || new Error('Read all failed'));
  });
  db.close();
  return values;
}

const courseSnapshotKey = (accountId: string, courseId: string, version: number) => `${accountId}:${courseId}:v${version}`;
const downloadStateKey = (accountId: string, courseId: string) => `${accountId}:${courseId}`;
const queueKey = (item: SyncQueueItem) => `${item.id}`;

export const offlineStore = {
  async saveCourseSnapshot(accountId: string, courseId: string, version: number, course: Course): Promise<void> {
    await putValue(SNAPSHOT_STORE, courseSnapshotKey(accountId, courseId, version), {
      accountId,
      courseId,
      version,
      course,
      savedAt: new Date().toISOString(),
    });
  },

  async getCourseSnapshot(accountId: string, courseId: string, version: number): Promise<Course | null> {
    const raw = await getValue<any>(SNAPSHOT_STORE, courseSnapshotKey(accountId, courseId, version));
    return raw?.course || null;
  },

  async saveDownloadState(accountId: string, state: DownloadState): Promise<void> {
    await putValue(DOWNLOAD_STORE, downloadStateKey(accountId, state.courseId), {
      ...state,
      accountId,
    });
  },

  async getDownloadStates(accountId: string): Promise<DownloadState[]> {
    const all = await getAllValues<any>(DOWNLOAD_STORE);
    return all
      .filter((row) => row?.accountId === accountId)
      .map((row) => ({
        courseId: String(row.courseId || ''),
        snapshotVersion: Number(row.snapshotVersion || 1),
        downloadedAt: String(row.downloadedAt || ''),
        sizeBytes: Number(row.sizeBytes || 0),
        title: String(row.title || ''),
      }));
  },

  async removeDownloadState(accountId: string, courseId: string): Promise<void> {
    await deleteValue(DOWNLOAD_STORE, downloadStateKey(accountId, courseId));
  },

  async queueSyncEvent(item: SyncQueueItem): Promise<void> {
    await putValue(QUEUE_STORE, queueKey(item), item);
  },

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    return await getAllValues<SyncQueueItem>(QUEUE_STORE);
  },

  async clearSyncEvent(id: string): Promise<void> {
    await deleteValue(QUEUE_STORE, id);
  },
};

