import { createFavoritesRoutes } from '@/lib/favorites-factory';

export const { GET, POST, PUT, DELETE } = createFavoritesRoutes('prompt_favorites');
