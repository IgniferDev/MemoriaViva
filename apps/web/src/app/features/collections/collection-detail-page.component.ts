import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OfflineCollectionService } from '../../core/offline/offline-collection.service';
import { MemoriaArchiveService } from '../../core/archive/memoria-archive.service';
import {
  CollectionDetail,
  CollectionKind,
  EventRecord,
  MemoriaApiService,
} from '../../core/api/memoria-api.service';

@Component({
  selector: 'app-collection-detail-page',
  standalone: true,
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    RouterLink,
  ],
  templateUrl: './collection-detail-page.component.html',
  styleUrl: './collection-detail-page.component.scss',
})
export class CollectionDetailPageComponent {
  private readonly api = inject(MemoriaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly offline = inject(OfflineCollectionService);
  readonly archive = inject(MemoriaArchiveService);
  readonly collection = signal<CollectionDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly savingOrder = signal(false);
  readonly deleting = signal(false);
  readonly offlineBusy = signal(false);
  readonly offlineMessage = signal('');
  readonly archiveBusy = signal(false);
  readonly showExisting = signal(false);
  readonly existingEvents = signal<EventRecord[]>([]);
  readonly existingSearch = signal('');
  readonly linkingEventId = signal<string | null>(null);
  readonly displayItems = computed(() => {
    const collection = this.collection();
    const items = collection?.items ?? [];
    if (collection?.kind !== 'TIMELINE') return items;
    return [...items].sort((a, b) => {
      const left = a.event.dateStart ?? '9999-12-31';
      const right = b.event.dateStart ?? '9999-12-31';
      return left.localeCompare(right) || a.position - b.position;
    });
  });
  readonly candidateEvents = computed(() => {
    const collection = this.collection();
    const linked = new Set(collection?.items.map((item) => item.eventId) ?? []);
    const term = this.existingSearch().trim().toLocaleLowerCase();
    return this.existingEvents().filter((event) =>
      !linked.has(event.id) && (!term || event.title.toLocaleLowerCase().includes(term)),
    );
  });

  constructor() {
    this.load();
  }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Falta el identificador de la colección.');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.api.getCollection(id).subscribe({
      next: (collection) => {
        this.collection.set(collection);
        this.error.set('');
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No encontramos esta colección.');
        this.loading.set(false);
      },
    });
  }

  collectionType(kind: CollectionKind): string {
    return {
      ALBUM: 'Álbum',
      TIMELINE: 'Línea de tiempo',
      EDUCATIONAL: 'Colección educativa',
    }[kind];
  }

  eventDate(event: EventRecord): string {
    if (!event.dateStart) return 'Fecha no indicada';
    return event.dateStart.slice(0, 10);
  }

  thumbnailUrl(assetId: string): string { return this.offline.assetThumbnailUrl(assetId); }
  coverUrl(assetId: string): string { return this.offline.assetContentUrl(assetId); }

  moveEvent(index: number, delta: -1 | 1): void {
    const collection = this.collection();
    if (!collection || collection.kind === 'TIMELINE') return;
    const items = [...this.displayItems()];
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    this.savingOrder.set(true);
    this.api
      .reorderCollectionEvents(
        collection.id,
        items.map((item) => item.eventId),
      )
      .subscribe({
        next: () => {
          this.savingOrder.set(false);
          this.load();
        },
        error: () => {
          this.savingOrder.set(false);
          this.error.set('No se pudo guardar el nuevo orden.');
        },
      });
  }

  removeEvent(eventId: string): void {
    const collection = this.collection();
    if (!collection) return;
    this.api.removeEventFromCollection(collection.id, eventId).subscribe({
      next: () => this.load(),
      error: () => this.error.set('No se pudo quitar el recuerdo de la colección.'),
    });
  }

  deleteCollection(): void {
    const collection = this.collection();
    if (!collection || this.deleting()) return;
    if (!window.confirm('¿Eliminar esta colección? Los recuerdos seguirán en tu biblioteca.')) {
      return;
    }
    this.deleting.set(true);
    this.api.deleteCollection(collection.id).subscribe({
      next: () => void this.router.navigate(['/']),
      error: () => {
        this.deleting.set(false);
        this.error.set('No se pudo eliminar la colección.');
      },
    });
  }

  async downloadOffline(): Promise<void> {
    const collection = this.collection();
    if (!collection || this.offlineBusy()) return;
    this.offlineBusy.set(true);
    this.offlineMessage.set('');
    try {
      await this.offline.download(collection.id);
      this.offlineMessage.set('Colección guardada para lectura sin conexión.');
    } catch {
      this.offlineMessage.set('No se completó la descarga. Revisa el espacio disponible y vuelve a intentarlo.');
    } finally {
      this.offlineBusy.set(false);
    }
  }

  async removeOffline(): Promise<void> {
    const collection = this.collection();
    if (!collection) return;
    await this.offline.remove(collection.id);
    this.offlineMessage.set('Se eliminó la copia local.');
  }

  async exportCollection(): Promise<void> {
    const collection = this.collection();
    if (!collection || this.archiveBusy()) return;
    this.archiveBusy.set(true);
    this.error.set('');
    try {
      const archive = await this.archive.exportCollection(collection.id);
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = archive.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      this.error.set('No se pudo exportar la colección. Comprueba que la API y sus medios estén disponibles.');
    } finally {
      this.archive.progress.set('');
      this.archiveBusy.set(false);
    }
  }

  toggleExisting(): void {
    const open = !this.showExisting();
    this.showExisting.set(open);
    if (!open || this.existingEvents().length) return;
    this.api.getEvents().subscribe({
      next: (events) => this.existingEvents.set(events),
      error: () => this.error.set('No se pudieron cargar los recuerdos existentes.'),
    });
  }

  linkExisting(eventId: string): void {
    const collection = this.collection();
    if (!collection || this.linkingEventId()) return;
    this.linkingEventId.set(eventId);
    this.api.addEventToCollection(collection.id, eventId).subscribe({
      next: () => { this.linkingEventId.set(null); this.load(); },
      error: () => { this.linkingEventId.set(null); this.error.set('No se pudo añadir el recuerdo.'); },
    });
  }
}
