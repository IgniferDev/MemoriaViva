import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { Person, MemoriaApiService } from '../../core/api/memoria-api.service';

@Component({
  selector: 'app-people-page',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, RouterLink],
  templateUrl: './people-page.component.html',
  styleUrl: './people-page.component.scss',
})
export class PeoplePageComponent {
  private readonly api = inject(MemoriaApiService);
  readonly people = signal<Person[]>([]);
  readonly newName = signal('');
  readonly editName = signal('');
  readonly editingId = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly error = signal('');

  constructor() { this.load(); }

  load(): void {
    this.api.getPeople().subscribe({ next: (people) => this.people.set(people), error: () => this.error.set('No se pudieron cargar las personas.') });
  }

  create(): void {
    const name = this.newName().trim();
    if (!name) return;
    this.error.set('');
    this.api.createPerson(name).subscribe({
      next: (person) => { this.people.update((items) => items.some((item) => item.id === person.id) ? items : [...items, person].sort((a, b) => a.name.localeCompare(b.name))); this.newName.set(''); },
      error: () => this.error.set('No se pudo guardar. Comprueba si ese nombre ya existe.'),
    });
  }

  beginEdit(person: Person): void { this.editingId.set(person.id); this.editName.set(person.name); this.error.set(''); }
  cancelEdit(): void { this.editingId.set(null); this.editName.set(''); }
  initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join(''); }

  saveEdit(person: Person): void {
    const name = this.editName().trim();
    if (!name || this.busyId()) return;
    this.busyId.set(person.id); this.error.set('');
    this.api.updatePerson(person.id, name).subscribe({
      next: (updated) => { this.people.update((items) => items.map((item) => item.id === updated.id ? updated : item).sort((a, b) => a.name.localeCompare(b.name))); this.busyId.set(null); this.cancelEdit(); },
      error: () => { this.busyId.set(null); this.error.set('No se pudo actualizar. Puede que ya exista otra persona con ese nombre.'); },
    });
  }

  remove(person: Person): void {
    if (this.busyId() || !window.confirm(`¿Borrar a ${person.name}? Se quitará su vínculo de recuerdos y narraciones, pero estos no se borrarán.`)) return;
    this.busyId.set(person.id); this.error.set('');
    this.api.deletePerson(person.id).subscribe({
      next: () => { this.people.update((items) => items.filter((item) => item.id !== person.id)); this.busyId.set(null); },
      error: () => { this.busyId.set(null); this.error.set('No se pudo borrar a esta persona. Recarga la lista e inténtalo de nuevo.'); },
    });
  }
}
