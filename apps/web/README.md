# Aplicación web de Memoria Viva

Este workspace contiene el frontend Angular. La guía principal del producto, el entorno local y la API está en [`../../README.md`](../../README.md); el alcance V1 y las decisiones de arquitectura están en [`../../docs/MVP_SPEC.md`](../../docs/MVP_SPEC.md) y [`../../docs/PLAN_DESARROLLO.md`](../../docs/PLAN_DESARROLLO.md).

## Desarrollo

Desde la raíz del monorepo, instala dependencias con `npm install` y ejecuta:

```powershell
npm run dev:web
```

Angular queda en `http://127.0.0.1:4200`. La API NestJS debe estar activa en `http://127.0.0.1:3000/api/v1`; levántala con `npm run dev:api`. La base PostgreSQL local se inicia con `docker compose up -d postgres`.

Para compilar producción:

```powershell
npm run build:web
```

## Estructura y conexiones

- `src/app/app.routes.ts` declara rutas lazy y protege con sesión la biblioteca, colecciones, lector y personas.
- `src/app/features/library/` lista colecciones y recuerdos disponibles.
- `src/app/features/collections/collection-detail-page.component.html` enlaza **Añadir recuerdo** al lector con `?create=true`.
- `src/app/features/reader/reader-page.component.ts` controla crear, leer y editar recuerdos en el mismo componente. Su HTML dibuja carrusel, datos, voces y visor a pantalla completa.
- `src/app/core/api/memoria-api.service.ts` es el cliente HTTP tipado de NestJS. `API_BASE_URL` determina el prefijo de la API y el interceptor añade cookies de sesión.
- `src/app/core/offline/offline-collection.service.ts` resuelve URLs de medios locales o descargados para el lector.
- `src/styles.scss` contiene estilos globales del visor a pantalla completa y sus iconos SVG centrados. El componente lector conserva en su SCSS el layout del carrusel y la historia.

El alta no usa una ruta de formulario independiente. La navegación va a `/collections/:id/read?create=true`; al guardar, se crea `POST /events`, se cargan fotos por `/events/:eventId/photos` y audios por `/events/:eventId/narrations`. Al terminar, el lector pasa a modo lectura. Si un archivo falla, los pendientes quedan en el mismo lector para reintentar.

En lectura, el marco principal usa el original del endpoint `/media/assets/:id/content` con `contain`. Las miniaturas solo apoyan la selección; no sustituyen la foto original. El botón de ampliar abre una capa oscura con la imagen completa, flechas para cambiar fotos y cierre con Escape, el control × o el fondo.

## Recursos

Los recursos públicos se guardan en `public/`. Si Angular ya estaba iniciado y se agrega o elimina un recurso de `public/`, reinicia `ng serve` si el navegador no lo recibe.
