import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { concatMap, finalize, firstValueFrom, from } from 'rxjs';
import { CollectionDetail, EventPhoto, EventRecord, MemoriaApiService, Narration, Person } from '../../core/api/memoria-api.service';
import { OfflineCollectionService } from '../../core/offline/offline-collection.service';

interface NarrationDraft { title: string; speakerId: string; relatedPhotoAssetId: string; transcript: string; }
interface PhotoDraft { id: string; file: File; url: string; }
interface NewNarrationDraft { id: string; file: File; url: string; title: string; speakerPersonId: string; relatedPhotoId: string; }
interface ReaderPhoto { id: string; src: string; alt: string; persisted?: EventPhoto; draftId?: string; }

@Component({
  selector: 'app-reader-page',
  standalone: true,
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, RouterLink],
  templateUrl: './reader-page.component.html',
  styleUrl: './reader-page.component.scss',
})
export class ReaderPageComponent implements OnDestroy {
  private readonly api = inject(MemoriaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly offline = inject(OfflineCollectionService);
  readonly collection = signal<CollectionDetail | null>(null);
  readonly people = signal<Person[]>([]);
  readonly index = signal(0);
  readonly photoIndex = signal(0);
  readonly createMode = signal(false);
  readonly editMode = signal(false);
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly savingNarrationId = signal<string | null>(null);
  readonly deletingNarrationId = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly editTitle = signal('');
  readonly editDescription = signal('');
  readonly editDate = signal('');
  readonly editLocation = signal('');
  readonly selectedPeople = signal<string[]>([]);
  readonly newPersonName = signal('');
  readonly speakerPersonId = signal('');
  readonly relatedPhotoAssetId = signal('');
  readonly narrationTitle = signal('');
  readonly uploadError = signal('');
  readonly narrationDrafts = signal<Record<string, NarrationDraft>>({});
  readonly photoDrafts = signal<PhotoDraft[]>([]);
  readonly newNarrationDrafts = signal<NewNarrationDraft[]>([]);
  readonly photoAssetIds = signal<Record<string, string>>({});
  readonly createdEventId = signal<string | null>(null);
  readonly creating = signal(false);
  readonly narrationsDirty = computed(() => this.narrations().some((voice) => this.isNarrationDirty(voice)));
  readonly hasUnsavedChanges = computed(() => this.dirty() || this.narrationsDirty());
  readonly items = computed(() => {
    const collection = this.collection();
    const items = collection?.items ?? [];
    return collection?.kind === 'TIMELINE'
      ? [...items].sort((a, b) => (a.event.dateStart ?? '9999-12-31').localeCompare(b.event.dateStart ?? '9999-12-31'))
      : items;
  });
  readonly current = computed(() => this.items()[this.index()]?.event ?? null);
  readonly activeEvent = computed<EventRecord | null>(() => this.current() ?? (this.createMode() ? {
    id: '', title: this.editTitle(), description: this.editDescription() || null,
    dateStart: this.editDate() || null, locationName: this.editLocation() || null,
    createdAt: '', updatedAt: '', photos: [], narrations: [], people: [],
  } : null));
  readonly photos = computed(() => [...(this.current()?.photos ?? [])].sort((a, b) => a.position - b.position));
  readonly currentPhoto = computed(() => this.photos()[this.photoIndex()] ?? null);
  readonly readerPhotos = computed<ReaderPhoto[]>(() => {
    const saved = this.photos().map((photo) => ({
      id: photo.id,
      src: this.assetUrl(photo.asset.id),
      alt: photo.caption || this.current()?.title || 'Fotografía del recuerdo',
      persisted: photo,
    }));
    return this.createMode()
      ? [...saved, ...this.photoDrafts().map((draft) => ({ id: draft.id, src: draft.url, alt: draft.file.name, draftId: draft.id }))]
      : saved;
  });
  readonly readerPhoto = computed(() => this.readerPhotos()[this.photoIndex()] ?? null);
  readonly narrations = computed(() => [...(this.current()?.narrations ?? [])].sort((a, b) => a.position - b.position));
  private recorder?: MediaRecorder;
  private audioChunks: BlobPart[] = [];
  private previousIndex = 0;
  readonly recording = signal(false);

  ngOnDestroy(): void {
    this.clearPhotoDrafts();
    for (const draft of this.newNarrationDrafts()) URL.revokeObjectURL(draft.url);
  }

  constructor() {
    this.api.getPeople().subscribe({ next: (people) => this.people.set(people) });
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.loading.set(false); this.error.set('Falta el identificador de la colección.'); return; }
    this.api.getCollection(id).subscribe({
      next: (collection) => {
        this.collection.set(collection);
        const requestedEvent = this.route.snapshot.queryParamMap.get('eventId');
        let requestedPosition = -1;
        if (requestedEvent) {
          requestedPosition = this.items().findIndex((item) => item.eventId === requestedEvent);
          if (requestedPosition >= 0) this.index.set(requestedPosition);
        }
        this.loading.set(false);
        if (this.route.snapshot.queryParamMap.get('create') === 'true') {
          if (requestedPosition >= 0 && this.current()) {
            this.beginEdit();
            this.createMode.set(true);
            this.createdEventId.set(requestedEvent);
          } else this.beginCreate(false);
        }
      },
      error: () => { this.error.set('No se pudo abrir esta colección.'); this.loading.set(false); },
    });
  }

  move(delta: -1 | 1): void {
    if (!this.allowMove()) return;
    this.index.update((value) => Math.max(0, Math.min(this.items().length - 1, value + delta)));
    this.photoIndex.set(0);
    if (this.editMode()) this.beginEdit();
  }

  selectEvent(index: number): void {
    if (!this.allowMove()) return;
    this.index.set(index);
    this.photoIndex.set(0);
    if (this.editMode()) this.beginEdit();
  }

  movePhoto(delta: -1 | 1): void {
    this.photoIndex.update((index) => Math.max(0, Math.min(this.readerPhotos().length - 1, index + delta)));
  }

  reorderPhoto(delta: -1 | 1): void {
    if (this.createMode()) return;
    const event = this.current();
    const currentPhotos = this.photos();
    const fromIndex = this.photoIndex();
    const targetIndex = fromIndex + delta;
    if (!event || targetIndex < 0 || targetIndex >= currentPhotos.length) return;
    const reordered = [...currentPhotos];
    [reordered[fromIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[fromIndex]];
    this.api.reorderPhotos(event.id, reordered.map((photo) => photo.id)).subscribe({
      next: () => {
        this.updateCurrent((current) => ({ ...current, photos: reordered.map((photo, position) => ({ ...photo, position })) }));
        this.photoIndex.set(targetIndex);
      },
      error: () => this.uploadError.set('No se pudo guardar el orden de las fotografías.'),
    });
  }

  selectPhoto(index: number): void { this.photoIndex.set(index); }
  selectPhotoForNarration(assetId: string): void {
    const index = this.photos().findIndex((photo) => photo.asset.id === assetId);
    if (index < 0) return;
    this.photoIndex.set(index);
    requestAnimationFrame(() => document.querySelector('.photo-stage')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  assetUrl(id: string): string { return this.offline.assetContentUrl(id); }
  thumbnailUrl(id: string): string { return this.offline.assetThumbnailUrl(id); }
  eventDate(event: EventRecord): string { return event.dateStart ? event.dateStart.slice(0, 10) : 'Fecha no indicada'; }
  peopleNames(event: EventRecord): string { return (event.people ?? []).map((person) => person.person.name).join(', '); }

  beginEdit(): void {
    const event = this.current();
    if (!event) return;
    this.editTitle.set(event.title);
    this.editDescription.set(event.description ?? '');
    this.editDate.set(event.dateStart?.slice(0, 10) ?? '');
    this.editLocation.set(event.locationName ?? '');
    this.selectedPeople.set((event.people ?? []).map((item) => item.person.id));
    this.narrationDrafts.set(Object.fromEntries((event.narrations ?? []).map((voice) => [voice.id, {
      title: voice.title,
      speakerId: voice.speaker?.id ?? '',
      relatedPhotoAssetId: voice.relatedPhotoAsset?.id ?? '',
      transcript: voice.transcript ?? '',
    }])));
    this.speakerPersonId.set('');
    this.dirty.set(false);
    this.uploadError.set('');
    this.editMode.set(true);
  }

  beginCreate(updateUrl = true): void {
    if (this.uploading() || this.recording() || this.saving()) return;
    this.previousIndex = Math.max(0, this.index());
    this.index.set(-1);
    this.clearPhotoDrafts();
    this.clearNewNarrations();
    this.photoAssetIds.set({});
    this.createdEventId.set(null);
    this.editTitle.set('');
    this.editDescription.set('');
    this.editDate.set('');
    this.editLocation.set('');
    this.selectedPeople.set([]);
    this.newPersonName.set('');
    this.narrationTitle.set('');
    this.speakerPersonId.set('');
    this.relatedPhotoAssetId.set('');
    this.photoIndex.set(0);
    this.dirty.set(false);
    this.uploadError.set('');
    this.createMode.set(true);
    this.editMode.set(true);
    if (updateUrl) void this.router.navigate([], { relativeTo: this.route, queryParams: { create: 'true', eventId: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  cancelCreate(): void {
    const hasDraft = !!(this.editTitle().trim() || this.editDescription().trim() || this.editDate() || this.editLocation().trim() ||
      this.selectedPeople().length || this.photoDrafts().length || this.newNarrationDrafts().length);
    const message = this.createdEventId()
      ? 'El recuerdo ya se creó. ¿Volver a la lectura y conservar lo que ya se guardó?'
      : 'Hay datos sin guardar. ¿Descartarlos y volver a la lectura?';
    if ((this.createdEventId() || hasDraft) && !window.confirm(message)) return;
    if (!this.createdEventId()) this.index.set(Math.min(this.previousIndex, this.items().length - 1));
    this.clearPhotoDrafts();
    this.clearNewNarrations();
    this.createMode.set(false);
    this.editMode.set(false);
    this.dirty.set(false);
    this.uploadError.set('');
    void this.router.navigate([], { relativeTo: this.route, queryParams: { create: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  selectCreatePhotos(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []).filter((file) => file.type.startsWith('image/'));
    input.value = '';
    const drafts = files.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
    this.photoDrafts.update((items) => [...items, ...drafts]);
    if (drafts.length) this.photoIndex.set(this.readerPhotos().length - 1);
  }

  removePhotoDraft(id: string): void {
    const draft = this.photoDrafts().find((item) => item.id === id);
    if (!draft) return;
    URL.revokeObjectURL(draft.url);
    this.photoDrafts.update((items) => items.filter((item) => item.id !== id));
    this.newNarrationDrafts.update((items) => items.map((item) => item.relatedPhotoId === id ? { ...item, relatedPhotoId: '' } : item));
    this.photoIndex.set(Math.max(0, Math.min(this.readerPhotos().length - 1, this.photoIndex())));
  }

  selectNewAudios(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []).filter((file) => file.type.startsWith('audio/') || /\.(m4a|mp3|wav|ogg|webm)$/i.test(file.name));
    input.value = '';
    this.newNarrationDrafts.update((items) => [...items, ...files.map((file) => ({
      id: crypto.randomUUID(), file, url: URL.createObjectURL(file),
      title: this.narrationTitle().trim() || file.name.replace(/\.[^.]+$/, '') || 'Narración',
      speakerPersonId: this.speakerPersonId(), relatedPhotoId: this.relatedPhotoAssetId(),
    }))]);
    this.narrationTitle.set('');
  }

  updateNewNarration(id: string, field: 'title' | 'speakerPersonId' | 'relatedPhotoId', value: string): void {
    this.newNarrationDrafts.update((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  removeNewNarration(id: string): void {
    const draft = this.newNarrationDrafts().find((item) => item.id === id);
    if (draft) URL.revokeObjectURL(draft.url);
    this.newNarrationDrafts.update((items) => items.filter((item) => item.id !== id));
  }

  newAudioUrl(draft: NewNarrationDraft): string { return draft.url; }

  async saveNewMemory(): Promise<void> {
    const collection = this.collection();
    const title = this.editTitle().trim();
    if (!collection || this.creating()) return;
    if (!title) { this.uploadError.set('El recuerdo necesita un título.'); return; }
    if (this.newNarrationDrafts().some((draft) => !draft.title.trim())) { this.uploadError.set('Escribe un título para cada narración.'); return; }
    this.creating.set(true);
    this.uploadError.set('');
    let failures = 0;
    try {
      const input = {
        title,
        description: this.editDescription().trim() || null,
        dateStart: this.editDate() || null,
        locationName: this.editLocation().trim() || null,
        personIds: this.selectedPeople(),
        collectionId: collection.id,
      };
      let event = this.createdEventId() ? this.current() : null;
      if (!event) {
        event = await firstValueFrom(this.api.createEvent(input));
        event = { ...event, photos: [], narrations: [], people: this.selectedPeople().map((id) => {
          const person = this.people().find((item) => item.id === id);
          return person ? { person } : null;
        }).filter((link): link is { person: Person } => !!link) };
        this.createdEventId.set(event.id);
        const currentCollection = this.collection();
        if (currentCollection) this.collection.set({
          ...currentCollection,
          items: [...currentCollection.items, { collectionId: currentCollection.id, eventId: event.id, position: currentCollection.items.length, event }],
        });
        this.index.set(this.items().findIndex((item) => item.eventId === event!.id));
        void this.router.navigate([], { relativeTo: this.route, queryParams: { create: 'true', eventId: event.id }, queryParamsHandling: 'merge', replaceUrl: true });
      } else {
        event = await firstValueFrom(this.api.updateEvent(event.id, input));
        this.setCurrent({ ...this.current()!, ...event, photos: this.current()?.photos ?? [], narrations: this.current()?.narrations ?? [], people: this.selectedPeople().map((id) => {
          const person = this.people().find((item) => item.id === id);
          return person ? { person } : null;
        }).filter((link): link is { person: Person } => !!link) });
      }

      for (const draft of [...this.photoDrafts()]) {
        try {
          const photo = await firstValueFrom(this.api.uploadPhoto(event.id, draft.file));
          this.photoAssetIds.update((ids) => ({ ...ids, [draft.id]: photo.asset.id }));
          this.updateCurrent((current) => ({ ...current, photos: [...(current.photos ?? []), photo] }));
          this.removePhotoDraft(draft.id);
        } catch { failures += 1; }
      }
      for (const draft of [...this.newNarrationDrafts()]) {
        try {
          if (this.photoDrafts().some((photo) => photo.id === draft.relatedPhotoId)) throw new Error('La foto relacionada no se ha guardado todavía');
          const relatedPhotoId = this.photoAssetIds()[draft.relatedPhotoId] ?? draft.relatedPhotoId;
          if (draft.relatedPhotoId && !relatedPhotoId) throw new Error('Foto relacionada pendiente');
          const speaker = this.people().find((person) => person.id === draft.speakerPersonId)?.name ?? '';
          const voice = await firstValueFrom(this.api.uploadNarration(event.id, draft.file, draft.title.trim(), speaker, '', draft.file.name, relatedPhotoId));
          this.updateCurrent((current) => ({ ...current, narrations: [...(current.narrations ?? []), voice] }));
          this.removeNewNarration(draft.id);
        } catch { failures += 1; }
      }
      if (failures) {
        this.uploadError.set(`El recuerdo ya está creado. ${failures} archivo(s) no se pudieron guardar; vuelve a intentarlo para completar la historia.`);
        return;
      }
      this.createMode.set(false);
      this.editMode.set(false);
      this.dirty.set(false);
      this.createdEventId.set(null);
      void this.router.navigate([], { relativeTo: this.route, queryParams: { create: null, eventId: event.id }, queryParamsHandling: 'merge', replaceUrl: true });
    } catch {
      this.uploadError.set('No se pudo crear el recuerdo. Revisa la conexión e inténtalo de nuevo.');
    } finally { this.creating.set(false); }
  }

  markDirty(): void { this.dirty.set(true); }

  async addPerson(): Promise<void> {
    const name = this.newPersonName().trim();
    if (!name) return;
    try {
      const person = await firstValueFrom(this.api.createPerson(name));
      this.people.update((items) => items.some((item) => item.id === person.id) ? items : [...items, person].sort((a, b) => a.name.localeCompare(b.name)));
      this.selectedPeople.update((ids) => ids.includes(person.id) ? ids : [...ids, person.id]);
      this.newPersonName.set('');
      this.markDirty();
    } catch {
      this.uploadError.set('No se pudo guardar a esta persona.');
    }
  }

  async saveDetails(): Promise<boolean> {
    const event = this.current();
    if (!event || this.saving()) return false;
    const title = this.editTitle().trim();
    if (!title) { this.uploadError.set('El título es obligatorio.'); return false; }
    this.saving.set(true);
    this.uploadError.set('');
    try {
      const updated = await firstValueFrom(this.api.updateEvent(event.id, {
        title,
        description: this.editDescription().trim() || null,
        dateStart: this.editDate() || null,
        locationName: this.editLocation().trim() || null,
        personIds: this.selectedPeople(),
      }));
      this.setCurrent({ ...event, ...updated, photos: event.photos, narrations: event.narrations, people: this.selectedPeople().map((id) => {
        const person = this.people().find((item) => item.id === id);
        return person ? { person } : null;
      }).filter((link): link is { person: Person } => !!link) });
      this.dirty.set(false);
      return true;
    } catch {
      this.uploadError.set('No se pudieron guardar los cambios del recuerdo.');
      return false;
    } finally { this.saving.set(false); }
  }

  async saveChanges(): Promise<void> {
    if (this.uploading() || this.recording() || this.saving() || this.savingNarrationId() || this.deletingNarrationId()) return;
    this.uploadError.set('');
    if (this.dirty() && !(await this.saveDetails())) return;
    for (const voice of this.narrations()) {
      if (this.isNarrationDirty(voice) && !(await this.saveNarration(voice))) return;
    }
    this.editMode.set(false);
    this.dirty.set(false);
  }

  narrationDraft(voice: Narration): NarrationDraft {
    return this.narrationDrafts()[voice.id] ?? {
      title: voice.title,
      speakerId: voice.speaker?.id ?? '',
      relatedPhotoAssetId: voice.relatedPhotoAsset?.id ?? '',
      transcript: voice.transcript ?? '',
    };
  }

  setNarrationDraft(voice: Narration, field: keyof NarrationDraft, value: string): void {
    this.narrationDrafts.update((drafts) => ({ ...drafts, [voice.id]: { ...this.narrationDraft(voice), [field]: value } }));
  }

  async saveNarration(voice: Narration): Promise<boolean> {
    const event = this.current();
    if (!event || this.savingNarrationId()) return false;
    const draft = this.narrationDraft(voice);
    if (!draft.title.trim()) { this.uploadError.set('Cada narración necesita un título.'); return false; }
    this.savingNarrationId.set(voice.id);
    this.uploadError.set('');
    try {
      const updated = await firstValueFrom(this.api.updateNarration(event.id, voice.id, {
        title: draft.title.trim(),
        speakerId: draft.speakerId || null,
        relatedPhotoAssetId: draft.relatedPhotoAssetId || null,
        transcript: draft.transcript.trim() || null,
      }));
      this.updateCurrent((current) => ({ ...current, narrations: (current.narrations ?? []).map((item) => item.id === voice.id ? updated : item) }));
      this.narrationDrafts.update((drafts) => ({ ...drafts, [voice.id]: {
        title: updated.title,
        speakerId: updated.speaker?.id ?? '',
        relatedPhotoAssetId: updated.relatedPhotoAsset?.id ?? '',
        transcript: updated.transcript ?? '',
      } }));
      return true;
    } catch {
      this.uploadError.set('No se pudieron guardar los cambios de esta narración.');
      return false;
    } finally { this.savingNarrationId.set(null); }
  }

  isNarrationDirty(voice: Narration): boolean {
    const draft = this.narrationDrafts()[voice.id];
    return !!draft && (draft.title.trim() !== voice.title || (draft.speakerId || '') !== (voice.speaker?.id ?? '') ||
      (draft.relatedPhotoAssetId || '') !== (voice.relatedPhotoAsset?.id ?? '') || (draft.transcript.trim() || '') !== (voice.transcript ?? ''));
  }

  uploadPhotos(input: HTMLInputElement): void {
    if (this.createMode()) { this.selectCreatePhotos(input); return; }
    const event = this.current();
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!event || !files.length) return;
    this.uploading.set(true);
    this.uploadError.set('');
    from(files).pipe(
      concatMap(async (file) => {
        return await firstValueFrom(this.api.uploadPhoto(event.id, file));
      }),
      finalize(() => this.uploading.set(false)),
    ).subscribe({
      next: (photo) => { if (photo) this.addPhotoLocally(photo); },
      error: () => this.uploadError.set('No se pudieron adjuntar todas las fotos. Revisa el formato y el límite de 25 MB.'),
    });
  }

  uploadAudios(input: HTMLInputElement): void {
    if (this.createMode()) { this.selectNewAudios(input); return; }
    const event = this.current();
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!event || !files.length) return;
    const customTitle = this.narrationTitle().trim();
    this.uploading.set(true);
    this.uploadError.set('');
    from(files).pipe(
      concatMap((file) => this.api.uploadNarration(
        event.id,
        file,
        files.length === 1 && customTitle ? customTitle : file.name.replace(/\.[^.]+$/, '') || 'Narración',
        this.selectedSpeakerName(),
        '',
        file.name,
        this.relatedPhotoAssetId(),
      )),
      finalize(() => this.uploading.set(false)),
    ).subscribe({
      next: (voice) => this.addNarrationLocally(voice),
      error: () => this.uploadError.set('No se pudieron adjuntar todas las narraciones. Revisa el formato y el límite de 100 MB.'),
    });
  }

  async startRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.uploadError.set('Este navegador no permite grabar audio. Puedes cargar una grabación.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined;
      this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.audioChunks = [];
      this.recorder.ondataavailable = (event) => { if (event.data.size) this.audioChunks.push(event.data); };
      this.recorder.onstop = () => {
        const blob = new Blob(this.audioChunks, { type: this.recorder?.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        const file = new File([blob], `${this.narrationTitle().trim() || 'Narración'}.webm`, { type: blob.type });
        this.recording.set(false);
        if (this.createMode()) {
          if (file.size) this.newNarrationDrafts.update((items) => [...items, {
            id: crypto.randomUUID(), file, url: URL.createObjectURL(file),
            title: this.narrationTitle().trim() || `Narración ${items.length + 1}`,
            speakerPersonId: this.speakerPersonId(), relatedPhotoId: this.relatedPhotoAssetId(),
          }]);
          this.narrationTitle.set('');
          return;
        }
        const current = this.current();
        if (!current || !file.size) return;
        this.uploading.set(true);
        this.api.uploadNarration(current.id, file, this.narrationTitle().trim() || 'Una voz del recuerdo', this.selectedSpeakerName(), '', file.name, this.relatedPhotoAssetId())
          .pipe(finalize(() => this.uploading.set(false)))
          .subscribe({ next: (voice) => this.addNarrationLocally(voice), error: () => this.uploadError.set('No se pudo guardar la grabación.') });
      };
      this.recorder.start();
      this.recording.set(true);
      this.uploadError.set('');
    } catch { this.uploadError.set('No se pudo acceder al micrófono. Revisa el permiso del navegador.'); }
  }

  stopRecording(): void { if (this.recorder?.state === 'recording') this.recorder.stop(); }

  deletePhoto(photo: EventPhoto): void {
    const event = this.current();
    if (!event) return;
    this.api.deletePhoto(event.id, photo.id).subscribe({
      next: () => {
        const removedIndex = this.photos().findIndex((item) => item.id === photo.id);
        this.updateCurrent((current) => ({
          ...current,
          photos: (current.photos ?? []).filter((item) => item.id !== photo.id),
          narrations: (current.narrations ?? []).map((voice) => voice.relatedPhotoAsset?.id === photo.asset.id ? { ...voice, relatedPhotoAsset: null } : voice),
        }));
        this.narrationDrafts.update((drafts) => {
          const next = { ...drafts };
          for (const [id, draft] of Object.entries(next)) if (draft.relatedPhotoAssetId === photo.asset.id) next[id] = { ...draft, relatedPhotoAssetId: '' };
          return next;
        });
        this.photoIndex.set(Math.max(0, Math.min(this.photos().length - 1, removedIndex <= this.photoIndex() ? this.photoIndex() - 1 : this.photoIndex())));
      },
      error: () => this.uploadError.set('No se pudo quitar esta fotografía.'),
    });
  }

  deleteNarration(voice: Narration): void {
    const event = this.current();
    if (!event || this.uploading() || this.savingNarrationId() || this.deletingNarrationId()) return;
    if (!window.confirm(`¿Eliminar la narración “${voice.title}”? Esta acción no se puede deshacer.`)) return;
    this.deletingNarrationId.set(voice.id);
    this.api.deleteNarration(event.id, voice.id).pipe(finalize(() => this.deletingNarrationId.set(null))).subscribe({
      next: () => {
        this.updateCurrent((current) => ({ ...current, narrations: (current.narrations ?? []).filter((item) => item.id !== voice.id) }));
        this.narrationDrafts.update((drafts) => { const next = { ...drafts }; delete next[voice.id]; return next; });
      },
      error: () => this.uploadError.set('No se pudo quitar esta narración.'),
    });
  }

  private allowMove(): boolean {
    if (this.uploading() || this.recording() || this.saving() || this.savingNarrationId() || this.deletingNarrationId()) {
      this.uploadError.set('Espera a que termine la operación actual para cambiar de recuerdo.');
      return false;
    }
    if (this.editMode() && this.hasUnsavedChanges()) {
      if (!window.confirm('Hay cambios sin guardar. ¿Descartarlos y cambiar de recuerdo?')) return false;
      this.dirty.set(false);
    }
    return true;
  }

  private selectedSpeakerName(): string {
    return this.people().find((person) => person.id === this.speakerPersonId())?.name ?? '';
  }

  private addPhotoLocally(photo: EventPhoto): void {
    this.updateCurrent((event) => ({ ...event, photos: [...(event.photos ?? []), photo].sort((a, b) => a.position - b.position) }));
  }

  private addNarrationLocally(voice: Narration): void {
    this.updateCurrent((event) => ({ ...event, narrations: [...(event.narrations ?? []), voice].sort((a, b) => a.position - b.position) }));
    this.narrationDrafts.update((drafts) => ({ ...drafts, [voice.id]: {
      title: voice.title, speakerId: voice.speaker?.id ?? '', relatedPhotoAssetId: voice.relatedPhotoAsset?.id ?? '', transcript: voice.transcript ?? '',
    } }));
  }

  private setCurrent(event: EventRecord): void {
    const collection = this.collection();
    if (!collection) return;
    this.collection.set({ ...collection, items: collection.items.map((item) => item.eventId === event.id ? { ...item, event } : item) });
  }

  private updateCurrent(update: (event: EventRecord) => EventRecord): void {
    const event = this.current();
    if (event) this.setCurrent(update(event));
  }

  private clearPhotoDrafts(): void {
    for (const draft of this.photoDrafts()) URL.revokeObjectURL(draft.url);
    this.photoDrafts.set([]);
  }

  private clearNewNarrations(): void {
    for (const draft of this.newNarrationDrafts()) URL.revokeObjectURL(draft.url);
    this.newNarrationDrafts.set([]);
  }
}
