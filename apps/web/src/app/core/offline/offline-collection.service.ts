import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../api/api-base-url';
import { Collection, CollectionDetail, EventRecord, MemoriaApiService } from '../api/memoria-api.service';

const CACHE_NAME = 'memoria-viva-offline-v1';
const LIST_KEY = 'memoria-viva-offline-collections';
const urlKey = (id: string) => `memoria-viva-offline-urls:${id}`;

@Injectable({ providedIn: 'root' })
export class OfflineCollectionService {
  private readonly api = inject(MemoriaApiService);
  readonly downloaded = signal<string[]>(this.readList());
  readonly progress = signal<{ collectionId: string; completed: number; total: number; downloadedBytes: number; totalBytes: number } | null>(null);
  private readonly mediaUrls = new Map<string, string>();
  readonly mediaVersion = signal(0);
  private cacheEpoch = 0;

  constructor() { void this.hydrateMedia(); }

  async download(collectionId: string): Promise<void> {
    const operationEpoch = this.cacheEpoch;
    if (typeof caches === 'undefined') throw new Error('Este navegador no admite almacenamiento offline');
    const collection = await firstValueFrom(this.api.getCollection(collectionId));
    this.ensureCurrentEpoch(operationEpoch);
    const events: EventRecord[] = await Promise.all(
      collection.items.map(async (item) => await firstValueFrom(this.api.getEvent(item.eventId))),
    );
    this.ensureCurrentEpoch(operationEpoch);
    const mediaIds = new Set<string>();
    const photoIds = new Set<string>();
    const mediaSizes = new Map<string, number>();
    if (collection.coverAsset) {
      mediaIds.add(collection.coverAsset.id);
      photoIds.add(collection.coverAsset.id);
      mediaSizes.set(collection.coverAsset.id, Number(collection.coverAsset.sizeBytes) || 0);
    }
    for (const event of events) {
      for (const photo of event.photos ?? []) { mediaIds.add(photo.asset.id); photoIds.add(photo.asset.id); mediaSizes.set(photo.asset.id, Number(photo.asset.sizeBytes) || 0); }
      for (const narration of event.narrations ?? []) if (narration.audioAsset) { mediaIds.add(narration.audioAsset.id); mediaSizes.set(narration.audioAsset.id, Number(narration.audioAsset.sizeBytes) || 0); }
    }
    const total = mediaIds.size + photoIds.size + events.length + 1;
    const totalBytes = [...mediaIds].reduce((sum, id) => sum + (mediaSizes.get(id) ?? 0), 0) +
      [...photoIds].reduce((sum, id) => sum + Math.round((mediaSizes.get(id) ?? 0) * 0.2), 0);
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && estimate.usage !== undefined && estimate.quota - estimate.usage < totalBytes) {
        throw new Error('No hay espacio de almacenamiento suficiente');
      }
    }
    this.progress.set({ collectionId, completed: 0, total, downloadedBytes: 0, totalBytes });
    const cache = await caches.open(CACHE_NAME);
    const urlsForCollection: string[] = [];
    const previousCache = new Map<string, Response | null>();
    let completed = 0;
    try {
      const collectionUrl = `${API_BASE_URL}/collections/${collectionId}`;
      await this.cacheJson(cache, collectionUrl, collection, previousCache);
      urlsForCollection.push(collectionUrl);
      this.progress.set({ collectionId, completed: ++completed, total, downloadedBytes: 0, totalBytes });
      for (const event of events) {
        const eventUrl = `${API_BASE_URL}/events/${event.id}`;
        await this.cacheJson(cache, eventUrl, event, previousCache);
        urlsForCollection.push(eventUrl);
        this.progress.set({ collectionId, completed: ++completed, total, downloadedBytes: 0, totalBytes });
      }
      let downloadedBytes = 0;
      for (const mediaId of mediaIds) {
        const endpoints = [
          `${API_BASE_URL}/media/assets/${mediaId}/content`,
          ...(photoIds.has(mediaId) ? [`${API_BASE_URL}/media/assets/${mediaId}/thumbnail`] : []),
        ];
        for (const url of endpoints) {
          const response = await fetch(url, { credentials: 'include' });
          this.ensureCurrentEpoch(operationEpoch);
          if (!response.ok) throw new Error(`No se pudo descargar un medio (${response.status})`);
          const blob = await response.blob();
          if (!blob.size) throw new Error('Se recibió un archivo vacío');
          downloadedBytes += blob.size;
          if (!previousCache.has(url)) previousCache.set(url, await cache.match(url) ?? null);
          await cache.put(url, new Response(blob, {
            status: 200,
            headers: { 'Content-Type': response.headers.get('Content-Type') ?? blob.type },
          }));
          this.setMediaUrl(url, blob);
          urlsForCollection.push(url);
          this.progress.set({ collectionId, completed: ++completed, total, downloadedBytes, totalBytes });
        }
      }
      this.ensureCurrentEpoch(operationEpoch);
      localStorage.setItem(urlKey(collectionId), JSON.stringify([...new Set(urlsForCollection)]));
      this.downloaded.update((ids) => ids.includes(collectionId) ? ids : [...ids, collectionId]);
      localStorage.setItem(LIST_KEY, JSON.stringify(this.downloaded()));
      await this.refreshOfflineLibrary(cache, operationEpoch);
    } catch (error) {
      if (operationEpoch === this.cacheEpoch) {
        for (const [url, previous] of previousCache) {
          if (previous) {
            await cache.put(url, previous.clone());
            if (url.includes('/media/assets/')) this.setMediaUrl(url, await previous.blob());
          } else {
            await cache.delete(url);
            this.revokeMediaUrl(url);
          }
        }
      }
      throw error;
    } finally {
      this.progress.set(null);
    }
  }

  async remove(collectionId: string): Promise<void> {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(CACHE_NAME);
    const urls = this.readUrls(collectionId);
    const otherUrls = new Set(this.downloaded()
      .filter((id) => id !== collectionId)
      .flatMap((id) => this.readUrls(id)));
    for (const url of urls) if (!otherUrls.has(url)) await cache.delete(url);
    const apiCache = await caches.open('memoria-viva-api-v1');
    for (const url of urls) if (!otherUrls.has(url)) await apiCache.delete(url);
    for (const url of urls) if (!otherUrls.has(url)) this.revokeMediaUrl(url);
    localStorage.removeItem(urlKey(collectionId));
    this.downloaded.update((ids) => ids.filter((id) => id !== collectionId));
    localStorage.setItem(LIST_KEY, JSON.stringify(this.downloaded()));
    await this.refreshOfflineLibrary(cache);
  }

  isDownloaded(id: string): boolean { return this.downloaded().includes(id); }

  async clearPrivateData(): Promise<void> {
    this.cacheEpoch += 1;
    this.progress.set(null);
    this.downloaded.set([]);
    for (const url of [...this.mediaUrls.keys()]) this.revokeMediaUrl(url);
    for (const key of Object.keys(localStorage)) {
      if (key === LIST_KEY || key.startsWith('memoria-viva-offline-urls:')) localStorage.removeItem(key);
    }
    if (typeof caches === 'undefined') return;
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('memoria-viva-offline') || name === 'memoria-viva-api-v1')
      .map((name) => caches.delete(name)));
  }

  assetContentUrl(id: string): string {
    this.mediaVersion();
    const url = `${API_BASE_URL}/media/assets/${id}/content`;
    return this.mediaUrls.get(url) ?? url;
  }

  assetThumbnailUrl(id: string): string {
    this.mediaVersion();
    const url = `${API_BASE_URL}/media/assets/${id}/thumbnail`;
    return this.mediaUrls.get(url) ?? url;
  }

  private async cacheJson(cache: Cache, url: string, value: CollectionDetail | EventRecord | unknown, previousCache?: Map<string, Response | null>): Promise<void> {
    if (previousCache && !previousCache.has(url)) previousCache.set(url, await cache.match(url) ?? null);
    await cache.put(url, new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  private async refreshOfflineLibrary(cache: Cache, epoch = this.cacheEpoch): Promise<void> {
    const entries: Collection[] = [];
    for (const id of this.downloaded()) {
      const response = await cache.match(`${API_BASE_URL}/collections/${id}`);
      if (epoch !== this.cacheEpoch) return;
      if (!response) continue;
      const collection = await response.json() as CollectionDetail;
      entries.push({
        id: collection.id,
        title: collection.title,
        kind: collection.kind,
        description: collection.description,
        createdAt: collection.createdAt,
        updatedAt: collection.updatedAt,
        _count: { items: collection.items.length },
        coverAsset: collection.coverAsset ?? null,
      });
    }
    if (epoch === this.cacheEpoch) await this.cacheJson(cache, `${API_BASE_URL}/collections`, entries);
  }

  private readList(): string[] {
    try { return JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]') as string[]; }
    catch { return []; }
  }

  private readUrls(id: string): string[] {
    try { return JSON.parse(localStorage.getItem(urlKey(id)) ?? '[]') as string[]; }
    catch { return []; }
  }

  private setMediaUrl(url: string, blob: Blob): void {
    const previous = this.mediaUrls.get(url);
    if (previous) URL.revokeObjectURL(previous);
    this.mediaUrls.set(url, URL.createObjectURL(blob));
    this.mediaVersion.update((version) => version + 1);
  }

  private revokeMediaUrl(url: string): void {
    const objectUrl = this.mediaUrls.get(url);
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    this.mediaUrls.delete(url);
    this.mediaVersion.update((version) => version + 1);
  }

  private async hydrateMedia(): Promise<void> {
    if (typeof caches === 'undefined') return;
    const operationEpoch = this.cacheEpoch;
    const cache = await caches.open(CACHE_NAME);
    for (const id of this.downloaded()) {
      for (const url of this.readUrls(id).filter((item) => item.includes('/media/assets/'))) {
        if (this.mediaUrls.has(url)) continue;
        const response = await cache.match(url);
        if (operationEpoch !== this.cacheEpoch) return;
        if (response) this.setMediaUrl(url, await response.blob());
      }
    }
  }

  private ensureCurrentEpoch(epoch: number): void {
    if (epoch !== this.cacheEpoch) throw new Error('La sesión cambió durante la descarga.');
  }
}
