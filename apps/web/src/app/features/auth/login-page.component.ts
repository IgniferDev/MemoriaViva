import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule, RouterLink],
  template: `<main class="auth-page"><mat-card appearance="outlined" class="auth-panel">
    <p class="auth-eyebrow">Tu espacio privado</p><h1>Bienvenido de vuelta.</h1>
    <p class="auth-intro">Inicia sesión para volver a tus colecciones y recuerdos.</p>
    <form class="auth-form" [formGroup]="form" (ngSubmit)="submit()">
      <mat-form-field appearance="outline"><mat-label>Correo electrónico</mat-label><input matInput type="email" formControlName="email" autocomplete="email" />
        @if (form.controls.email.touched && form.controls.email.invalid) { <mat-error>Escribe un correo válido.</mat-error> }
      </mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Contraseña</mat-label><input matInput type="password" formControlName="password" autocomplete="current-password" />
        @if (form.controls.password.touched && form.controls.password.hasError('required')) { <mat-error>Escribe tu contraseña.</mat-error> }
      </mat-form-field>
      @if (error()) { <p class="auth-error" role="alert">{{ error() }}</p> }
      <div class="auth-actions"><a mat-button routerLink="/welcome">Volver</a><button mat-flat-button color="primary" type="submit" [disabled]="busy()">{{ busy() ? 'Ingresando…' : 'Iniciar sesión' }}</button></div>
    </form>
    <p class="auth-footnote">¿Aún no tienes cuenta? <a routerLink="/register">Regístrate</a></p>
  </mat-card></main>`,
  styleUrl: './auth-page.scss',
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = this.fb.nonNullable.group({ email: ['', [Validators.required, Validators.email]], password: ['', Validators.required] });

  submit(): void {
    if (this.form.invalid || this.busy()) { this.form.markAllAsTouched(); return; }
    this.busy.set(true); this.error.set('');
    this.auth.login(this.form.getRawValue()).subscribe({
      next: () => { this.busy.set(false); void this.router.navigateByUrl('/library'); },
      error: (error: unknown) => { this.busy.set(false); this.error.set(this.message(error)); },
    });
  }

  private message(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') return error.error.message;
    return 'No se pudo iniciar sesión. Revisa tu conexión e inténtalo de nuevo.';
  }
}
