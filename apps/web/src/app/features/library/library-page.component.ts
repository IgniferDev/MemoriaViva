import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OfflineCollectionService } from '../../core/offline/offline-collection.service';
import {
  Collection,
  CollectionKind,
  EventRecord,
  MemoriaApiService,
} from '../../core/api/memoria-api.service';

type CollectionFilter = 'ALL' | CollectionKind;

@Component({
  selector: 'app-library-page',
  standalone: true,
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './library-page.component.html',
  styleUrl: './library-page.component.scss',
})
export class LibraryPageComponent {
  private readonly api = inject(MemoriaApiService);
  readonly offline = inject(OfflineCollectionService);

  readonly collections = signal<Collection[]>([]);
  readonly searchResults = signal<EventRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly kindFilter = signal<CollectionFilter>('ALL');
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly visibleCollections = computed(() => {
    const filter = this.kindFilter();
    if (filter === 'ALL') return this.collections();
    return this.collections().filter((item) => item.kind === filter);
  });

  constructor() {
    this.loadCollections();
    this.searchControl.valueChanges.pipe(startWith(this.searchControl.value))
      .pipe(
        debounceTime(300),
        map((search) => search.trim()),
        distinctUntilChanged(),
        switchMap((filters) =>
          filters.length >= 2
            ? this.api.getEvents({ search: filters })
            : of([]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (events) => this.searchResults.set(events),
        error: () => this.searchResults.set([]),
      });
  }

  loadCollections(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.getCollections().subscribe({
      next: (items) => {
        this.collections.set(items);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(
          'No fue posible cargar la biblioteca. Revisa la conexión con la API.',
        );
        this.loading.set(false);
      },
    });
  }

  onFilterChange(value: CollectionFilter): void {
    this.kindFilter.set(value);
  }

  collectionType(kind: CollectionKind): string {
    return {
      ALBUM: 'Álbum',
      TIMELINE: 'Línea de tiempo',
      EDUCATIONAL: 'Colección educativa',
    }[kind];
  }

  coverUrl(assetId: string): string { return this.offline.assetContentUrl(assetId); }

  eventDate(event: EventRecord): string {
    if (!event.dateStart) return 'Fecha no indicada';
    return event.dateStart.slice(0, 10);
  }

  hasActiveEventFilters(): boolean {
    return this.searchControl.value.trim().length >= 2;
  }
}
