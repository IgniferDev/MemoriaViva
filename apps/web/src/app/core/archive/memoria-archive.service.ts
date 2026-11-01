import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { strToU8, strFromU8, zipSync, Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import {
  Collection,
  EventInput,
  EventRecord,
  MediaAsset,
  MemoriaApiService,
} from '../api/memoria-api.service';

interface ArchiveAsset {
  id: string;
  path: string;
  kind: MediaAsset['kind'];
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}
interface ArchiveManifest {
  format: 'memoria-viva';
  version: 1 | 2;
  exportedAt: string;
  assets: ArchiveAsset[];
}
interface ArchiveCollection extends Pick<Collection, 'title' | 'kind' | 'description' | 'coverAsset'> {}

@Injectable({ providedIn: 'root' })
export class MemoriaArchiveService {
  private readonly api = inject(MemoriaApiService);
  readonly progress = signal('');

  async exportCollection(collectionId: string): Promise<{ blob: Blob; filename: string }> {
    this.progress.set('Reuniendo recuerdos…');
    const collection = await firstValueFrom(this.api.getCollection(collectionId));
    const events = await Promise.all(collection.items.map((item) => firstValueFrom(this.api.getEvent(item.eventId))));
    const portableEvents = events.map((event) => {
      const legacy = event as EventRecord & {
        dateEnd?: unknown;
        datePrecision?: unknown;
        locationLatitude?: unknown;
        locationLongitude?: unknown;
        ownerId?: unknown;
        categories?: unknown[];
        tags?: unknown[];
      };
      const {
        dateEnd: _dateEnd,
        datePrecision: _datePrecision,
        locationLatitude: _locationLatitude,
        locationLongitude: _locationLongitude,
        ownerId: _ownerId,
        categories: _categories,
        tags: _tags,
        collectionItems: _collectionItems,
        ...simpleEvent
      } = legacy;
      return { ...simpleEvent, people: (event.people ?? []).map(({ person }) => ({ person })) };
    });
    const media = new Map<string, MediaAsset>();
    if (collection.coverAsset) media.set(collection.coverAsset.id, collection.coverAsset);
    for (const event of events) {
      for (const photo of event.photos ?? []) media.set(photo.asset.id, photo.asset);
      for (const narration of event.narrations ?? []) if (narration.audioAsset) media.set(narration.audioAsset.id, narration.audioAsset);
    }
    const files: Record<string, Uint8Array> = {
      'collection.json': strToU8(JSON.stringify({ title: collection.title, kind: collection.kind, description: collection.description, coverAsset: collection.coverAsset ?? null })),
      'events.json': strToU8(JSON.stringify(portableEvents)),
    };
    const assets: ArchiveAsset[] = [];
    let current = 0;
    for (const asset of media.values()) {
      this.progress.set(`Incluyendo archivo ${++current} de ${media.size}…`);
      const response = await fetch(this.api.assetContentUrl(asset.id), { credentials: 'include' });
      if (!response.ok) throw new Error('No se pudo leer un archivo de la colección.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const path = `media/${asset.id}`;
      files[path] = bytes;
      assets.push({
        id: asset.id,
        path,
        kind: asset.kind,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        sizeBytes: bytes.byteLength,
        sha256: await this.sha256(bytes),
      });
    }
    const manifest: ArchiveManifest = {
      format: 'memoria-viva', version: 2, exportedAt: new Date().toISOString(), assets,
    };
    files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
    this.progress.set('Empaquetando archivo .memoria…');
    const zipped = zipSync(files, { level: 0 });
    this.progress.set('');
    const blob = new Blob([zipped], { type: 'application/vnd.memoria-viva+zip' });
    return { blob, filename: `${this.slug(collection.title)}.memoria` };
  }

  async importCollection(file: File): Promise<Collection> {
    if (!file.name.toLowerCase().endsWith('.memoria')) throw new Error('Selecciona un archivo .memoria.');
    if (file.size > 500 * 1024 * 1024) throw new Error('El archivo supera el límite de 500 MB.');
    this.progress.set('Validando paquete y archivos…');
    const files = await this.unzipWithLimit(new Uint8Array(await file.arrayBuffer()));
    const manifest = this.json<ArchiveManifest>(files, 'manifest.json');
    const sourceCollection = this.json<ArchiveCollection>(files, 'collection.json');
    const events = this.json<EventRecord[]>(files, 'events.json');
    if (manifest.format !== 'memoria-viva' || ![1, 2].includes(manifest.version)) throw new Error('La versión de este paquete no es compatible.');
    if (!['ALBUM', 'TIMELINE', 'EDUCATIONAL'].includes(sourceCollection.kind)) throw new Error('El tipo de colección no es válido.');
    if (!Array.isArray(events) || events.length > 10000 || !Array.isArray(manifest.assets) || manifest.assets.length > 20000) {
      throw new Error('El paquete contiene más elementos de los permitidos.');
    }
    const assetBytes = new Map<string, Uint8Array>();
    for (const [index, asset] of manifest.assets.entries()) {
      if (!asset.id || asset.path !== `media/${asset.id}` || asset.path.includes('..') || asset.path.includes('\\')) throw new Error('El paquete contiene una ruta no permitida.');
      const bytes = files[asset.path];
      if (!bytes || bytes.byteLength !== asset.sizeBytes || await this.sha256(bytes) !== asset.sha256) {
        throw new Error(`No se pudo verificar el archivo ${asset.originalName || index + 1}.`);
      }
      assetBytes.set(asset.id, bytes);
    }

    let createdCollection: Collection | null = null;
    const createdEvents: string[] = [];
    try {
      this.progress.set('Creando una copia nueva…');
      createdCollection = await firstValueFrom(this.api.createCollection({
        title: `${sourceCollection.title} (importada)`,
        kind: sourceCollection.kind,
        description: sourceCollection.description,
      }));
      const assetMap = new Map<string, string>();
      if (sourceCollection.coverAsset) {
        const bytes = assetBytes.get(sourceCollection.coverAsset.id);
        if (!bytes) throw new Error('Falta la fotografía de portada de la colección.');
        const cover = await firstValueFrom(this.api.uploadCollectionCover(
          createdCollection.id,
          this.toFile(bytes, sourceCollection.coverAsset.originalName, sourceCollection.coverAsset.mimeType),
        ));
        createdCollection = cover;
      }
      for (const [index, event] of events.entries()) {
        this.progress.set(`Importando recuerdo ${index + 1} de ${events.length}…`);
        const personIds = await Promise.all((event.people ?? []).map(async ({ person }) =>
          (await firstValueFrom(this.api.createPerson(person.name))).id,
        ));
        const input: EventInput = {
          title: event.title,
          description: event.description,
          dateStart: event.dateStart?.slice(0, 10) ?? null,
          locationName: event.locationName,
          collectionId: createdCollection.id,
          personIds: [...new Set(personIds)],
        };
        const created = await firstValueFrom(this.api.createEvent(input));
        createdEvents.push(created.id);
        for (const photo of [...(event.photos ?? [])].sort((a, b) => a.position - b.position)) {
          const bytes = assetBytes.get(photo.asset.id);
          if (!bytes) throw new Error(`Falta el archivo de la fotografía ${photo.asset.originalName}.`);
          const newPhoto = await firstValueFrom(this.api.uploadPhoto(created.id, this.toFile(bytes, photo.asset.originalName, photo.asset.mimeType), photo.caption ?? ''));
          assetMap.set(photo.asset.id, newPhoto.asset.id);
        }
        for (const voice of [...(event.narrations ?? [])].sort((a, b) => a.position - b.position)) {
          const sourceAsset = voice.audioAsset;
          if (!sourceAsset) throw new Error(`Falta el audio de ${voice.title}.`);
          const bytes = assetBytes.get(sourceAsset.id);
          if (!bytes) throw new Error(`Falta el archivo de audio ${sourceAsset.originalName}.`);
          const newVoice = await firstValueFrom(this.api.uploadNarration(
            created.id,
            this.toFile(bytes, sourceAsset.originalName, sourceAsset.mimeType),
            voice.title,
            voice.speaker?.name ?? '',
            voice.transcript ?? '',
            sourceAsset.originalName,
            voice.relatedPhotoAsset ? assetMap.get(voice.relatedPhotoAsset.id) ?? '' : '',
          ));
        }
      }
      this.progress.set('');
      return createdCollection;
    } catch (error) {
      if (createdCollection) await this.rollback(createdCollection.id, createdEvents);
      this.progress.set('');
      throw error;
    }
  }

  private async rollback(collectionId: string, eventIds: string[]): Promise<void> {
    try { await firstValueFrom(this.api.deleteCollection(collectionId)); } catch { /* best effort rollback */ }
    for (const eventId of eventIds) {
      try {
        const event = await firstValueFrom(this.api.getEvent(eventId));
        for (const photo of event.photos ?? []) await firstValueFrom(this.api.deletePhoto(eventId, photo.id));
        for (const voice of event.narrations ?? []) await firstValueFrom(this.api.deleteNarration(eventId, voice.id));
        await firstValueFrom(this.api.deleteEvent(eventId));
      } catch { /* keep rolling back remaining records */ }
    }
  }

  private async unzipWithLimit(input: Uint8Array): Promise<Record<string, Uint8Array>> {
    const result: Record<string, Uint8Array> = {};
    const parts = new Map<string, Uint8Array[]>();
    const sizes = new Map<string, number>();
    let totalSize = 0;
    let entryCount = 0;
    let failure: Error | null = null;
    await new Promise<void>((resolve, reject) => {
      const unzip = new Unzip((entry) => {
        entryCount += 1;
        if (entryCount > 20021 || entry.name.startsWith('/') || entry.name.includes('..') || entry.name.includes('\\')) {
          failure = new Error('El archivo ZIP contiene rutas o demasiados elementos.');
          reject(failure);
          return;
        }
        if (entry.name.endsWith('/')) return;
        if (parts.has(entry.name) || result[entry.name]) {
          failure = new Error('El archivo ZIP contiene nombres duplicados.');
          reject(failure);
          return;
        }
        if (entry.compression !== 0 && entry.compression !== 8) {
          failure = new Error('El archivo ZIP usa una compresión no admitida.');
          reject(failure);
          return;
        }
        if (entry.originalSize && entry.originalSize > 160 * 1024 * 1024) {
          failure = new Error('Un archivo interno supera el límite de 160 MB.');
          reject(failure);
          return;
        }
        parts.set(entry.name, []);
        sizes.set(entry.name, 0);
        entry.ondata = (error, chunk, final) => {
          if (failure) return;
          if (error) { failure = new Error('El archivo ZIP está dañado.'); reject(failure); return; }
          totalSize += chunk.byteLength;
          const size = (sizes.get(entry.name) ?? 0) + chunk.byteLength;
          if (totalSize > 1024 * 1024 * 1024 || size > 160 * 1024 * 1024) {
            failure = new Error('El contenido descomprimido supera el límite permitido.');
            reject(failure);
            return;
          }
          parts.get(entry.name)?.push(chunk);
          sizes.set(entry.name, size);
          if (final) {
            const chunks = parts.get(entry.name) ?? [];
            const output = new Uint8Array(size);
            let offset = 0;
            for (const part of chunks) { output.set(part, offset); offset += part.byteLength; }
            result[entry.name] = output;
            parts.delete(entry.name);
          }
        };
        try { entry.start(); } catch { failure = new Error('ZIP inválido.'); reject(failure); }
      });
      unzip.register(UnzipPassThrough);
      unzip.register(UnzipInflate);
      try {
        const step = 64 * 1024;
        for (let offset = 0; offset < input.length && !failure; offset += step) {
          unzip.push(input.subarray(offset, Math.min(input.length, offset + step)), offset + step >= input.length);
        }
        if (!input.length) reject(new Error('El archivo está vacío.'));
        else if (!failure) resolve();
      } catch { reject(new Error('El archivo ZIP está dañado o incompleto.')); }
    });
    return result;
  }

  private json<T>(files: Record<string, Uint8Array>, path: string): T {
    const bytes = files[path];
    if (!bytes || bytes.byteLength > 25 * 1024 * 1024) throw new Error(`Falta ${path} o es demasiado grande.`);
    try { return JSON.parse(strFromU8(bytes)) as T; }
    catch { throw new Error(`El archivo ${path} no contiene JSON válido.`); }
  }

  private async sha256(bytes: Uint8Array): Promise<string> {
    const copy = new Uint8Array(bytes);
    const hash = await crypto.subtle.digest('SHA-256', copy.buffer);
    return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  private toFile(bytes: Uint8Array, name: string, mimeType: string): File {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return new File([buffer], name, { type: mimeType });
  }

  private slug(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'memoria';
  }
}
