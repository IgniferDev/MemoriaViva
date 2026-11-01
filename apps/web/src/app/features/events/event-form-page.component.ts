import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Person, MemoriaApiService } from '../../core/api/memoria-api.service';

interface PhotoDraft { id: string; file: File; url: string; }
interface AudioDraft { id: string; file: File; title: string; speakerPersonId: string; relatedPhotoId: string; }

@Component({
  selector: 'app-event-form-page',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, ReactiveFormsModule, RouterLink],
  templateUrl: './event-form-page.component.html',
  styleUrl: './event-form-page.component.scss',
})
export class EventFormPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(MemoriaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly eventId = signal<string | null>(null);
  readonly collectionId = signal<string | null>(null);
  readonly people = signal<Person[]>([]);
  readonly selectedPeople = signal<string[]>([]);
  readonly newPersonName = signal('');
  readonly photoFiles = signal<File[]>([]);
  readonly photoPreviews = signal<PhotoDraft[]>([]);
  readonly photoAssetIds = signal<Record<string, string>>({});
  readonly audioFiles = signal<AudioDraft[]>([]);
  readonly recordingTitle = signal('');
  readonly recording = signal(false);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', Validators.maxLength(20000)],
    date: [''],
    locationName: ['', Validators.maxLength(200)],
  });
  private recorder?: MediaRecorder;
  private audioChunks: BlobPart[] = [];

  ngOnDestroy(): void {
    for (const preview of this.photoPreviews()) URL.revokeObjectURL(preview.url);
  }

  ngOnInit(): void {
    this.collectionId.set(this.route.snapshot.queryParamMap.get('collectionId'));
    this.api.getPeople().subscribe({ next: (items) => this.people.set(items) });
    const id = this.route.snapshot.paramMap.get('id');
    if (!id || id === 'new') return;
    this.eventId.set(id);
    this.loading.set(true);
    this.api.getEvent(id).subscribe({
      next: (event) => {
        if (!this.collectionId()) this.collectionId.set(event.collectionItems?.[0]?.collectionId ?? null);
        this.form.patchValue({
          title: event.title,
          description: event.description ?? '',
          date: event.dateStart?.slice(0, 10) ?? '',
          locationName: event.locationName ?? '',
        });
        this.selectedPeople.set((event.people ?? []).map((item) => item.person.id));
        this.loading.set(false);
      },
      error: () => { this.error.set('No pudimos abrir este recuerdo.'); this.loading.set(false); },
    });
  }

  selectPhotos(input: HTMLInputElement): void {
    const selected = Array.from(input.files ?? []);
    input.value = '';
    this.photoFiles.update((files) => [...files, ...selected]);
    this.photoPreviews.update((previews) => [...previews, ...selected.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]);
  }

  selectAudios(input: HTMLInputElement): void {
    const selected = Array.from(input.files ?? []);
    input.value = '';
    this.audioFiles.update((drafts) => [...drafts, ...selected.map((file) => ({
      id: crypto.randomUUID(),
      file,
      title: file.name.replace(/\.[^.]+$/, '').trim() || 'Narración',
      speakerPersonId: '',
      relatedPhotoId: '',
    }))]);
  }

  removePhoto(file: File, preserveAudioLinks = false): void {
    this.photoFiles.update((files) => files.filter((item) => item !== file));
    const preview = this.photoPreviews().find((item) => item.file === file);
    if (preview) URL.revokeObjectURL(preview.url);
    this.photoPreviews.update((items) => items.filter((item) => item.file !== file));
    const previewId = preview?.id;
    if (previewId && !preserveAudioLinks) this.audioFiles.update((drafts) => drafts.map((draft) => draft.relatedPhotoId === previewId ? { ...draft, relatedPhotoId: '' } : draft));
  }
  removeAudio(draft: AudioDraft): void { this.audioFiles.update((items) => items.filter((item) => item.id !== draft.id)); }

  updateAudioDraft(id: string, field: 'title' | 'speakerPersonId' | 'relatedPhotoId', value: string): void {
    this.audioFiles.update((drafts) => drafts.map((draft) => draft.id === id ? { ...draft, [field]: value } : draft));
  }

  async addPerson(): Promise<void> {
    const name = this.newPersonName().trim();
    if (!name) return;
    try {
      const person = await firstValueFrom(this.api.createPerson(name));
      this.people.update((items) => items.some((item) => item.id === person.id) ? items : [...items, person].sort((a, b) => a.name.localeCompare(b.name)));
      this.selectedPeople.update((ids) => ids.includes(person.id) ? ids : [...ids, person.id]);
      this.newPersonName.set('');
      this.error.set('');
    } catch {
      this.error.set('No se pudo guardar a esta persona.');
    }
  }

  async startRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.error.set('Este navegador no permite grabar. Puedes elegir un archivo de audio.');
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
        if (blob.size) {
          const title = this.recordingTitle().trim() || `Narración ${this.audioFiles().length + 1}`;
          const file = new File([blob], `${title}.webm`, { type: blob.type });
          this.audioFiles.update((drafts) => [...drafts, { id: crypto.randomUUID(), file, title, speakerPersonId: '', relatedPhotoId: '' }]);
          this.recordingTitle.set('');
        }
        this.recording.set(false);
      };
      this.recorder.start();
      this.recording.set(true);
      this.error.set('');
    } catch { this.error.set('No se pudo acceder al micrófono. Revisa el permiso del navegador.'); }
  }

  stopRecording(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) { this.form.markAllAsTouched(); return; }
    const activeCollectionId = this.collectionId();
    if (!this.eventId() && !activeCollectionId) {
      this.error.set('Abre una colección para añadir un recuerdo.');
      return;
    }
    if (this.audioFiles().some((draft) => !draft.title.trim())) {
      this.error.set('Escribe un título para cada narración antes de guardar.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    const value = this.form.getRawValue();
    const input = {
      title: (value.title ?? '').trim(),
      description: (value.description ?? '').trim() || null,
      dateStart: value.date || null,
      locationName: (value.locationName ?? '').trim() || null,
      personIds: this.selectedPeople(),
      collectionId: activeCollectionId ?? '',
    };
    try {
      const currentId = this.eventId();
      const event = currentId
        ? await firstValueFrom(this.api.updateEvent(currentId, {
            title: input.title,
            description: input.description,
            dateStart: input.dateStart,
            locationName: input.locationName,
            personIds: input.personIds,
          }))
        : await firstValueFrom(this.api.createEvent(input));
      this.eventId.set(event.id);
      let uploadFailures = 0;
      for (const file of [...this.photoFiles()]) {
        try {
          const photo = await firstValueFrom(this.api.uploadPhoto(event.id, file));
          const draft = this.photoPreviews().find((item) => item.file === file);
          if (draft) this.photoAssetIds.update((items) => ({ ...items, [draft.id]: photo.asset.id }));
          this.removePhoto(file, true);
        } catch { uploadFailures += 1; }
      }
      for (const draft of [...this.audioFiles()]) {
        try {
          const speaker = this.people().find((person) => person.id === draft.speakerPersonId)?.name ?? '';
          const relatedPhotoAssetId = draft.relatedPhotoId ? this.photoAssetIds()[draft.relatedPhotoId] ?? '' : '';
          if (draft.relatedPhotoId && !relatedPhotoAssetId) throw new Error('La foto relacionada no se pudo subir');
          await firstValueFrom(this.api.uploadNarration(event.id, draft.file, draft.title.trim() || 'Narración', speaker, '', draft.file.name, relatedPhotoAssetId));
          this.removeAudio(draft);
        } catch { uploadFailures += 1; }
      }
      if (uploadFailures) {
        this.error.set(`El recuerdo quedó guardado, pero ${uploadFailures} archivo(s) no se pudieron adjuntar. Intenta guardar de nuevo.`);
        this.saving.set(false);
        return;
      }
      if (this.collectionId()) {
        void this.router.navigate(['/collections', this.collectionId(), 'read'], { queryParams: { eventId: event.id } });
      } else {
        void this.router.navigate(['/events', event.id]);
      }
    } catch {
      this.error.set('No se pudo guardar el recuerdo. Revisa la conexión e inténtalo de nuevo.');
    } finally { this.saving.set(false); }
  }
}
