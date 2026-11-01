import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: 'welcome', loadComponent: () => import('./features/auth/welcome-page.component').then((module) => module.WelcomePageComponent) },
  { path: 'login', loadComponent: () => import('./features/auth/login-page.component').then((module) => module.LoginPageComponent) },
  { path: 'register', loadComponent: () => import('./features/auth/register-page.component').then((module) => module.RegisterPageComponent) },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'library' },
      { path: 'library', loadComponent: () => import('./features/library/library-page.component').then((module) => module.LibraryPageComponent) },
      { path: 'portability', loadComponent: () => import('./features/import-export/import-export-page.component').then((module) => module.ImportExportPageComponent) },
      { path: 'people', loadComponent: () => import('./features/people/people-page.component').then((module) => module.PeoplePageComponent) },
      { path: 'collections/new', loadComponent: () => import('./features/collections/collection-form-page.component').then((module) => module.CollectionFormPageComponent) },
      { path: 'collections/:id/edit', loadComponent: () => import('./features/collections/collection-form-page.component').then((module) => module.CollectionFormPageComponent) },
      { path: 'collections/:id/read', loadComponent: () => import('./features/reader/reader-page.component').then((module) => module.ReaderPageComponent) },
      { path: 'collections/:id', loadComponent: () => import('./features/collections/collection-detail-page.component').then((module) => module.CollectionDetailPageComponent) },
      { path: 'events/new', loadComponent: () => import('./features/events/event-form-page.component').then((module) => module.EventFormPageComponent) },
      { path: 'events/:id/edit', loadComponent: () => import('./features/events/event-form-page.component').then((module) => module.EventFormPageComponent) },
      { path: 'events/:id', loadComponent: () => import('./features/events/event-detail-page.component').then((module) => module.EventDetailPageComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
