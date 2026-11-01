import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { concatMap, finalize, from } from 'rxjs';
import { EventRecord, MemoriaApiService } from '../../core/api/memoria-api.service';
import { OfflineCollectionService } from '../../core/offline/offline-collection.service';

@Component({
  selector: 'app-event-detail-page',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatProgressSpinnerModule, RouterLink],
  templateUrl: './event-detail-page.component.html',
  styleUrl: './event-detail-page.component.scss',
})
export class EventDetailPageComponent {
  private readonly api = inject(MemoriaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly offline = inject(OfflineCollectionService);
  readonly event = signal<EventRecord | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly recording = signal(false);
  readonly narrationTitle = signal('Un recuerdo contado');
  readonly speakerName = signal('');
  readonly relatedPhotoAssetId = signal('');
  readonly transcript = signal('');
  readonly error = signal('');
  readonly displayDate = computed(() => {
    const event = this.event();
    if (!event?.dateStart) return 'Fecha no indicada';
    return event.dateStart.slice(0, 10);
  });
  private recorder?: MediaRecorder;
  private recordingChunks: BlobPart[] = [];

  constructor() {
    this.load();
  }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      this.error.set('Falta el identificador del recuerdo.');
      return;
    }
    this.api.getEvent(id).subscribe({
      next: (event) => {
        this.event.set(event);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No encontramos este recuerdo.');
        this.loading.set(false);
      },
    });
  }

  assetUrl(id: string): string { return this.offline.assetContentUrl(id); }
  thumbnailUrl(id: string): string { return this.offline.assetThumbnailUrl(id); }

  uploadPhotos(input: HTMLInputElement): void {
    const event = this.event();
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!event || !files.length) return;
    this.busy.set(true);
    this.error.set('');
    from(files)
      .pipe(
        concatMap((file) => this.api.uploadPhoto(event.id, file, window.prompt(`Pie de foto para “${file.name}”`, '') ?? '')),
        finalize(() => { this.busy.set(false); this.load(); }),
      )
      .subscribe({ error: () => this.error.set('No se pudo guardar una fotografía. Usa JPG, PNG, WebP o GIF, de hasta 25 MB.') });
  }

  uploadAudio(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.saveNarration(file, file.name);
  }

  async startRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.error.set('Este navegador no permite grabar audio. Puedes cargar un archivo existente.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined;
      this.recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      this.recordingChunks = [];
      this.recorder.ondataavailable = (event) => {
        if (event.data.size) this.recordingChunks.push(event.data);
      };
      this.recorder.onstop = () => {
        const audio = new Blob(this.recordingChunks, { type: this.recorder?.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        if (audio.size) this.saveNarration(audio, 'voz.webm');
      };
      this.recorder.start();
      this.recording.set(true);
      this.error.set('');
    } catch {
      this.error.set('No se pudo acceder al micrófono. Revisa el permiso del navegador.');
    }
  }

  stopRecording(): void {
    if (this.recorder?.state === 'recording') {
      this.recording.set(false);
      this.recorder.stop();
    }
  }

  deletePhoto(photoId: string): void {
    const event = this.event();
    if (!event) return;
    this.api.deletePhoto(event.id, photoId).subscribe({
      next: () => this.load(),
      error: () => this.error.set('No se pudo quitar la fotografía.'),
    });
  }

  editCaption(photoId: string, currentCaption: string | null): void {
    const event = this.event();
    if (!event) return;
    const caption = window.prompt('Pie de foto', currentCaption ?? '');
    if (caption === null) return;
    this.api.updatePhotoCaption(event.id, photoId, caption).subscribe({
      next: () => this.load(),
      error: () => this.error.set('No se pudo guardar el pie de foto.'),
    });
  }

  movePhoto(index: number, delta: -1 | 1): void {
    const event = this.event();
    const photos = [...(event?.photos ?? [])];
    const target = index + delta;
    if (!event || target < 0 || target >= photos.length) return;
    [photos[index], photos[target]] = [photos[target], photos[index]];
    this.api.reorderPhotos(event.id, photos.map((photo) => photo.id)).subscribe({
      next: () => this.load(),
      error: () => this.error.set('No se pudo cambiar el orden de las fotos.'),
    });
  }

  moveNarration(index: number, delta: -1 | 1): void {
    const event = this.event();
    const narrations = [...(event?.narrations ?? [])];
    const target = index + delta;
    if (!event || target < 0 || target >= narrations.length) return;
    [narrations[index], narrations[target]] = [narrations[target], narrations[index]];
    this.api.reorderNarrations(event.id, narrations.map((voice) => voice.id)).subscribe({
      next: () => this.load(),
      error: () => this.error.set('No se pudo cambiar el orden de las narraciones.'),
    });
  }

  deleteNarration(narrationId: string): void {
    const event = this.event();
    if (!event) return;
    this.api.deleteNarration(event.id, narrationId).subscribe({
      next: () => this.load(),
      error: () => this.error.set('No se pudo quitar la narración.'),
    });
  }

  deleteEvent(): void {
    const event = this.event();
    if (!event || !window.confirm('¿Eliminar este recuerdo y sus relaciones?')) return;
    const collectionId = event.collectionItems?.[0]?.collectionId;
    this.api.deleteEvent(event.id).subscribe({
      next: () => void this.router.navigate(collectionId ? ['/collections', collectionId] : ['/']),
      error: () => this.error.set('No se pudo eliminar el recuerdo.'),
    });
  }

  private saveNarration(file: File | Blob, filename: string): void {
    const event = this.event();
    if (!event) return;
    this.busy.set(true);
    this.error.set('');
    const title = this.narrationTitle().trim() || 'Un recuerdo contado';
    this.api.uploadNarration(event.id, file, title, this.speakerName(), this.transcript(), filename, this.relatedPhotoAssetId())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.narrationTitle.set('Un recuerdo contado');
          this.transcript.set('');
          this.load();
        },
        error: () => this.error.set('No se pudo guardar el audio. Formatos admitidos: MP3, M4A, WAV, OGG o WebM (máximo 100 MB).'),
      });
  }
}
