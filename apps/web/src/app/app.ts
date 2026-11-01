import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterOutlet } from '@angular/router';
import { API_BASE_URL } from './core/api/api-base-url';
import { AuthService } from './core/auth/auth.service';

type ConnectionState = 'checking' | 'connected' | 'unavailable';

@Component({
  imports: [
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatToolbarModule,
    MatMenuModule,
    RouterLink,
    RouterOutlet,
  ],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly http = inject(HttpClient);
  readonly auth = inject(AuthService);
  readonly connection = signal<ConnectionState>('checking');

  ngOnInit(): void {
    this.refreshConnection();
  }

  refreshConnection(): void {
    this.connection.set('checking');
    this.http.get(API_BASE_URL + '/health').subscribe({
      next: () => this.connection.set('connected'),
      error: () => this.connection.set('unavailable'),
    });
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    window.location.assign('/welcome');
  }
}
