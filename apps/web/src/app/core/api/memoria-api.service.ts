import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, throwError } from 'rxjs';
import { API_BASE_URL } from './api-base-url';

export type CollectionKind = 'ALBUM' | 'TIMELINE' | 'EDUCATIONAL';
export interface Person { id: string; name: string; }
export interface AppUser { id: string; firstName: string; lastName: string; birthDate: string; country: string; email: string; }
export interface RegisterInput extends Omit<AppUser, 'id'> { password: string; }
export interface LoginInput { email: string; password: string; }

export interface Collection {
  id: string;
  title: string;
  kind: CollectionKind;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { items: number };
  coverAsset?: MediaAsset | null;
}

export interface CollectionItem {
  collectionId: string;
  eventId: string;
  position: number;
  event: EventRecord;
}

export interface CollectionDetail extends Collection {
  items: CollectionItem[];
}

export interface MediaAsset {
  id: string;
  kind: 'PHOTO' | 'AUDIO' | 'THUMBNAIL';
  originalName: string;
  mimeType: string;
  sizeBytes: string | number;
  storageKey: string;
}

export interface EventPhoto {
  id: string;
  position: number;
  caption: string | null;
  asset: MediaAsset;
}

export interface Narration {
  id: string;
  title: string;
  position: number;
  transcript: string | null;
  durationSeconds: number | null;
  speaker?: { id: string; name: string } | null;
  audioAsset?: MediaAsset;
  relatedPhotoAsset?: MediaAsset | null;
}

export interface EventRecord {
  id: string;
  title: string;
  description: string | null;
  dateStart: string | null;
  locationName: string | null;
  createdAt: string;
  updatedAt: string;
  photos?: EventPhoto[];
  narrations?: Narration[];
  collectionItems?: Array<{
    collectionId: string;
    collection?: Pick<Collection, 'id' | 'title' | 'kind'>;
  }>;
  people?: Array<{ person: { id: string; name: string } }>;
}

export interface CreateCollectionInput {
  title: string;
  kind: CollectionKind;
  description?: string | null;
}

export interface EventInput {
  title: string;
  description?: string | null;
  dateStart?: string | null;
  locationName?: string | null;
  collectionId: string;
  personIds?: string[];
}

@Injectable({ providedIn: 'root' })
export class MemoriaApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = API_BASE_URL;

  getCurrentUser(): Observable<AppUser> { return this.http.get<AppUser>(this.baseUrl + '/auth/me'); }
  register(input: RegisterInput): Observable<{ user: AppUser }> { return this.http.post<{ user: AppUser }>(this.baseUrl + '/auth/register', input); }
  login(input: LoginInput): Observable<{ user: AppUser }> { return this.http.post<{ user: AppUser }>(this.baseUrl + '/auth/login', input); }
  logout(): Observable<{ loggedOut: boolean }> { return this.http.post<{ loggedOut: boolean }>(this.baseUrl + '/auth/logout', {}); }

  getCollections(): Observable<Collection[]> {
    return this.cachedGet<Collection[]>(this.baseUrl + '/collections');
  }

  getPeople(): Observable<Person[]> {
    return this.http.get<Person[]>(this.baseUrl + '/people');
  }

  createPerson(name: string): Observable<Person> {
    return this.http.post<Person>(this.baseUrl + '/people', { name });
  }

  updatePerson(id: string, name: string): Observable<Person> { return this.http.patch<Person>(this.baseUrl + '/people/' + id, { name }); }
  deletePerson(id: string): Observable<{ id: string; deleted: boolean }> { return this.http.delete<{ id: string; deleted: boolean }>(this.baseUrl + '/people/' + id); }

  getCollection(id: string): Observable<CollectionDetail> {
    return this.cachedGet<CollectionDetail>(this.baseUrl + '/collections/' + id);
  }

  createCollection(input: CreateCollectionInput): Observable<Collection> {
    return this.http.post<Collection>(this.baseUrl + '/collections', input);
  }

  updateCollection(
    id: string,
    input: Partial<CreateCollectionInput>,
  ): Observable<Collection> {
    return this.http.patch<Collection>(
      this.baseUrl + '/collections/' + id,
      input,
    );
  }

  uploadCollectionCover(collectionId: string, file: File): Observable<Collection> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<Collection>(this.baseUrl + '/collections/' + collectionId + '/cover', form);
  }

  removeCollectionCover(collectionId: string): Observable<{ collectionId: string; removed: boolean }> {
    return this.http.delete<{ collectionId: string; removed: boolean }>(this.baseUrl + '/collections/' + collectionId + '/cover');
  }

  deleteCollection(id: string): Observable<{ id: string; deleted: boolean }> {
    return this.http.delete<{ id: string; deleted: boolean }>(
      this.baseUrl + '/collections/' + id,
    );
  }

  addEventToCollection(
    collectionId: string,
    eventId: string,
  ): Observable<unknown> {
    return this.http.post(
      this.baseUrl + '/collections/' + collectionId + '/events',
      { eventId },
    );
  }

  removeEventFromCollection(
    collectionId: string,
    eventId: string,
  ): Observable<unknown> {
    return this.http.delete(
      this.baseUrl + '/collections/' + collectionId + '/events/' + eventId,
    );
  }

  reorderCollectionEvents(
    collectionId: string,
    eventIds: string[],
  ): Observable<unknown> {
    return this.http.patch(
      this.baseUrl + '/collections/' + collectionId + '/events/order',
      { eventIds },
    );
  }

  getEvents(options: {
    collectionId?: string;
    search?: string;
  } = {}): Observable<EventRecord[]> {
    let params = new HttpParams();
    if (options.collectionId) params = params.set('collectionId', options.collectionId);
    if (options.search) params = params.set('search', options.search);
    return this.http.get<EventRecord[]>(this.baseUrl + '/events', { params });
  }

  getEvent(id: string): Observable<EventRecord> {
    return this.cachedGet<EventRecord>(this.baseUrl + '/events/' + id);
  }

  createEvent(input: EventInput): Observable<EventRecord> {
    return this.http.post<EventRecord>(this.baseUrl + '/events', input);
  }

  updateEvent(id: string, input: Partial<EventInput>): Observable<EventRecord> {
    return this.http.patch<EventRecord>(
      this.baseUrl + '/events/' + id,
      input,
    );
  }

  deleteEvent(id: string): Observable<{ id: string; deleted: boolean }> {
    return this.http.delete<{ id: string; deleted: boolean }>(
      this.baseUrl + '/events/' + id,
    );
  }

  uploadPhoto(eventId: string, file: File, caption = ''): Observable<EventPhoto> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('caption', caption);
    return this.http.post<EventPhoto>(
      this.baseUrl + '/events/' + eventId + '/photos',
      form,
    );
  }

  deletePhoto(eventId: string, photoId: string): Observable<unknown> {
    return this.http.delete(this.baseUrl + '/events/' + eventId + '/photos/' + photoId);
  }

  updatePhotoCaption(eventId: string, photoId: string, caption: string): Observable<EventPhoto> {
    return this.http.patch<EventPhoto>(this.baseUrl + '/events/' + eventId + '/photos/' + photoId, { caption });
  }

  reorderPhotos(eventId: string, ids: string[]): Observable<unknown> {
    return this.http.patch(this.baseUrl + '/events/' + eventId + '/photos/order', { ids });
  }

  uploadNarration(
    eventId: string,
    file: File | Blob,
    title: string,
    speaker = '',
    transcript = '',
    filename = 'narracion.webm',
    relatedPhotoAssetId = '',
  ): Observable<Narration> {
    const form = new FormData();
    form.append('file', file, filename);
    form.append('title', title);
    form.append('speaker', speaker);
    form.append('transcript', transcript);
    form.append('relatedPhotoAssetId', relatedPhotoAssetId);
    return this.http.post<Narration>(
      this.baseUrl + '/events/' + eventId + '/narrations',
      form,
    );
  }

  deleteNarration(eventId: string, narrationId: string): Observable<unknown> {
    return this.http.delete(
      this.baseUrl + '/events/' + eventId + '/narrations/' + narrationId,
    );
  }

  updateNarration(
    eventId: string,
    narrationId: string,
    input: { title?: string; speakerId?: string | null; relatedPhotoAssetId?: string | null; transcript?: string | null },
  ): Observable<Narration> {
    return this.http.patch<Narration>(
      this.baseUrl + '/events/' + eventId + '/narrations/' + narrationId,
      input,
    );
  }

  reorderNarrations(eventId: string, ids: string[]): Observable<unknown> {
    return this.http.patch(this.baseUrl + '/events/' + eventId + '/narrations/order', { ids });
  }

  assetContentUrl(id: string): string {
    return this.baseUrl + '/media/assets/' + id + '/content';
  }

  assetThumbnailUrl(id: string): string {
    return this.baseUrl + '/media/assets/' + id + '/thumbnail';
  }

  private cachedGet<T>(url: string): Observable<T> {
    return this.http.get<T>(url).pipe(
      catchError((error: unknown) => {
        if (typeof caches === 'undefined') return throwError(() => error);
        return from(caches.open('memoria-viva-offline-v1').then(async (cache) => {
          const response = await cache.match(url);
          if (!response) throw error;
          return response.json() as Promise<T>;
        }));
      }),
    );
  }
}
