import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  Collection,
  CollectionKind,
  MediaAsset,
  MemoriaApiService,
} from '../../core/api/memoria-api.service';

@Component({
  selector: 'app-collection-form-page',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './collection-form-page.component.html',
  styleUrl: './collection-form-page.component.scss',
})
export class CollectionFormPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(MemoriaApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly collectionId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly coverAsset = signal<MediaAsset | null>(null);
  readonly coverFile = signal<File | null>(null);
  readonly coverPreview = signal<string | null>(null);
  readonly removeCover = signal(false);
  readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(160)]],
    kind: ['ALBUM' as CollectionKind, Validators.required],
    description: ['', Validators.maxLength(5000)],
  });

  ngOnDestroy(): void {
    const preview = this.coverPreview();
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id || id === 'new') return;

    this.collectionId.set(id);
    this.loading.set(true);
    this.api.getCollection(id).subscribe({
      next: (collection) => {
        this.form.patchValue({
          title: collection.title,
          kind: collection.kind,
          description: collection.description ?? '',
        });
        this.coverAsset.set(collection.coverAsset ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No pudimos abrir esta colección.');
        this.loading.set(false);
      },
    });
  }

  selectCover(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const oldPreview = this.coverPreview();
    if (oldPreview?.startsWith('blob:')) URL.revokeObjectURL(oldPreview);
    this.coverFile.set(file);
    this.coverPreview.set(URL.createObjectURL(file));
    this.removeCover.set(false);
  }

  clearCover(): void {
    const oldPreview = this.coverPreview();
    if (oldPreview?.startsWith('blob:')) URL.revokeObjectURL(oldPreview);
    this.coverPreview.set(null);
    this.coverFile.set(null);
    this.removeCover.set(!!this.coverAsset());
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set('');
    const value = this.form.getRawValue();
    const input = {
      title: (value.title ?? '').trim(),
      kind: value.kind ?? 'ALBUM',
      description: (value.description ?? '').trim() || null,
    };
    let collectionSaved = false;
    try {
      const id = this.collectionId();
      let collection: Collection = id
        ? await firstValueFrom(this.api.updateCollection(id, input))
        : await firstValueFrom(this.api.createCollection(input));
      this.collectionId.set(collection.id);
      collectionSaved = true;
      const coverFile = this.coverFile();
      if (coverFile) {
        collection = await firstValueFrom(this.api.uploadCollectionCover(collection.id, coverFile));
        this.coverAsset.set(collection.coverAsset ?? null);
        this.coverFile.set(null);
        const preview = this.coverPreview();
        if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
        this.coverPreview.set(null);
      } else if (this.removeCover() && this.coverAsset()) {
        await firstValueFrom(this.api.removeCollectionCover(collection.id));
        this.coverAsset.set(null);
      }
      this.removeCover.set(false);
      void this.router.navigate(['/collections', collection.id]);
    } catch {
      this.error.set(collectionSaved
        ? 'La colección se guardó, pero no se pudo actualizar su portada. Revisa el archivo o la conexión e inténtalo de nuevo.'
        : 'No se pudo guardar la colección. Revisa los datos y vuelve a intentarlo.');
    } finally {
      this.saving.set(false);
    }
  }

  coverImage(): string | null {
    if (this.removeCover()) return null;
    return this.coverPreview() ?? (this.coverAsset() ? this.api.assetContentUrl(this.coverAsset()!.id) : null);
  }
}
