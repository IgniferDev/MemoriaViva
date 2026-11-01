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
  selector: 'app-register-page',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule, RouterLink],
  template: `<main class="auth-page"><mat-card appearance="outlined" class="auth-panel">
    <p class="auth-eyebrow">Tu biblioteca comienza aquí</p><h1>Crear cuenta</h1>
    <p class="auth-intro">Tus recuerdos y colecciones serán privados para tu cuenta.</p>
    <form class="auth-form" [formGroup]="form" (ngSubmit)="submit()">
      <div class="auth-two-columns">
        <mat-form-field appearance="outline"><mat-label>Nombre</mat-label><input matInput formControlName="firstName" autocomplete="given-name" />
          @if (form.controls.firstName.touched && form.controls.firstName.invalid) { <mat-error>Escribe tu nombre.</mat-error> }
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Apellidos</mat-label><input matInput formControlName="lastName" autocomplete="family-name" />
          @if (form.controls.lastName.touched && form.controls.lastName.invalid) { <mat-error>Escribe tus apellidos.</mat-error> }
        </mat-form-field>
      </div>
      <div class="auth-two-columns">
        <mat-form-field appearance="outline"><mat-label>Fecha de nacimiento</mat-label><input matInput type="date" formControlName="birthDate" autocomplete="bday" />
          @if (form.controls.birthDate.touched && form.controls.birthDate.invalid) { <mat-error>Selecciona una fecha.</mat-error> }
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>País</mat-label><input matInput formControlName="country" autocomplete="country-name" />
          @if (form.controls.country.touched && form.controls.country.invalid) { <mat-error>Escribe tu país.</mat-error> }
        </mat-form-field>
      </div>
      <mat-form-field appearance="outline"><mat-label>Correo electrónico</mat-label><input matInput type="email" formControlName="email" autocomplete="email" />
        @if (form.controls.email.touched && form.controls.email.invalid) { <mat-error>Escribe un correo válido.</mat-error> }
      </mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Contraseña</mat-label><input matInput type="password" formControlName="password" autocomplete="new-password" />
        <mat-hint>Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo.</mat-hint>
      </mat-form-field>
      <mat-form-field appearance="outline"><mat-label>Confirmar contraseña</mat-label><input matInput type="password" formControlName="confirmPassword" autocomplete="new-password" />
        @if (form.controls.confirmPassword.touched && passwordsDoNotMatch()) { <mat-error>Las contraseñas no coinciden.</mat-error> }
      </mat-form-field>
      @if (error()) { <p class="auth-error" role="alert">{{ error() }}</p> }
      <div class="auth-actions"><a mat-button routerLink="/welcome">Volver</a><button mat-flat-button color="primary" type="submit" [disabled]="busy()">{{ busy() ? 'Creando cuenta…' : 'Crear cuenta' }}</button></div>
    </form>
    <p class="auth-footnote">¿Ya tienes cuenta? <a routerLink="/login">Inicia sesión</a></p>
  </mat-card></main>`,
  styleUrl: './auth-page.scss',
})
export class RegisterPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = this.fb.nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    birthDate: ['', Validators.required],
    country: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/)]],
    confirmPassword: ['', Validators.required],
  });

  passwordsDoNotMatch(): boolean { return this.form.controls.confirmPassword.value !== this.form.controls.password.value; }

  submit(): void {
    if (this.form.invalid || this.passwordsDoNotMatch() || this.busy()) { this.form.markAllAsTouched(); return; }
    this.busy.set(true); this.error.set('');
    const { confirmPassword: _confirmPassword, ...input } = this.form.getRawValue();
    this.auth.register(input).subscribe({
      next: () => { this.busy.set(false); void this.router.navigateByUrl('/library'); },
      error: (error: unknown) => { this.busy.set(false); this.error.set(this.message(error)); },
    });
  }

  private message(error: unknown): string {
    const message = error instanceof HttpErrorResponse ? error.error?.message : null;
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string') return message;
    return 'No se pudo crear la cuenta. Revisa los datos e inténtalo de nuevo.';
  }
}
