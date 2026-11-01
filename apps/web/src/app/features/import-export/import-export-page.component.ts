import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { MemoriaArchiveService } from '../../core/archive/memoria-archive.service';

@Component({
  selector: 'app-import-export-page',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatProgressSpinnerModule, RouterLink],
  templateUrl: './import-export-page.component.html',
  styleUrl: './import-export-page.component.scss',
})
export class ImportExportPageComponent {
  private readonly router = inject(Router);
  readonly archive = inject(MemoriaArchiveService);
  readonly busy = signal(false);
  readonly error = signal('');

  async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const collection = await this.archive.importCollection(file);
      void this.router.navigate(['/collections', collection.id]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo importar el archivo.');
    } finally {
      this.archive.progress.set('');
      this.busy.set(false);
    }
  }
}
