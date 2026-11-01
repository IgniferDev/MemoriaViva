import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, firstValueFrom, map, of, tap } from 'rxjs';
import { AppUser, LoginInput, MemoriaApiService, RegisterInput } from '../api/memoria-api.service';
import { OfflineCollectionService } from '../offline/offline-collection.service';

const PROFILE_KEY = 'memoria-viva-session-profile';
const SIGNED_OUT_KEY = 'memoria-viva-signed-out';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(MemoriaApiService);
  private readonly offline = inject(OfflineCollectionService);
  readonly currentUser = signal<AppUser | null>(this.readProfile());
  private checked = false;

  loadSession(): Observable<AppUser | null> {
    if (this.checked) return of(this.currentUser());
    if (localStorage.getItem(SIGNED_OUT_KEY) === 'true') {
      this.currentUser.set(null);
      this.checked = true;
      return of(null);
    }
    return this.api.getCurrentUser().pipe(
      tap((user) => this.setUser(user)),
      map((user) => user),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500)) {
          return of(this.currentUser());
        }
        this.currentUser.set(null);
        localStorage.removeItem(PROFILE_KEY);
        void this.clearPrivateStorage();
        return of(null);
      }),
      tap(() => { this.checked = true; }),
    );
  }

  login(input: LoginInput): Observable<AppUser> {
    return this.api.login(input).pipe(map(({ user }) => { localStorage.removeItem(SIGNED_OUT_KEY); this.setUser(user); this.checked = true; return user; }));
  }

  register(input: RegisterInput): Observable<AppUser> {
    return this.api.register(input).pipe(map(({ user }) => { localStorage.removeItem(SIGNED_OUT_KEY); this.setUser(user); this.checked = true; return user; }));
  }

  async logout(): Promise<void> {
    localStorage.setItem(SIGNED_OUT_KEY, 'true');
    try { await firstValueFrom(this.api.logout()); } catch { /* still remove the local session */ }
    this.currentUser.set(null);
    this.checked = true;
    localStorage.removeItem(PROFILE_KEY);
    await this.clearPrivateStorage();
  }

  private setUser(user: AppUser): void {
    const previousId = this.currentUser()?.id;
    if (previousId && previousId !== user.id) void this.offline.clearPrivateData();
    this.currentUser.set(user);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
  }

  private readProfile(): AppUser | null {
    try {
      const value = localStorage.getItem(PROFILE_KEY);
      return value ? JSON.parse(value) as AppUser : null;
    } catch { return null; }
  }

  private async clearPrivateStorage(): Promise<void> {
    localStorage.removeItem(PROFILE_KEY);
    await this.offline.clearPrivateData();
  }
}
